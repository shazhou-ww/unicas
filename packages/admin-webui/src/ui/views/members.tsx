import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Copy, RefreshCw, UserMinus, UserPlus, X } from "lucide-react";
import type { AppMemberInvitation, AppMembership } from "@unicas/admin-client";
import { api, ifMatch } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface InvitationResult {
  readonly invitationId: string;
  readonly expiresAt: number;
  readonly acceptUrl: string;
}

interface MembersProps {
  appId: string;
  appRevision: number;
  onChanged: () => void;
}

export function MembersView(props: MembersProps) {
  return <MembersPanel key={props.appId} {...props} />;
}

function MembersPanel({ appId, appRevision, onChanged }: MembersProps) {
  const [members, setMembers] = useState<AppMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<InvitationResult | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [view, setView] = useState("administrators");
  const [invitationVersion, setInvitationVersion] = useState(0);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api<{ items: AppMembership[] }>(`/admin/apps/${encodeURIComponent(appId)}/members`);
      setMembers(result.items);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite() {
    setInviting(true);
    setError(null);
    setInviteResult(null);
    try {
      const result = await api<InvitationResult>(
        `/admin/apps/${encodeURIComponent(appId)}/member-invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(email.trim().length > 0 ? { emailConstraint: email.trim() } : {}),
        },
      );
      setInviteResult(result);
      setCopied(false);
      setInvitationVersion(version => version + 1);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setInviting(false);
    }
  }

  async function removeMember(issuer: string, subject: string) {
    setRemoving(subject);
    setError(null);
    try {
      await api<{ ok: true }>(
        `/admin/apps/${encodeURIComponent(appId)}/members?issuer=${encodeURIComponent(issuer)}&subject=${encodeURIComponent(subject)}`,
        { method: "DELETE", headers: ifMatch(appRevision) },
      );
      onChanged();
      await load();
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invite an App Administrator</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="email-constraint">Email constraint (optional)</Label>
              <Input
                id="email-constraint"
                value={email}
                placeholder="email@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <Button onClick={() => void invite()} disabled={inviting}>
              <UserPlus className="h-4 w-4" />
              {inviting ? "Creating…" : "Create invitation"}
            </Button>
          </div>

          {inviteResult ? (
            <div className="rounded-md border bg-muted/50 p-4 space-y-2">
              <p className="text-sm">
                One-time invitation created (expires {new Date(inviteResult.expiresAt).toLocaleString()}).
                Share this URL once:
              </p>
              <code className="block rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
                {inviteResult.acceptUrl}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteResult.acceptUrl)
                    .then(() => setCopied(true))
                    .catch(() => setError("Unable to copy invitation URL"));
                }}
              >
                <Copy className="h-4 w-4" />
                {copied ? "Copied" : "Copy invitation URL"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Tabs */}
      <nav className="flex gap-1 border-b" role="tablist" aria-label="App members" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "administrators" : event.key === "End" ? "invitations" : view === "administrators" ? "invitations" : "administrators";
        setView(next);
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus();
      }}>
        {[{ id: "administrators", label: "Administrators" }, { id: "invitations", label: "Invitations" }].map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-view={tab.id}
            id={`members-${tab.id}`}
            aria-controls="members-panel"
            aria-selected={view === tab.id}
            tabIndex={view === tab.id ? 0 : -1}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              view === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setView(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div id="members-panel" role="tabpanel" aria-labelledby={`members-${view}`}>
        {view === "invitations" ? (
          <InvitationList key={`${appId}:${invitationVersion}`} appId={appId} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>App Administrators</CardTitle>
            </CardHeader>
            <CardContent>
              {members === null && !error ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : null}

              {members !== null && members.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                  <p>No members.</p>
                </div>
              ) : null}

              {members !== null && members.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="w-[100px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow key={member.principal.subject}>
                        <TableCell className="font-medium">{member.principal.subject}</TableCell>
                        <TableCell>{member.profile.emailForDisplay ?? "—"}</TableCell>
                        <TableCell>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={removing === member.principal.subject}
                            onClick={() => void removeMember(member.principal.issuer, member.principal.subject)}
                          >
                            <UserMinus className="h-4 w-4" />
                            {removing === member.principal.subject ? "Removing…" : "Remove"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function InvitationList({ appId }: { appId: string }) {
  const [items, setItems] = useState<AppMemberInvitation[] | null>(null);
  const [status, setStatus] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AppMemberInvitation | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async (cursor?: string) => {
    const version = ++requestVersion.current;
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (status) query.set("status", status);
      if (cursor) query.set("cursor", cursor);
      const page = await api<{ items: AppMemberInvitation[]; nextCursor: string | null }>(`/admin/apps/${encodeURIComponent(appId)}/member-invitations?${query}`);
      if (version !== requestVersion.current) return;
      setItems(previous => cursor ? [...(previous ?? []), ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setError(formatErrorSafe(caught));
      setNextCursor(null);
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }, [appId, status]);

  useEffect(() => {
    setItems(null);
    setConfirming(null);
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  async function revoke() {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    try {
      await api<void>(`/admin/apps/${encodeURIComponent(appId)}/member-invitations/${encodeURIComponent(confirming.invitationId)}`, {
        method: "DELETE", headers: ifMatch(confirming.revision),
      });
      setConfirming(null);
      await load();
    } catch (caught) {
      setConfirming(null);
      await load();
      setError(formatErrorSafe(caught));
    } finally {
      setBusy(false);
    }
  }

  function getStatusBadgeVariant(invStatus: string): "default" | "secondary" | "destructive" | "outline" {
    switch (invStatus) {
      case "pending": return "default";
      case "accepted": return "secondary";
      case "expired": return "outline";
      case "revoked": return "destructive";
      default: return "outline";
    }
  }

  return (
    <section className="space-y-4" aria-label="App invitations">
      <div className="flex items-center gap-4">
        <div className="space-y-1">
          <Label htmlFor="invitation-status">Status</Label>
          <select
            id="invitation-status"
            value={status}
            disabled={busy}
            onChange={event => setStatus(event.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">All statuses</option>
            {["pending", "accepted", "expired", "revoked"].map(value => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      {busy && items === null ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {items !== null ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email Constraint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No invitations.
                </TableCell>
              </TableRow>
            ) : (
              items.map(invitation => (
                <TableRow key={invitation.invitationId}>
                  <TableCell className="font-medium">
                    {invitation.emailConstraint ?? "Unconstrained"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(invitation.status)}>
                      {invitation.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(invitation.expiresAt).toLocaleString()}</TableCell>
                  <TableCell>
                    {invitation.status === "pending" && invitation.expiresAt > Date.now() ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy || confirming !== null}
                        onClick={() => setConfirming(invitation)}
                      >
                        <X className="h-4 w-4" />
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      ) : null}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button variant="outline" disabled={busy} onClick={() => void load(nextCursor)}>
            <ArrowRight className="h-4 w-4" />
            Load more invitations
          </Button>
        </div>
      ) : null}

      {/* Revoke confirmation dialog */}
      <Dialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Invitation</DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke the invitation for {confirming?.emailConstraint ?? confirming?.invitationId}?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void revoke()} disabled={busy}>
              <X className="h-4 w-4" />
              Confirm revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
