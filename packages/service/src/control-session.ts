/** Opaque encrypted browser session persisted by a platform adapter. */
export interface StoredSession {
  readonly sessionId: string;
  readonly encryptedPayload: string;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

/** Cloud-neutral persistence port for browser and CLI administrator sessions. */
export interface ControlSessionRepository {
  create(sessionId: string, encryptedPayload: string, ttlMs: number, account?: {
    readonly accountId: string;
    readonly externalIdentityId: string;
    readonly credentialVersion: number;
  }): Promise<void>;
  read(sessionId: string): Promise<StoredSession | null>;
  touch(sessionId: string, ttlMs: number): Promise<void>;
  delete(sessionId: string): Promise<void>;
  pruneExpired(): Promise<number>;
}
