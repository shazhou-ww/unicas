/**
 * Tool catalog for `unicas mcp` and the CLI commands.
 *
 * Names, descriptions, input schemas, and annotations mirror the remote
 * MCP ingress hosted by `@unicas/service-cloudflare`
 * (`src/mcp/server.ts`); the CLI must never drift from that contract.
 * Required scopes document what the remote enforces; the CLI does not
 * re-issue scope decisions.
 */

import { APP_ADMIN_MCP_TOOL_LIST } from "@unicas/admin-protocol";
import type { AppAdminMcpToolScope } from "@unicas/admin-protocol";
import { z } from "zod";

export type ControlPlaneToolScope = AppAdminMcpToolScope;

export interface ToolDefinition {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject<z.ZodRawShape>;
  readonly annotations: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
  };
  readonly requiredScope: ControlPlaneToolScope;
}

const APP_TOOL_CATALOG: readonly ToolDefinition[] = APP_ADMIN_MCP_TOOL_LIST.map((toolDefinition) => ({
  name: toolDefinition.name,
  requiredScope: toolDefinition.requiredScope,
  ...toolDefinition.registration,
}));

export const TOOL_CATALOG: readonly ToolDefinition[] = APP_TOOL_CATALOG;

const CATALOG_BY_NAME = new Map(TOOL_CATALOG.map((tool) => [tool.name, tool]));

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return CATALOG_BY_NAME.get(name);
}

/** Default idempotency key generator for creation commands. */
export function generateIdempotencyKey(): string {
  return `unicas-cli:${crypto.randomUUID()}`;
}
