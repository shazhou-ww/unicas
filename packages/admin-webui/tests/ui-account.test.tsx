// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AccountSelf } from "@unicas/admin-client";
import { AccountView } from "../src/ui/views/account.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const googleIdentity = {
  externalIdentityId: "ext-google",
  provider: "google" as const,
  accountHint: "a***@example.com",
  linkedAt: Date.UTC(2025, 0, 1),
  lastAuthenticatedAt: Date.UTC(2025, 1, 1),
  currentLogin: true,
};

const githubIdentity = {
  externalIdentityId: "ext-github",
  provider: "github" as const,
  accountHint: "alice-dev",
  linkedAt: Date.UTC(2025, 0, 2),
  lastAuthenticatedAt: null,
  currentLogin: false,
};

let account: AccountSelf;

beforeEach(() => {
  account = {
    accountId: `acct_${"a".repeat(22)}` as AccountSelf["accountId"],
    displayName: "Alice Admin",
    primaryVerifiedEmail: {
      normalizedEmail: "alice@example.com",
      source: "google-oidc",
      verifiedAt: Date.UTC(2025, 0, 1),
    },
    avatar: { kind: "fallback", initials: "AA", colorIndex: 2 },
    blockedAt: null,
    platformAuthorities: ["apps.create"],
    identities: [googleIdentity, githubIdentity],
    linkableProviders: ["microsoft"],
  };
});

describe("AccountView", () => {
  test("updates mutable profile fields without an App revision", async () => {
    let patch: { body: unknown; headers: Headers } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/admin/account" && (init?.method ?? "GET") === "GET") return json(account);
      if (path === "/admin/account/profile" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patch = { body, headers: init.headers as Headers };
        account = { ...account, displayName: body.displayName };
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${path}`);
    }));
    const user = userEvent.setup();
    render(<AccountView />);

    const name = await screen.findByLabelText("Display name");
    await user.clear(name);
    await user.type(name, "Alice Updated");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Profile saved.");
    expect(patch).toMatchObject({ body: { displayName: "Alice Updated" } });
    expect(patch!.headers.get("If-Match")).toBeNull();
  });

  test("links only a provider offered by the Account projection", async () => {
    const navigateExternal = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/admin/account") return json(account);
      if (path === "/admin/auth/link/microsoft" && init?.method === "POST") {
        return json({ redirectTo: "https://microsoft.example/authorize" });
      }
      throw new Error(`Unexpected request: ${path}`);
    }));
    const user = userEvent.setup();
    render(<AccountView navigateExternal={navigateExternal} />);

    await user.click(await screen.findByRole("button", { name: /link login method/i }));
    expect(screen.queryByRole("menuitem", { name: "Google" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Microsoft" }));
    expect(screen.getByText(/matching email does not transfer access/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(navigateExternal).toHaveBeenCalledWith("https://microsoft.example/authorize"));
  });

  test("requires a remaining identity for fresh-auth unlink", async () => {
    const navigateExternal = vi.fn();
    let unlinkBody: unknown;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/admin/account") return json(account);
      if (path === "/admin/auth/unlink/ext-github" && init?.method === "POST") {
        unlinkBody = JSON.parse(String(init.body));
        return json({ redirectTo: "https://google.example/authorize" });
      }
      throw new Error(`Unexpected request: ${path}`);
    }));
    const user = userEvent.setup();
    render(<AccountView navigateExternal={navigateExternal} />);

    await user.click(await screen.findByRole("button", { name: "Unlink GitHub" }));
    expect(screen.getByText(/memberships, authorities, and data will stay/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Unlink and continue" }));

    await waitFor(() => expect(unlinkBody).toEqual({ remainingExternalIdentityId: "ext-google" }));
    expect(navigateExternal).toHaveBeenCalledWith("https://google.example/authorize");
  });

  test("does not allow the final login method to be unlinked", async () => {
    account = { ...account, identities: [googleIdentity], linkableProviders: ["microsoft", "github"] };
    vi.stubGlobal("fetch", vi.fn(async () => json(account)));
    render(<AccountView />);

    expect(await screen.findByRole("button", { name: "Unlink Google" })).toBeDisabled();
  });
});
