// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MyAppsView } from "../src/ui/index.js";
import { AppCreateRow } from "../src/ui/components/app-create-row.js";

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
  test.each([
    { name: "", enter: false },
    { name: "   ", enter: false },
    { name: "", enter: true },
  ])("cancels an empty draft on blur ($name, Enter=$enter)", async ({ name, enter }) => {
    const cancel = vi.fn();
    const created = vi.fn();
    const user = userEvent.setup();
    render(<AppCreateRow onCreated={created} onCancel={cancel} />);
    if (name) await user.type(screen.getByLabelText("App display name"), name);
    if (enter) {
      await user.keyboard("{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent("App name is required");
    }
    await user.tab();
    expect(cancel).not.toHaveBeenCalled();
    await user.tab();
    await user.tab();
    expect(cancel).toHaveBeenCalledOnce();
    expect(created).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("inline creation validates locally and submits a trimmed name once on Enter and blur", async () => {
    const onCreated = vi.fn();
    fetchMock.mockResolvedValue(json({ appId: "cas_new" }, 201));
    const user = userEvent.setup();
    render(<AppCreateRow onCreated={onCreated} onCancel={vi.fn()} />);
    const input = screen.getByLabelText("App display name");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("App name is required");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.type(input, "  New App  ");
    await user.keyboard("{Enter}");
    await user.tab();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("cas_new"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ displayName: "New App" });
  });

  test("inline creation keeps server errors and reuses its idempotency key on retry", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "INVALID_REQUEST", message: "Name rejected" }, 400)).mockResolvedValueOnce(json({ appId: "cas_new" }));
    const user = userEvent.setup();
    render(<AppCreateRow onCreated={vi.fn()} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText("App display name"), "Draft");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Name rejected");
    await user.tab();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByLabelText("App display name"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Idempotency-Key")).toBe(new Headers(fetchMock.mock.calls[1][1].headers).get("Idempotency-Key"));
  });

  test("Escape cancels the inline draft without creating", async () => {
    const cancel = vi.fn();
    const user = userEvent.setup();
    render(<AppCreateRow onCreated={vi.fn()} onCancel={cancel} />);
    await user.type(screen.getByLabelText("App display name"), "Draft");
    await user.keyboard("{Escape}");
    await user.tab();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("shows only a starter message without fetching or duplicating sidebar controls", () => {
    render(<MyAppsView />);
    expect(screen.getByRole("region", { name: "Get started" })).toHaveTextContent("Select an App to get started, or use + to create one.");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not suggest creation without authority", () => {
    render(<MyAppsView canCreateApps={false} />);
    expect(screen.getByText("Select an App to get started.")).toBeVisible();
    expect(screen.queryByText(/create one/)).not.toBeInTheDocument();
  });

  test("creates a named draft on blur", async () => {
    fetchMock.mockResolvedValue(json({ appId: "cas_new" }, 201));
    const created = vi.fn();
    const user = userEvent.setup();
    render(<AppCreateRow onCreated={created} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText("App display name"), "New");
    await user.tab();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.tab();
    await user.tab();
    await waitFor(() => expect(created).toHaveBeenCalledWith("cas_new"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("mouse confirmation creates once without a premature blur submission", async () => {
    fetchMock.mockResolvedValue(json({ appId: "cas_mouse" }, 201));
    const created = vi.fn();
    const user = userEvent.setup();
    render(<AppCreateRow onCreated={created} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText("App display name"), "Mouse App");
    await user.click(screen.getByRole("button", { name: "Confirm App creation" }));
    await waitFor(() => expect(created).toHaveBeenCalledWith("cas_mouse"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("mouse cancellation of a named draft never creates an App", async () => {
    const cancel = vi.fn();
    const user = userEvent.setup();
    render(<AppCreateRow onCreated={vi.fn()} onCancel={cancel} />);
    await user.type(screen.getByLabelText("App display name"), "Do not create");
    await user.click(screen.getByRole("button", { name: "Cancel App creation" }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("inline controls support keyboard cancellation and mouse validation", async () => {
    const cancel = vi.fn();
    const user = userEvent.setup();
    render(<AppCreateRow onCreated={vi.fn()} onCancel={cancel} />);
    await user.click(screen.getByRole("button", { name: "Confirm App creation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("App name is required");
    expect(cancel).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole("button", { name: "Cancel App creation" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("keeps an overlong name in place and shows an anchored error without a request", async () => {
    const user = userEvent.setup();
    render(<AppCreateRow onCreated={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByLabelText("App display name");
    await user.type(input, "x".repeat(121));
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("at most 120 characters");
    expect(input).toHaveValue("x".repeat(121));
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
