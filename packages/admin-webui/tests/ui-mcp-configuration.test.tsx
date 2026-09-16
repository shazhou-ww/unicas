// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { App } from "../src/ui/index.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AI tool connection", () => {
  test("opens from sidebar profile menu, copies connection details, and closes with Escape", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/admin/me") {
        return json({
          principal: { issuer: "https://accounts.example", subject: "admin" },
          profile: { displayName: "Admin User", emailForDisplay: "admin@example.com" },
          platformAccess: {
            principalRef: "principal-admin",
            status: "active",
            authorities: ["platform.admin", "apps.create"],
            revision: 1,
          },
          memberships: [],
        });
      }
      if (path === "/admin/apps") return json({ items: [] });
      return new Response(null, { status: 404 });
    }));

    render(<App />);

    expect(await screen.findByText("Platform access")).toBeInTheDocument();
    expect(screen.getByTitle("Create App")).toBeInTheDocument();

    // Open the user menu from sidebar footer
    const userMenuTrigger = await screen.findByRole("button", { name: "Open user menu" });
    await user.click(userMenuTrigger);

    // Click "Connect AI tools" from dropdown
    const connectItem = await screen.findByRole("menuitem", { name: /connect ai tools/i });
    await user.click(connectItem);

    const dialog = screen.getByRole("dialog", { name: "Connect an AI tool" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(`${window.location.origin}/mcp`);

    // The URL is a click-to-copy bubble.
    const urlBubble = screen.getByRole("button", { name: "Copy MCP server URL" });
    await user.click(urlBubble);
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/mcp`);
    expect(screen.queryByRole("button", { name: "Copy URL" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(await navigator.clipboard.readText()).toContain('remote MCP server named "UniCAS"');
    expect(screen.getByRole("button", { name: "Prompt copied" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy CLI prompt" }));
    const cliPrompt = await navigator.clipboard.readText();
    expect(cliPrompt).toContain("pnpm install --global ./packages/admin-cli");
    expect(cliPrompt).toContain("unicas login");
    expect(cliPrompt).toContain("unicas principal");
    expect(cliPrompt).toContain("unicas apps list");
    expect(cliPrompt).not.toContain("unicas stacks list");
    expect(cliPrompt).toContain(`${window.location.origin}/admin/assets/skills/unicas-cli/SKILL.md`);
    expect(cliPrompt).toContain("standard agent-skills location");
    expect(cliPrompt).not.toContain("DeepSeek Harness");
    expect(cliPrompt).not.toContain("Claude Code");
    expect(cliPrompt).toContain('command "unicas", args ["mcp"]');
    expect(screen.getByRole("button", { name: "CLI prompt copied" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Connect an AI tool" })).not.toBeInTheDocument();
  });

  test("hides platform administration and App creation for an App-only member", async () => {
    window.location.hash = "#/";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/admin/me") {
        return json({
          principal: { issuer: "https://accounts.example", subject: "member" },
          profile: { displayName: "App Member", emailForDisplay: "member@example.com" },
          platformAccess: {
            principalRef: "principal-member",
            status: "active",
            authorities: [],
            revision: 1,
          },
          memberships: [],
        });
      }
      if (path === "/admin/apps") return json({ items: [] });
      return new Response(null, { status: 404 });
    }));

    render(<App />);

    await screen.findByRole("button", { name: "Open user menu" });
    expect(screen.queryByText("Platform access")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Create App")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create App" })).not.toBeInTheDocument();
  });
});

describe("invitation-limited Console", () => {
  test("renders the invitation route without loading general session or App APIs", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/invitations/invite%2F1";
    const fetchMock = vi.fn(async () => json({ appId: "app-invited" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const accept = await screen.findByRole("button", { name: "Accept membership" });
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    await user.click(accept);

    expect(await screen.findByText(/You are now a member of App/)).toHaveTextContent("app-invited");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/member-invitations/invite%2F1/accept",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
