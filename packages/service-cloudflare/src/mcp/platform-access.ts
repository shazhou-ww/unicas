import type { AccountId, PlatformAuthority } from "@unicas/admin-protocol";
import { AccountServiceError, type AccountService } from "@unicas/service";

interface McpPrincipalProps {
  readonly identityIssuer: string;
  readonly subject: string;
}

export interface McpAccountCredential extends McpPrincipalProps {
  readonly accountId?: AccountId;
  readonly externalIdentityId?: string;
  readonly credentialVersion?: number;
}

export async function checkMcpAccountAccess(
  accounts: Pick<AccountService, "authorizeCredential">,
  props: McpAccountCredential,
  authority?: PlatformAuthority,
): Promise<Response | null> {
  if (!props.accountId || !props.externalIdentityId || !Number.isSafeInteger(props.credentialVersion)
    || props.credentialVersion! < 1) {
    return Response.json({ error: "MCP_ACCESS_NOT_ALLOWED" }, { status: 403 });
  }
  try {
    const resolved = await accounts.authorizeCredential({
      accountId: props.accountId,
      externalIdentityId: props.externalIdentityId,
      credentialVersion: props.credentialVersion!,
    });
    if (resolved.authenticatedIdentity.issuer !== props.identityIssuer
      || resolved.authenticatedIdentity.subject !== props.subject
      || (!resolved.hasAppMembership && resolved.platformAuthorities.length === 0)
      || authority !== undefined && !resolved.platformAuthorities.includes(authority)) {
      return Response.json({ error: "MCP_ACCESS_NOT_ALLOWED" }, { status: 403 });
    }
    return null;
  } catch (error) {
    return error instanceof AccountServiceError
      ? Response.json({ error: "MCP_ACCESS_NOT_ALLOWED" }, { status: 403 })
      : Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }
}
