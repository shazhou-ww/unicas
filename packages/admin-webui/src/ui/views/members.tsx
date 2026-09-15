import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Copy, RefreshCw, UserMinus, UserPlus, X } from "lucide-react";
import type { AppMemberInvitation, AppMembership } from "@unicas/admin-client";
import { api, ifMatch } from "../api.js";
import { Button, Card, EmptyState, ErrorState, LoadingState, Table } from "../components.js";
import { formatErrorSafe } from "./view-helpers.js";

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
    <>
      {error ? <ErrorState message={error} /> : null}
      <Card title="Invite an App administrator">
        <div className="inline-form">
          <input
            aria-label="Email constraint (optional)"
            value={email}
            placeholder="email constraint (optional)"
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button icon={<UserPlus size={15} />} variant="primary" onClick={() => void invite()} disabled={inviting}>
            {inviting ? "Creating…" : "Create invitation"}
          </Button>
        </div>
        {inviteResult ? (
          <div className="invite-result">
            <p>
              One-time invitation created (expires {new Date(inviteResult.expiresAt).toLocaleString()}).
              Share this URL once:
            </p>
            <code className="accept-url">{inviteResult.acceptUrl}</code>
            <Button icon={<Copy size={15} />} onClick={() => {
              void navigator.clipboard.writeText(inviteResult.acceptUrl)
                .then(() => setCopied(true))
                .catch(() => setError("Unable to copy invitation URL"));
            }}>{copied ? "Copied" : "Copy invitation URL"}</Button>
          </div>
        ) : null}
      </Card>
      <nav className="tabs" role="tablist" aria-label="App members" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "administrators" : event.key === "End" ? "invitations" : view === "administrators" ? "invitations" : "administrators";
        setView(next);
        event.currentTarget.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus();
      }}>
        {[{ id: "administrators", label: "Administrators" }, { id: "invitations", label: "Invitations" }].map(tab => (
          <button key={tab.id} type="button" role="tab" data-view={tab.id} id={`members-${tab.id}`}
            aria-controls="members-panel" aria-selected={view === tab.id} tabIndex={view === tab.id ? 0 : -1}
            className={`tab${view === tab.id ? " tab-active" : ""}`} onClick={() => setView(tab.id)}>{tab.label}</button>
        ))}
      </nav>
      <div id="members-panel" role="tabpanel" aria-labelledby={`members-${view}`}>
      {view === "invitations" ? <InvitationList key={`${appId}:${invitationVersion}`} appId={appId} /> : (
      <Card title="App administrators">
        {members === null && !error ? <LoadingState /> : null}
        {members !== null && members.length === 0 ? (
          <EmptyState message="No members." />
        ) : null}
        {members !== null && members.length > 0 ? (
          <Table
            columns={["Subject", "Email", ""]}
            empty="No members."
            rows={members.map((member) => [
              member.principal.subject,
              member.profile.emailForDisplay ?? "—",
              <Button
                key={`remove-${member.principal.subject}`}
                icon={<UserMinus size={15} />}
                variant="danger"
                disabled={removing === member.principal.subject}
                onClick={() => void removeMember(member.principal.issuer, member.principal.subject)}
              >
                {removing === member.principal.subject ? "Removing…" : "Remove"}
              </Button>,
            ])}
          />
        ) : null}
      </Card>
      )}
      </div>
    </>
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
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => {
    if (!confirming && !busy && confirmationTrigger.current) {
      confirmationTrigger.current.focus();
      confirmationTrigger.current = null;
    }
  }, [confirming, busy]);

  function closeConfirmation() {
    setConfirming(null);
  }

  async function revoke() {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    try {
      await api<void>(`/admin/apps/${encodeURIComponent(appId)}/member-invitations/${encodeURIComponent(confirming.invitationId)}`, {
        method: "DELETE", headers: ifMatch(confirming.revision),
      });
      closeConfirmation();
      await load();
    } catch (caught) {
      closeConfirmation();
      await load();
      setError(formatErrorSafe(caught));
    } finally {
      setBusy(false);
    }
  }

  return <section className="invitation-list" aria-label="App invitations">
    <div className="inline-form">
      <label htmlFor="invitation-status">Status</label>
      <select id="invitation-status" value={status} disabled={busy} onChange={event => setStatus(event.target.value)}>
        <option value="">All statuses</option>
        {["pending", "accepted", "expired", "revoked"].map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <Button icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void load()}>Refresh invitations</Button>
    </div>
    {error ? <ErrorState message={error} /> : null}
    {busy ? <LoadingState /> : null}
    {confirming ? <div className="invitation-confirmation" role="group" aria-label="Revoke invitation confirmation" onKeyDown={event => {
      if (event.key === "Escape" && !busy) closeConfirmation();
    }}>
      <p>Revoke invitation for {confirming.emailConstraint ?? confirming.invitationId}?</p>
      <div className="inline-form">
        <button type="button" className="btn" autoFocus disabled={busy} onClick={closeConfirmation}>Cancel</button>
        <Button icon={<X size={15} />} variant="danger" disabled={busy} onClick={() => void revoke()}>Confirm revoke</Button>
      </div>
    </div> : null}
    {items !== null ? <Table columns={["Email constraint", "Status", "Expires", ""]} empty="No invitations."
      rows={items.map(invitation => [
        invitation.emailConstraint ?? "Unconstrained",
        invitation.status,
        new Date(invitation.expiresAt).toLocaleString(),
        invitation.status === "pending" && invitation.expiresAt > Date.now() ? <button key={invitation.invitationId} type="button" className="btn btn-danger"
          disabled={busy || confirming !== null} onClick={event => { confirmationTrigger.current = event.currentTarget; setConfirming(invitation); }}>
          <X size={15} aria-hidden="true" />Revoke
        </button> : null,
      ])} /> : null}
    {nextCursor ? <Button icon={<ArrowRight size={15} />} disabled={busy} onClick={() => void load(nextCursor)}>Load more invitations</Button> : null}
  </section>;
}
