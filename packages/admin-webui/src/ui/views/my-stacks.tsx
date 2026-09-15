import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { App } from "@unicas/admin-client";
import { api } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { Button, Card, ConceptGuide, EmptyState, ErrorState, LoadingState, Page } from "../components.js";

export function MyAppsView() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api<{ items: App[] }>("/admin/apps");
      setApps(result.items);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createApp() {
    setCreating(true);
    setCreateError(null);
    try {
      await api<App>("/admin/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      setName("");
      await load();
    } catch (caught) {
      setCreateError(formatErrorSafe(caught));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Page title="My Apps">
      <ConceptGuide
        title="UniCAS Apps"
        summary="An App is the top-level UniCAS trust, administration, and storage namespace for an integrating application."
        concepts={[
          { term: "Isolation", detail: "Each App has independent issuer trust, Spaces, data history, and stored objects." },
          { term: "Stable identity", detail: "UniCAS generates an opaque App ID. The display name is only an administrator-facing label." },
          { term: "First membership", detail: "Creating an App grants your current Principal its first administrator membership." },
        ]}
      />
      <Card title="Create an App">
        <div className="inline-form">
          <input
            aria-label="App display name"
            value={name}
            placeholder="e.g. unidocs-cloudflare"
            onChange={(event) => setName(event.target.value)}
          />
          <Button icon={<Plus size={15} />} variant="primary" onClick={() => void createApp()} disabled={creating || name.trim().length === 0}>
            {creating ? "Creating…" : "Create App"}
          </Button>
        </div>
        {createError ? <ErrorState message={createError} /> : null}
      </Card>
      <Card title="Your Apps">
        {error ? <ErrorState message={error} /> : null}
        {apps === null && !error ? <LoadingState /> : null}
        {apps !== null && apps.length === 0 ? (
          <EmptyState message="You are not a member of any App yet. Create one above." />
        ) : null}
        {apps !== null && apps.length > 0 ? (
          <ul className="stack-list">
            {apps.map((app) => (
              <li key={app.appId}>
                <a href={`#/apps/${encodeURIComponent(app.appId)}`}>
                  <strong>{app.displayName}</strong>
                  <span className="muted">{app.appId}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </Page>
  );
}
