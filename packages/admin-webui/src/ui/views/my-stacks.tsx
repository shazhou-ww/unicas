import { useCallback, useEffect, useState } from "react";
import { Plus, Inbox, CircleAlert, LoaderCircle } from "lucide-react";
import type { App } from "@unicas/admin-client";
import { api } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";
import { PageHeading } from "../components/page-heading.js";

export function MyAppsView({ canCreateApps = true }: { readonly canCreateApps?: boolean }) {
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
    <section className="page">
      <PageHeading title="My Apps" />
      <aside className="concept-guide" aria-labelledby="concept-unicas-apps">
        <div className="concept-guide-content">
          <p className="concept-guide-label">About this page</p>
          <h2 id="concept-unicas-apps">UniCAS Apps</h2>
          <p className="concept-guide-summary">An App is the top-level UniCAS trust, administration, and storage namespace for an integrating application.</p>
          <dl className="concept-list">
            <div>
              <dt>Isolation</dt>
              <dd>Each App has independent issuer trust, Spaces, data history, and stored objects.</dd>
            </div>
            <div>
              <dt>Stable identity</dt>
              <dd>UniCAS generates an opaque App ID. The display name is only an administrator-facing label.</dd>
            </div>
            <div>
              <dt>First membership</dt>
              <dd>Creating an App grants your current Principal its first administrator membership.</dd>
            </div>
          </dl>
        </div>
      </aside>
      {canCreateApps ? (
        <Card>
          <CardHeader>
            <CardTitle>Create an App</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="inline-form">
              <input
                aria-label="App display name"
                value={name}
                placeholder="e.g. unidocs-cloudflare"
                onChange={(event) => setName(event.target.value)}
              />
              <Button onClick={() => void createApp()} disabled={creating || name.trim().length === 0}>
                <Plus className="mr-2 h-4 w-4" />
                {creating ? "Creating…" : "Create App"}
              </Button>
            </div>
            {createError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <CircleAlert className="h-4 w-4" />
                <span>{createError}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Your Apps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <CircleAlert className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : null}
          {apps === null && !error ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>Loading…</span>
            </div>
          ) : null}
          {apps !== null && apps.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Inbox className="h-4 w-4" />
              <span>{canCreateApps
                ? "You are not a member of any App yet. Create one above."
                : "You are not a member of any App yet."}</span>
            </div>
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
        </CardContent>
      </Card>
    </section>
  );
}
