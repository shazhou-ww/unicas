import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";

export function PlatformAuditView() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform Audit</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          Platform audit log will be available after the audit infrastructure prerequisite is implemented.
        </p>
      </CardContent>
    </Card>
  );
}
