import { EncryptJWT, jwtDecrypt } from "jose";

export class InvitationTokenCrypto {
  readonly #keys: ReadonlyMap<string, Uint8Array>;
  readonly #newestKid: string;

  constructor(keys: Readonly<Record<string, string>>) {
    const entries = Object.entries(keys);
    if (entries.length === 0) throw new Error("no invitation encryption keys");
    const parsed = new Map<string, Uint8Array>();
    for (const [kid, encoded] of entries) {
      const key = base64UrlDecode(encoded);
      if (key.length !== 32) throw new Error(`invitation key '${kid}' must be 32 bytes`);
      parsed.set(kid, key);
    }
    this.#keys = parsed;
    this.#newestKid = entries.at(-1)![0];
  }

  async seal(token: string): Promise<string> {
    return new EncryptJWT({ v: 1, kind: "platform-invitation-token", token })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", kid: this.#newestKid })
      .encrypt(this.#keys.get(this.#newestKid)!);
  }

  async open(sealed: string): Promise<string> {
    for (const key of this.#keys.values()) {
      try {
        const { payload } = await jwtDecrypt(sealed, key, {
          keyManagementAlgorithms: ["dir"],
          contentEncryptionAlgorithms: ["A256GCM"],
        });
        if (payload.v === 1
          && payload.kind === "platform-invitation-token"
          && typeof payload.token === "string") {
          return payload.token;
        }
      } catch {
        // Try the next retained key.
      }
    }
    throw new Error("platform invitation token could not be decrypted");
  }
}

export function parseInvitationEncryptionKeys(value: string | undefined): Readonly<Record<string, string>> {
  if (!value) throw new Error("SESSION_ENCRYPTION_KEYS must be configured");
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SESSION_ENCRYPTION_KEYS must be a key object");
  }
  return parsed as Readonly<Record<string, string>>;
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}