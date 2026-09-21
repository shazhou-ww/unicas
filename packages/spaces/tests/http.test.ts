import { describe, expect, test, vi } from "vitest";
import {
  CsrfCookieName,
  OAuthStateCookieName,
  SessionCookieName,
  oauthStateCookie,
  parseCookies,
  passesMutationProtection,
  sessionCookies,
} from "../src/http.js";
import type { AuthenticatedSession, SpacesRepository } from "../src/repository.js";

const session: AuthenticatedSession = {
  context: {
    principalId: "principal-a",
    status: "active",
    displayName: "Ada",
    provider: "google",
    appId: "app-a",
    spaceId: "space-a",
    refDomain: "spaces",
  },
  csrfTokenHash: "digest",
  expiresAt: 10_000,
};

describe("Spaces HTTP security", () => {
  test("issues host-only secure cookies with the intended visibility", () => {
    const [sessionCookie, csrfCookie] = sessionCookies("session", "csrf", 300);
    expect(sessionCookie).toContain(`${SessionCookieName}=session`);
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(csrfCookie).toContain(`${CsrfCookieName}=csrf`);
    expect(csrfCookie).not.toContain("HttpOnly");
    expect(oauthStateCookie("state", 300)).toContain(`${OAuthStateCookieName}=state`);
    expect(oauthStateCookie("state", 300)).toContain("Path=/auth/google/callback");
  });

  test("parses cookie values containing equals characters", () => {
    const request = new Request("https://spaces.example.test", {
      headers: { Cookie: "first=one; second=two=three" },
    });
    expect(parseCookies(request)).toEqual({ first: "one", second: "two=three" });
  });

  test("requires both exact origin and a valid CSRF token", async () => {
    const repository = {
      verifyCsrf: vi.fn(async (_session, token: string) => token === "valid"),
    } satisfies Pick<SpacesRepository, "verifyCsrf">;
    const request = (origin: string, token: string) => new Request("https://spaces.example.test/api/files", {
      method: "POST",
      headers: { Origin: origin, "X-CSRF-Token": token },
    });

    await expect(passesMutationProtection(
      request("https://spaces.example.test", "valid"),
      "https://spaces.example.test",
      session,
      repository,
    )).resolves.toBe(true);
    await expect(passesMutationProtection(
      request("https://other.example.test", "valid"),
      "https://spaces.example.test",
      session,
      repository,
    )).resolves.toBe(false);
    await expect(passesMutationProtection(
      request("https://spaces.example.test", "wrong"),
      "https://spaces.example.test",
      session,
      repository,
    )).resolves.toBe(false);
  });
});