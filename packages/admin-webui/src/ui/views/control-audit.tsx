import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronsDown, Search } from "lucide-react";
import type { AppControlAuditEvent } from "@unicas/admin-client";
import { api } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyBubble } from "../components/copy-bubble.js";
import { LoadingState } from "../components/loading-state.js";
import { useNarrowLayout } from "../components/use-narrow-layout.js";
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

const actionNames: Partial<Record<string, string>> = {
  "app.created": "App created",
  "app.suspended": "App suspended",
  "app.restored": "App restored",
  "stack.created": "App created",
  "stack.patched": "App settings changed",
  "member.invited": "Member invited",
  "member.invitation.accepted": "Member invitation accepted",
  "member.invitation.revoked": "Member invitation revoked",
  "member.invitation.expired": "Member invitation expired",
  "member.removed": "Member removed",
  "oauth_issuer.inspection.created": "OAuth issuer inspected",
  "oauth_issuer.activated": "OAuth issuer activated",
  "oauth_issuer.replaced": "OAuth issuer replaced",
  "session.login": "Session signed in",
  "session.login_failed": "Session sign-in failed",
  "session.logout": "Session signed out",
};

function actionName(action: string): string {
  return actionNames[action] ?? action.replaceAll("_", " ").replaceAll(".", " · ");
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

export function ControlAuditView({ appId }: { appId: string }) {
  const narrow = useNarrowLayout();
  const requestVersion = useRef(0);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actorAccountId, setActorAccountId] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [filters, setFilters] = useState({ actorAccountId: "", targetAccountId: "" });

  const load = useCallback(async (nextCursor: string | null, replace: boolean) => {
    const request = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (nextCursor) query.set("cursor", nextCursor);
      if (filters.actorAccountId) query.set("actorAccountId", filters.actorAccountId);
      if (filters.targetAccountId) query.set("targetAccountId", filters.targetAccountId);
      const result = await api<AuditPage>(`/admin/apps/${encodeURIComponent(appId)}/audit-events?${query}`);
      if (request !== requestVersion.current) return;
      setPage((previous) => {
        if (!replace && previous) {
          return { items: [...previous.items, ...result.items], nextCursor: result.nextCursor };
        }
        return result;
      });
      setCursor(result.nextCursor);
    } catch (caught) {
      if (request !== requestVersion.current) return;
      setError(formatErrorSafe(caught));
    } finally {
      if (request === requestVersion.current) setLoading(false);
    }
  }, [appId, filters]);

  useEffect(() => {
    void load(null, true);
    return () => { requestVersion.current += 1; };
  }, [load]);

  return (
    <section className="space-y-4" aria-label="Change Logs">
      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={event => {
        event.preventDefault();
        setFilters({ actorAccountId: actorAccountId.trim(), targetAccountId: targetAccountId.trim() });
      }}>
        <div className="space-y-2"><Label htmlFor="app-audit-actor">Actor Account ID</Label><Input id="app-audit-actor" name="actorAccountId" autoComplete="off" spellCheck={false} placeholder="acct_…" value={actorAccountId} onChange={event => setActorAccountId(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="app-audit-target">Target Account ID</Label><Input id="app-audit-target" name="targetAccountId" autoComplete="off" spellCheck={false} placeholder="acct_…" value={targetAccountId} onChange={event => setTargetAccountId(event.target.value)} /></div>
        <div className="flex items-end"><Button type="submit"><Search className="h-4 w-4" />Apply filters</Button></div>
      </form>
      {error ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <span>{error}</span><Button type="button" size="sm" variant="outline" onClick={() => void load(null, true)}>Retry</Button>
        </div>
      ) : null}

      {page === null && !error ? (
        <LoadingState className="console-loading-region-compact" label="Loading Change Logs" detail="App events are loading." />
      ) : null}

      {page !== null && loading ? <p className="text-sm text-muted-foreground" role="status">Loading more Change Logs…</p> : null}
      {page !== null && page.items.length === 0 && !error ? <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No changes found.</div> : null}

      {page !== null && page.items.length > 0 ? (
        <div className="space-y-4">
          {!narrow ? <Table>
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
                  <TableCell className="whitespace-nowrap">{formatDateTime(event.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{actionName(event.action)}</span>
                      {isLegacyIssuerAction(event.action) ? (
                        <Badge variant="outline" className="text-xs" title="Historical action from the retired issuer-key API">
                          Legacy
                        </Badge>
                      ) : null}
                    </div>
                    <code className="text-xs text-muted-foreground">{event.action}</code>
                  </TableCell>
                  <TableCell className="text-xs"><div className="font-medium">{event.actorAccount.displayName ?? event.actorAccount.accountId}</div><div className="font-mono text-muted-foreground">{event.actorAccount.accountId}</div><div className="break-all font-mono text-muted-foreground">{event.authenticatedIdentity.issuer} / {event.authenticatedIdentity.subject}</div></TableCell>
                  <TableCell className="max-w-48 break-all">
                    <code className="text-xs">{event.targetAccount?.accountId ?? event.target}</code>
                  </TableCell>
                  <TableCell>{event.requestId ? <CopyBubble label="Request ID" value={event.requestId} /> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table> : <div className="grid gap-3" role="list" aria-label="Change Log events">{page.items.map(event => {
            const target = event.targetAccount?.accountId ?? event.target;
            return <article key={event.eventId} role="listitem" aria-label={actionName(event.action)} className="grid gap-3 rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{actionName(event.action)}</p><code className="text-xs text-muted-foreground">{event.action}</code></div>{isLegacyIssuerAction(event.action) ? <Badge variant="outline" className="text-xs">Legacy</Badge> : null}</div>
              <p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
              <dl className="grid gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Actor</dt><dd>{event.actorAccount.displayName ?? event.actorAccount.accountId}</dd></div><div><dt className="text-xs text-muted-foreground">Target</dt><dd className="break-all font-mono text-xs">{target}</dd></div></dl>
              {event.requestId ? <CopyBubble label="Request ID" value={event.requestId} className="justify-start text-left" /> : null}
            </article>;
          })}</div>}

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
