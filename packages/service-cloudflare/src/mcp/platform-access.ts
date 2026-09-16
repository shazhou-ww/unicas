import type { CasAdminErrorResponse, PlatformAuthority } from "@unicas/admin-protocol";
import { PlatformAccessError, PlatformAccessService } from "@unicas/service";

interface McpPrincipalProps {
  readonly identityIssuer: string;
  readonly subject: string;
}

export async function checkMcpPlatformAccess(
  platformAccess: PlatformAccessService,
  props: McpPrincipalProps,
): Promise<Response | null> {
  try {
    await platformAccess.requireAccess({ issuer: props.identityIssuer, subject: props.subject });
    return null;
  } catch (error) {
    if (error instanceof PlatformAccessError && error.code === "SERVICE_UNAVAILABLE") {
      return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
    }
    return Response.json({ error: "MCP_ACCESS_NOT_ALLOWED" }, { status: 403 });
  }
}

export async function authorizeMcpPlatformOperation(
  platformAccess: PlatformAccessService,
  principal: { readonly issuer: string; readonly subject: string },
  authority: PlatformAuthority,
): Promise<CasAdminErrorResponse | null> {
  try {
    await platformAccess.requireAccess(principal, authority);
    return null;
  } catch (error) {
    if (error instanceof PlatformAccessError) {
      return { error: error.code as CasAdminErrorResponse["error"] };
    }
    return { error: "SERVICE_UNAVAILABLE" };
  }
}