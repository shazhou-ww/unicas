import { useCallback, useEffect, useState } from "react";
import { Search, ShieldCheck, AlertCircle } from "lucide-react";
import type {
  AppOAuthIssuer,
  AppOAuthIssuerInspection,
} from "@unicas/admin-client";
import { api, ifMatch } from "../api.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";
import { formatErrorSafe } from "./view-helpers.js";

/**
 * App OAuth issuer connection. UniCAS discovers the issuer's metadata and
 * JWKS itself (RFC 8414 / OpenID discovery), so administrators never upload
 * keys: activation proves control of a key the issuer currently advertises,
 * and Space verification reads the issuer's discovered jwks_uri.
 */
export function IssuerView(props: { appId: string }) {
  return <IssuerPanel key={props.appId} {...props} />;
}

function IssuerPanel({ appId }: { appId: string }) {
  const [oauthIssuer, setOAuthIssuer] = useState<AppOAuthIssuer | null>(null);
  const [inspection, setInspection] = useState<AppOAuthIssuerInspection | null>(null);
  const [oauthIssuerUrl, setOAuthIssuerUrl] = useState("");
  const [activationProof, setActivationProof] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const oauthResult = await api<AppOAuthIssuer | null>(`/admin/apps/${encodeURIComponent(appId)}/oauth-issuer?optional=true`);
      setOAuthIssuer(oauthResult);
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

  const configured = oauthIssuer !== null;
  const canInspect = loaded && !activating && !inspecting;

  return (
    <Card>
        <CardHeader>
          <CardTitle>Custom OAuth authorization server</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Connect a standards-based authorization server through RFC 8414 or OpenID discovery.
            UniCAS validates its metadata and JWKS, then requires a signed control challenge before
            activation.
          </p>
          {error ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : null}
          {configured ? (
            <p className="text-sm text-muted-foreground">
              Mode: <strong>{oauthIssuer!.mode}</strong> · Status: <strong>{oauthIssuer!.status}</strong> · Metadata: {oauthIssuer!.metadataType} · Revision {oauthIssuer!.revision}
              <br />Issuer: {oauthIssuer!.issuer}
              <br />JWKS: <a href={oauthIssuer!.jwksUri} target="_blank" rel="noreferrer">{oauthIssuer!.jwksUri}</a>
              <br />Resource audience: {oauthIssuer!.audience} · Maximum capability lifetime: {oauthIssuer!.capabilityMaxLifetimeSeconds}s
            </p>
          ) : null}
          <div className="space-y-2">
            <label htmlFor="oauth-issuer-url" className="text-sm font-medium">Issuer</label>
            <input id="oauth-issuer-url" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" value={oauthIssuerUrl} placeholder="https://authorization.example" disabled={!canInspect} onChange={(event) => {
              setOAuthIssuerUrl(event.target.value);
              setInspection(null);
              setActivationProof("");
            }} />
          </div>
          <Button onClick={() => void inspectOAuthIssuer()} disabled={inspecting || !canInspect || oauthIssuerUrl.trim().length === 0}>
            <Search className="mr-2 h-4 w-4" />
            {inspecting ? "Inspecting…" : oauthIssuer?.status === "active" ? "Inspect replacement" : "Inspect issuer"}
          </Button>
          {inspection ? (
            <div className="challenge-box space-y-3 rounded-lg border p-4">
              <h3 className="font-semibold">Candidate issuer</h3>
              <p className="text-sm text-muted-foreground">{oauthIssuerUrl} · Expires {new Date(inspection.expiresAt).toLocaleString()}</p>
              <p className="text-sm">
                The issuer JWKS contains {inspection.keys.length} eligible signing key(s).
                Sign this one-time control challenge with the matching private key:
              </p>
              <code className="challenge block rounded bg-muted p-2 text-xs">{inspection.challenge}</code>
              <div className="space-y-2">
                <label htmlFor="oauth-activation-proof" className="text-sm font-medium">Activation proof (compact JWS)</label>
                <textarea id="oauth-activation-proof" className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" value={activationProof} rows={3} onChange={(event) => setActivationProof(event.target.value)} />
              </div>
              <Button disabled={activating || activationProof.trim().length === 0} onClick={() => void activateOAuthIssuer()}>
                <ShieldCheck className="mr-2 h-4 w-4" />
                {activating ? "Activating…" : oauthIssuer?.status === "active" ? "Verify and replace" : "Verify and activate"}
              </Button>
            </div>
          ) : null}
        </CardContent>
    </Card>
  );
}
