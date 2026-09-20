import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { PlatformAccountAuditEvent, PlatformAuditAction } from "@unicas/admin-client";
import { api } from "../../api.js";
import { formatErrorSafe } from "../view-helpers.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.js";
import { CopyBubble } from "../../components/copy-bubble.js";
import { LoadingState } from "../../components/loading-state.js";
import { useNarrowLayout } from "../../components/use-narrow-layout.js";

const actions: readonly PlatformAuditAction[] = [
  "platform_invitation.created",
  "platform_invitation.revoked",
  "platform_invitation.accepted",
  "platform_access.authority_changed",
  "platform_access.blocked",
  "platform_access.restored",
  "platform_access.change_denied",
  "app.create_denied",
];

const actionNames: Partial<Record<string, string>> = {
  "platform_invitation.created": "Platform invitation created",
  "platform_invitation.revoked": "Platform invitation revoked",
  "platform_invitation.accepted": "Platform invitation accepted",
  "platform_access.authority_changed": "Platform authority changed",
  "platform_access.blocked": "Account access blocked",
  "platform_access.restored": "Account access restored",
  "platform_access.change_denied": "Platform access change denied",
  "app.create_denied": "App creation denied",
};

function actionName(action: string): string {
  return actionNames[action] ?? action.replaceAll("_", " ").replaceAll(".", " · ");
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export function PlatformAuditView() {
  const narrow = useNarrowLayout();
  const requestVersion = useRef(0);
  const [items, setItems] = useState<PlatformAccountAuditEvent[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [action, setAction] = useState("all");
  const [actorAccountId, setActorAccountId] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [createdAfter, setCreatedAfter] = useState("");
  const [filters, setFilters] = useState({ action: "all", actorAccountId: "", targetAccountId: "", createdAfter: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    const request = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (filters.action !== "all") query.set("action", filters.action);
      if (filters.actorAccountId) query.set("actorAccountId", filters.actorAccountId);
      if (filters.targetAccountId) query.set("targetAccountId", filters.targetAccountId);
      if (filters.createdAfter) query.set("createdAfter", String(new Date(filters.createdAfter).getTime()));
      if (cursor) query.set("cursor", cursor);
      const page = await api<{ items: PlatformAccountAuditEvent[]; nextCursor: string | null }>(
        `/admin/platform/audit-events?${query}`,
      );
      if (request !== requestVersion.current) return;
      setItems(current => cursor && current ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      if (request !== requestVersion.current) return;
      setError(formatErrorSafe(caught));
    } finally {
      if (request === requestVersion.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  function applyFilters() {
    setFilters({ action, actorAccountId: actorAccountId.trim(), targetAccountId: targetAccountId.trim(), createdAfter });
  }

  return (
    <section className="space-y-4" aria-label="Change Logs">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_auto]">
        <div className="space-y-2"><Label htmlFor="platform-audit-action">Action</Label><Select name="action" value={action} onValueChange={setAction}><SelectTrigger id="platform-audit-action"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All actions</SelectItem>{actions.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="platform-audit-actor">Actor Account ID</Label><Input id="platform-audit-actor" name="actorAccountId" autoComplete="off" spellCheck={false} placeholder="acct_…" value={actorAccountId} onChange={event => setActorAccountId(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="platform-audit-target">Target Account ID</Label><Input id="platform-audit-target" name="targetAccountId" autoComplete="off" spellCheck={false} placeholder="acct_…" value={targetAccountId} onChange={event => setTargetAccountId(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="platform-audit-after">Created after</Label><Input id="platform-audit-after" name="createdAfter" autoComplete="off" type="datetime-local" value={createdAfter} onChange={event => setCreatedAfter(event.target.value)} /></div>
        <div className="flex items-end"><Button onClick={applyFilters}><Search className="mr-2 h-4 w-4" />Apply filters</Button></div>
      </div>

      {error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert"><span>{error}</span><Button type="button" size="sm" variant="outline" onClick={() => void load()}>Retry</Button></div> : null}
      {items === null && loading ? <LoadingState className="console-loading-region-compact" label="Loading Change Logs" detail="Platform events are loading." /> : null}
      {items !== null && loading ? <p className="text-sm text-muted-foreground" role="status">Refreshing Change Logs…</p> : null}
      {items !== null && items.length === 0 && !error ? <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No changes found.</div> : null}
      {items !== null && items.length > 0 ? (
        <>
          {!narrow ? <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Target</TableHead><TableHead>Result</TableHead><TableHead>Request</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map(event => <TableRow key={event.eventId}>
                <TableCell className="whitespace-nowrap">{formatDateTime(event.createdAt)}</TableCell>
                <TableCell><div className="font-medium">{actionName(event.action)}</div><code className="text-xs text-muted-foreground">{event.action}</code></TableCell>
                <TableCell className="text-xs"><div className="font-medium">{event.actorAccount.displayName ?? event.actorAccount.accountId}</div><div className="font-mono text-muted-foreground">{event.actorAccount.accountId}</div><div className="break-all font-mono text-muted-foreground">{event.authenticatedIdentity.issuer} / {event.authenticatedIdentity.subject}</div></TableCell>
                <TableCell className="max-w-48 break-all font-mono text-xs">{event.targetAccount?.accountId ?? event.targetInvitationId ?? "—"}</TableCell>
                <TableCell><Badge variant={event.result === "succeeded" ? "default" : "destructive"}>{event.result}</Badge></TableCell>
                <TableCell>{event.requestId ? <CopyBubble label="Request ID" value={event.requestId} /> : "—"}</TableCell>
              </TableRow>)}</TableBody>
          </Table> : <div className="grid gap-3" role="list" aria-label="Change Log events">{items.map(event => {
            const target = event.targetAccount?.accountId ?? event.targetInvitationId ?? null;
            return <article key={event.eventId} role="listitem" aria-label={`${actionName(event.action)}, ${event.result}`} className="grid gap-3 rounded-md border bg-card p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{actionName(event.action)}</p><code className="text-xs text-muted-foreground">{event.action}</code></div><Badge variant={event.result === "succeeded" ? "default" : "destructive"}>{event.result}</Badge></div>
              <p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
              <dl className="grid gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Actor</dt><dd>{event.actorAccount.displayName ?? event.actorAccount.accountId}</dd></div><div><dt className="text-xs text-muted-foreground">Target</dt><dd className="break-all font-mono text-xs">{target ?? "—"}</dd></div></dl>
              {event.requestId ? <CopyBubble label="Request ID" value={event.requestId} className="justify-start text-left" /> : null}
            </article>;
          })}</div>}
          {nextCursor ? <div className="mt-4 flex justify-center"><Button variant="outline" onClick={() => void load(nextCursor)} disabled={loading}>Load more</Button></div> : null}
        </>
      ) : null}
    </section>
  );
}
