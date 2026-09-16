import { useCallback, useEffect, useState } from "react";
import { RefreshCw, UserPlus, X } from "lucide-react";
import type { AppMemberInvitation } from "@unicas/admin-client";
import { api } from "../api.js";
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

interface AppInvitationsProps {
  appId: string;
}

export function AppInvitationsView({ appId }: AppInvitationsProps) {
  const [invitations, setInvitations] = useState<AppMemberInvitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [emailConstraint, setEmailConstraint] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<AppMemberInvitation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ items: AppMemberInvitation[] }>(
        `/admin/apps/${encodeURIComponent(appId)}/member-invitations`
      );
      setInvitations(result.items);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createInvitation() {
    setCreating(true);
    setError(null);
    try {
      const body = emailConstraint.trim() ? { emailConstraint: emailConstraint.trim() } : {};
      await api<AppMemberInvitation>(
        `/admin/apps/${encodeURIComponent(appId)}/member-invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      setCreateOpen(false);
      setEmailConstraint("");
      await load();
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setCreating(false);
    }
  }

  async function revokeInvitation() {
    if (!revoking) return;
    setError(null);
    try {
      await api<void>(
        `/admin/apps/${encodeURIComponent(appId)}/member-invitations/${encodeURIComponent(revoking.invitationId)}`,
        { method: "DELETE" }
      );
      setRevoking(null);
      await load();
    } catch (caught) {
      setError(formatErrorSafe(caught));
      setRevoking(null);
    }
  }

  function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
    switch (status) {
      case "pending": return "default";
      case "accepted": return "secondary";
      case "expired": return "outline";
      case "revoked": return "destructive";
      default: return "outline";
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>App Invitations</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                Refresh
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <UserPlus className="h-4 w-4" />
                Create invitation
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-4" role="alert">
              {error}
            </div>
          ) : null}

          {loading && invitations === null ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : null}

          {invitations !== null ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email Constraint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No invitations.
                    </TableCell>
                  </TableRow>
                ) : (
                  invitations.map((invitation) => (
                    <TableRow key={invitation.invitationId}>
                      <TableCell className="font-medium">
                        {invitation.emailConstraint ?? "Unconstrained"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(invitation.status)}>
                          {invitation.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(invitation.createdAt).toLocaleString()}</TableCell>
                      <TableCell>{new Date(invitation.expiresAt).toLocaleString()}</TableCell>
                      <TableCell>
                        {invitation.status === "pending" && invitation.expiresAt > Date.now() ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setRevoking(invitation)}
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
        </CardContent>
      </Card>

      {/* Create invitation dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Invitation</DialogTitle>
            <DialogDescription>
              Create a new invitation for this app. Optionally specify an email constraint.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="email-constraint">Email constraint (optional)</Label>
              <Input
                id="email-constraint"
                value={emailConstraint}
                onChange={(e) => setEmailConstraint(e.target.value)}
                placeholder="user@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={() => void createInvitation()} disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation dialog */}
      <Dialog open={revoking !== null} onOpenChange={(open) => { if (!open) setRevoking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Invitation</DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke the invitation for {revoking?.emailConstraint ?? "this user"}?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void revokeInvitation()}>
              <X className="h-4 w-4" />
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
