import type { AuthenticatedSession, SpacesRepository } from "./repository.js";

export const SessionCookieName = "__Host-spaces-session";
export const CsrfCookieName = "__Host-spaces-csrf";
export const OAuthStateCookieName = "__Host-spaces-oauth-state";

export function parseCookies(request: Request): Readonly<Record<string, string>> {
  const cookies: Record<string, string> = {};
  for (const part of request.headers.get("Cookie")?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return cookies;
}

export function sessionCookies(
  sessionId: string,
  csrfToken: string,
  maxAgeSeconds: number,
  secure = true,
): readonly string[] {
  return [
    cookie(SessionCookieName, sessionId, { httpOnly: true, maxAgeSeconds, secure }),
    cookie(CsrfCookieName, csrfToken, { httpOnly: false, maxAgeSeconds, secure }),
  ];
}

export function clearSessionCookies(secure = true): readonly string[] {
  return [
    cookie(SessionCookieName, "", { httpOnly: true, maxAgeSeconds: 0, secure }),
    cookie(CsrfCookieName, "", { httpOnly: false, maxAgeSeconds: 0, secure }),
  ];
}

export function oauthStateCookie(state: string, maxAgeSeconds: number, secure = true): string {
  return cookie(OAuthStateCookieName, state, {
    httpOnly: true,
    maxAgeSeconds,
    path: "/",
    sameSite: "Lax",
    secure,
  });
}

export function clearOAuthStateCookie(secure = true): string {
  return cookie(OAuthStateCookieName, "", {
    httpOnly: true,
    maxAgeSeconds: 0,
    path: "/",
    sameSite: "Lax",
    secure,
  });
}

export async function passesMutationProtection(
  request: Request,
  publicOrigin: string,
  session: AuthenticatedSession,
  repository: Pick<SpacesRepository, "verifyCsrf">,
): Promise<boolean> {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== new URL(publicOrigin).origin) return false;
  } catch {
    return false;
  }
  const csrfToken = request.headers.get("X-CSRF-Token");
  return csrfToken !== null && csrfToken.length > 0
    && await repository.verifyCsrf(session, csrfToken);
}

export function appendSetCookies(response: Response, values: readonly string[]): Response {
  const headers = new Headers(response.headers);
  for (const value of values) headers.append("Set-Cookie", value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

interface CookieOptions {
  readonly httpOnly: boolean;
  readonly maxAgeSeconds: number;
  readonly secure: boolean;
  readonly path?: string;
  readonly sameSite?: "Lax" | "Strict";
}

function cookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path ?? "/"}`,
    `Max-Age=${options.maxAgeSeconds}`,
    `SameSite=${options.sameSite ?? "Strict"}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}