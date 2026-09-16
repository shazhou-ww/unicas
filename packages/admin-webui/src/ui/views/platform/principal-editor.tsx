import { useState } from "react";
import type { PlatformPrincipalDetail, PlatformAccessStatus, PlatformAuthority } from "@unicas/admin-client";
import { api, ApiError, ifMatch } from "../../api.js";
import { formatErrorSafe } from "../view-helpers.js";
import { Button } from "@/components/ui/button.js";
import { Label } from "@/components/ui/label.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";

export function PrincipalDetailEditor({ principal, onSaved }: { principal: PlatformPrincipalDetail; onSaved: () => void }) {
  const [status, setStatus] = useState<PlatformAccessStatus>(principal.status);
  const [authorities, setAuthorities] = useState<PlatformAuthority[]>([...principal.authorities]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function save() {
    setConfirming(false);
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/platform/principals/${encodeURIComponent(principal.principalRef)}/access`, {
        method: "PATCH", headers: { "Content-Type": "application/json", ...ifMatch(principal.revision) },
        body: JSON.stringify({ status, authorities }),
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "SELF_BLOCK_FORBIDDEN"
        ? "You cannot block your own Principal."
        : caught instanceof ApiError && caught.code === "LAST_PLATFORM_ADMIN"
          ? "Assign another Platform Admin before removing the final administrator."
          : caught instanceof ApiError && caught.status === 412
            ? "This principal was modified by another user. Please reload and try again."
            : formatErrorSafe(caught));
    } finally { setSaving(false); }
  }

  return <div className="mt-6 space-y-6">
    <dl className="space-y-4 text-sm">
      <div><dt className="font-medium">Principal Identity</dt><dd className="mt-2 break-all font-mono text-xs">Issuer: {principal.principal.issuer}<br />Subject: {principal.principal.subject}</dd></div>
      <div><dt className="font-medium">Profile</dt><dd className="mt-2 break-all">Email: {principal.profile.emailForDisplay ?? "-"}</dd></div>
    </dl>
    <div className="space-y-2"><Label htmlFor="principal-status">Status</Label><Select value={status} onValueChange={value => setStatus(value as PlatformAccessStatus)}><SelectTrigger id="principal-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="blocked">Blocked</SelectItem></SelectContent></Select></div>
    <fieldset className="space-y-2"><legend className="text-sm font-medium">Authorities</legend>{(["platform.admin", "apps.create"] as const).map(authority => <div className="flex items-center gap-2" key={authority}><Checkbox id={`auth-${authority}`} checked={authorities.includes(authority)} onCheckedChange={checked => setAuthorities(current => checked ? [...current, authority] : current.filter(value => value !== authority))} /><Label htmlFor={`auth-${authority}`}>{authority}</Label></div>)}</fieldset>
    <p className="text-xs text-muted-foreground">Revision: {principal.revision}</p>
    <div className="space-y-2"><h3 className="text-sm font-medium">App Memberships ({principal.memberships.length})</h3>{principal.memberships.map(membership => <div className="break-all border-b py-2 font-mono text-xs" key={membership.appId}><div>{membership.appId}</div><div>{membership.principal.issuer} / {membership.principal.subject}</div></div>)}</div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex justify-end"><Button disabled={saving} onClick={() => setConfirming(true)}>{saving ? "Saving..." : "Save Changes"}</Button></div>
    <Dialog open={confirming} onOpenChange={setConfirming}><DialogContent><DialogHeader><DialogTitle>Confirm Platform Access changes</DialogTitle><DialogDescription>{status === "blocked" ? "Blocking immediately denies this Principal's Console, CLI, and MCP access." : authorities.includes("platform.admin") && !principal.authorities.includes("platform.admin") ? "This grants authority to manage Platform Access and platform invitations." : "Apply the selected status and authorities to this Principal."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button><Button variant={status === "blocked" ? "destructive" : "default"} onClick={() => void save()}>Confirm changes</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}