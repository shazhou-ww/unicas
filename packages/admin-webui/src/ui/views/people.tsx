import { useEffect, useRef, useState } from "react";
import { RefreshCw, Search, UserMinus, UserPlus, X } from "lucide-react";
import type { AppPerson, PlatformPerson, PlatformPrincipalDetail, PlatformAccessSummary, PeoplePage } from "@unicas/admin-client";
import { api, ifMatch } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { CopyBubble } from "../components/copy-bubble.js";
import { PrincipalDetailEditor } from "./platform/principal-editor.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { Badge } from "@/components/ui/badge.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";

type Person = AppPerson | PlatformPerson;
type Scope = { appId: string; appRevision: number; onChanged: () => void } | { platform: true };
type Props = { scope: Scope; initialFilter?: string };

function personKey(person: Person): string {
  if (person.kind === "member") return JSON.stringify([person.kind, person.membership.principal.issuer, person.membership.principal.subject]);
  if (person.kind === "principal") return `principal:${person.principal.principalRef}`;
  return `invitation:${person.invitation.invitationId}`;
}

export function PeopleView(props: Props) {
  return <PeoplePanel key={"appId" in props.scope ? props.scope.appId : "platform"} {...props} />;
}

function PeoplePanel({ scope, initialFilter = "current" }: Props) {
  const platform = "platform" in scope;
  const base = platform ? "/admin/platform" : `/admin/apps/${encodeURIComponent(scope.appId)}`;
  const invitationBase = `${base}/${platform ? "invitations" : "member-invitations"}`;
  const [filters, setFilters] = useState({ query: "", filter: initialFilter, authority: "all", effectiveAccess: "all" });
  const [draft, setDraft] = useState(filters);
  const [items, setItems] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PlatformAccessSummary | null>(null);
  const [version, setVersion] = useState(0);
  const requestVersion = useRef(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [authorities, setAuthorities] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<{ acceptUrl: string; expiresAt: number } | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Person | null>(null);
  const [principalRef, setPrincipalRef] = useState<string | null>(null);
  const [principal, setPrincipal] = useState<PlatformPrincipalDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    setFilters(current => current.filter === initialFilter ? current : ({ ...current, filter: initialFilter }));
    setDraft(current => current.filter === initialFilter ? current : ({ ...current, filter: initialFilter }));
  }, [initialFilter]);

  useEffect(() => {
    const request = ++requestVersion.current;
    setItems([]);
    setCursor(null);
    void load(undefined, request);
    return () => { requestVersion.current += 1; };
  }, [base, filters, version]);

  useEffect(() => {
    if (!platform) return;
    let active = true;
    api<PlatformAccessSummary>("/admin/platform/access-summary")
      .then(result => { if (active) setSummary(result); })
      .catch(() => { if (active) setSummary(null); });
    return () => { active = false; };
  }, [platform, version]);

  useEffect(() => {
    if (!principalRef) return;
    let active = true;
    setPrincipal(null);
    setDetailError(null);
    api<PlatformPrincipalDetail>(`/admin/platform/principals/${encodeURIComponent(principalRef)}`)
      .then(result => { if (active) setPrincipal(result); })
      .catch(caught => { if (active) setDetailError(formatErrorSafe(caught)); });
    return () => { active = false; };
  }, [principalRef]);

  async function load(next?: string, request = ++requestVersion.current) {
    setBusy(true);
    setError(null);
    const query = new URLSearchParams({ filter: filters.filter, limit: "50" });
    if (filters.query) query.set("query", filters.query);
    if (next) query.set("cursor", next);
    if (platform && filters.authority !== "all") query.set("authority", filters.authority);
    if (platform && filters.effectiveAccess !== "all") query.set("effectiveAccess", filters.effectiveAccess);
    try {
      const page = await api<PeoplePage<Person>>(`${base}/people?${query}`);
      if (request !== requestVersion.current) return;
      setItems(current => next ? [...current, ...page.items] : [...page.items]);
      setCursor(page.nextCursor);
    } catch (caught) {
      if (request !== requestVersion.current) return;
      setError(formatErrorSafe(caught));
      setCursor(null);
    } finally {
      if (request === requestVersion.current) setBusy(false);
    }
  }

  function refresh() { setVersion(current => current + 1); }
  function openInvite() { setEmail(""); setAuthorities([]); setReceipt(null); setMutationError(null); setInviteOpen(true); }

  async function invite() {
    setMutationBusy(true);
    setMutationError(null);
    try {
      const body = platform ? { emailConstraint: email.trim(), authorities } : email.trim() ? { emailConstraint: email.trim() } : {};
      setReceipt(await api(invitationBase, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) }));
      refresh();
    } catch (caught) { setMutationError(formatErrorSafe(caught)); }
    finally { setMutationBusy(false); }
  }

  async function remove() {
    if (!confirming) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      if (confirming.kind === "invitation") {
        await api(`${invitationBase}/${encodeURIComponent(confirming.invitation.invitationId)}`, { method: "DELETE", headers: ifMatch(confirming.invitation.revision) });
      } else if (confirming.kind === "member" && !platform) {
        const identity = confirming.membership.principal;
        const query = new URLSearchParams({ issuer: identity.issuer, subject: identity.subject });
        await api(`${base}/members?${query}`, { method: "DELETE", headers: ifMatch(scope.appRevision) });
        scope.onChanged();
      }
      setConfirming(null);
      refresh();
    } catch (caught) { setMutationError(formatErrorSafe(caught)); refresh(); }
    finally { setMutationBusy(false); }
  }

  return <section className="space-y-4" aria-label={platform ? "Platform people" : "App members"}>
    {summary ? <dl className="grid grid-cols-2 gap-4 border-b pb-4 lg:grid-cols-4">
      {[["Active Principals", summary.activePrincipalCount], ["Platform Admins", summary.platformAdminCount], ["App Creators", summary.appCreatorCount], ["Blocked Principals", summary.blockedPrincipalCount]].map(([label, count]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-xl font-semibold">{count}</dd></div>)}
    </dl> : null}
    <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); setFilters({ ...draft, query: draft.query.trim() }); }}>
      <Input className="min-w-0 flex-[1_1_14rem]" aria-label="Search people" placeholder="Search name, email or Principal" value={draft.query} onChange={event => setDraft({ ...draft, query: event.target.value })} />
      <Select value={draft.filter} onValueChange={filter => setDraft({ ...draft, filter })}>
        <SelectTrigger className="w-44" aria-label="People filter"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="current">Current</SelectItem><SelectItem value={platform ? "principals" : "members"}>{platform ? "Principals" : "Members"}</SelectItem><SelectItem value="pending">Pending invitations</SelectItem><SelectItem value="history">Invitation history</SelectItem></SelectContent>
      </Select>
      {platform ? <>
        <Select value={draft.authority} onValueChange={authority => setDraft({ ...draft, authority })}><SelectTrigger className="w-44" aria-label="Authority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All authorities</SelectItem><SelectItem value="platform.admin">Platform Admin</SelectItem><SelectItem value="apps.create">App creation</SelectItem><SelectItem value="none">No authority</SelectItem></SelectContent></Select>
        <Select value={draft.effectiveAccess} onValueChange={effectiveAccess => setDraft({ ...draft, effectiveAccess })}><SelectTrigger className="w-40" aria-label="Effective access"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All access</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="blocked">Blocked</SelectItem><SelectItem value="no_access">No access</SelectItem></SelectContent></Select>
      </> : null}
      <Button type="submit" variant="outline"><Search />Apply</Button>
      <div className="ml-auto flex gap-2">
        <Button type="button" variant="outline" size="icon" title="Refresh people" onClick={refresh} disabled={busy}><RefreshCw /></Button>
        <Button type="button" onClick={openInvite}><UserPlus />Invite</Button>
      </div>
    </form>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {busy ? <p role="status" className="text-sm text-muted-foreground">Loading people...</p> : null}
    <Table>
      <TableHeader><TableRow><TableHead>Person / Email</TableHead><TableHead>Status</TableHead>{platform ? <><TableHead>Authorities</TableHead><TableHead>Apps</TableHead></> : null}<TableHead>{platform ? "Created / Invited" : "Joined / Invited"}</TableHead><TableHead>Expires</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
      <TableBody>
        {!busy && !error && items.length === 0 ? <TableRow><TableCell colSpan={platform ? 7 : 5}>No people found.</TableCell></TableRow> : null}
        {items.map(person => {
          const identity = person.kind === "member" ? person.membership : person.kind === "principal" ? person.principal : null;
          const name = identity ? identity.profile.displayName || identity.profile.emailForDisplay || identity.principal.subject : person.kind === "invitation" ? person.invitation.emailConstraint ?? "Unconstrained invitation" : "";
          const state = person.kind === "member" ? "Member" : person.kind === "principal" ? person.principal.effectiveAccess : person.invitation.status;
          const time = person.kind === "member" ? person.joinedAt : person.kind === "principal" ? person.principal.createdAt : person.invitation.createdAt;
          const grants = person.kind === "principal" ? person.principal.authorities : person.kind === "invitation" && "authorities" in person.invitation ? person.invitation.authorities : [];
          return <TableRow key={personKey(person)}>
            <TableCell className="min-w-48 max-w-sm break-words">
              {person.kind === "principal" ? <Button variant="link" className="h-auto max-w-full whitespace-normal p-0 text-left" aria-label={`Open Principal details for ${name}`} onClick={() => setPrincipalRef(person.principal.principalRef)}>{name}</Button> : <span className="font-medium">{name}</span>}
              {identity ? <><div className="text-xs text-muted-foreground">{identity.profile.emailForDisplay}</div><div className="break-all font-mono text-xs text-muted-foreground">{identity.principal.issuer} / {identity.principal.subject}</div></> : null}
            </TableCell>
            <TableCell><Badge variant={state === "blocked" ? "destructive" : "secondary"}>{state}</Badge>{person.kind === "principal" ? <div className="text-xs text-muted-foreground">Principal</div> : person.kind === "invitation" ? <div className="text-xs text-muted-foreground">Invitation</div> : null}</TableCell>
            {platform ? <><TableCell><div className="flex flex-wrap gap-1">{grants.map(grant => <Badge key={grant} variant="outline">{grant}</Badge>)}{grants.length === 0 ? "-" : null}</div></TableCell><TableCell>{person.kind === "principal" ? person.principal.appMembershipCount : "-"}</TableCell></> : null}
            <TableCell>{new Date(time).toLocaleString()}</TableCell>
            <TableCell>{person.kind === "invitation" ? new Date(person.invitation.expiresAt).toLocaleString() : "-"}</TableCell>
            <TableCell>{person.kind === "member" || (person.kind === "invitation" && person.invitation.status === "pending" && person.invitation.expiresAt > Date.now()) ? <Button variant="ghost" size="icon" title={person.kind === "member" ? "Remove member" : "Revoke invitation"} onClick={() => { setConfirming(person); setMutationError(null); }}>{person.kind === "member" ? <UserMinus /> : <X />}</Button> : null}</TableCell>
          </TableRow>;
        })}
      </TableBody>
    </Table>
    {cursor ? <div className="flex justify-center"><Button variant="outline" disabled={busy} onClick={() => void load(cursor)}>Load more</Button></div> : null}
    <Dialog open={inviteOpen} onOpenChange={open => { if (!mutationBusy) setInviteOpen(open); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{receipt ? "Invitation created" : platform ? "Invite to platform" : "Invite App member"}</DialogTitle><DialogDescription>{receipt ? "Share this one-time URL through a trusted channel." : platform ? "Grant platform authorities to a verified email." : "Invite an administrator to this App."}</DialogDescription></DialogHeader>
        {receipt ? <><CopyBubble label="Invitation URL" value={receipt.acceptUrl} /><p className="text-xs text-muted-foreground">Expires {new Date(receipt.expiresAt).toLocaleString()}</p></> : <>
          <div className="space-y-2"><Label htmlFor="people-invite-email">{platform ? "Email" : "Email constraint (optional)"}</Label><Input id="people-invite-email" type="email" value={email} onChange={event => setEmail(event.target.value)} /></div>
          {platform ? <fieldset className="space-y-2"><legend className="text-sm font-medium">Authorities</legend>{["platform.admin", "apps.create"].map(authority => <div key={authority} className="flex items-center gap-2"><Checkbox id={`invite-${authority}`} checked={authorities.includes(authority)} onCheckedChange={checked => setAuthorities(current => checked ? [...current, authority] : current.filter(value => value !== authority))} /><Label htmlFor={`invite-${authority}`}>{authority === "platform.admin" ? "Platform administration" : "App creation"}</Label></div>)}</fieldset> : null}
        </>}
        {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError}</p> : null}
        <DialogFooter><Button variant="outline" disabled={mutationBusy} onClick={() => setInviteOpen(false)}>{receipt ? "Done" : "Cancel"}</Button>{!receipt ? <Button disabled={mutationBusy || (platform && (!email.trim() || authorities.length === 0))} onClick={() => void invite()}>Create invitation</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={confirming !== null} onOpenChange={open => { if (!open && !mutationBusy) setConfirming(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{confirming?.kind === "member" ? "Remove member" : "Revoke invitation"}</DialogTitle><DialogDescription>{confirming?.kind === "member" ? "Remove this Principal's App membership?" : "Prevent this invitation from being accepted?"}</DialogDescription></DialogHeader>
        {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError}</p> : null}
        <DialogFooter><Button variant="outline" disabled={mutationBusy} onClick={() => setConfirming(null)}>Cancel</Button><Button variant="destructive" disabled={mutationBusy} onClick={() => void remove()}>Confirm {confirming?.kind === "member" ? "removal" : "revoke"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Sheet open={principalRef !== null} onOpenChange={open => { if (!open) setPrincipalRef(null); }}><SheetContent className="w-full max-w-full overflow-y-auto sm:max-w-[540px]" aria-describedby={undefined}><SheetTitle>Principal Details</SheetTitle>
      {detailError ? <p role="alert">{detailError}</p> : principal ? <PrincipalDetailEditor key={principal.principalRef} principal={principal} onSaved={() => { setPrincipalRef(null); refresh(); }} /> : <p role="status">Loading Principal...</p>}
    </SheetContent></Sheet>
  </section>;
}