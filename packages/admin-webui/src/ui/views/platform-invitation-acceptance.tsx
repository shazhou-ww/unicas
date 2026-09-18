import { useState } from "react";
import { AlertCircle, ShieldCheck } from "lucide-react";
import { api } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";
import { PageHeading } from "../components/page-heading.js";

export function PlatformInvitationAcceptanceView({
  token,
  onAccepted = () => window.location.assign("/admin/"),
}: {
  readonly token: string;
  readonly onAccepted?: () => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      await api<void>(`/admin/platform-invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
      });
      onAccepted();
    } catch (caught) {
      setError(formatErrorSafe(caught));
      setAccepting(false);
    }
  }

  return (
    <section className="page">
      <PageHeading title="Platform invitation" />
      <Card>
        <CardHeader>
          <CardTitle>Accept platform access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Accept the platform authorities assigned to your verified Account.
          </p>
          {error ? (
            <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : null}
          <Button onClick={() => void accept()} disabled={accepting}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            {accepting ? "Accepting…" : "Accept platform access"}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}