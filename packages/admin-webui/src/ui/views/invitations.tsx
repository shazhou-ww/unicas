import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { api } from "../api.js";
import { Button, Card, ErrorState, Page } from "../components.js";
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
    <Page title="App membership invitation">
      {result ? (
        <Card title="Invitation accepted">
          <p>
            You are now a member of App <strong>{result.appId}</strong>.
          </p>
          <p><a href="#/">Go to My Apps</a></p>
        </Card>
      ) : (
        <Card title="Join an App">
          <p>
            Someone invited you to administer a UniCAS App. Accepting binds your
            Principal to the App with equal administrator authority.
          </p>
          {error ? <ErrorState message={error} /> : null}
          <Button icon={<Check size={15} />} variant="primary" onClick={() => void accept()} disabled={accepting || accepted}>
            {accepting ? "Accepting…" : "Accept membership"}
          </Button>
        </Card>
      )}
    </Page>
  );
}
