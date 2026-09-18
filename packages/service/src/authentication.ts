import type { ProviderKind, VerifiedEmailSource } from "@unicas/admin-protocol";

export const AUTHENTICATION_FLOW_TTL_MS = 10 * 60 * 1000;

export type ProviderFlowPurpose =
  | "login"
  | "link-current"
  | "link-target"
  | "unlink"
  | "cli"
  | "mcp";

export interface VerifiedEmailEvidence {
  readonly normalizedEmail: string;
  readonly source: VerifiedEmailSource;
  readonly verifiedAt: number;
  readonly expiresAt: number;
  readonly authenticationEventId: string;
  readonly challengeId?: string;
}

export interface AuthenticatedProviderResult {
  readonly provider: ProviderKind;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly accountHint: string | null;
  readonly verifiedEmailEvidence: readonly VerifiedEmailEvidence[];
  readonly authenticatedAt: number;
  readonly authenticationEventId: string;
}

export interface ProviderFlowContext {
  readonly purpose: ProviderFlowPurpose;
  readonly state: string;
  readonly codeChallenge: string;
  readonly nonce: string | null;
}

export interface ProviderCallbackInput {
  readonly code: string;
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string | null;
  readonly authenticationEventId: string;
}

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  readonly displayName: string;
  begin(context: ProviderFlowContext): Promise<string>;
  complete(input: ProviderCallbackInput): Promise<AuthenticatedProviderResult>;
}

export class ProviderRegistry {
  readonly #providers: ReadonlyMap<ProviderKind, ProviderAdapter>;

  constructor(providers: readonly ProviderAdapter[]) {
    const entries = new Map<ProviderKind, ProviderAdapter>();
    for (const provider of providers) {
      if (entries.has(provider.kind)) throw new TypeError(`duplicate provider '${provider.kind}'`);
      entries.set(provider.kind, provider);
    }
    this.#providers = entries;
  }

  list(): readonly ProviderAdapter[] {
    return [...this.#providers.values()];
  }

  get(kind: ProviderKind): ProviderAdapter | null {
    return this.#providers.get(kind) ?? null;
  }
}

export type EmailEvidenceErrorCode =
  | "EMAIL_EVIDENCE_ABSENT"
  | "EMAIL_EVIDENCE_MISMATCH"
  | "EMAIL_EVIDENCE_STALE";

export class EmailEvidenceError extends Error {
  constructor(readonly code: EmailEvidenceErrorCode) {
    super(code);
    this.name = "EmailEvidenceError";
  }
}

export function verifiedProviderEmailEvidence(input: {
  readonly provider: "google" | "github";
  readonly email: string;
  readonly verifiedAt: number;
  readonly authenticationEventId: string;
  readonly ttlMs?: number;
}): VerifiedEmailEvidence {
  return {
    normalizedEmail: normalizeEmail(input.email),
    source: input.provider === "google" ? "google-oidc" : "github-emails-api",
    verifiedAt: input.verifiedAt,
    expiresAt: input.verifiedAt + (input.ttlMs ?? AUTHENTICATION_FLOW_TTL_MS),
    authenticationEventId: input.authenticationEventId,
  };
}

export function requireInvitationEmailEvidence(
  evidence: readonly VerifiedEmailEvidence[],
  invitationEmail: string,
  now: number,
): VerifiedEmailEvidence {
  const normalizedEmail = normalizeEmail(invitationEmail);
  const matching = evidence.filter(item => item.normalizedEmail === normalizedEmail
    && (item.source !== "unicas-email-challenge" || item.challengeId !== undefined));
  if (matching.length === 0) {
    throw new EmailEvidenceError(evidence.length === 0
      ? "EMAIL_EVIDENCE_ABSENT"
      : "EMAIL_EVIDENCE_MISMATCH");
  }
  const fresh = matching
    .filter(item => item.verifiedAt <= now && item.expiresAt > now)
    .sort((left, right) => right.verifiedAt - left.verifiedAt)[0];
  if (!fresh) throw new EmailEvidenceError("EMAIL_EVIDENCE_STALE");
  return fresh;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}