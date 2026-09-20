// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  MembersView,
  InvitationView,
  IssuerView,
  ControlAuditView,
  UsageView,
} from "../src/ui/index.js";
import { PlatformInvitationAcceptanceView } from "../src/ui/views/platform-invitation-acceptance.js";
import { PlatformInvitationsView } from "../src/ui/views/platform/invitations.js";
import { PeopleView } from "../src/ui/views/people.js";
import { PlatformAuditView } from "../src/ui/views/platform/audit.js";
import { toast } from "sonner";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const STACK = "cas_stack_a";
const ACCOUNT_ID = `acct_${"a".repeat(22)}`;

function accountSummary(displayName: string | null, email: string | null = null) {
  return {
    accountId: ACCOUNT_ID,
    displayName,
    primaryVerifiedEmail: email ? { normalizedEmail: email, source: "google-oidc", verifiedAt: 1 } : null,
    avatar: { kind: "fallback", initials: displayName?.slice(0, 2).toUpperCase() ?? "UC", colorIndex: 1 },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  document.head.innerHTML = '<meta name="x-csrf-token" content="csrf-1" />';
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("InvitationView", () => {
  test("accepts an App membership invitation", async () => {
    fetchMock.mockResolvedValueOnce(json({
      appId: STACK,
      principal: { issuer: "https://accounts.example", subject: "alice" },
      profile: { displayName: "Alice", emailForDisplay: "alice@example.com" },
    }));
    const user = userEvent.setup();
    render(<InvitationView token="invite/1" />);

    await user.click(screen.getByRole("button", { name: "Accept membership" }));
    expect(await screen.findByText(/You are now a member of App/)).toHaveTextContent(STACK);
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/member-invitations/invite%2F1/accept",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("PlatformInvitationAcceptanceView", () => {
  test("accepts platform access and hands control to a full-session reload", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const onAccepted = vi.fn();
    const user = userEvent.setup();
    render(<PlatformInvitationAcceptanceView token="platform/1" onAccepted={onAccepted} />);

    await user.click(screen.getByRole("button", { name: "Accept platform access" }));

    await waitFor(() => expect(onAccepted).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/platform-invitations/platform%2F1/accept",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("PlatformInvitationsView", () => {
  test("creates and conditionally revokes platform invitations", async () => {
    const invitation = {
      invitationId: "platform-invite-1",
      emailConstraint: "developer@example.com",
      authorities: ["apps.create"],
      status: "pending",
      expiresAt: 4102444800000,
      createdAt: 1,
      createdByAccountId: ACCOUNT_ID,
      revision: 1,
    };
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "POST") return json({ invitationId: invitation.invitationId, acceptUrl: "https://console.example/admin/platform-invitations/secret-token", expiresAt: invitation.expiresAt }, 201);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return json({ items: [{ kind: "invitation", invitation }], nextCursor: null });
    });
    const user = userEvent.setup();
    render(<PlatformInvitationsView />);

    expect(await screen.findByText("developer@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.click(screen.getByLabelText("App creation"));
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByText("https://console.example/admin/platform-invitations/secret-token")).toBeVisible();
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(createCall?.[0]).toBe("/admin/platform/invitations");
    expect((createCall?.[1]?.headers as Headers).get("Idempotency-Key")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Done" }));

    await user.click(screen.getByTitle("Revoke invitation"));
    await user.click(screen.getByRole("button", { name: "Confirm revoke" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    const revokeCall = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect((revokeCall?.[1]?.headers as Headers).get("If-Match")).toBe('"1"');
  });
});

describe("Platform Accounts PeopleView", () => {
  test("uses cursor pagination and renders App memberships in Account detail", async () => {
    const account = {
      ...accountSummary("Developer", "developer@example.com"),
      blockedAt: null,
      platformAuthorities: ["apps.create"],
      createdAt: 1,
      updatedAt: 1,
      effectiveAccess: "active",
      appMembershipCount: 1,
      lastActiveAt: 1,
    };
    let page = 0;
    fetchMock.mockImplementation(async input => {
      const path = String(input);
      if (path.startsWith("/admin/platform/people?")) {
        page += 1;
        return page === 1
          ? json({ items: [{ kind: "account", account }], nextCursor: "next-page" })
          : json({ items: [], nextCursor: null });
      }
      if (path === `/admin/platform/accounts/${ACCOUNT_ID}`) {
        return json({ ...account, memberships: [{ appId: "app-1", account: accountSummary("Developer", "developer@example.com") }] });
      }
      return new Response(null, { status: 404 });
    });
    const user = userEvent.setup();
    render(<PeopleView scope={{ platform: true }} />);

    const openAccount = await screen.findByRole("button", { name: "Open Account details for Developer" });
    openAccount.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("app-1")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "Developer" })).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).includes("cursor=next-page"))).toBe(true));
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes("after=next-page"))).toBe(false);
    await user.type(screen.getByLabelText("Search people"), "developer");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).includes("query=developer"))).toBe(true));
  });

  test("confirms one authority command without a revision precondition", async () => {
    const account = {
      ...accountSummary("Developer", "developer@example.com"),
      blockedAt: null,
      platformAuthorities: ["apps.create"],
      createdAt: 1,
      updatedAt: 1,
      effectiveAccess: "active",
      appMembershipCount: 0,
      lastActiveAt: null,
      memberships: [],
    };
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/admin/platform/people?")) return json({ items: [{ kind: "account", account }], nextCursor: null });
      if (path === `/admin/platform/accounts/${ACCOUNT_ID}` && !init?.method) return json(account);
      if (path === `/admin/platform/accounts/${ACCOUNT_ID}/authorities/apps.create` && init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    });
    const user = userEvent.setup();
    render(<PeopleView scope={{ platform: true }} />);

    await user.click(await screen.findByRole("button", { name: "Open Account details for Developer" }));
    await user.click(await screen.findByLabelText(/^Create Apps/));
    expect(await screen.findByRole("dialog", { name: "Confirm Platform Access change" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    await user.click(screen.getByLabelText(/^Create Apps/));
    await user.click(screen.getByRole("button", { name: "Confirm change" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    const command = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(command?.[0]).toBe(`/admin/platform/accounts/${ACCOUNT_ID}/authorities/apps.create`);
    expect((command?.[1]?.headers as Headers).get("If-Match")).toBeNull();
  });
});

describe("PlatformAuditView", () => {
  test("applies Account filters and preserves them across cursor pagination", async () => {
    const event = {
      eventId: "event-1",
      action: "platform_invitation.created",
      actorAccount: accountSummary("Admin", "admin@example.com"),
      authenticatedIdentity: { externalIdentityId: "ext-admin", provider: "google", accountHint: null, linkedAt: 1, lastAuthenticatedAt: 1, currentLogin: false, issuer: "https://accounts.example", subject: "admin" },
      targetAccount: null,
      targetInvitationId: "invitation-1",
      result: "succeeded",
      requestId: "request-1",
      createdAt: 1,
      details: {},
    };
    fetchMock
      .mockResolvedValueOnce(json({ items: [], nextCursor: null }))
      .mockResolvedValueOnce(json({ items: [event], nextCursor: "audit-next" }))
      .mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    const user = userEvent.setup();
    render(<PlatformAuditView />);

    await screen.findByText("No changes found.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Change Logs" }).querySelector(".bg-card")).toBeNull();
    const actorFilter = screen.getByLabelText("Actor Account ID");
    expect(actorFilter).toHaveAttribute("name", "actorAccountId");
    expect(actorFilter).toHaveAttribute("autocomplete", "off");
    await user.type(actorFilter, ACCOUNT_ID);
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("Platform invitation created")).toBeInTheDocument();
    expect(await screen.findByText("platform_invitation.created")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Change Logs" })).getByRole("table")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).includes("cursor=audit-next"))).toBe(true));
    const pagedPath = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(pagedPath).toContain(`actorAccountId=${ACCOUNT_ID}`);
    expect(pagedPath).toContain("cursor=audit-next");
  });

  test("renders complete mobile audit summaries without a wide table", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const event = {
      eventId: "event-mobile",
      action: "platform_access.restored",
      actorAccount: accountSummary("Admin", "admin@example.com"),
      authenticatedIdentity: { externalIdentityId: "ext-admin", provider: "google", accountHint: null, linkedAt: 1, lastAuthenticatedAt: 1, currentLogin: false, issuer: "https://accounts.example", subject: "admin" },
      targetAccount: accountSummary("Developer", "developer@example.com"),
      targetInvitationId: null,
      result: "succeeded",
      requestId: "request-mobile",
      createdAt: 1,
      details: {},
    };
    fetchMock.mockResolvedValueOnce(json({ items: [event], nextCursor: null }));
    try {
      render(<PlatformAuditView />);
      const item = await screen.findByRole("listitem", { name: "Account access restored, succeeded" });
      expect(within(item).getByText("platform_access.restored")).toBeVisible();
      expect(within(item).getByText("Admin")).toBeVisible();
      expect(within(item).getByText(ACCOUNT_ID)).toBeVisible();
      expect(within(item).getByRole("button", { name: /Copy Request ID request-mobile/ })).toBeVisible();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    }
  });

  test("ignores a stale platform audit response after filters change", async () => {
    let resolveOld!: (response: Response) => void;
    const oldRequest = new Promise<Response>(resolve => { resolveOld = resolve; });
    const identity = { externalIdentityId: "ext-admin", provider: "google", accountHint: null, linkedAt: 1, lastAuthenticatedAt: 1, currentLogin: false, issuer: "https://accounts.example", subject: "admin" };
    const oldEvent = { eventId: "old", action: "platform_access.blocked", actorAccount: accountSummary("Old Admin"), authenticatedIdentity: identity, targetAccount: accountSummary("Developer"), targetInvitationId: null, result: "succeeded", requestId: null, createdAt: 1, details: {} };
    const newEvent = { ...oldEvent, eventId: "new", action: "platform_access.restored", actorAccount: accountSummary("New Admin") };
    fetchMock.mockImplementationOnce(() => oldRequest).mockResolvedValueOnce(json({ items: [newEvent], nextCursor: null }));
    const user = userEvent.setup();
    render(<PlatformAuditView />);

    await user.type(screen.getByLabelText("Actor Account ID"), ACCOUNT_ID);
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("Account access restored")).toBeVisible();
    await act(async () => resolveOld(json({ items: [oldEvent], nextCursor: null })));
    expect(screen.queryByText("Account access blocked")).not.toBeInTheDocument();
    expect(screen.getByText("New Admin")).toBeVisible();
  });
});

function externalIssuer() {
  return {
    appId: STACK,
    issuer: "https://issuer.example",
    audience: `https://cas.example/stacks/${STACK}`,
    metadataUrl: "https://cas.example/metadata",
    metadataType: "oauth",
    authorizationEndpoint: "https://cas.example/authorize",
    tokenEndpoint: "https://cas.example/token",
    jwksUri: "https://cas.example/jwks",
    registrationEndpoint: null,
    scopesSupported: ["cas:manage"],
    codeChallengeMethodsSupported: ["S256"],
    status: "active",
    verifiedAt: 1,
    lastRefreshAt: 1,
    lastRefreshError: null,
    jwksDigest: "digest",
    capabilityMaxLifetimeSeconds: 3600,
    revision: 1,
  };
}

describe("MembersView", () => {
  test("filters and pages invitations and revokes using the invitation revision", async () => {
    const invitation = { appId: STACK, invitationId: "inv/1", status: "pending", emailConstraint: "invitee@example.test", expiresAt: 4102444800000, createdAt: 1, revision: 7 };
    fetchMock
      .mockResolvedValueOnce(json({ items: [{ kind: "invitation", invitation }], nextCursor: "page-2" }))
      .mockResolvedValueOnce(json({ items: [{ kind: "invitation", invitation: { ...invitation, invitationId: "inv_2", emailConstraint: "second@example.test" } }], nextCursor: null }))
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: { ETag: '"8"' } }))
      .mockResolvedValueOnce(json({ items: [{ kind: "invitation", invitation: { ...invitation, status: "revoked", revision: 8 } }], nextCursor: null }))
      .mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    const user = userEvent.setup();
    render(<MembersView appId={STACK} appRevision={99} onChanged={() => undefined} />);
    expect(await screen.findByText("invitee@example.test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("second@example.test")).toBeInTheDocument();
    await user.click(screen.getAllByTitle("Revoke invitation")[0]!);
    expect(screen.getByRole("dialog", { name: "Revoke invitation" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm revoke" }));
    expect(await screen.findByText("revoked")).toBeInTheDocument();
    const deletion = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(deletion?.[0]).toBe(`/admin/apps/${STACK}/member-invitations/inv%2F1`);
    expect(new Headers(deletion?.[1]?.headers).get("If-Match")).toBe('"7"');
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=page-2");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    screen.getByRole("combobox", { name: "People collection" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("option", { name: "Invitation history" }));
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("No people found.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("filter=history");
  });

  test("clears one-time invitation URLs when switching Apps", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({ invitationId: "inv_1", expiresAt: 4102444800000, acceptUrl: "https://console.example.test/synthetic-once" }))
      .mockResolvedValueOnce(json({ items: [] }));
    const user = userEvent.setup();
    const { rerender } = render(<MembersView appId={STACK} appRevision={1} onChanged={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.click(screen.getByRole("radio", { name: /Anyone with the one-time link/ }));
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByText("https://console.example.test/synthetic-once")).toBeInTheDocument();
    rerender(<MembersView appId="other-app" appRevision={1} onChanged={() => undefined} />);
    expect(screen.queryByText("https://console.example.test/synthetic-once")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("lists members and creates an invitation with a copyable URL", async () => {
    fetchMock
      .mockResolvedValueOnce(json({
        items: [
          {
            kind: "member", joinedAt: 1, membership: {
              appId: STACK,
              account: accountSummary("Alice", "alice@example.com"),
            },
          },
        ]
      }))
      .mockResolvedValueOnce(json({
        invitationId: "inv_1", expiresAt: 2000000000000,
        acceptUrl: "https://cas.example/admin/invitations/token-xyz",
      }));
    const user = userEvent.setup();
    render(<MembersView appId={STACK} appRevision={1} onChanged={() => undefined} />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.click(screen.getByRole("radio", { name: /Anyone with the one-time link/ }));
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await waitFor(() => expect(screen.getByText(/Share this one-time URL/)).toBeInTheDocument());
    expect(screen.getByText("https://cas.example/admin/invitations/token-xyz")).toBeInTheDocument();
  });

  test("removing an App member sends only the Account ID", async () => {
    fetchMock
      .mockResolvedValueOnce(json({
        items: [
          {
            kind: "member", joinedAt: 1, membership: {
              appId: STACK,
              account: accountSummary(null),
            },
          },
        ]
      }))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ items: [] }));
    const user = userEvent.setup();
    render(<MembersView appId={STACK} appRevision={3} onChanged={() => undefined} />);
    await waitFor(() => expect(screen.getByTitle("Remove member")).toBeInTheDocument());
    await user.click(screen.getByTitle("Remove member"));
    await user.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(screen.getByText("No people found.")).toBeInTheDocument());
    const deleteCall = fetchMock.mock.calls.find((call) => call[1]?.method === "DELETE");
    expect(deleteCall).toBeDefined();
    expect(new Headers(deleteCall![1]!.headers).get("If-Match")).toBeNull();
    expect(deleteCall![0]).toBe(`/admin/apps/${STACK}/members?accountId=${ACCOUNT_ID}`);
  });
});

describe("IssuerView", () => {
  test("shows the connect form when no OAuth issuer is configured", async () => {
    fetchMock.mockResolvedValueOnce(json(null));
    render(<IssuerView appId={STACK} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inspect issuer" })).toBeInTheDocument());
    const customCard = screen.getByRole("heading", { name: "Custom OAuth authorization server" }).closest<HTMLDivElement>("div[class*='bg-card']")!;
    expect(within(customCard).queryByText(/Status:/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(`/admin/apps/${STACK}/oauth-issuer?optional=true`);
  });

  test("shows status for an active OAuth issuer", async () => {
    fetchMock.mockResolvedValueOnce(json({
      appId: STACK,
      issuer: "https://issuer.example/oauth",
      audience: `https://cas.example/stacks/${STACK}`,
      metadataUrl: "https://issuer.example/.well-known/oauth-authorization-server/oauth",
      metadataType: "oauth",
      authorizationEndpoint: "https://issuer.example/oauth/authorize",
      tokenEndpoint: "https://issuer.example/oauth/token",
      jwksUri: "https://issuer.example/oauth/jwks",
      registrationEndpoint: null,
      scopesSupported: ["cas:read"],
      codeChallengeMethodsSupported: ["S256"],
      status: "active",
      verifiedAt: 10,
      lastRefreshAt: 11,
      lastRefreshError: null,
      jwksDigest: "digest",
      capabilityMaxLifetimeSeconds: 1800,
      revision: 2,
    }));
    render(<IssuerView appId={STACK} />);
    const customCard = screen.getByRole("heading", { name: "Custom OAuth authorization server" }).closest<HTMLDivElement>("div[class*='bg-card']")!;
    await waitFor(() => expect(within(customCard).getByText(/Status:/)).toHaveTextContent("active"));
    expect(screen.getByRole("button", { name: "Inspect replacement" })).toBeEnabled();
    expect(screen.getByLabelText("Issuer")).toBeEnabled();
    expect(screen.getByRole("link", { name: "https://issuer.example/oauth/jwks" }))
      .toHaveAttribute("href", "https://issuer.example/oauth/jwks");
  });

  test("keeps current authority visible while inspecting and replacing a candidate", async () => {
    const current = { ...externalIssuer(), issuer: "https://current.example", revision: 9 };
    fetchMock.mockResolvedValueOnce(json(current))
      .mockResolvedValueOnce(json({ inspectionId: "candidate", metadataUrl: "https://replacement.example/metadata", jwksUri: "https://replacement.example/jwks", challenge: "candidate-challenge", expiresAt: 4102444800000, keys: [{ kid: "key", algorithm: "ES256" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: { ETag: '"10"' } }))
      .mockResolvedValueOnce(json({ ...current, issuer: "https://replacement.example", revision: 10 }));
    const user = userEvent.setup();
    render(<IssuerView appId={STACK} />);
    const input = await screen.findByLabelText("Issuer", { selector: "#oauth-issuer-url" });
    await waitFor(() => expect(input).toBeEnabled());
    await user.clear(input);
    await user.type(input, "https://replacement.example");
    await user.click(screen.getByRole("button", { name: "Inspect replacement" }));
    expect(await screen.findByText("candidate-challenge")).toBeInTheDocument();
    const custom = screen.getByRole("heading", { name: "Custom OAuth authorization server" }).closest<HTMLDivElement>("div[class*='bg-card']")!;
    expect(within(custom).getByText(/Status:/)).toHaveTextContent("https://current.example");
    expect(within(custom).getByText(/Status:/)).toHaveTextContent("active");
    await user.type(screen.getByLabelText("Activation proof (compact JWS)"), "synthetic-proof");
    await user.click(screen.getByRole("button", { name: "Verify and replace" }));
    await waitFor(() => expect(within(custom).getByText(/Status:/)).toHaveTextContent("https://replacement.example"));
    const update = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(new Headers(update?.[1]?.headers).get("If-Match")).toBe('"9"');
    expect(new Headers(update?.[1]?.headers).has("If-None-Match")).toBe(false);
  });

  test("inspects and activates a standards-based OAuth issuer", async () => {
    fetchMock
      .mockResolvedValueOnce(json(null))
      .mockResolvedValueOnce(json({
        inspectionId: "oinsp_1", appId: STACK, issuer: "https://auth.example", audience: `https://cas.example/stacks/${STACK}`,
        metadataUrl: "https://auth.example/.well-known/oauth-authorization-server", metadataType: "oauth",
        authorizationEndpoint: "https://auth.example/authorize", tokenEndpoint: "https://auth.example/token",
        jwksUri: "https://auth.example/jwks", registrationEndpoint: null, scopesSupported: ["cas:read"],
        codeChallengeMethodsSupported: ["S256"], metadataDigest: "m", jwksDigest: "j",
        capabilityMaxLifetimeSeconds: 1800, challenge: "cas-oauth-issuer-inspection-v1\nchallenge",
        expiresAt: 1000, keys: [{ kid: "key-1", algorithm: "ES256", publicJwk: {} }], revision: 1,
      }))
      .mockResolvedValueOnce(json({ appId: STACK, status: "active", revision: 2 }))
      .mockResolvedValueOnce(json({
        appId: STACK,
        issuer: "https://auth.example",
        audience: `https://cas.example/stacks/${STACK}`,
        metadataUrl: "https://auth.example/.well-known/oauth-authorization-server",
        metadataType: "oauth",
        authorizationEndpoint: "https://auth.example/authorize",
        tokenEndpoint: "https://auth.example/token",
        jwksUri: "https://auth.example/jwks",
        registrationEndpoint: null,
        scopesSupported: ["cas:read"],
        codeChallengeMethodsSupported: ["S256"],
        status: "active",
        verifiedAt: 20,
        lastRefreshAt: 21,
        lastRefreshError: null,
        jwksDigest: "j",
        capabilityMaxLifetimeSeconds: 1800,
        revision: 2,
      }));
    const user = userEvent.setup();
    render(<IssuerView appId={STACK} />);
    await user.type(await screen.findByLabelText("Issuer", { selector: "#oauth-issuer-url" }), "https://auth.example");
    await user.click(screen.getByRole("button", { name: "Inspect issuer" }));
    await screen.findByText(/cas-oauth-issuer-inspection-v1/);
    await user.type(screen.getByLabelText("Activation proof (compact JWS)"), "proof");
    await user.click(screen.getByRole("button", { name: "Verify and activate" }));
    const customCard = screen.getByRole("heading", { name: "Custom OAuth authorization server" }).closest<HTMLDivElement>("div[class*='bg-card']")!;
    await waitFor(() => expect(within(customCard).getByText(/Status:/)).toHaveTextContent("active"));
    const inspectionCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/oauth-issuer/inspections"));
    expect(JSON.parse(inspectionCall![1]!.body as string)).toEqual({ issuer: "https://auth.example" });
    const activationCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT" && String(call[0]).endsWith("/oauth-issuer"));
    expect(new Headers(activationCall?.[1]?.headers).get("If-None-Match")).toBe("*");
    expect(new Headers(activationCall?.[1]?.headers).has("If-Match")).toBe(false);
  });
});

describe("ControlAuditView", () => {
  test("paginates audit events with load more", async () => {
    const auditIdentity = { externalIdentityId: "ext-alice", provider: "google", accountHint: null, linkedAt: 1, lastAuthenticatedAt: 1, currentLogin: false, issuer: "iss", subject: "alice" };
    fetchMock
      .mockResolvedValueOnce(json({
        items: [
          { eventId: "evt_1", appId: STACK, actorAccount: accountSummary("Alice"), authenticatedIdentity: auditIdentity, targetAccount: null, action: "app.created", target: STACK, requestId: "r1", traceId: null, caller: null, createdAt: 1 },
          { eventId: "evt_legacy", appId: STACK, actorAccount: accountSummary("Alice"), authenticatedIdentity: auditIdentity, targetAccount: null, action: "issuer.put", target: STACK, requestId: "r0", traceId: null, caller: null, createdAt: 0 },
        ], nextCursor: "cursor-2"
      }))
      .mockResolvedValueOnce(json({
        items: [
          { eventId: "evt_2", appId: STACK, actorAccount: accountSummary("Bob"), authenticatedIdentity: { ...auditIdentity, externalIdentityId: "ext-bob", subject: "bob" }, targetAccount: null, action: "member.invited", target: "inv_1", requestId: "r2", traceId: null, caller: null, createdAt: 2 },
        ], nextCursor: null
      }));
    const user = userEvent.setup();
    render(<ControlAuditView appId={STACK} />);
    await waitFor(() => expect(screen.getByText("app.created")).toBeInTheDocument());
    expect(screen.getByText("App created")).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy Request ID r1" })).toBeVisible();
    expect(screen.getByText("Legacy")).toHaveAttribute("title", "Historical action from the retired issuer-key API");
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("member.invited")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  test("renders complete mobile App audit summaries without a wide table", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const auditIdentity = { externalIdentityId: "ext-alice", provider: "google", accountHint: null, linkedAt: 1, lastAuthenticatedAt: 1, currentLogin: false, issuer: "iss", subject: "alice" };
    fetchMock.mockResolvedValueOnce(json({
      items: [{ eventId: "evt_mobile", appId: STACK, actorAccount: accountSummary("Alice"), authenticatedIdentity: auditIdentity, targetAccount: null, action: "member.invited", target: "inv_1", requestId: "r-mobile", traceId: null, caller: null, createdAt: 1 }],
      nextCursor: null,
    }));
    try {
      render(<ControlAuditView appId={STACK} />);
      const item = await screen.findByRole("listitem", { name: "Member invited" });
      expect(within(item).getByText("member.invited")).toBeVisible();
      expect(within(item).getByText("Alice")).toBeVisible();
      expect(within(item).getByText("inv_1")).toBeVisible();
      expect(within(item).getByRole("button", { name: "Copy Request ID r-mobile" })).toBeVisible();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
    }
  });

  test("ignores a stale App audit response after filters change", async () => {
    let resolveOld!: (response: Response) => void;
    const oldRequest = new Promise<Response>(resolve => { resolveOld = resolve; });
    const identity = { externalIdentityId: "ext-alice", provider: "google", accountHint: null, linkedAt: 1, lastAuthenticatedAt: 1, currentLogin: false, issuer: "iss", subject: "alice" };
    const oldEvent = { eventId: "old", appId: STACK, actorAccount: accountSummary("Old Admin"), authenticatedIdentity: identity, targetAccount: null, action: "app.suspended", target: STACK, requestId: null, traceId: null, caller: null, createdAt: 1 };
    const newEvent = { ...oldEvent, eventId: "new", actorAccount: accountSummary("New Admin"), action: "app.restored" };
    fetchMock.mockImplementationOnce(() => oldRequest).mockResolvedValueOnce(json({ items: [newEvent], nextCursor: null }));
    const user = userEvent.setup();
    render(<ControlAuditView appId={STACK} />);

    await user.type(screen.getByLabelText("Actor Account ID"), ACCOUNT_ID);
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("App restored")).toBeVisible();
    await act(async () => resolveOld(json({ items: [oldEvent], nextCursor: null })));
    expect(screen.queryByText("App suspended")).not.toBeInTheDocument();
    expect(screen.getByText("New Admin")).toBeVisible();
  });
});

describe("UsageView", () => {
  test("documents the delegated Space data-plane read", () => {
    render(<UsageView appId={STACK} />);
    expect(screen.getByText(/Usage is a Space data-plane read/)).toBeInTheDocument();
  });
});
