// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { UserMenu } from "../src/ui/index.js";

const mockMe = {
  account: {
    accountId: `acct_${"a".repeat(22)}`,
    displayName: "Admin User",
    primaryVerifiedEmail: { normalizedEmail: "admin@example.com", source: "google-oidc", verifiedAt: 1 },
    avatar: { kind: "fallback", initials: "AU", colorIndex: 1 },
    blockedAt: null,
    platformAuthorities: [],
    identities: [{ externalIdentityId: "ext-admin", provider: "google", accountHint: null, linkedAt: 1, lastAuthenticatedAt: 1, currentLogin: true }],
    linkableProviders: [],
  },
  authenticatedIdentity: { externalIdentityId: "ext-admin", provider: "google", accountHint: null, linkedAt: 1, lastAuthenticatedAt: 1, currentLogin: true },
  principal: { issuer: "https://accounts.example", subject: "admin" },
  profile: { displayName: "Admin User", emailForDisplay: "admin@example.com" },
  platformAccess: {
    principalRef: "principal-admin",
    status: "active",
    authorities: [],
    revision: 1,
  },
  memberships: [],
};

describe("UserMenu", () => {
  test("links to the Account view", async () => {
    const user = userEvent.setup();
    render(<UserMenu me={mockMe as never} onOpenMcpConfiguration={vi.fn()} onLogout={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Open user menu" }));
    expect(screen.getByRole("menuitem", { name: "Account" })).toHaveAttribute("href", "#/account");
  });

  test("keeps sign out inside the username menu", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(<UserMenu me={mockMe as never} onOpenMcpConfiguration={vi.fn()} onLogout={onLogout} />);

    const trigger = screen.getByRole("button", { name: "Open user menu" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menuitem", { name: /sign out/i })).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  test("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <>
        <UserMenu me={mockMe as never} onOpenMcpConfiguration={vi.fn()} onLogout={vi.fn()} />
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Open user menu" });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
