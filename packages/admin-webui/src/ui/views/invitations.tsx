import { useEffect, useState } from "react";
import { Check, AlertCircle } from "lucide-react";
import { api } from "../api.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";
import { PageHeading } from "../components/page-heading.js";
import { formatErrorSafe } from "./view-helpers.js";

/**
 * Invitation accept page. The BFF redirects authenticated visitors here from
 * `/admin/invitations/{token}`; this view POSTs the App invitation contract.
 */
export function InvitationView({ token }: { token: string }) {
  const [accepting, setAccepting] = useState(false);
  const [result, setResult] = useState<{ readonly appId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    // Reset when navigating between tokens.
    setResult(null);
    setError(null);
    setAccepted(false);
  }, [token]);

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const member = await api<{ readonly appId: string }>(`/admin/member-invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
      });
      setResult(member);
      setAccepted(true);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setAccepting(false);
    }
  }

  return (
    <section className="page">
      <PageHeading title="App membership invitation" />
      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>Invitation accepted</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>
              You are now a member of App <strong>{result.appId}</strong>.
            </p>
            <p><a href="#/">Go to My Apps</a></p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Join an App</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Someone invited you to administer a UniCAS App. Accepting binds your
              Account to the App with administrator authority.
            </p>
            {error ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            ) : null}
            <Button onClick={() => void accept()} disabled={accepting || accepted}>
              <Check className="mr-2 h-4 w-4" />
              {accepting ? "Accepting…" : "Accept membership"}
            </Button>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
