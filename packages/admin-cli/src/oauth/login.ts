/**
 * Interactive `unicas login`: the CLI never talks to Google directly. It opens
 * the browser at the BFF's `/admin/auth/cli/authorize` endpoint, which runs
 * the selected provider flow (client secret held server-side), then redirects the
 * browser back to the CLI's loopback with a one-time code. The CLI exchanges
 * the code (PKCE) for a BFF session cookie + CSRF token and persists it.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  generateOidcState,
  generatePkceVerifier,
  s256Challenge,
} from "@unicas/control-auth";
import type { ProviderKind } from "@unicas/admin-protocol";
import type { PersistedSession, TokenStore } from "../store.js";

export interface LoginFlowOptions {
  /** Origin of the `/admin` API. */
  readonly adminOrigin: string;
  readonly store: TokenStore;
  /** Explicit loopback port; `0` (default) picks a free ephemeral port. */
  readonly port?: number;
  /** Open the system browser automatically (default true). */
  readonly openBrowser?: boolean;
  /** Authentication provider selected for this login. */
  readonly provider?: ProviderKind;
  /** Injectable fetch for tests. */
  readonly fetchImpl?: typeof fetch;
  /** Abort signal; rejects the pending callback with an error. */
  readonly signal?: AbortSignal;
  /** Log line sink (defaults to stderr). */
  readonly log?: (message: string) => void;
  /** Test hook: invoked with the loopback port once the callback server listens. */
  readonly onCallbackServerStarted?: (port: number) => void;
  /** Test hook: invoked with the BFF authorize URL right before the browser opens. */
  readonly onAuthorizeUrl?: (url: URL) => void;
}

export interface LoginFlowResult {
  readonly session: PersistedSession;
  readonly authorizationUrl: string;
  readonly identity: {
    readonly identityIssuer: string;
    readonly subject: string;
    readonly displayName: string | null;
    readonly emailForDisplay: string | null;
  } | null;
}

const CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;

export async function runLoginFlow(options: LoginFlowOptions): Promise<LoginFlowResult> {
  const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const callback = new LocalCallbackServer(options.signal);
  await callback.start(options.port ?? 0);
  options.onCallbackServerStarted?.(callback.port);
  const redirectUri = `http://127.0.0.1:${callback.port}/callback`;

  const state = generateOidcState();
  const codeVerifier = generatePkceVerifier();
  const codeChallenge = await s256Challenge(codeVerifier);
  const authorizeUrl = new URL(`${options.adminOrigin}/admin/auth/cli/authorize`);
  authorizeUrl.searchParams.set("client_id", "unicas-cli");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  if (options.provider) authorizeUrl.searchParams.set("provider", options.provider);
  callback.captureState(state);
  options.onAuthorizeUrl?.(authorizeUrl);
  log("");
  log("Open this URL in your browser to authorize the UniCAS CLI:");
  log(`  ${authorizeUrl.toString()}`);
  log("");
  if (options.openBrowser !== false) {
    await openBrowser(authorizeUrl.toString()).catch(() => {
      log("Could not open a browser automatically; copy the URL above.");
    });
  }

  const code = await callback.waitForCode();
  await callback.close();

  let response: Response;
  try {
    response = await fetchImpl(`${options.adminOrigin}/admin/auth/cli/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, codeVerifier }),
    });
  } catch (error) {
    throw new Error(
      `failed to reach /admin/auth/cli/exchange at ${options.adminOrigin} — check network/proxy access`,
      { cause: error },
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown };
    const detail = typeof body.message === "string" ? `: ${body.message}` : "";
    throw new Error(`admin session exchange failed with HTTP ${response.status}${detail}`);
  }
  const setCookie = response.headers.get("Set-Cookie");
  const body = await response.json() as { csrfToken?: unknown; identity?: unknown };
  if (setCookie === null || typeof body.csrfToken !== "string" || body.csrfToken.length === 0) {
    throw new Error("admin session exchange returned no session");
  }
  const identity = typeof body.identity === "object" && body.identity !== null
    ? body.identity as LoginFlowResult["identity"]
    : null;
  const session: PersistedSession = {
    adminOrigin: options.adminOrigin,
    cookie: setCookie.split(";")[0]!,
    csrfToken: body.csrfToken,
    identity: identity ?? undefined,
    savedAt: Date.now(),
  };
  await options.store.save(session);
  return { session, authorizationUrl: authorizeUrl.toString(), identity };
}

class LocalCallbackServer {
  readonly #signal: AbortSignal | undefined;
  readonly #server = createServer((request, response) => this.#handle(request.url ?? "/", response));
  #port = 0;
  #state: string | undefined;
  #authorizeUrl = "";
  #waiters: Waiter[] = [];

  constructor(signal: AbortSignal | undefined) {
    this.#signal = signal;
  }

  get port(): number {
    return this.#port;
  }

  get authorizationUrl(): string {
    return this.#authorizeUrl;
  }

  start(requestedPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(requestedPort, "127.0.0.1", () => {
        this.#server.removeListener("error", reject);
        this.#port = (this.#server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  captureState(state: string | undefined): void {
    this.#state = state;
  }

  captureAuthorizeUrl(url: string): void {
    this.#authorizeUrl = url;
  }

  waitForCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      waiter.timeout = setTimeout(() => {
        this.#settle(waiter, undefined, new Error("Timed out waiting for the browser authorization callback"));
      }, CALLBACK_TIMEOUT_MS);
      this.#waiters.push(waiter);
      if (this.#signal) {
        const onAbort = () => this.#settle(waiter, undefined, new Error("login aborted"));
        if (this.#signal.aborted) {
          onAbort();
        } else {
          this.#signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const waiter of this.#waiters) {
        this.#settle(waiter, undefined, new Error("login interrupted"));
      }
      this.#waiters = [];
      this.#server.close(() => resolve());
    });
  }

  #handle(rawUrl: string, response: ServerResponse): void {
    const url = new URL(rawUrl, "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      respondHtml(response, 404, {
        status: "Not found",
        title: "Page not found",
        message: "This authorization callback is not available.",
        nextStep: "Return to your terminal and start sign-in again.",
        tone: "error",
      });
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (error) {
      const description = url.searchParams.get("error_description") ?? "";
      respondHtml(response, 400, {
        status: "Failed",
        title: "Authorization failed",
        message: `${error}${description ? `: ${description}` : ""}`,
        nextStep: "Return to your terminal and start sign-in again.",
        tone: "error",
      });
      this.#failAll(new Error(`authorization error: ${error}${description ? ` (${description})` : ""}`));
      return;
    }
    if (!code) {
      respondHtml(response, 400, {
        status: "Failed",
        title: "Authorization failed",
        message: "No authorization code was returned.",
        nextStep: "Return to your terminal and start sign-in again.",
        tone: "error",
      });
      this.#failAll(new Error("authorization callback did not include a code"));
      return;
    }
    if (this.#state !== undefined && state !== this.#state) {
      respondHtml(response, 400, {
        status: "Failed",
        title: "Authorization failed",
        message: "The authorization state did not match, so sign-in was stopped.",
        nextStep: "Return to your terminal and start sign-in again.",
        tone: "error",
      });
      this.#failAll(new Error("authorization callback state mismatch"));
      return;
    }
    respondHtml(response, 200, {
      status: "Connected",
      title: "Authorization complete",
      message: "UniCAS is connected. Return to your terminal to continue.",
      nextStep: "You can close this window",
      tone: "success",
    });
    this.#settleAll(code);
  }

  #settleAll(code: string): void {
    for (const waiter of this.#waiters) this.#settle(waiter, code, undefined);
    this.#waiters = [];
  }

  #failAll(error: Error): void {
    for (const waiter of this.#waiters) this.#settle(waiter, undefined, error);
    this.#waiters = [];
  }

  #settle(waiter: Waiter, code: string | undefined, error: Error | undefined): void {
    if (waiter.timeout !== undefined) clearTimeout(waiter.timeout);
    if (error) waiter.reject(error);
    else if (code !== undefined) waiter.resolve(code);
  }
}

interface Waiter {
  resolve(code: string): void;
  reject(error: Error): void;
  timeout?: NodeJS.Timeout;
}

interface CallbackPage {
  readonly status: string;
  readonly title: string;
  readonly message: string;
  readonly nextStep: string;
  readonly tone: "success" | "error";
}

function respondHtml(response: ServerResponse, statusCode: number, page: CallbackPage): void {
  const title = escapeHtml(page.title);
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - UniCAS</title>
  <style>
    :root { color-scheme: light; font-family: "Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { min-width: 320px; min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; color: #18181b; background-color: #f6f6f7; background-image: linear-gradient(rgba(24,24,27,.024) 1px, transparent 1px), linear-gradient(90deg, rgba(24,24,27,.024) 1px, transparent 1px); background-size: 28px 28px; font-size: 14px; line-height: 1.5; }
    main { width: min(380px, 100%); padding: 24px; background: #fff; border: 1px solid #dddde0; border-radius: 8px; box-shadow: 0 14px 38px rgba(24,24,27,.09); }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
    .brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; }
    .brand-mark { display: grid; width: 30px; height: 30px; place-items: center; color: #fff; background: #263746; border-radius: 6px; font-size: 11px; font-weight: 800; }
    .status { padding-top: 1px; font-size: 11px; font-weight: 750; text-transform: uppercase; white-space: nowrap; }
    .status.success { color: #0f766e; }
    .status.error { color: #b42318; }
    h1 { margin: 0 0 8px; font-size: 21px; line-height: 1.25; }
    p { margin: 0; color: #66666f; }
    .next-step { display: flex; width: fit-content; min-height: 22px; align-items: center; margin: 18px auto 0; padding: 2px 8px; border: 1px solid #b9ddd7; border-radius: 999px; color: #115e59; background: #e8f5f2; font-size: 11px; font-weight: 650; white-space: nowrap; }
    main.error .next-step { color: #7f1d1d; background: #fff1f0; border-color: #f1b8b2; }
  </style>
</head>
<body>
  <main class="${page.tone}" aria-labelledby="result-title">
    <header>
      <span class="brand"><span class="brand-mark">U</span><span>UniCAS</span></span>
      <span class="status ${page.tone}">${escapeHtml(page.status)}</span>
    </header>
    <div class="content" ${page.tone === "error" ? 'role="alert"' : 'role="status"'}>
      <h1 id="result-title">${title}</h1>
      <p>${escapeHtml(page.message)}</p>
      <p class="next-step">${escapeHtml(page.nextStep)}</p>
    </div>
  </main>
</body>
</html>`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

/** Opens the system browser; resolves regardless of whether a browser exists. */
export async function openBrowser(url: string): Promise<void> {
  const command = buildOpenBrowserCommand(url);
  await new Promise<void>((resolve) => {
    const child = spawn(command.command, command.args, {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
      windowsVerbatimArguments: command.windowsVerbatimArguments,
    });
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}

export interface OpenBrowserCommand {
  readonly command: string;
  readonly args: string[];
  readonly windowsVerbatimArguments?: boolean;
}

/**
 * Builds the browser-open command. On Windows the URL must be quoted when
 * handed to `cmd /c start`: Node does not quote arguments without spaces, so
 * an unquoted authorization URL is split at every `&` (cmd's command
 * separator), truncating the query string and breaking the OAuth flow.
 */
export function buildOpenBrowserCommand(url: string, platform: NodeJS.Platform = process.platform): OpenBrowserCommand {
  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", '""', "/b", `"${url}"`],
      windowsVerbatimArguments: true,
    };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}
