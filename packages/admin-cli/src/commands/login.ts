/** `unicas login` — provider login with a local callback, then BFF session exchange. */

import { parseArgs } from "node:util";
import type { ProviderKind } from "@unicas/admin-protocol";
import type { CliContext } from "./common.js";
import { runLoginFlow } from "../oauth/login.js";

export async function loginCommand(ctx: CliContext, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      "no-browser": { type: "boolean" },
      provider: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(
      "usage: unicas login [--provider google|microsoft|github] [--port N] [--no-browser]\n",
    );
    return;
  }
  const port = values.port === undefined ? 0 : parsePort(values.port);
  const provider = parseProvider(values.provider);

  const result = await runLoginFlow({
    adminOrigin: ctx.config.adminOrigin,
    store: ctx.store,
    port,
    openBrowser: values["no-browser"] !== true,
    provider,
    fetchImpl: ctx.fetchImpl,
  });

  process.stdout.write(`Logged in to ${ctx.config.adminOrigin}\n`);
  process.stdout.write(`  identity: ${result.identity?.emailForDisplay ?? result.identity?.subject ?? "(unknown)"}\n`);
  process.stdout.write(`  session:  ${ctx.store.path}\n`);
}

function parseProvider(value: string | undefined): ProviderKind | undefined {
  if (value === undefined) return undefined;
  if (value === "google" || value === "microsoft" || value === "github") return value;
  throw new Error(`invalid provider '${value}'`);
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid --port '${value}'`);
  }
  return port;
}
