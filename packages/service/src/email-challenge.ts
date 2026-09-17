import { normalizeEmail, type VerifiedEmailEvidence } from "./authentication.js";
import { generateInvitationToken } from "./control-ids.js";
import { sha256Hex } from "./control-validation.js";

export const EMAIL_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_CHALLENGE_MAX_ATTEMPTS = 5;
export const EMAIL_CHALLENGE_RESEND_INTERVAL_MS = 60 * 1000;
export const EMAIL_CHALLENGE_MAX_SENDS = 3;

export interface EmailChallengeBinding {
  readonly invitationKind: "app" | "platform";
  readonly invitationId: string;
  readonly invitationTokenHash: string;
  readonly issuer: string;
  readonly subject: string;
  readonly authenticationEventId: string;
  readonly normalizedEmail: string;
}

export interface EmailChallengeRecord extends EmailChallengeBinding {
  readonly challengeId: string;
  readonly codeHash: string;
  readonly expiresAt: number;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly sendCount: number;
  readonly lastSentAt: number;
  readonly verifiedAt: number | null;
  readonly consumedAt: number | null;
  readonly invalidatedAt: number | null;
  readonly createdAt: number;
}

export interface EmailChallengeRepository {
  create(record: EmailChallengeRecord, limits: {
    readonly minimumIntervalMs: number;
    readonly windowMs: number;
    readonly maxSends: number;
  }): Promise<"created" | "conflict" | "rate-limited">;
  get(challengeId: string): Promise<EmailChallengeRecord | null>;
  invalidate(input: {
    readonly challengeId: string;
    readonly binding: EmailChallengeBinding;
    readonly now: number;
  }): Promise<void>;
  verify(input: {
    readonly challengeId: string;
    readonly binding: EmailChallengeBinding;
    readonly codeHash: string;
    readonly now: number;
  }): Promise<
    | { readonly kind: "verified"; readonly verifiedAt: number; readonly expiresAt: number }
    | { readonly kind: "failed" }
  >;
  resend(input: {
    readonly challengeId: string;
    readonly binding: EmailChallengeBinding;
    readonly codeHash: string;
    readonly now: number;
    readonly minimumIntervalMs: number;
    readonly maxSends: number;
  }): Promise<
    | { readonly kind: "resent"; readonly expiresAt: number }
    | { readonly kind: "failed" }
  >;
}

export interface EmailChallengeStart {
  readonly challengeId: string;
  readonly binding: EmailChallengeBinding;
  readonly code: string;
  readonly secret: string;
  readonly maskedEmail: string;
  readonly expiresAt: number;
}

export interface EmailChallengeServiceOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly maxAttempts?: number;
  readonly resendIntervalMs?: number;
  readonly maxSends?: number;
  readonly generateChallengeId?: () => string;
  readonly generateCode?: () => string;
  readonly generateSecret?: () => string;
}

export class EmailChallengeError extends Error {
  constructor() {
    super("EMAIL_CHALLENGE_FAILED");
    this.name = "EmailChallengeError";
  }
}

export class EmailChallengeService {
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #maxAttempts: number;
  readonly #resendIntervalMs: number;
  readonly #maxSends: number;
  readonly #generateChallengeId: () => string;
  readonly #generateCode: () => string;
  readonly #generateSecret: () => string;

  constructor(
    readonly repository: EmailChallengeRepository,
    options: EmailChallengeServiceOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? EMAIL_CHALLENGE_TTL_MS;
    this.#maxAttempts = options.maxAttempts ?? EMAIL_CHALLENGE_MAX_ATTEMPTS;
    this.#resendIntervalMs = options.resendIntervalMs ?? EMAIL_CHALLENGE_RESEND_INTERVAL_MS;
    this.#maxSends = options.maxSends ?? EMAIL_CHALLENGE_MAX_SENDS;
    this.#generateChallengeId = options.generateChallengeId ?? (() => `emc_${generateInvitationToken()}`);
    this.#generateCode = options.generateCode ?? generateSixDigitCode;
    this.#generateSecret = options.generateSecret ?? generateInvitationToken;
  }

  async create(input: Omit<EmailChallengeBinding, "normalizedEmail"> & { readonly email: string }): Promise<EmailChallengeStart> {
    const now = this.#now();
    const binding: EmailChallengeBinding = {
      invitationKind: input.invitationKind,
      invitationId: input.invitationId,
      invitationTokenHash: input.invitationTokenHash,
      issuer: input.issuer,
      subject: input.subject,
      authenticationEventId: input.authenticationEventId,
      normalizedEmail: normalizeEmail(input.email),
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const challengeId = this.#generateChallengeId();
      const code = this.#generateCode();
      const secret = this.#generateSecret();
      const expiresAt = now + this.#ttlMs;
      const result = await this.repository.create({
        ...binding,
        challengeId,
        codeHash: await hashCode(challengeId, secret, code),
        expiresAt,
        attemptCount: 0,
        maxAttempts: this.#maxAttempts,
        sendCount: 1,
        lastSentAt: now,
        verifiedAt: null,
        consumedAt: null,
        invalidatedAt: null,
        createdAt: now,
      }, {
        minimumIntervalMs: this.#resendIntervalMs,
        windowMs: this.#ttlMs,
        maxSends: this.#maxSends,
      });
      if (result === "created") {
        return {
          challengeId,
          binding,
          code,
          secret,
          maskedEmail: maskEmail(binding.normalizedEmail),
          expiresAt,
        };
      }
      if (result === "rate-limited") throw new EmailChallengeError();
    }
    throw new EmailChallengeError();
  }

  async describe(challengeId: string, binding: EmailChallengeBinding): Promise<{
    readonly maskedEmail: string;
    readonly expiresAt: number;
  }> {
    const record = await this.repository.get(challengeId);
    if (!record || !sameBinding(record, binding) || record.consumedAt !== null
      || record.invalidatedAt !== null
      || record.expiresAt <= this.#now() || record.attemptCount >= record.maxAttempts) {
      throw new EmailChallengeError();
    }
    return { maskedEmail: maskEmail(record.normalizedEmail), expiresAt: record.expiresAt };
  }

  async verify(input: {
    readonly challengeId: string;
    readonly binding: EmailChallengeBinding;
    readonly secret: string;
    readonly code: string;
  }): Promise<VerifiedEmailEvidence> {
    const now = this.#now();
    const code = /^\d{6}$/.test(input.code) ? input.code : "invalid";
    const result = await this.repository.verify({
      challengeId: input.challengeId,
      binding: input.binding,
      codeHash: await hashCode(input.challengeId, input.secret, code),
      now,
    });
    if (result.kind !== "verified") throw new EmailChallengeError();
    return {
      normalizedEmail: input.binding.normalizedEmail,
      source: "unicas-email-challenge",
      verifiedAt: result.verifiedAt,
      expiresAt: result.expiresAt,
      authenticationEventId: input.binding.authenticationEventId,
      challengeId: input.challengeId,
    };
  }

  async resend(input: {
    readonly challengeId: string;
    readonly binding: EmailChallengeBinding;
  }): Promise<EmailChallengeStart> {
    const now = this.#now();
    const code = this.#generateCode();
    const secret = this.#generateSecret();
    const result = await this.repository.resend({
      challengeId: input.challengeId,
      binding: input.binding,
      codeHash: await hashCode(input.challengeId, secret, code),
      now,
      minimumIntervalMs: this.#resendIntervalMs,
      maxSends: this.#maxSends,
    });
    if (result.kind !== "resent") throw new EmailChallengeError();
    return {
      challengeId: input.challengeId,
      binding: input.binding,
      code,
      secret,
      maskedEmail: maskEmail(input.binding.normalizedEmail),
      expiresAt: result.expiresAt,
    };
  }

  async invalidate(input: {
    readonly challengeId: string;
    readonly binding: EmailChallengeBinding;
  }): Promise<void> {
    await this.repository.invalidate({ ...input, now: this.#now() });
  }
}

function sameBinding(left: EmailChallengeBinding, right: EmailChallengeBinding): boolean {
  return left.invitationKind === right.invitationKind
    && left.invitationId === right.invitationId
    && left.invitationTokenHash === right.invitationTokenHash
    && left.issuer === right.issuer
    && left.subject === right.subject
    && left.authenticationEventId === right.authenticationEventId
    && left.normalizedEmail === right.normalizedEmail;
}

async function hashCode(challengeId: string, secret: string, code: string): Promise<string> {
  return sha256Hex(`${challengeId}\0${secret}\0${code}`);
}

function generateSixDigitCode(): string {
  const range = 1_000_000;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0]!;
  } while (value >= limit);
  return String(value % range).padStart(6, "0");
}

function maskEmail(email: string): string {
  const separator = email.lastIndexOf("@");
  if (separator <= 0) return "***";
  const local = email.slice(0, separator);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}${email.slice(separator)}`;
}