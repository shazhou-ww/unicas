import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PeopleView } from "../src/ui/views/people.js";

const accountId = `acct_${"a".repeat(22)}`;
const member = { kind: "member", joinedAt: 1, membership: { appId: "cas_one", account: { accountId, displayName: "Alice", primaryVerifiedEmail: { normalizedEmail: "same@example.test", source: "google-oidc", verifiedAt: 1 }, avatar: { kind: "fallback", initials: "AL", colorIndex: 1 } } } };
const invitation = { kind: "invitation", invitation: { invitationId: "invite-1", emailConstraint: "same@example.test", status: "pending", expiresAt: 4102444800000, createdAt: 2, revision: 7 } };
const response = (body: unknown) => Response.json(body);

test("Platform Members renders its toolbar without statistics or summary requests", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => response({ items: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
  render(<PeopleView scope={{ platform: true }} />);
  await screen.findByText("No people found.");
  expect(screen.getByRole("button", { name: "Invite" })).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Platform people" }).querySelector("dl")).toBeNull();
  expect(fetcher.mock.calls.every(([url]) => !String(url).includes("access-summary"))).toBe(true);
});

test("restores focus to the Invite and member action triggers on dismissal", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response({ items: [member], nextCursor: null })));
  const user = userEvent.setup();
  render(<PeopleView scope={{ appId: "cas_one", appRevision: 3, onChanged: vi.fn() }} />);
  await screen.findByText("Alice");
  const invite = screen.getByRole("button", { name: "Invite" });
  await user.click(invite);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(invite).toHaveFocus());
  const remove = screen.getByTitle("Remove member");
  await user.click(remove);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(remove).toHaveFocus());
});

test("one App table renders distinct members and invitations, filtering and paging on the server", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => { requests.push(input); return response({ items: input.includes("cursor=") ? [] : [member, invitation], nextCursor: input.includes("cursor=") ? null : "page-two" }); }));
  const user = userEvent.setup();
  render(<PeopleView scope={{ appId: "cas_one", appRevision: 3, onChanged: vi.fn() }} />);
  await screen.findByText("Alice");
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(screen.getAllByText("same@example.test")).toHaveLength(2);
  await user.type(screen.getByRole("textbox", { name: "Search people" }), "Alice");
  await user.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(requests.at(-1)).toContain("query=Alice"));
  await user.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(requests.at(-1)).toContain("cursor=page-two"));
  expect(requests.at(-1)).toContain("query=Alice");
});

test("App invitations use revision receipts while member removal targets only Account ID", async () => {
  const fetcher = vi.fn(async (_input: string, init?: RequestInit) => init?.method === "POST" ? response({ acceptUrl: "https://example.test/invite/one", expiresAt: 4102444800000 }) : init?.method === "DELETE" ? new Response(null, { status: 204 }) : response({ items: [member, invitation], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<PeopleView scope={{ appId: "cas_one", appRevision: 3, onChanged: vi.fn() }} />);
  await screen.findByText("Alice");
  await user.click(screen.getByRole("button", { name: "Invite" }));
  expect(screen.getByRole("button", { name: "Create invitation" })).toBeDisabled();
  await user.type(screen.getByLabelText("Email"), "invitee@example.test");
  await user.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(await screen.findByText("https://example.test/invite/one")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByTitle("Revoke invitation"));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm revoke" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => url.endsWith("invite-1") && new Headers(init?.headers).get("If-Match") === '"7"')).toBe(true));
  await user.click(screen.getByTitle("Remove member"));
  await user.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => url.includes(`accountId=${accountId}`) && new Headers(init?.headers).get("If-Match") === null)).toBe(true));
});

test("App invitations require an explicit unconstrained-link choice", async () => {
  let invitationBody: unknown;
  vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      invitationBody = JSON.parse(String(init.body));
      return response({ acceptUrl: "https://example.test/invite/open", expiresAt: 4102444800000 });
    }
    return response({ items: [], nextCursor: null });
  }));
  const user = userEvent.setup();
  render(<PeopleView scope={{ appId: "cas_one", appRevision: 3, onChanged: vi.fn() }} />);
  await screen.findByText("No people found.");
  await user.click(screen.getByRole("button", { name: "Invite" }));
  await user.click(screen.getByRole("radio", { name: /Anyone with the one-time link/ }));
  await user.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(await screen.findByText("https://example.test/invite/open")).toBeVisible();
  expect(invitationBody).toEqual({});
});

test("renders complete mobile person summaries without a wide table", async () => {
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  vi.stubGlobal("fetch", vi.fn(async () => response({ items: [member], nextCursor: null })));
  try {
    render(<PeopleView scope={{ appId: "cas_one", appRevision: 3, onChanged: vi.fn() }} />);
    const result = await screen.findByRole("listitem", { name: /Alice, Member/ });
    expect(within(result).getByText(accountId)).toBeVisible();
    expect(within(result).getByText("Joined / invited")).toBeVisible();
    expect(within(result).getByRole("button", { name: "Remove member" })).toHaveClass("min-h-11", "w-full");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  } finally {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
  }
});

test("Platform Invite requires proposed authorities and keeps permission editing separate", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response({ items: [{ ...invitation, invitation: { ...invitation.invitation, authorities: ["apps.create"] } }], nextCursor: null })));
  const user = userEvent.setup();
  render(<PeopleView scope={{ platform: true }} />);
  await screen.findByText("same@example.test");
  expect(screen.queryByTitle("Remove member")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Invite" }));
  expect(screen.getByRole("button", { name: "Create invitation" })).toBeDisabled();
  await user.type(screen.getByLabelText("Email"), "new@example.test");
  await user.click(screen.getByLabelText("App creation"));
  expect(screen.getByRole("button", { name: "Create invitation" })).toBeEnabled();
});

test("shows a bounded initial loading state without an empty table", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  render(<PeopleView scope={{ platform: true }} />);

  const loading = await screen.findByRole("status");
  expect(loading).toHaveClass("console-loading-state");
  expect(loading).toHaveTextContent("Loading people");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();

  await act(async () => resolve(response({ items: [], nextCursor: null })));
  expect(await screen.findByText("No people found.")).toBeVisible();
});