import { describe, expect, test } from "vitest";
import { InvitationTokenCrypto } from "../src/invitation-token-crypto.js";

function key(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("platform invitation token encryption", () => {
  test("seals tokens and decrypts retained keys after rotation", async () => {
    const oldKey = key();
    const newKey = key();
    const token = "sensitive-platform-invitation-token";
    const sealed = await new InvitationTokenCrypto({ old: oldKey }).seal(token);

    expect(sealed).not.toContain(token);
    await expect(new InvitationTokenCrypto({ old: oldKey, current: newKey }).open(sealed)).resolves.toBe(token);
    await expect(new InvitationTokenCrypto({ other: key() }).open(sealed)).rejects.toThrow(/could not be decrypted/);
  });
});