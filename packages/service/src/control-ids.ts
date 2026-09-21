/**
 * Opaque CAS-generated identifiers. Never caller-chosen.
 * All identifiers are URL-safe so they can appear unescaped in paths.
 */

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/** App namespace id, e.g. `cas_AbC...`. */
export function generateAppId(): string {
  return `cas_${randomBase64Url(12)}`;
}

/** Durable Account id containing 128 bits of entropy in base64url form. */
export function generateAccountId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `acct_${encodeBase64Url(bytes)}`;
}

export function generateExternalIdentityId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `ext_${encodeBase64Url(bytes)}`;
}

export function generateInvitationId(): string {
  return `inv_${randomBase64Url(12)}`;
}

export function generatePrincipalRef(): string {
  return `prn_${randomBase64Url(16)}`;
}

export function generateEventId(): string {
  return `evt_${randomBase64Url(12)}`;
}

export function generateOAuthInspectionId(): string {
  return `oinsp_${randomBase64Url(16)}`;
}

export function generateSessionId(): string {
  return `sess_${randomBase64Url(24)}`;
}

/** High-entropy one-time invitation token; only its hash is stored. */
export function generateInvitationToken(): string {
  return randomBase64Url(32);
}

/** Possession-challenge nonce. */
export function generateNonce(): string {
  return randomBase64Url(16);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!;
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    encoded += ALPHABET[first >>> 2];
    encoded += ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >>> 4)];
    if (second !== undefined) {
      encoded += ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >>> 6)];
    }
    if (third !== undefined) encoded += ALPHABET[third & 0x3f];
  }
  return encoded;
}
