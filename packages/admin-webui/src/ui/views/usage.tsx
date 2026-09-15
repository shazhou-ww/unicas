import { Card, NotAvailableState } from "../components.js";

export function UsageView({ appId }: { appId: string }) {
  void appId;
  return (
    <Card title="Usage">
      <NotAvailableState
        title="Usage is a Space data-plane read"
        detail="Space usage requires a cas:manage capability for a specific Space. The admin session deliberately carries no Space credential, so an explicit delegated path is required before this view can query usage."
      />
    </Card>
  );
}