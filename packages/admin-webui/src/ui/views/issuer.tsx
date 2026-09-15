import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Power, Search, ShieldCheck } from "lucide-react";
import type {
  AppOAuthIssuer,
  AppOAuthIssuerInspection,
} from "@unicas/admin-client";
import { api, ifMatch } from "../api.js";
import { Button, Card, ErrorState } from "../components.js";
import { formatErrorSafe } from "./view-helpers.js";

/**
 * App OAuth issuer connection. UniCAS discovers the issuer's metadata and
 * JWKS itself (RFC 8414 / OpenID discovery), so administrators never upload
 * keys: activation proves control of a key the issuer currently advertises,
 * and Space verification reads the issuer's discovered jwks_uri.
 */
export function IssuerView(props: { appId: string; focusManagedIssuer?: boolean }) {
  return <IssuerPanel key={props.appId} {...props} />;
}

function IssuerPanel({ appId, focusManagedIssuer = false }: { appId: string; focusManagedIssuer?: boolean }) {
  const managedSettingsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!focusManagedIssuer) return;
    managedSettingsRef.current?.focus();
    managedSettingsRef.current?.scrollIntoView?.({ block: "start" });
  }, [appId, focusManagedIssuer]);

  const [oauthIssuer, setOAuthIssuer] = useState<AppOAuthIssuer | null>(null);
  const [managedIssuer, setManagedIssuer] = useState<AppOAuthIssuer | null>(null);
  const [inspection, setInspection] = useState<AppOAuthIssuerInspection | null>(null);
  const [oauthIssuerUrl, setOAuthIssuerUrl] = useState("");
  const [activationProof, setActivationProof] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [togglingManaged, setTogglingManaged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setCopyStatus(null);
  }, [appId, managedIssuer?.issuer]);

  useEffect(() => {
    if (copyStatus !== "copied") return;
    const timer = window.setTimeout(() => setCopyStatus(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  async function copyManagedIssuerUrl() {
    if (!managedIssuer) return;
    try {
      await navigator.clipboard.writeText(managedIssuer.issuer);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const [oauthResult, managedResult] = await Promise.all([
        api<AppOAuthIssuer | null>(`/admin/apps/${encodeURIComponent(appId)}/oauth-issuer?optional=true`),
        api<AppOAuthIssuer>(`/admin/apps/${encodeURIComponent(appId)}/managed-issuer`),
      ]);
      setOAuthIssuer(oauthResult);
      setManagedIssuer(managedResult);
      setLoaded(true);
      if (oauthResult) {
        setOAuthIssuerUrl(oauthResult.issuer);
      }
    } catch (caught) {
      setError(formatErrorSafe(caught));
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function inspectOAuthIssuer() {
    setInspecting(true);
    setError(null);
    setInspection(null);
    setActivationProof("");
    try {
      const result = await api<AppOAuthIssuerInspection>(`/admin/apps/${encodeURIComponent(appId)}/oauth-issuer/inspections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issuer: oauthIssuerUrl.trim() }),
      });
      setInspection(result);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setInspecting(false);
    }
  }

  async function activateOAuthIssuer() {
    if (!inspection) return;
    setActivating(true);
    setError(null);
    try {
      await api<void>(`/admin/apps/${encodeURIComponent(appId)}/oauth-issuer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(oauthIssuer ? ifMatch(oauthIssuer.revision) : { "If-None-Match": "*" }) },
        body: JSON.stringify({ inspectionId: inspection.inspectionId, activationProof: activationProof.trim() }),
      });
      setInspection(null);
      setActivationProof("");
      await load();
    } catch (caught) {
      setInspection(null);
      setActivationProof("");
      await load();
      setError(formatErrorSafe(caught));
    } finally {
      setActivating(false);
    }
  }

  async function toggleManagedIssuer() {
    if (!managedIssuer) return;
    setTogglingManaged(true);
    setError(null);
    try {
      const enabled = managedIssuer.status !== "active";
      setManagedIssuer(await api<AppOAuthIssuer>(`/admin/apps/${encodeURIComponent(appId)}/managed-issuer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...ifMatch(managedIssuer.revision) },
        body: JSON.stringify({ enabled }),
      }));
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setTogglingManaged(false);
    }
  }

  const configured = oauthIssuer !== null;
  const canInspect = loaded && !activating && !inspecting;

  return (
    <>
      <section
        aria-label="Managed issuer settings"
        tabIndex={-1}
        ref={managedSettingsRef}
      >
        <Card title="Managed issuer">
          <p className="hint">
            Admin sign-in grants App management access, not access to Space data.
            The managed issuer is UniCAS's built-in authorization server: it issues short-lived
            Space capabilities for Playground and gives each App member an isolated personal Space.
            Enable it to use Playground without running your own authorization server.
            Applications using a custom OAuth issuer do not need to enable it.
          </p>
          {error ? <ErrorState message={error} /> : null}
          {managedIssuer ? (
            <>
              <p className="hint">
                Status: <strong>{managedIssuer.status}</strong> · Revision {managedIssuer.revision}
              </p>
              {managedIssuer.status === "active" ? (
                <div className="field-row">
                  <span className="hint">Managed issuer URL</span>
                  <button
                    type="button"
                    className="issuer-url-copy"
                    aria-label="Copy managed issuer URL"
                    title={copyStatus === "copied" ? "Copied" : "Copy managed issuer URL"}
                    onClick={() => void copyManagedIssuerUrl()}
                  >
                    <code>{managedIssuer.issuer}</code>
                    {copyStatus === "copied" ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                  <span className="hint" role="status">
                    {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Could not copy URL. Clipboard access is unavailable." : ""}
                  </span>
                </div>
              ) : null}
              <Button icon={<Power size={15} />} variant="primary" onClick={() => void toggleManagedIssuer()} disabled={togglingManaged}>
                {togglingManaged ? "Updating…" : managedIssuer.status === "active" ? "Disable managed issuer" : "Enable managed issuer"}
              </Button>
            </>
          ) : null}
        </Card>
      </section>
      <Card title="Custom OAuth authorization server">
        <p className="hint">
          Connect a standards-based authorization server through RFC 8414 or OpenID discovery.
          UniCAS validates its metadata and JWKS, then requires a signed control challenge before
          activation. When active, this issuer is listed before the managed issuer and is the CLI login default.
        </p>
        {configured ? (
          <p className="hint">
            Mode: <strong>{oauthIssuer!.mode}</strong> · Status: <strong>{oauthIssuer!.status}</strong> · Metadata: {oauthIssuer!.metadataType} · Revision {oauthIssuer!.revision}
            <br />Issuer: {oauthIssuer!.issuer}
            <br />JWKS: <a href={oauthIssuer!.jwksUri} target="_blank" rel="noreferrer">{oauthIssuer!.jwksUri}</a>
            <br />Resource audience: {oauthIssuer!.audience} · Maximum capability lifetime: {oauthIssuer!.capabilityMaxLifetimeSeconds}s
          </p>
        ) : null}
        <div className="field-row">
          <label htmlFor="oauth-issuer-url">Issuer</label>
          <input id="oauth-issuer-url" value={oauthIssuerUrl} placeholder="https://authorization.example" disabled={!canInspect} onChange={(event) => {
            setOAuthIssuerUrl(event.target.value);
            setInspection(null);
            setActivationProof("");
          }} />
        </div>
        <Button icon={<Search size={15} />} variant="primary" onClick={() => void inspectOAuthIssuer()} disabled={inspecting || !canInspect || oauthIssuerUrl.trim().length === 0}>
          {inspecting ? "Inspecting…" : oauthIssuer?.status === "active" ? "Inspect replacement" : "Inspect issuer"}
        </Button>
        {inspection ? (
          <div className="challenge-box">
            <h3>Candidate issuer</h3>
            <p className="hint">{oauthIssuerUrl} · Expires {new Date(inspection.expiresAt).toLocaleString()}</p>
            <p>
              The issuer JWKS contains {inspection.keys.length} eligible signing key(s).
              Sign this one-time control challenge with the matching private key:
            </p>
            <code className="challenge">{inspection.challenge}</code>
            <div className="field-row">
              <label htmlFor="oauth-activation-proof">Activation proof (compact JWS)</label>
              <textarea id="oauth-activation-proof" value={activationProof} rows={3} onChange={(event) => setActivationProof(event.target.value)} />
            </div>
            <Button icon={<ShieldCheck size={15} />} variant="primary" disabled={activating || activationProof.trim().length === 0} onClick={() => void activateOAuthIssuer()}>
              {activating ? "Activating…" : oauthIssuer?.status === "active" ? "Verify and replace" : "Verify and activate"}
            </Button>
          </div>
        ) : null}
      </Card>
    </>
  );
}
