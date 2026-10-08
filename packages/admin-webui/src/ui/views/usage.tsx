import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw, Trash2 } from "lucide-react";
import type { AppGcResult, AppUsage } from "@unicas/admin-client";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { api } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";

export function UsageView({ appId }: { appId: string }) {
  return <UsagePanel key={appId} appId={appId} />;
}

function UsagePanel({ appId }: { appId: string }) {
  const [usage, setUsage] = useState<AppUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [gcDialogOpen, setGcDialogOpen] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [gcError, setGcError] = useState<string | null>(null);
  const [gcResult, setGcResult] = useState<AppGcResult | null>(null);
  const [gcCursor, setGcCursor] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api<AppUsage>(`/admin/apps/${encodeURIComponent(appId)}/usage`);
      if (request === requestSequence.current) {
        setUsage(result);
        setUpdatedAt(Date.now());
      }
    } catch (caught) {
      if (request === requestSequence.current) setError(formatErrorSafe(caught));
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  async function runGc() {
    setCollecting(true);
    setGcError(null);
    try {
      const result = await api<AppGcResult>(`/admin/apps/${encodeURIComponent(appId)}/gc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gcCursor === null ? {} : { cursor: gcCursor }),
      });
      setGcResult(result);
      setGcCursor(result.nextCursor);
      setGcDialogOpen(false);
      await load();
    } catch (caught) {
      setGcError(formatErrorSafe(caught));
    } finally {
      setCollecting(false);
    }
  }

  const gcButtonLabel = gcCursor !== null
    ? "Continue garbage collection"
    : gcResult && gcResult.nodesDeleted > 0
      ? "Run another pass"
      : "Run garbage collection";

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Usage</CardTitle>
          {usage ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Refresh usage"
              title="Refresh usage"
              disabled={loading || collecting}
              onClick={() => void load()}
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {usage ? <UsageMetrics usage={usage} /> : loading ? <UsageSkeleton /> : null}
          {usage && loading ? (
            <p className="text-sm text-muted-foreground" role="status">Refreshing usage…</p>
          ) : null}
          {usage && isZeroUsage(usage) ? (
            <p className="text-sm text-muted-foreground">No storage activity yet.</p>
          ) : null}
          {gcResult ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm" role="status">
              <p className="font-medium">
                {gcResult.nodesDeleted === 0
                  ? "No eligible nodes were found."
                  : `Deleted ${gcResult.nodesDeleted.toLocaleString()} nodes from ${gcResult.spacesWithDeletions.toLocaleString()} ${gcResult.spacesWithDeletions === 1 ? "Space" : "Spaces"}.`}
              </p>
              {gcResult.nodesDeleted > 0 ? (
                <p className="mt-1 text-muted-foreground">
                  Released {formatBytes(gcResult.reclaimedContentBytes)} of logical content.
                  {gcResult.nextCursor === null ? " Another pass may expose child nodes for collection." : ""}
                </p>
              ) : null}
              {gcResult.nextCursor !== null ? (
                <p className="mt-1 text-muted-foreground">More Spaces remain in this App sweep.</p>
              ) : null}
            </div>
          ) : null}
          {gcError && !gcDialogOpen ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{gcError}</span>
            </div>
          ) : null}
          {error ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              <span className="flex min-w-0 items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
            </div>
          ) : null}
          {usage && updatedAt !== null && !loading && !error ? (
            <p className="text-xs text-muted-foreground">
              Updated {new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
            </p>
          ) : null}
        </CardContent>
        {usage ? (
          <CardFooter className="flex flex-col items-start justify-between gap-3 border-t pt-6 sm:flex-row sm:items-center">
            <div className="max-w-2xl">
              <p className="text-sm font-medium">Garbage collection</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Remove expired, unreferenced nodes across this App in a bounded, race-safe pass.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={collecting || loading || usage.nodeCount === 0}
              onClick={() => setGcDialogOpen(true)}
            >
              <Trash2 />
              {gcButtonLabel}
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      <Dialog
        open={gcDialogOpen}
        onOpenChange={open => {
          if (!collecting) setGcDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run garbage collection?</DialogTitle>
            <DialogDescription>
              This permanently deletes eligible CAS nodes from a bounded batch of Spaces in this App.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 p-4 text-sm">
            <p className="font-medium">A node is deleted only when all three conditions are true:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>It has no Root Ref.</li>
              <li>No stored parent references it.</li>
              <li>Its protection lease has expired.</li>
            </ul>
            <p className="mt-3 text-muted-foreground">
              A pass can make child nodes eligible, so more than one pass may be needed.
            </p>
          </div>
          {gcError ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{gcError}</span>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={collecting} onClick={() => setGcDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={collecting} onClick={() => void runGc()}>
              <Trash2 />
              {collecting ? "Running garbage collection…" : "Run GC pass"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UsageMetrics({ usage }: { usage: AppUsage }) {
  const metrics = [
    ["Logical content", formatBytes(usage.readyContentBytes), `${usage.readyContentBytes.toLocaleString()} bytes`],
    ["Stored content", formatBytes(usage.readyStoredBytes), `${usage.readyStoredBytes.toLocaleString()} bytes`],
    ["Upload reservations", formatBytes(usage.reservedBytes), `${usage.reservedBytes.toLocaleString()} bytes`],
    ["Nodes", usage.nodeCount.toLocaleString(), undefined],
    ["Missing content", usage.notReadyNodeCount.toLocaleString(), undefined],
    ["Leased nodes", usage.leasedNodeCount.toLocaleString(), undefined],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3">
      {metrics.map(([label, value, title]) => (
        <div className="min-w-0 bg-card p-4" key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd
            className="mt-2 break-words text-xl font-semibold tabular-nums"
            title={title}
            aria-label={title ? `${value}; ${title}` : undefined}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function UsageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading usage" role="status" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="min-h-20 bg-card p-4" key={index}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

function isZeroUsage(usage: AppUsage): boolean {
  return Object.values(usage).every((value) => value === 0);
}

export function formatBytes(value: number): string {
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** unitIndex;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: unitIndex === 0 ? 0 : 1 }).format(amount)} ${units[unitIndex]}`;
}