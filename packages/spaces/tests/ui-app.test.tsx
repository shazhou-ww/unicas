/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://spaces.example.test/files"} */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "../ui/app.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = "__Host-spaces-csrf=; Max-Age=0; Path=/; Secure";
  window.history.replaceState(null, "", "/files");
});

describe("Spaces UI", () => {
  test("offers only Google when no App session exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: { code: "session_required", message: "Sign in is required", correlationId: "test" },
    }, { status: 401 })));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sign in to your files" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/auth/google/start");
    expect(screen.queryByRole("link", { name: /Microsoft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /GitHub/i })).not.toBeInTheDocument();
  });

  test("renders directories first and navigates with breadcrumbs", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/session") {
        return Response.json({ principal: { id: "principal-a", displayName: "Ada", provider: "google" } });
      }
      if (url === "/api/entries?path=%2F") {
        return Response.json({
          path: "/",
          revision: 4,
          entries: [
            { path: "/Releases", name: "Releases", type: "directory" },
            { path: "/notes.txt", name: "notes.txt", type: "file", size: 5, mediaType: "text/plain" },
          ],
        });
      }
      if (url === "/api/entries?path=%2FReleases") {
        return Response.json({ path: "/Releases", revision: 4, entries: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    const table = await screen.findByRole("table", { name: "Files in /" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByRole("button", { name: "Releases" })).toBeInTheDocument();
    expect(within(rows[2]).getByText("notes.txt")).toBeInTheDocument();
    expect(within(rows[2]).getByRole("link", { name: "Download notes.txt" }))
      .toHaveAttribute("href", "/api/files/content?path=%2Fnotes.txt");

    await user.click(within(rows[1]).getByRole("button", { name: "Releases" }));
    expect(await screen.findByText("This folder is empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Releases" })).toHaveAttribute("aria-current", "page");
    expect(window.location.pathname).toBe("/files/Releases");
  });

  test("creates a folder with the current revision and CSRF token", async () => {
    document.cookie = "__Host-spaces-csrf=csrf-token; Path=/; Secure; SameSite=Strict";
    let rootReads = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/session") {
        return Response.json({ principal: { id: "principal-a", displayName: "Ada", provider: "google" } });
      }
      if (url === "/api/entries?path=%2F") {
        rootReads += 1;
        return Response.json({
          path: "/",
          revision: rootReads === 1 ? 7 : 8,
          entries: rootReads === 1 ? [] : [{ path: "/Docs", name: "Docs", type: "directory" }],
        });
      }
      if (url === "/api/folders") {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-CSRF-Token")).toBe("csrf-token");
        expect(JSON.parse(String(init?.body))).toEqual({ parentPath: "/", name: "Docs", revision: 7 });
        return Response.json({
          revision: 8,
          rootRetained: true,
          entry: { path: "/Docs", name: "Docs", type: "directory" },
        }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText("This folder is empty");
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Docs");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Docs" })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/folders", expect.objectContaining({ method: "POST" }));
  });

  test("dismisses a modal with Escape and restores focus to its trigger", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/session") {
        return Response.json({ principal: { id: "principal-a", displayName: "Ada", provider: "google" } });
      }
      return Response.json({
        path: "/",
        revision: 2,
        entries: [{ path: "/notes.txt", name: "notes.txt", type: "file", size: 5, mediaType: "text/plain" }],
      });
    }));
    const user = userEvent.setup();
    render(<App />);
    const trigger = await screen.findByRole("button", { name: "Rename notes.txt" });
    await user.click(trigger);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Rename file" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    const deleteTrigger = screen.getByRole("button", { name: "Delete notes.txt" });
    await user.click(deleteTrigger);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Delete file?" })).not.toBeInTheDocument();
    expect(deleteTrigger).toHaveFocus();
  });
});