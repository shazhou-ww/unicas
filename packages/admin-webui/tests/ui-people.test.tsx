import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PeopleView } from "../src/ui/views/people.js";

const member = { kind: "member", joinedAt: 1, membership: { appId: "cas_one", principal: { issuer: "issuer-a", subject: "same" }, profile: { displayName: "Alice", emailForDisplay: "same@example.test" } } };
const invitation = { kind: "invitation", invitation: { invitationId: "invite-1", emailConstraint: "same@example.test", status: "pending", expiresAt: 4102444800000, createdAt: 2, revision: 7 } };
const response = (body: unknown) => Response.json(body);

test("Platform Members renders its toolbar without statistics or summary requests", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => response({ items: [], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
  render(<PeopleView scope={{ platform: true }} />);
  await screen.findByText("No people found.");
  expect(screen.getByRole("button", { name: "Invite" })).toBeVisible();
  expect(screen.getByRole("table")).toBeVisible();
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
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(requests.at(-1)).toContain("query=Alice"));
  await user.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(requests.at(-1)).toContain("cursor=page-two"));
  expect(requests.at(-1)).toContain("query=Alice");
});

test("App invitations use existing create/revoke receipts and member removal uses both identity fields", async () => {
  const fetcher = vi.fn(async (_input: string, init?: RequestInit) => init?.method === "POST" ? response({ acceptUrl: "https://example.test/invite/one", expiresAt: 4102444800000 }) : init?.method === "DELETE" ? new Response(null, { status: 204 }) : response({ items: [member, invitation], nextCursor: null }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<PeopleView scope={{ appId: "cas_one", appRevision: 3, onChanged: vi.fn() }} />);
  await screen.findByText("Alice");
  await user.click(screen.getByRole("button", { name: "Invite" }));
  await user.type(screen.getByLabelText("Email constraint (optional)"), "invitee@example.test");
  await user.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(await screen.findByText("https://example.test/invite/one")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getByTitle("Revoke invitation"));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm revoke" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => url.endsWith("invite-1") && new Headers(init?.headers).get("If-Match") === '"7"')).toBe(true));
  await user.click(screen.getByTitle("Remove member"));
  await user.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => url.includes("issuer=issuer-a&subject=same") && new Headers(init?.headers).get("If-Match") === '"3"')).toBe(true));
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