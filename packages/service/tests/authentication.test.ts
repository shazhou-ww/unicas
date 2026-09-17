import { describe, expect, test, vi } from "vitest";
import {
  AUTHENTICATION_FLOW_TTL_MS,
  ProviderRegistry,
  requireInvitationEmailEvidence,
  verifiedProviderEmailEvidence,
  type ProviderAdapter,
} from "../src/index.js";

function adapter(kind: ProviderAdapter["kind"]): ProviderAdapter {
  return {
    kind,
    displayName: kind,
    begin: vi.fn(async () => `https://${kind}.example/authorize`),
    complete: vi.fn(async () => ({
      provider: kind,
      issuer: `https://${kind}.example`,
      subject: "subject",
      displayName: null,
      avatarUrl: null,
      accountHint: null,
      verifiedEmailEvidence: [],
      authenticatedAt: 1,
      authenticationEventId: "event-1",
    })),
  };
}

describe("provider registry", () => {
  test("resolves only configured closed provider names", () => {
    const google = adapter("google");
    const registry = new ProviderRegistry([google]);
    expect(registry.list()).toEqual([google]);
    expect(registry.get("google")).toBe(google);
    expect(registry.get("github")).toBeNull();
  });

  test("rejects duplicate provider registrations", () => {
    expect(() => new ProviderRegistry([adapter("google"), adapter("google")]))
      .toThrow("duplicate provider 'google'");
  });
});

describe("verified email evidence", () => {
  test("normalizes verified Google and GitHub evidence with bounded freshness", () => {
    const google = verifiedProviderEmailEvidence({
      provider: "google",
      email: " Alice@Example.com ",
      verifiedAt: 1000,
      authenticationEventId: "google-event",
    });
    const github = verifiedProviderEmailEvidence({
      provider: "github",
      email: "alice@example.com",
      verifiedAt: 1000,
      authenticationEventId: "github-event",
    });
    expect(google).toMatchObject({ normalizedEmail: "alice@example.com", source: "google-oidc" });
    expect(github).toMatchObject({ normalizedEmail: "alice@example.com", source: "github-emails-api" });
    expect(google.expiresAt).toBe(1000 + AUTHENTICATION_FLOW_TTL_MS);
  });

  test("accepts only fresh exact-address evidence", () => {
    const evidence = verifiedProviderEmailEvidence({
      provider: "google",
      email: "alice@example.com",
      verifiedAt: 1000,
      authenticationEventId: "event-1",
      ttlMs: 100,
    });
    expect(requireInvitationEmailEvidence([evidence], " Alice@Example.com ", 1050)).toBe(evidence);
    expect(() => requireInvitationEmailEvidence([evidence], "other@example.com", 1050))
      .toThrow(expect.objectContaining({ code: "EMAIL_EVIDENCE_MISMATCH" }));
    expect(() => requireInvitationEmailEvidence([evidence], "alice@example.com", 1100))
      .toThrow(expect.objectContaining({ code: "EMAIL_EVIDENCE_STALE" }));
  });

  test("requires separate challenge evidence for Microsoft personal accounts", () => {
    expect(() => requireInvitationEmailEvidence([], "alice@example.com", 1000))
      .toThrow(expect.objectContaining({ code: "EMAIL_EVIDENCE_ABSENT" }));
    const challengeEvidence = {
      normalizedEmail: "alice@example.com",
      source: "unicas-email-challenge" as const,
      verifiedAt: 1000,
      expiresAt: 1100,
      authenticationEventId: "microsoft-event",
    };
    expect(requireInvitationEmailEvidence([challengeEvidence], "alice@example.com", 1050))
      .toBe(challengeEvidence);
  });
});