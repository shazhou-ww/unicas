import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";

export function UsageView({ appId }: { appId: string }) {
  void appId;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <div>
            <p className="font-medium text-foreground mb-1">Usage is a Space data-plane read</p>
            <p>Space usage requires a cas:usage:read capability for a specific Space. The admin session deliberately carries no Space credential, so an explicit delegated path is required before this view can query usage.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}