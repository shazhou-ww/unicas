import { useEffect, useRef, useState } from "react";
import { RefreshCw, Search, UserMinus, UserPlus, X } from "lucide-react";
import type { AppPerson, PlatformAccountDetail, PlatformPerson, PeoplePage } from "@unicas/admin-client";
import { api, ifMatch } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { CopyBubble } from "../components/copy-bubble.js";
import { LoadingState } from "../components/loading-state.js";
import { useNarrowLayout } from "../components/use-narrow-layout.js";
import { PlatformAccountEditor } from "./platform/account-editor.js";
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
  if (person.kind === "member") return `${person.kind}:${person.membership.account.accountId}`;
  if (person.kind === "account") return `account:${person.account.accountId}`;
  return `invitation:${person.invitation.invitationId}`;
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function personPresentation(person: Person) {
  const account = person.kind === "member" ? person.membership.account : person.kind === "account" ? person.account : null;
  const name = person.kind === "invitation"
    ? person.invitation.emailConstraint ?? "Unconstrained invitation"
    : account!.displayName || account!.primaryVerifiedEmail?.normalizedEmail || account!.accountId;
  return {
    account,
    name,
    state: person.kind === "member" ? "Member" : person.kind === "account" ? person.account.effectiveAccess : person.invitation.status,
    time: person.kind === "member" ? person.joinedAt : person.kind === "account" ? person.account.createdAt : person.invitation.createdAt,
    expiresAt: person.kind === "invitation" ? person.invitation.expiresAt : null,
    grants: person.kind === "account" ? person.account.platformAuthorities : person.kind === "invitation" && "authorities" in person.invitation ? person.invitation.authorities : [],
  };
}

export function PeopleView(props: Props) {
  return <PeoplePanel key={"appId" in props.scope ? props.scope.appId : "platform"} {...props} />;
}

function PeoplePanel({ scope, initialFilter = "current" }: Props) {
  const platform = "platform" in scope;
  const narrow = useNarrowLayout();
  const base = platform ? "/admin/platform" : `/admin/apps/${encodeURIComponent(scope.appId)}`;
  const invitationBase = `${base}/${platform ? "invitations" : "member-invitations"}`;
  const [filters, setFilters] = useState({ query: "", filter: initialFilter, authority: "all", effectiveAccess: "all" });
  const [draft, setDraft] = useState(filters);
  const [items, setItems] = useState<Person[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const regionRef = useRef<HTMLElement>(null);
  const inviteTrigger = useRef<HTMLButtonElement>(null);
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitationScope, setInvitationScope] = useState<"email" | "link">("email");
  const [email, setEmail] = useState("");
  const [authorities, setAuthorities] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<{ acceptUrl: string; expiresAt: number } | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Person | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [detailAccount, setDetailAccount] = useState<PlatformAccountDetail | null>(null);
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
  }, [base, filters]);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    setDetailAccount(null);
    setDetailError(null);
    api<PlatformAccountDetail>(`/admin/platform/accounts/${encodeURIComponent(accountId)}`)
      .then(result => { if (active) setDetailAccount(result); })
      .catch(caught => { if (active) setDetailError(formatErrorSafe(caught)); });
    return () => { active = false; };
  }, [accountId]);

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

  function refresh() { void load(undefined); }
  function openInvite() { setEmail(""); setInvitationScope("email"); setAuthorities([]); setReceipt(null); setMutationError(null); setInviteOpen(true); }

  async function invite() {
    setMutationBusy(true);
    setMutationError(null);
    try {
      const body = platform
        ? { emailConstraint: email.trim(), authorities }
        : invitationScope === "email" ? { emailConstraint: email.trim() } : {};
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
        const query = new URLSearchParams({ accountId: confirming.membership.account.accountId });
        await api(`${base}/members?${query}`, { method: "DELETE" });
        scope.onChanged();
      }
      setConfirming(null);
      refresh();
    } catch (caught) { setMutationError(formatErrorSafe(caught)); refresh(); }
    finally { setMutationBusy(false); }
  }

  function restoreFocus(event: Event, target: HTMLButtonElement | null) {
    event.preventDefault();
    if (target?.isConnected && !target.disabled) target.focus();
    else regionRef.current?.focus();
  }

  const selectedAccount = accountId === null ? null : items.find(person => person.kind === "account" && person.account.accountId === accountId);
  const accountTitle = selectedAccount?.kind === "account"
    ? selectedAccount.account.displayName || selectedAccount.account.primaryVerifiedEmail?.normalizedEmail || selectedAccount.account.accountId
    : "Account details";

  function actionFor(person: Person, mobile = false) {
    if (person.kind === "account") {
      if (!mobile) return null;
      const { name } = personPresentation(person);
      return <Button className="min-h-11 w-full" variant="outline" aria-label={`View Account details for ${name}`} onClick={event => { detailTrigger.current = event.currentTarget; setAccountId(person.account.accountId); }}>View account</Button>;
    }
    const actionable = person.kind === "member"
      || (person.kind === "invitation" && person.invitation.status === "pending" && person.invitation.expiresAt > Date.now());
    if (!actionable) return null;
    const label = person.kind === "member" ? "Remove member" : "Revoke invitation";
    return <Button className={mobile ? "min-h-11 w-full" : undefined} variant={mobile ? "destructive" : "ghost"} size={mobile ? "default" : "icon"} title={label} aria-label={label} onClick={event => { actionTrigger.current = event.currentTarget; setConfirming(person); setMutationError(null); }}>{mobile ? label : person.kind === "member" ? <UserMinus /> : <X />}</Button>;
  }

  return <section ref={regionRef} tabIndex={-1} className="space-y-4" aria-label={platform ? "Platform people" : "App members"} aria-busy={busy}>
    <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); setFilters({ ...draft, query: draft.query.trim() }); }}>
      <Input className="min-w-0 flex-[1_1_14rem]" name="peopleSearch" autoComplete="off" spellCheck={false} aria-label="Search people" placeholder="Name, email, or Account ID…" value={draft.query} onChange={event => setDraft({ ...draft, query: event.target.value })} />
      <Select name="peopleCollection" value={draft.filter} onValueChange={filter => setDraft({ ...draft, filter })}>
        <SelectTrigger className="w-60 max-w-full" aria-label="People collection"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="current">Active &amp; pending</SelectItem><SelectItem value={platform ? "accounts" : "members"}>{platform ? "Accounts" : "Members"}</SelectItem><SelectItem value="pending">Pending invitations</SelectItem><SelectItem value="history">Invitation history</SelectItem></SelectContent>
      </Select>
      {platform ? <>
        <Select name="authority" value={draft.authority} onValueChange={authority => setDraft({ ...draft, authority })}><SelectTrigger className="w-44" aria-label="Authority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All authorities</SelectItem><SelectItem value="platform.admin">Platform Admin</SelectItem><SelectItem value="apps.create">App creation</SelectItem><SelectItem value="none">No authority</SelectItem></SelectContent></Select>
        <Select name="effectiveAccess" value={draft.effectiveAccess} onValueChange={effectiveAccess => setDraft({ ...draft, effectiveAccess })}><SelectTrigger className="w-40" aria-label="Effective access"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All access</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="blocked">Blocked</SelectItem><SelectItem value="no_access">No access</SelectItem></SelectContent></Select>
      </> : null}
      <div className="ml-auto flex gap-2">
        <Button type="submit" variant="outline"><Search />Apply filters</Button>
        <Button type="button" variant="outline" size="icon" aria-label="Refresh people" title="Refresh people" onClick={refresh} disabled={busy}><RefreshCw /></Button>
        <Button ref={inviteTrigger} type="button" onClick={openInvite}><UserPlus />Invite</Button>
      </div>
    </form>
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><span>{error}</span><Button type="button" size="sm" variant="outline" onClick={refresh}>Retry</Button></div> : null}
    {busy && items.length === 0 ? <LoadingState className="console-loading-region-compact" label="Loading people" detail="Current access and invitations are loading." /> : null}
    {busy && items.length > 0 ? <p role="status" className="text-sm text-muted-foreground">Refreshing people…</p> : null}
    {!busy && !error && items.length === 0 ? <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No people found.</div> : null}
    {items.length > 0 && !narrow ? <Table>
      <TableHeader><TableRow><TableHead>Account / Email</TableHead><TableHead>Status</TableHead>{platform ? <><TableHead>Authorities</TableHead><TableHead>Apps</TableHead></> : null}<TableHead>{platform ? "Created / Invited" : "Joined / Invited"}</TableHead><TableHead>Expires</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
      <TableBody>
        {items.map(person => {
          const { account, name, state, time, expiresAt, grants } = personPresentation(person);
          return <TableRow key={personKey(person)}>
            <TableCell className="min-w-48 max-w-sm break-words">
              {person.kind === "account" ? <Button variant="link" className="-ml-2 min-h-9 max-w-full whitespace-normal px-2 py-1 text-left" aria-label={`Open Account details for ${name}`} onClick={event => { detailTrigger.current = event.currentTarget; setAccountId(person.account.accountId); }}>{name}</Button> : <span className="font-medium">{name}</span>}
              {account ? <><div className="text-xs text-muted-foreground">{account.primaryVerifiedEmail?.normalizedEmail}</div><div className="break-all font-mono text-xs text-muted-foreground">{account.accountId}</div></> : null}
            </TableCell>
            <TableCell><Badge variant={state === "blocked" ? "destructive" : "secondary"}>{state}</Badge>{person.kind === "account" ? <div className="text-xs text-muted-foreground">Account</div> : person.kind === "invitation" ? <div className="text-xs text-muted-foreground">Invitation</div> : null}</TableCell>
            {platform ? <><TableCell><div className="flex flex-wrap gap-1">{grants.map(grant => <Badge key={grant} variant="outline">{grant}</Badge>)}{grants.length === 0 ? "-" : null}</div></TableCell><TableCell>{person.kind === "account" ? person.account.appMembershipCount : "-"}</TableCell></> : null}
            <TableCell>{formatDateTime(time)}</TableCell>
            <TableCell>{expiresAt === null ? "-" : formatDateTime(expiresAt)}</TableCell>
            <TableCell>{actionFor(person)}</TableCell>
          </TableRow>;
        })}
      </TableBody>
    </Table> : null}
    {items.length > 0 && narrow ? <div className="grid gap-3" role="list" aria-label="People results">
      {items.map(person => {
        const { account, name, state, time, expiresAt, grants } = personPresentation(person);
        return <article key={personKey(person)} role="listitem" aria-label={`${name}, ${state}`} className="grid gap-3 rounded-md border bg-card p-4">
          <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium">{name}</p>{account?.primaryVerifiedEmail ? <p className="break-all text-xs text-muted-foreground">{account.primaryVerifiedEmail.normalizedEmail}</p> : null}{account ? <p className="break-all font-mono text-xs text-muted-foreground">{account.accountId}</p> : null}</div><Badge variant={state === "blocked" ? "destructive" : "secondary"}>{state}</Badge></div>
          <dl className="grid gap-2 text-sm">
            {platform ? <><div><dt className="text-xs text-muted-foreground">Authorities</dt><dd className="mt-1 flex flex-wrap gap-1">{grants.length > 0 ? grants.map(grant => <Badge key={grant} variant="outline">{grant}</Badge>) : "-"}</dd></div><div><dt className="text-xs text-muted-foreground">Apps</dt><dd>{person.kind === "account" ? person.account.appMembershipCount : "-"}</dd></div></> : null}
            <div><dt className="text-xs text-muted-foreground">{platform ? "Created / invited" : "Joined / invited"}</dt><dd>{formatDateTime(time)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Expires</dt><dd>{expiresAt === null ? "-" : formatDateTime(expiresAt)}</dd></div>
          </dl>
          {actionFor(person, true)}
        </article>;
      })}
    </div> : null}
    {cursor ? <div className="flex justify-center"><Button variant="outline" disabled={busy} onClick={() => void load(cursor)}>Load more</Button></div> : null}
    <Dialog open={inviteOpen} onOpenChange={open => { if (!mutationBusy) setInviteOpen(open); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event => restoreFocus(event, inviteTrigger.current)}>
        <DialogHeader><DialogTitle>{receipt ? "Invitation created" : platform ? "Invite to platform" : "Invite App member"}</DialogTitle><DialogDescription>{receipt ? "Share this one-time URL through a trusted channel." : platform ? "Grant platform authorities to a verified email." : "Invite an administrator to this App."}</DialogDescription></DialogHeader>
        {receipt ? <><CopyBubble label="Invitation URL" value={receipt.acceptUrl} /><p className="text-xs text-muted-foreground">Expires {new Date(receipt.expiresAt).toLocaleString()}</p></> : <>
          {!platform ? <fieldset className="space-y-2"><legend className="text-sm font-medium">Who can accept?</legend><label className="flex items-start gap-2 rounded-md border p-3 text-sm"><input className="mt-1 h-4 w-4 shrink-0" type="radio" name="appInvitationScope" value="email" checked={invitationScope === "email"} onChange={() => setInvitationScope("email")} /><span><strong className="block">Only this email</strong><span className="text-muted-foreground">The recipient must sign in with a matching verified address.</span></span></label><label className="flex items-start gap-2 rounded-md border p-3 text-sm"><input className="mt-1 h-4 w-4 shrink-0" type="radio" name="appInvitationScope" value="link" checked={invitationScope === "link"} onChange={() => setInvitationScope("link")} /><span><strong className="block">Anyone with the one-time link</strong><span className="text-muted-foreground">Treat the link like a credential and share it through a trusted channel.</span></span></label></fieldset> : null}
          {platform || invitationScope === "email" ? <div className="space-y-2"><Label htmlFor="people-invite-email">Email</Label><Input id="people-invite-email" name="email" type="email" autoComplete="email" spellCheck={false} required value={email} onChange={event => setEmail(event.target.value)} /></div> : null}
          {platform ? <fieldset className="space-y-2"><legend className="text-sm font-medium">Authorities</legend>{["platform.admin", "apps.create"].map(authority => <div key={authority} className="flex items-center gap-2"><Checkbox id={`invite-${authority}`} checked={authorities.includes(authority)} onCheckedChange={checked => setAuthorities(current => checked ? [...current, authority] : current.filter(value => value !== authority))} /><Label htmlFor={`invite-${authority}`}>{authority === "platform.admin" ? "Platform administration" : "App creation"}</Label></div>)}</fieldset> : null}
        </>}
        {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError}</p> : null}
        <DialogFooter><Button variant="outline" disabled={mutationBusy} onClick={() => setInviteOpen(false)}>{receipt ? "Done" : "Cancel"}</Button>{!receipt ? <Button disabled={mutationBusy || (platform ? !email.trim() || authorities.length === 0 : invitationScope === "email" && !email.trim())} onClick={() => void invite()}>Create invitation</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={confirming !== null} onOpenChange={open => { if (!open && !mutationBusy) setConfirming(null); }}>
      <DialogContent onCloseAutoFocus={event => restoreFocus(event, actionTrigger.current)}><DialogHeader><DialogTitle>{confirming?.kind === "member" ? "Remove member" : "Revoke invitation"}</DialogTitle><DialogDescription>{confirming?.kind === "member" ? "Remove this Account's App membership?" : "Prevent this invitation from being accepted?"}</DialogDescription></DialogHeader>
        {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError}</p> : null}
        <DialogFooter><Button variant="outline" disabled={mutationBusy} onClick={() => setConfirming(null)}>Cancel</Button><Button variant="destructive" disabled={mutationBusy} onClick={() => void remove()}>Confirm {confirming?.kind === "member" ? "removal" : "revoke"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Sheet open={accountId !== null} onOpenChange={open => { if (!open) setAccountId(null); }}><SheetContent className="w-full max-w-full overflow-y-auto sm:max-w-[540px]" aria-describedby={undefined} onCloseAutoFocus={event => restoreFocus(event, detailTrigger.current)}><SheetTitle>{accountTitle}</SheetTitle>
      {detailError ? <p role="alert">{detailError}</p> : detailAccount ? <PlatformAccountEditor key={detailAccount.accountId} account={detailAccount} onChanged={refresh} /> : <LoadingState className="console-loading-region-compact" label="Loading Account details" />}
    </SheetContent></Sheet>
  </section>;
}