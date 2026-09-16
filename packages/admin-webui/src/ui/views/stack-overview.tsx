import { useState } from "react";
import { Copy, Save } from "lucide-react";
import type { App } from "@unicas/admin-client";
import { api, ifMatch } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function AppOverviewView({ app, onChanged }: {
  app: App;
  onChanged: () => void;
}) {
  const [name, setName] = useState(app.displayName);
  const [description, setDescription] = useState(app.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [copied, setCopied] = useState(false);

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

  async function copyAppId() {
    try {
      await navigator.clipboard.writeText(app.appId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silently fail if clipboard API not available
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
          {/* App ID */}
          <div className="space-y-2">
            <Label>App ID</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono">
                {app.appId}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyAppId()}
              >
                <Copy className="h-4 w-4" />
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <Label>Status</Label>
            <div>
              <Badge variant={statusVariant}>
                {app.status}
              </Badge>
            </div>
          </div>

          {/* Read-only metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-muted-foreground">Revision</Label>
              <p className="font-medium">{app.revision}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Created</Label>
              <p className="font-medium">{new Date(app.createdAt).toLocaleString()}</p>
            </div>
          </div>

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

      <Card>
        <CardHeader>
          <CardTitle>OAuth Issuers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              OAuth issuer configuration
            </p>
            <Button variant="outline" size="sm">
              Configure issuers
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
