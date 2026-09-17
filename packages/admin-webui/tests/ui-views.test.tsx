// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  MembersView,
  InvitationView,
  IssuerView,
  ControlAuditView,
  UsageView,
  PlaygroundView,
} from "../src/ui/index.js";
import { PlatformInvitationAcceptanceView } from "../src/ui/views/platform-invitation-acceptance.js";
import { PlatformInvitationsView } from "../src/ui/views/platform/invitations.js";
import { PlatformPrincipalsView } from "../src/ui/views/platform/principals.js";
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
      createdBy: { issuer: "https://accounts.example", subject: "admin" },
      revision: 1,
    };
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "POST") return json({ invitationId: invitation.invitationId, acceptUrl: "https://console.example/admin/platform-invitations/secret-token", expiresAt: invitation.expiresAt }, 201);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (String(input).endsWith("access-summary")) return json({ activePrincipalCount: 1, platformAdminCount: 1, appCreatorCount: 0, blockedPrincipalCount: 0, generatedAt: 1 });
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

describe("PlatformPrincipalsView", () => {
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
      if (path === "/admin/platform/access-summary") {
        return json({ activePrincipalCount: 1, platformAdminCount: 1, appCreatorCount: 1, blockedPrincipalCount: 0, generatedAt: 1 });
      }
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
    render(<PlatformPrincipalsView />);

    const openAccount = await screen.findByRole("button", { name: "Open Account details for Developer" });
    openAccount.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("app-1")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog", { name: "Account Details" })).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).includes("cursor=next-page"))).toBe(true));
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes("after=next-page"))).toBe(false);
    await user.type(screen.getByLabelText("Search people"), "developer");
    await user.click(screen.getByRole("button", { name: "Apply" }));
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
      if (path === "/admin/platform/access-summary") return json({ activePrincipalCount: 1, platformAdminCount: 1, appCreatorCount: 1, blockedPrincipalCount: 0, generatedAt: 1 });
      if (path.startsWith("/admin/platform/people?")) return json({ items: [{ kind: "account", account }], nextCursor: null });
      if (path === `/admin/platform/accounts/${ACCOUNT_ID}` && !init?.method) return json(account);
      if (path === `/admin/platform/accounts/${ACCOUNT_ID}/authorities/apps.create` && init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    });
    const user = userEvent.setup();
    render(<PlatformPrincipalsView />);

    await user.click(await screen.findByRole("button", { name: "Open Account details for Developer" }));
    await user.click(await screen.findByLabelText("apps.create"));
    expect(await screen.findByRole("dialog", { name: "Confirm Platform Access change" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    await user.click(screen.getByLabelText("apps.create"));
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

    await screen.findByText("No changes yet.");
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("region", { name: "Change Logs" }).querySelector(".bg-card")).toBeNull();
    await user.type(screen.getByLabelText("Actor Account ID"), ACCOUNT_ID);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("platform_invitation.created")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Change Logs" })).getByRole("table")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).includes("cursor=audit-next"))).toBe(true));
    const pagedPath = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(pagedPath).toContain(`actorAccountId=${ACCOUNT_ID}`);
    expect(pagedPath).toContain("cursor=audit-next");
  });
});

function managedIssuer() {
  return {
    appId: STACK,
    mode: "managed",
    issuer: `https://cas.example/managed-issuers/${STACK}`,
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

describe("PlaygroundView", () => {
  test("creates a root from an inline editor on blur", async () => {
    fetchMock
      .mockResolvedValueOnce(json(managedIssuer()))
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({
        accessToken: "space-token",
        tokenType: "Bearer",
        expiresIn: 3600,
        expiresAt: Date.now() + 3_600_000,
        issuer: `https://cas.example/managed-issuers/${STACK}`,
        audience: `https://cas.example/stacks/${STACK}`,
        spaceId: "member_abc",
        permissions: ["spaces:member_abc:cas:manage"],
      }))
      .mockResolvedValueOnce(json({ hash: "a".repeat(64), ready: true, leaseStartedAt: 1, leaseExpiresAt: 2 }))
      .mockResolvedValueOnce(json({ success: true, revision: 1 }))
      .mockResolvedValueOnce(json({ rootId: "root-1", name: "Project", manifestHash: "a".repeat(64), revision: 1, createdAt: 1, updatedAt: 1 }))
      .mockResolvedValueOnce(json({ metadata: { hash: "a".repeat(64), size: 7, contentType: "application/vnd.unicas.file-manifest+cbor;version=1", refs: [] } }))
      .mockResolvedValueOnce(new Response(Uint8Array.from([0xa2, 0x61, 0x65, 0x80, 0x61, 0x76, 0x01])))
      .mockResolvedValueOnce(json({ items: [{ rootId: "root-1", name: "Project", manifestHash: "a".repeat(64), revision: 1, createdAt: 1, updatedAt: 1 }] }));
    const user = userEvent.setup();
    render(<PlaygroundView appId={STACK} />);

    await user.click(await screen.findByRole("button", { name: "Create root" }));
    const editor = screen.getByRole("textbox", { name: "New root name" });
    await user.type(editor, "Project");
    await user.tab();

    await waitFor(() => expect(within(screen.getByRole("complementary", { name: "File roots" })).getByRole("button", { name: /Project/ })).toBeInTheDocument());
    const createCall = fetchMock.mock.calls.find(([path, init]) =>
      path === `/admin/apps/${STACK}/playground/file-roots` && init?.method === "POST"
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ name: "Project" });
  });

  test("rejects an invalid inline root name before issuing a capability", async () => {
    fetchMock
      .mockResolvedValueOnce(json(managedIssuer()))
      .mockResolvedValueOnce(json({ items: [] }));
    const user = userEvent.setup();
    render(<PlaygroundView appId={STACK} />);

    await user.click(await screen.findByRole("button", { name: "Create root" }));
    await user.type(screen.getByRole("textbox", { name: "New root name" }), "   ");
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent("Root name is required");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("rejects a duplicate inline root name locally", async () => {
    fetchMock
      .mockResolvedValueOnce(json(managedIssuer()))
      .mockResolvedValueOnce(json({ items: [{ rootId: "root-1", name: "Project", manifestHash: "a".repeat(64), revision: 1, createdAt: 1, updatedAt: 1 }] }));
    const user = userEvent.setup();
    render(<PlaygroundView appId={STACK} />);

    await user.click(await screen.findByRole("button", { name: "Create root" }));
    await user.type(screen.getByRole("textbox", { name: "New root name" }), "project");
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("keeps the member capability private and reads Space usage", async () => {
    fetchMock
      .mockResolvedValueOnce(json(managedIssuer()))
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({
        accessToken: "space-token",
        tokenType: "Bearer",
        expiresIn: 3600,
        expiresAt: Date.now() + 3_600_000,
        issuer: `https://cas.example/managed-issuers/${STACK}`,
        audience: `https://cas.example/stacks/${STACK}`,
        spaceId: "member_abc",
        permissions: ["spaces:member_abc:cas:manage"],
      }))
      .mockResolvedValueOnce(json({ nodeCount: 0, readyContentBytes: 0, readyStoredBytes: 0, reservedBytes: 0, notReadyNodeCount: 0, leasedNodeCount: 0 }));
    const user = userEvent.setup();
    render(<PlaygroundView appId={STACK} />);

    expect(await screen.findByRole("button", { name: /Usage/ })).toBeInTheDocument();
    expect(screen.getByText("File roots")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run garbage collection" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(screen.getByText("Nodes").nextSibling).toHaveTextContent("0"));
    expect(screen.getByText("member_abc")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("space-token")).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenNthCalledWith(3,
      `/admin/apps/${STACK}/managed-capabilities`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(4,
      `https://cas.example/v2/apps/${STACK}/spaces/member_abc/cas/usage`,
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect((fetchMock.mock.calls[3][1]?.headers as Headers).get("Authorization")).toBe("Bearer space-token");
  });

  test.each([false, true])("refreshes usage after GC and preserves its result if the refresh fails (%s)", async (refreshFails) => {
    const before = { nodeCount: 3, readyContentBytes: 2048, readyStoredBytes: 3072, reservedBytes: 0, notReadyNodeCount: 0, leasedNodeCount: 0 };
    const after = { ...before, nodeCount: 1, readyContentBytes: 1024, readyStoredBytes: 1536 };
    fetchMock
      .mockResolvedValueOnce(json(managedIssuer()))
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({
        accessToken: "space-token", tokenType: "Bearer", expiresIn: 3600,
        expiresAt: Date.now() + 3_600_000,
        issuer: `https://cas.example/managed-issuers/${STACK}`,
        audience: `https://cas.example/stacks/${STACK}`, spaceId: "member_abc",
        permissions: ["spaces:member_abc:cas:manage"],
      }))
      .mockResolvedValueOnce(json(before))
      .mockResolvedValueOnce(json({ examined: 3, deleted: 2, reclaimedContentBytes: 1024 }))
      .mockResolvedValueOnce(refreshFails ? json({ error: "UNAVAILABLE", message: "Usage temporarily unavailable" }, 503) : json(after));
    const user = userEvent.setup();
    render(<PlaygroundView appId={STACK} />);
    await user.click(await screen.findByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(screen.getByText("Nodes").nextSibling).toHaveTextContent("3"));
    const confirmation = screen.getByRole("checkbox", { name: /I understand/ });
    await user.click(confirmation);
    await user.click(screen.getByRole("button", { name: "Run garbage collection" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh usage" })).toBeEnabled());
    expect(fetchMock.mock.calls.slice(4).map(([path]) => path)).toEqual([
      `https://cas.example/v2/apps/${STACK}/spaces/member_abc/cas/gc`,
      `https://cas.example/v2/apps/${STACK}/spaces/member_abc/cas/usage`,
    ]);
    expect(screen.getByText(/Examined 3, deleted 2/)).toBeInTheDocument();
    expect(confirmation).not.toBeChecked();
    expect(screen.getByText("Nodes").nextSibling).toHaveTextContent(refreshFails ? "3" : "1");
    expect(screen.getByText("Content").nextSibling).toHaveTextContent(refreshFails ? "2.00 KiB" : "1.00 KiB");
    if (refreshFails) expect(screen.getByRole("alert")).toHaveTextContent("Usage temporarily unavailable");
  });

  test("renews a capability only when a request finds it expired", async () => {
    const now = Date.now();
    const capability = (accessToken: string) => ({
      accessToken,
      tokenType: "Bearer",
      expiresIn: 1,
      expiresAt: now + (accessToken === "space-token-1" ? 1000 : 10_000),
      issuer: `https://cas.example/managed-issuers/${STACK}`,
      audience: `https://cas.example/stacks/${STACK}`,
      spaceId: "member_abc",
      permissions: ["spaces:member_abc:cas:manage"],
    });
    fetchMock
      .mockResolvedValueOnce(json(managedIssuer()))
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json(capability("space-token-1")))
      .mockResolvedValueOnce(json({ nodeCount: 1, readyContentBytes: 0, readyStoredBytes: 0, reservedBytes: 0, notReadyNodeCount: 0, leasedNodeCount: 0 }))
      .mockResolvedValueOnce(json(capability("space-token-2")))
      .mockResolvedValueOnce(json({ nodeCount: 2, readyContentBytes: 0, readyStoredBytes: 0, reservedBytes: 0, notReadyNodeCount: 0, leasedNodeCount: 0 }));
    const user = userEvent.setup();
    render(<PlaygroundView appId={STACK} />);

    await user.click(await screen.findByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(screen.getByText("Nodes").nextSibling).toHaveTextContent("1"));
    vi.spyOn(Date, "now").mockReturnValue(now + 2000);
    await user.click(screen.getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(screen.getByText("Nodes").nextSibling).toHaveTextContent("2"));

    const issueCalls = fetchMock.mock.calls.filter(([path]) =>
      path === `/admin/apps/${STACK}/managed-capabilities`
    );
    expect(issueCalls).toHaveLength(2);
    expect((fetchMock.mock.calls[5][1]?.headers as Headers).get("Authorization")).toBe("Bearer space-token-2");
  });
});

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
    screen.getByRole("combobox", { name: "People filter" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("option", { name: "Invitation history" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
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
  test.each([0, 3])("hides a disabled managed issuer URL at revision %s and follows enable/disable changes", async (revision) => {
    const user = userEvent.setup();
    const disabled = { ...managedIssuer(), status: "disabled", revision };
    fetchMock
      .mockResolvedValueOnce(json(null))
      .mockResolvedValueOnce(json(disabled))
      .mockResolvedValueOnce(json({ ...disabled, status: "active", revision: revision + 1 }))
      .mockResolvedValueOnce(json({ ...disabled, revision: revision + 2 }));
    render(<IssuerView appId={STACK} />);
    const enable = await screen.findByRole("button", { name: "Enable managed issuer" });
    expect(screen.queryByText("Managed issuer URL")).not.toBeInTheDocument();
    expect(screen.queryByText(disabled.issuer)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy Managed issuer URL / })).not.toBeInTheDocument();
    await user.click(enable);
    expect(await screen.findByRole("button", { name: /^Copy Managed issuer URL / })).toHaveTextContent(disabled.issuer);
    await user.click(screen.getByRole("button", { name: "Disable managed issuer" }));
    await screen.findByRole("button", { name: "Enable managed issuer" });
    expect(screen.queryByText("Managed issuer URL")).not.toBeInTheDocument();
    expect(screen.queryByText(disabled.issuer)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy Managed issuer URL / })).not.toBeInTheDocument();
  });

  test("copies the managed issuer URL from a non-editable text block with keyboard support", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const notify = vi.spyOn(toast, "success");
    fetchMock.mockResolvedValueOnce(json(null)).mockResolvedValueOnce(json(managedIssuer()));
    render(<IssuerView appId={STACK} />);
    const copy = await screen.findByRole("button", { name: /^Copy Managed issuer URL / });
    expect(copy).toHaveClass("cursor-pointer", "max-w-full", "whitespace-normal");
    expect(copy.parentElement).toHaveClass("flex-col", "gap-2");
    expect(screen.queryByRole("textbox", { name: "Managed issuer URL" })).not.toBeInTheDocument();
    expect(copy).toHaveTextContent(managedIssuer().issuer);
    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith(managedIssuer().issuer);
    expect(notify).toHaveBeenCalledWith("Managed issuer URL copied", expect.any(Object));
    await user.keyboard("{Enter}");
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("reports clipboard failures without changing the issuer", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const notify = vi.spyOn(toast, "error");
    fetchMock.mockResolvedValueOnce(json(null)).mockResolvedValueOnce(json(managedIssuer()));
    render(<IssuerView appId={STACK} />);
    await user.click(await screen.findByRole("button", { name: /^Copy Managed issuer URL / }));
    expect(notify).toHaveBeenCalledWith("Could not copy Managed issuer URL. Try again.", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("shows the connect form when no OAuth issuer is configured", async () => {
    fetchMock
      .mockResolvedValueOnce(json(null))
      .mockResolvedValueOnce(json(managedIssuer()));
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
    })).mockResolvedValueOnce(json(managedIssuer()));
    render(<IssuerView appId={STACK} />);
    const customCard = screen.getByRole("heading", { name: "Custom OAuth authorization server" }).closest<HTMLDivElement>("div[class*='bg-card']")!;
    await waitFor(() => expect(within(customCard).getByText(/Status:/)).toHaveTextContent("active"));
    expect(screen.getByRole("button", { name: "Inspect replacement" })).toBeEnabled();
    expect(screen.getByLabelText("Issuer")).toBeEnabled();
    expect(screen.getByRole("link", { name: "https://issuer.example/oauth/jwks" }))
      .toHaveAttribute("href", "https://issuer.example/oauth/jwks");
  });

  test("keeps current authority visible while inspecting and replacing a candidate", async () => {
    const current = { ...managedIssuer(), mode: "external", issuer: "https://current.example", revision: 9 };
    fetchMock.mockResolvedValueOnce(json(current)).mockResolvedValueOnce(json(managedIssuer()))
      .mockResolvedValueOnce(json({ inspectionId: "candidate", metadataUrl: "https://replacement.example/metadata", jwksUri: "https://replacement.example/jwks", challenge: "candidate-challenge", expiresAt: 4102444800000, keys: [{ kid: "key", algorithm: "ES256" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: { ETag: '"10"' } }))
      .mockResolvedValueOnce(json({ ...current, issuer: "https://replacement.example", revision: 10 }))
      .mockResolvedValueOnce(json(managedIssuer()));
    const user = userEvent.setup();
    render(<IssuerView appId={STACK} />);
    const input = await screen.findByLabelText("Issuer", { selector: "#oauth-issuer-url" });
    await waitFor(() => expect(input).toBeEnabled());
    await user.clear(input);
    await user.type(input, "https://replacement.example");
    await user.click(screen.getByRole("button", { name: "Inspect replacement" }));
    expect(await screen.findByText("candidate-challenge")).toBeInTheDocument();
    const custom = screen.getByRole("heading", { name: "Custom OAuth authorization server" }).closest<HTMLDivElement>("div[class*='bg-card']")!;
    expect(within(custom).getByText(/Mode:/)).toHaveTextContent("https://current.example");
    expect(within(custom).getByText(/Mode:/)).toHaveTextContent("active");
    await user.type(screen.getByLabelText("Activation proof (compact JWS)"), "synthetic-proof");
    await user.click(screen.getByRole("button", { name: "Verify and replace" }));
    await waitFor(() => expect(within(custom).getByText(/Mode:/)).toHaveTextContent("https://replacement.example"));
    const update = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(new Headers(update?.[1]?.headers).get("If-Match")).toBe('"9"');
    expect(new Headers(update?.[1]?.headers).has("If-None-Match")).toBe(false);
  });

  test("inspects and activates a standards-based OAuth issuer", async () => {
    fetchMock
      .mockResolvedValueOnce(json(null))
      .mockResolvedValueOnce(json(managedIssuer()))
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
      }))
      .mockResolvedValueOnce(json(managedIssuer()));
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
    expect(screen.getByText("Legacy")).toHaveAttribute("title", "Historical action from the retired issuer-key API");
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("member.invited")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("UsageView", () => {
  test("documents the delegated Space data-plane read", () => {
    render(<UsageView appId={STACK} />);
    expect(screen.getByText(/Usage is a Space data-plane read/)).toBeInTheDocument();
  });
});
