// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/ui/index.js";
import { CopyBubble, CopyNotifications } from "../src/ui/components/copy-bubble.js";
import { toast } from "sonner";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const currentApp = {
  appId: "cas_one",
  displayName: "Primary App",
  description: "Primary production App",
  status: "active",
  createdAt: 1,
  revision: 3,
};

const me = {
  principal: { issuer: "https://accounts.example", subject: "admin" },
  profile: { displayName: "Admin", emailForDisplay: "admin@example.com" },
  platformAccess: { principalRef: "admin-ref", status: "active", authorities: ["apps.create"], revision: 1 },
  memberships: [{ appId: currentApp.appId, principal: { issuer: "https://accounts.example", subject: "admin" }, profile: { displayName: "Admin", emailForDisplay: "admin@example.com" } }],
};

function managedIssuer(status: "active" | "disabled" = "active") {
  return {
    appId: currentApp.appId,
    mode: "managed",
    issuer: `https://cas.example/managed-issuers/${currentApp.appId}`,
    audience: `https://cas.example/stacks/${currentApp.appId}`,
    metadataUrl: "https://cas.example/metadata",
    metadataType: "oauth",
    authorizationEndpoint: "https://cas.example/authorize",
    tokenEndpoint: "https://cas.example/token",
    jwksUri: "https://cas.example/jwks",
    registrationEndpoint: null,
    scopesSupported: ["cas:manage"],
    codeChallengeMethodsSupported: ["S256"],
    status,
    verifiedAt: 1,
    lastRefreshAt: 1,
    lastRefreshError: null,
    jwksDigest: "digest",
    capabilityMaxLifetimeSeconds: 3600,
    revision: status === "active" ? 1 : 0,
  };
}

beforeEach(() => {
  toast.dismiss();
  window.location.hash = "#/apps/cas_one/overview";
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/admin/me") return json(me);
    if (url.pathname === "/admin/apps") return json({ items: [currentApp] });
    if (url.pathname === "/admin/apps/cas_one") return json(currentApp);
    if (url.pathname.endsWith("/managed-issuer")) return json(managedIssuer());
    if (url.pathname.endsWith("/oauth-issuer")) return json(null);
    if (url.pathname.endsWith("/file-roots")) return json({ items: [] });
    if (url.pathname.endsWith("/people")) return json({ items: [], nextCursor: null });
    throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
  }));
});

describe("current App shell", () => {
  test("redirects old App invitations links to Members with pending selection", async () => {
    window.location.hash = "#/apps/cas_one/invitations";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/apps/cas_one/members?filter=pending"));
    expect(await screen.findByRole("button", { name: "Invite", exact: true })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Invitations" })).not.toBeInTheDocument();
  });

  test.each([
    ["en", "Copy Reference reference-1", "Reference copied"],
    ["zh-CN", "\u590d\u5236 Reference reference-1", "Reference \u5df2\u590d\u5236"],
    ["zh-TW", "\u8907\u88fd Reference reference-1", "Reference \u5df2\u8907\u88fd"],
  ])("localizes shared copy feedback for %s", async (language, action, message) => {
    const previousLanguage = document.documentElement.lang;
    document.documentElement.lang = language;
    try {
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      render(<><CopyBubble value="reference-1" label="Reference" /><CopyNotifications /></>);
      const bubble = screen.getByRole("button", { name: action });
      expect(bubble).toHaveClass("cursor-pointer");
      await user.click(bubble);
      expect(writeText).toHaveBeenCalledWith("reference-1");
      expect(await screen.findByText(message)).toBeVisible();
    } finally {
      document.documentElement.lang = previousLanguage;
    }
  });

  test("renders direct-linkable App tabs in the accepted order with overview workflows", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Primary App" });
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "Overview", "Members", "Change Logs", "Playground",
    ]);
    expect(screen.getByRole("heading", { name: "Managed issuer" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Custom OAuth authorization server" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Playground" })).toBeEnabled());

    await user.click(screen.getByRole("tab", { name: "Members" }));
    expect(window.location.hash).toBe("#/apps/cas_one/members");
  });

  test("copies the App ID from its bubble with mouse and keyboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<App />);

    const bubble = await screen.findByRole("button", { name: "Copy App ID cas_one" });
    expect(bubble).toHaveTextContent("cas_one");
    expect(screen.queryByRole("button", { name: "Copy", exact: true })).not.toBeInTheDocument();
    await user.click(bubble);
    expect(writeText).toHaveBeenLastCalledWith("cas_one");
    expect(await screen.findByText("App ID copied")).toBeVisible();
    expect(bubble).toHaveTextContent("cas_one");
    bubble.focus();
    await user.keyboard("{Enter}");
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  test("reports App ID copy failures without replacing the ID", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Clipboard unavailable"));
    render(<App />);

    const bubble = await screen.findByRole("button", { name: "Copy App ID cas_one" });
    await user.click(bubble);
    expect(await screen.findByText("Could not copy App ID. Try again.")).toBeVisible();
    expect(bubble).toHaveTextContent("cas_one");
  });

  test("updates the App description with its current revision", async () => {
    let app = currentApp;
    let patchBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/admin/me") return json(me);
      if (url.pathname === "/admin/apps") return json({ items: [app] });
      if (url.pathname === "/admin/apps/cas_one" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        app = { ...app, description: String(patchBody.description), revision: 4 };
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/admin/apps/cas_one") return json(app);
      if (url.pathname.endsWith("/managed-issuer")) return json(managedIssuer());
      if (url.pathname.endsWith("/oauth-issuer")) return json(null);
      throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
    }));
    const user = userEvent.setup();
    render(<App />);

    const description = await screen.findByLabelText("Description");
    await user.clear(description);
    await user.type(description, "Updated production App");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(patchBody).toMatchObject({
      displayName: "Primary App",
      description: "Updated production App",
    }));
    const patch = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "PATCH");
    expect((patch?.[1]?.headers as Headers).get("If-Match")).toBe('"3"');
  });

  test("disables Playground until the managed issuer is enabled and updates after toggling", async () => {
    let issuer = managedIssuer("disabled");
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/managed-issuer")) {
        if (init?.method === "PATCH") {
          issuer = managedIssuer(JSON.parse(String(init.body)).enabled ? "active" : "disabled");
        }
        return json(issuer);
      }
      return base(input, init);
    });
    const user = userEvent.setup();
    render(<App />);

    const playground = await screen.findByRole("tab", { name: "Playground" });
    expect(playground).toBeDisabled();
    await user.click(playground);
    expect(window.location.hash).toBe("#/apps/cas_one/overview");
    await user.click(await screen.findByRole("button", { name: "Enable managed issuer" }));
    await waitFor(() => expect(playground).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Disable managed issuer" }));
    await waitFor(() => expect(playground).toBeDisabled());
  });

  test("routes a disabled Playground to focused managed issuer settings", async () => {
    window.location.hash = "#/apps/cas_one/playground";
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/managed-issuer")) return json(managedIssuer("disabled"));
      return base(input, init);
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Go to managed issuer settings" }));
    await waitFor(() => expect(window.location.hash).toBe("#/apps/cas_one/overview"));
    const settings = await screen.findByRole("region", { name: "Managed issuer settings" });
    expect(settings).toHaveFocus();
    await within(settings).findByRole("button", { name: "Enable managed issuer" });
  });
});