import { useState } from "react";
import { Save } from "lucide-react";
import type { App } from "@unicas/admin-client";
import { api, ifMatch } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CopyBubble } from "../components/copy-bubble.js";

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

  const statusVariant = app.status === "active" ? "default" : "destructive";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>App Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div className="min-w-0">
              <dt className="text-muted-foreground">App ID</dt>
              <dd className="mt-2 flex min-h-8 items-center">
                <CopyBubble value={app.appId} label="App ID" />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="mt-2 flex min-h-8 items-center">
                <Badge variant={statusVariant}>{app.status}</Badge>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">Revision</dt>
              <dd className="mt-2 flex min-h-8 items-center font-medium">{app.revision}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">Created</dt>
              <dd className="mt-2 flex min-h-8 items-center break-words font-medium">{new Date(app.createdAt).toLocaleString()}</dd>
            </div>
          </dl>

          {/* Editable fields */}
          <div className="space-y-2">
            <Label htmlFor="stack-display-name">Display Name</Label>
            <Input
              id="stack-display-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter display name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="stack-description">Description</Label>
            <textarea
              id="stack-description"
              value={description}
              maxLength={2_000}
              rows={4}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Enter description"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* Error state */}
          {error ? (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          ) : null}

          {conflict ? (
            <p className="text-sm text-muted-foreground">
              The App changed on the server (revision {app.revision}). Reload the page and retry.
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={
              saving
              || name.trim().length === 0
              || (name.trim() === app.displayName && description.trim() === app.description)
            }
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
