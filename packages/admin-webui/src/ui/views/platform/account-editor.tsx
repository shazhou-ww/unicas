import { useState } from "react";
import type { PlatformAccountDetail, PlatformAuthority } from "@unicas/admin-client";
import { api, ApiError } from "../../api.js";
import { formatErrorSafe } from "../view-helpers.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Label } from "@/components/ui/label.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { CopyBubble } from "../../components/copy-bubble.js";

type PendingCommand =
  | { readonly kind: "authority"; readonly authority: PlatformAuthority; readonly grant: boolean }
  | { readonly kind: "block"; readonly blocked: boolean };

const authorityDetails: Record<PlatformAuthority, { readonly label: string; readonly description: string }> = {
  "platform.admin": { label: "Platform administration", description: "Manage platform Accounts, access, invitations, and audit records." },
  "apps.create": { label: "Create Apps", description: "Register new Apps in the UniCAS control plane." },
};

export function PlatformAccountEditor({ account, onChanged }: { account: PlatformAccountDetail; onChanged: () => void }) {
  const [current, setCurrent] = useState(account);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCommand | null>(null);

  async function applyCommand() {
    if (!pending) return;
    setPending(null);
    setSaving(true);
    setError(null);
    try {
      if (pending.kind === "authority") {
        await api(`/admin/platform/accounts/${encodeURIComponent(current.accountId)}/authorities/${pending.authority}`, {
          method: pending.grant ? "PUT" : "DELETE",
        });
        setCurrent(value => ({
          ...value,
          platformAuthorities: pending.grant
            ? [...value.platformAuthorities, pending.authority]
            : value.platformAuthorities.filter(authority => authority !== pending.authority),
        }));
      } else {
        await api(`/admin/platform/accounts/${encodeURIComponent(current.accountId)}/block`, {
          method: pending.blocked ? "PUT" : "DELETE",
        });
        setCurrent(value => ({ ...value, blockedAt: pending.blocked ? Date.now() : null }));
      }
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === "SELF_BLOCK_FORBIDDEN"
        ? "You cannot block your own Account."
        : caught instanceof ApiError && caught.code === "LAST_PLATFORM_ADMIN"
          ? "Assign another Platform Admin before removing the final administrator."
          : formatErrorSafe(caught));
    } finally { setSaving(false); }
  }

  return <div className="mt-6 space-y-6">
    <dl className="space-y-4 text-sm">
      <div><dt className="font-medium">Account ID</dt><dd className="mt-2"><CopyBubble label="Account ID" value={current.accountId} className="justify-start text-left" /></dd></div>
      <div><dt className="font-medium">Verified contact</dt><dd className="mt-2 break-all">{current.primaryVerifiedEmail?.normalizedEmail ?? "-"}</dd></div>
      <div><dt className="font-medium">Status</dt><dd className="mt-2"><Badge variant={current.blockedAt === null ? "secondary" : "destructive"}>{current.blockedAt === null ? "Active" : "Blocked"}</Badge></dd></div>
    </dl>
    <fieldset className="space-y-3" disabled={saving}><legend className="text-sm font-medium">Authorities</legend><p className="text-xs text-muted-foreground">Changes apply immediately after confirmation.</p>{(["platform.admin", "apps.create"] as const).map(authority => <div className="flex items-start gap-2" key={authority}><Checkbox className="mt-1" id={`auth-${authority}`} checked={current.platformAuthorities.includes(authority)} onCheckedChange={checked => setPending({ kind: "authority", authority, grant: checked === true })} /><Label className="grid gap-0.5" htmlFor={`auth-${authority}`}><span>{authorityDetails[authority].label}</span><span className="text-xs font-normal text-muted-foreground">{authorityDetails[authority].description}</span></Label></div>)}</fieldset>
    <div className="space-y-2"><h3 className="text-sm font-medium">App Memberships ({current.memberships.length})</h3>{current.memberships.length === 0 ? <p className="text-sm text-muted-foreground">This Account does not administer an App.</p> : current.memberships.map(membership => <div className="break-all border-b py-2 font-mono text-xs" key={membership.appId}>{membership.appId}</div>)}</div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex justify-end"><Button variant={current.blockedAt === null ? "destructive" : "outline"} disabled={saving} onClick={() => setPending({ kind: "block", blocked: current.blockedAt === null })}>{saving ? "Applying..." : current.blockedAt === null ? "Block Account" : "Restore Account"}</Button></div>
    <Dialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }}><DialogContent><DialogHeader><DialogTitle>Confirm Platform Access change</DialogTitle><DialogDescription>{pending?.kind === "block" ? pending.blocked ? "Blocking immediately denies every linked login and rotates the Account credential generation." : "Restore this Account's current platform and App admission." : pending?.grant ? `Grant ${pending.authority} to this Account?` : `Revoke ${pending?.authority} from this Account?`}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setPending(null)}>Cancel</Button><Button variant={pending?.kind === "block" && pending.blocked ? "destructive" : "default"} onClick={() => void applyCommand()}>Confirm change</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}