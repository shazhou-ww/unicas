// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MyAppsView } from "../src/ui/index.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MyAppsView", () => {
  test("shows loading then the App list", async () => {
    fetchMock.mockResolvedValueOnce(json({
      items: [
        { appId: "cas_one", displayName: "Cloudflare", description: "", status: "active", createdAt: 1, revision: 1 },
      ]
    }));
    render(<MyAppsView />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "UniCAS Apps" })).toBeInTheDocument();
    expect(screen.getByText(/top-level UniCAS trust/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Cloudflare")).toBeInTheDocument());
    expect(screen.getByText("cas_one")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/admin/apps", expect.any(Object));
    expect(screen.getByRole("link", { name: /Cloudflare/ })).toHaveAttribute("href", "#/apps/cas_one");
  });

  test("shows the empty state when there are no Apps", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    render(<MyAppsView />);
    await waitFor(() => expect(screen.getByText(/not a member of any App/)).toBeInTheDocument());
  });

  test("creates an App and refreshes the list", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({ appId: "cas_new", displayName: "New", description: "", status: "active", createdAt: 1, revision: 1 }))
      .mockResolvedValueOnce(json({
        items: [
          { appId: "cas_new", displayName: "New", description: "", status: "active", createdAt: 1, revision: 1 },
        ]
      }));
    const user = userEvent.setup();
    render(<MyAppsView />);
    await waitFor(() => expect(screen.getByText(/not a member/)).toBeInTheDocument());
    await user.type(screen.getByLabelText("App display name"), "New");
    await user.click(screen.getByRole("button", { name: "Create App" }));
    await waitFor(() => expect(screen.getByText("cas_new")).toBeInTheDocument());
    const createCall = fetchMock.mock.calls.find((call) => call[0] === "/admin/apps" && call[1]?.method === "POST");
    expect(createCall).toBeDefined();
    expect(JSON.parse(createCall![1]!.body as string)).toEqual({ displayName: "New" });
  });

  test("surfaces creation errors", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({ error: "INVALID_REQUEST", message: "displayName must not be empty" }, 400));
    const user = userEvent.setup();
    render(<MyAppsView />);
    await waitFor(() => expect(screen.getByText(/not a member/)).toBeInTheDocument());
    await user.type(screen.getByLabelText("App display name"), "X");
    await user.click(screen.getByRole("button", { name: "Create App" }));
    await waitFor(() => expect(screen.getByText("displayName must not be empty")).toBeInTheDocument());
  });
});
