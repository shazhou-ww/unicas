import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import type { AppUsage } from "@unicas/admin-client";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";
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

  return (
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
            disabled={loading}
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
    </Card>
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