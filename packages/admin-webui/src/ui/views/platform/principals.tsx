import { useCallback, useEffect, useState } from "react";
import type {
  PlatformPrincipalListItem,
  PlatformPrincipalDetail,
  PlatformPrincipalPage,
  PlatformAccessSummary,
  PlatformAuthority,
  PlatformAccessStatus,
  AppMembership,
} from "@unicas/admin-client";
import { api, ifMatch, ApiError } from "../../api.js";
import { formatErrorSafe } from "../view-helpers.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ALL_AUTHORITIES: readonly PlatformAuthority[] = ["platform.admin", "apps.create"];

function formatRelativeTime(timestamp: number | null): string {
  if (timestamp === null) return "—";
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function truncatePrincipal(principal: { issuer: string; subject: string }): string {
  const full = `${principal.issuer}:${principal.subject}`;
  return full.length > 40 ? `${full.slice(0, 37)}…` : full;
}

export function PlatformPrincipalsView() {
  const [summary, setSummary] = useState<PlatformAccessSummary | null>(null);
  const [principals, setPrincipals] = useState<PlatformPrincipalListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedPrincipal, setSelectedPrincipal] = useState<PlatformPrincipalDetail | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const result = await api<PlatformAccessSummary>("/admin/platform/access-summary");
      setSummary(result);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    }
  }, []);

  const loadPrincipals = useCallback(async (cursor?: string) => {
    const isLoadMore = cursor !== undefined;
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("after", cursor);
      const result = await api<PlatformPrincipalPage>(`/admin/platform/principals?${params}`);
      
      if (isLoadMore) {
        setPrincipals(prev => prev ? [...prev, ...result.items] as PlatformPrincipalListItem[] : [...result.items] as PlatformPrincipalListItem[]);
      } else {
        setPrincipals([...result.items] as PlatformPrincipalListItem[]);
      }
      setNextCursor(result.nextCursor);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      if (isLoadMore) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadSummary();
    void loadPrincipals();
  }, [loadSummary, loadPrincipals]);

  const openPrincipalDetail = useCallback(async (principalRef: string) => {
    setSheetOpen(true);
    setSheetLoading(true);
    setSheetError(null);
    setSelectedPrincipal(null);

    try {
      const result = await api<PlatformPrincipalDetail>(
        `/admin/platform/principals/${encodeURIComponent(principalRef)}`
      );
      setSelectedPrincipal(result);
    } catch (caught) {
      setSheetError(formatErrorSafe(caught));
    } finally {
      setSheetLoading(false);
    }
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setSelectedPrincipal(null);
    setSheetError(null);
  }, []);

  const filteredPrincipals = principals?.filter(principal => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const displayName = principal.profile.emailForDisplay?.toLowerCase() ?? "";
    const principalRef = `${principal.principal.issuer}:${principal.principal.subject}`.toLowerCase();
    return displayName.includes(query) || principalRef.includes(query);
  }) ?? [];

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      {/* Access Summary Cards */}
      {summary === null && !error ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {summary !== null ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Principals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.activePrincipalCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Platform Admins
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.platformAdminCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                App Creators
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.appCreatorCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Blocked Principals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.blockedPrincipalCount}</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Search/Filter */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search by email or principal..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Principals Table */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Principals</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : null}

          {!loading && principals !== null && principals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <p>No principals found.</p>
            </div>
          ) : null}

          {!loading && principals !== null && principals.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Principal</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Authorities</TableHead>
                    <TableHead>Apps</TableHead>
                    <TableHead>Last Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPrincipals.map((principal) => (
                    <TableRow
                      key={principal.principalRef}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => void openPrincipalDetail(principal.principalRef)}
                    >
                      <TableCell className="font-medium font-mono text-xs">
                        {truncatePrincipal(principal.principal)}
                      </TableCell>
                      <TableCell>{principal.profile.emailForDisplay ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={principal.status === "active" ? "default" : "destructive"}>
                          {principal.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {principal.authorities.length === 0 ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : (
                            principal.authorities.map(auth => (
                              <Badge key={auth} variant="outline" className="text-xs">
                                {auth}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{principal.appMembershipCount}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatRelativeTime(principal.lastActiveAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {nextCursor ? (
                <div className="flex justify-center mt-4">
                  <Button
                    variant="outline"
                    onClick={() => void loadPrincipals(nextCursor)}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading..." : "Load more"}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Principal Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Principal Details</SheetTitle>
          </SheetHeader>

          {sheetLoading ? (
            <div className="space-y-4 mt-6">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : null}

          {sheetError ? (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mt-6" role="alert">
              {sheetError}
            </div>
          ) : null}

          {selectedPrincipal && !sheetLoading && !sheetError ? (
            <PrincipalDetailEditor
              principal={selectedPrincipal}
              onSaved={() => {
                closeSheet();
                void loadPrincipals();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PrincipalDetailEditor({
  principal,
  onSaved,
}: {
  principal: PlatformPrincipalDetail;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<PlatformAccessStatus>(principal.status);
  const [authorities, setAuthorities] = useState<Set<PlatformAuthority>>(new Set(principal.authorities));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAuthority = (auth: PlatformAuthority) => {
    setAuthorities(prev => {
      const next = new Set(prev);
      if (next.has(auth)) {
        next.delete(auth);
      } else {
        next.add(auth);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const patch = {
        status,
        authorities: Array.from(authorities),
      };

      await api<void>(
        `/admin/platform/principals/${encodeURIComponent(principal.principalRef)}/access`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...ifMatch(principal.revision),
          },
          body: JSON.stringify(patch),
        }
      );

      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError("This principal was modified by another user. Please reload and try again.");
      } else {
        setError(formatErrorSafe(caught));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 mt-6">
      {/* Identity */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Principal Identity</Label>
        <div className="rounded-md bg-muted p-3 space-y-1 font-mono text-xs">
          <div>Issuer: {principal.principal.issuer}</div>
          <div>Subject: {principal.principal.subject}</div>
        </div>
      </div>

      {/* Profile */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Profile</Label>
        <div className="rounded-md bg-muted p-3 text-sm">
          <div>Email: {principal.profile.emailForDisplay ?? "—"}</div>
        </div>
      </div>

      <Separator />

      {/* Status */}
      <div className="space-y-2">
        <Label htmlFor="principal-status">Status</Label>
        <Select value={status} onValueChange={(value) => setStatus(value as PlatformAccessStatus)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Authorities */}
      <div className="space-y-3">
        <Label>Authorities</Label>
        <div className="space-y-2">
          {ALL_AUTHORITIES.map(auth => (
            <div key={auth} className="flex items-center space-x-2">
              <Checkbox
                id={`auth-${auth}`}
                checked={authorities.has(auth)}
                onCheckedChange={() => toggleAuthority(auth)}
              />
              <Label htmlFor={`auth-${auth}`} className="text-sm font-normal cursor-pointer">
                {auth}
              </Label>
            </div>
          ))}
        </div>
      </div>

      {/* Revision */}
      <div className="text-xs text-muted-foreground">
        Revision: {principal.revision}
      </div>

      {/* App Memberships */}
      {principal.memberships.length > 0 ? (
        <>
          <Separator />
          <div className="space-y-3">
            <Label>App Memberships ({principal.memberships.length})</Label>
            <div className="space-y-2">
              {principal.memberships.map(membership => (
                <div key={membership.principal.subject} className="rounded-md border p-2 text-xs">
                  <div className="font-medium font-mono text-xs">{membership.appId}</div>
                  <div className="text-muted-foreground font-mono">
                    {membership.principal.issuer}:{membership.principal.subject}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {error ? (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      {/* Save Button */}
      <div className="flex justify-end gap-2 pt-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
