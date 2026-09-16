import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { PlatformAuditAction, PlatformAuditEvent } from "@unicas/admin-client";
import { api } from "../../api.js";
import { formatErrorSafe } from "../view-helpers.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.js";

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

export function PlatformAuditView() {
  const [items, setItems] = useState<PlatformAuditEvent[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [action, setAction] = useState("all");
  const [actorPrincipalRef, setActorPrincipalRef] = useState("");
  const [targetPrincipalRef, setTargetPrincipalRef] = useState("");
  const [createdAfter, setCreatedAfter] = useState("");
  const [filters, setFilters] = useState({ action: "all", actorPrincipalRef: "", targetPrincipalRef: "", createdAfter: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (filters.action !== "all") query.set("action", filters.action);
      if (filters.actorPrincipalRef) query.set("actorPrincipalRef", filters.actorPrincipalRef);
      if (filters.targetPrincipalRef) query.set("targetPrincipalRef", filters.targetPrincipalRef);
      if (filters.createdAfter) query.set("createdAfter", String(new Date(filters.createdAfter).getTime()));
      if (cursor) query.set("cursor", cursor);
      const page = await api<{ items: PlatformAuditEvent[]; nextCursor: string | null }>(
        `/admin/platform/audit-events?${query}`,
      );
      setItems(current => cursor && current ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  function applyFilters() {
    setFilters({ action, actorPrincipalRef: actorPrincipalRef.trim(), targetPrincipalRef: targetPrincipalRef.trim(), createdAfter });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(12rem,1fr)_auto]">
        <div className="space-y-2"><Label htmlFor="platform-audit-action">Action</Label><Select value={action} onValueChange={setAction}><SelectTrigger id="platform-audit-action"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All actions</SelectItem>{actions.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="platform-audit-actor">Actor Principal ref</Label><Input id="platform-audit-actor" value={actorPrincipalRef} onChange={event => setActorPrincipalRef(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="platform-audit-target">Target Principal ref</Label><Input id="platform-audit-target" value={targetPrincipalRef} onChange={event => setTargetPrincipalRef(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="platform-audit-after">Created after</Label><Input id="platform-audit-after" type="datetime-local" value={createdAfter} onChange={event => setCreatedAfter(event.target.value)} /></div>
        <div className="flex items-end"><Button onClick={applyFilters}><Search className="mr-2 h-4 w-4" />Apply</Button></div>
      </div>

      {error ? <div className="text-sm text-destructive" role="alert">{error}</div> : null}

      <Card>
        <CardHeader><CardTitle>Platform audit</CardTitle></CardHeader>
        <CardContent>
          {items === null && loading ? <p className="text-sm text-muted-foreground" role="status">Loading events…</p> : null}
          {items?.length === 0 ? <p className="text-sm text-muted-foreground">No events.</p> : null}
          {items && items.length > 0 ? (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Target</TableHead><TableHead>Result</TableHead><TableHead>Request</TableHead></TableRow></TableHeader>
                <TableBody>{items.map(event => <TableRow key={event.eventId}>
                  <TableCell className="whitespace-nowrap">{new Date(event.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{event.action}</TableCell>
                  <TableCell className="font-mono text-xs">{event.actorPrincipalRef ?? `${event.actorPrincipal.issuer}:${event.actorPrincipal.subject}`}</TableCell>
                  <TableCell className="font-mono text-xs">{event.targetPrincipalRef ?? event.targetInvitationId ?? "—"}</TableCell>
                  <TableCell><Badge variant={event.result === "succeeded" ? "default" : "destructive"}>{event.result}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{event.requestId ?? "—"}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
              {nextCursor ? <div className="mt-4 flex justify-center"><Button variant="outline" onClick={() => void load(nextCursor)} disabled={loading}>Load more</Button></div> : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
