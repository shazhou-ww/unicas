import { useCallback, useEffect, useState } from "react";
import { ChevronsDown, Search } from "lucide-react";
import type { AppControlAuditEvent } from "@unicas/admin-client";
import { api } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AuditPage {
  readonly items: readonly AppControlAuditEvent[];
  readonly nextCursor: string | null;
}

function isLegacyIssuerAction(action: string): boolean {
  return action.startsWith("issuer.");
}

export function ControlAuditView({ appId }: { appId: string }) {
  const [page, setPage] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actorAccountId, setActorAccountId] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [filters, setFilters] = useState({ actorAccountId: "", targetAccountId: "" });

  const load = useCallback(async (nextCursor: string | null, replace: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (nextCursor) query.set("cursor", nextCursor);
      if (filters.actorAccountId) query.set("actorAccountId", filters.actorAccountId);
      if (filters.targetAccountId) query.set("targetAccountId", filters.targetAccountId);
      const result = await api<AuditPage>(`/admin/apps/${encodeURIComponent(appId)}/audit-events?${query}`);
      setPage((previous) => {
        if (!replace && previous) {
          return { items: [...previous.items, ...result.items], nextCursor: result.nextCursor };
        }
        return result;
      });
      setCursor(result.nextCursor);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setLoading(false);
    }
  }, [appId, filters]);

  useEffect(() => {
    void load(null, true);
  }, [load]);

  return (
    <section className="space-y-4" aria-label="Change Logs">
      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={event => {
        event.preventDefault();
        setFilters({ actorAccountId: actorAccountId.trim(), targetAccountId: targetAccountId.trim() });
      }}>
        <div className="space-y-2"><Label htmlFor="app-audit-actor">Actor Account ID</Label><Input id="app-audit-actor" value={actorAccountId} onChange={event => setActorAccountId(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="app-audit-target">Target Account ID</Label><Input id="app-audit-target" value={targetAccountId} onChange={event => setTargetAccountId(event.target.value)} /></div>
        <div className="flex items-end"><Button type="submit"><Search className="h-4 w-4" />Apply</Button></div>
      </form>
      {error ? (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-4" role="alert">
          {error}
        </div>
      ) : null}

      {page === null && !error ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {page !== null ? (
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Request ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.length === 0 ? <TableRow><TableCell colSpan={5} className="text-muted-foreground">No changes yet.</TableCell></TableRow> : null}
              {page.items.map((event) => (
                <TableRow key={event.eventId}>
                  <TableCell>{new Date(event.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{event.action}</code>
                      {isLegacyIssuerAction(event.action) ? (
                        <Badge variant="outline" className="text-xs" title="Historical action from the retired issuer-key API">
                          Legacy
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs"><div className="font-medium">{event.actorAccount.displayName ?? event.actorAccount.accountId}</div><div className="font-mono text-muted-foreground">{event.actorAccount.accountId}</div><div className="break-all font-mono text-muted-foreground">{event.authenticatedIdentity.issuer} / {event.authenticatedIdentity.subject}</div></TableCell>
                  <TableCell>
                    <code className="text-xs">{event.targetAccount?.accountId ?? event.target}</code>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{event.requestId ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {cursor ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => void load(cursor, false)} disabled={loading}>
                <ChevronsDown className="h-4 w-4" />
                {loading ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
