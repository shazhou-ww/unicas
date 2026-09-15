import { useState } from "react";
import { Save } from "lucide-react";
import type { App } from "@unicas/admin-client";
import { api, ifMatch } from "../api.js";
import { Button, Card, ErrorState } from "../components.js";
import { formatErrorSafe } from "./view-helpers.js";

export function AppOverviewView({ app, onChanged }: {
  app: App;
  onChanged: () => void;
}) {
  const [name, setName] = useState(app.displayName);
  const [description, setDescription] = useState(app.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      await api<App>(`/admin/apps/${encodeURIComponent(app.appId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...ifMatch(app.revision) },
        body: JSON.stringify({
          displayName: name.trim(),
          description: description.trim(),
        }),
      });
      onChanged();
    } catch (caught) {
      const message = formatErrorSafe(caught);
      setError(message);
      if (message.includes("revision") || message.includes("changed")) setConflict(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="App metadata">
      <dl className="stack-details">
        <div>
          <dt>App ID</dt>
          <dd><code>{app.appId}</code></dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd><span className="status-badge">{app.status}</span></dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{app.revision}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{new Date(app.createdAt).toLocaleString()}</dd>
        </div>
      </dl>
      <div className="field-row">
        <label htmlFor="stack-display-name">Display name</label>
        <input
          id="stack-display-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="field-row">
        <label htmlFor="stack-description">Description</label>
        <textarea
          id="stack-description"
          value={description}
          maxLength={2_000}
          rows={4}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Button
          icon={<Save size={15} />}
          variant="primary"
          onClick={() => void save()}
          disabled={
            saving
            || name.trim().length === 0
            || (name.trim() === app.displayName && description.trim() === app.description)
          }
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {conflict ? (
        <p className="hint">
          The App changed on the server (revision {app.revision}). Reload the page and retry.
        </p>
      ) : null}
    </Card>
  );
}
