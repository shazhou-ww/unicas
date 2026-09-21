/**
 * Control-audit action vocabulary. Events are append-only; the `action` and
 * `target` strings are stable identifiers, not free-form descriptions.
 */

export const ControlAuditActions = {
  identityCreated: "operator.identity.created",
  identityUpdated: "operator.identity.updated",
  legacyStackCreated: "stack.created",
  legacyStackPatched: "stack.patched",
  appSuspended: "app.suspended",
  appRestored: "app.restored",
  memberInvited: "member.invited",
  memberInvitationAccepted: "member.invitation.accepted",
  memberInvitationRevoked: "member.invitation.revoked",
  memberInvitationExpired: "member.invitation.expired",
  memberRemoved: "member.removed",
  oauthIssuerInspected: "oauth_issuer.inspection.created",
  oauthIssuerActivated: "oauth_issuer.activated",
  oauthIssuerReplaced: "oauth_issuer.replaced",
  sessionLogin: "session.login",
  sessionLoginFailed: "session.login_failed",
  sessionLogout: "session.logout",
} as const;

export type ControlAuditAction =
  (typeof ControlAuditActions)[keyof typeof ControlAuditActions];
