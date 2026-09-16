import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";

export function PlatformInvitationsView() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform Invitations</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          Platform invitation management will be available after the invitation-limited login prerequisite is implemented.
        </p>
      </CardContent>
    </Card>
  );
}
