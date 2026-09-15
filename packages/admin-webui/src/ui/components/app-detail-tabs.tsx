import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import type { AppSection } from "../router.js";

const APP_TABS: readonly { id: AppSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "invitations", label: "Invitations" },
  { id: "playground", label: "Playground" },
  { id: "change-logs", label: "Change Logs" },
];

/**
 * App detail tab navigation using shadcn Tabs (line-style).
 * Active tab derived from route section, switching tabs updates the hash route.
 */
export function AppDetailTabs({
  appId,
  displayName,
  activeSection,
  onTabChange,
}: {
  appId: string;
  displayName: string;
  activeSection: AppSection;
  onTabChange: (section: AppSection) => void;
}) {
  return (
    <div className="console-app-detail-header">
      <h1 className="console-app-detail-title" title={displayName}>
        {displayName}
      </h1>
      <Tabs value={activeSection} onValueChange={(value) => onTabChange(value as AppSection)}>
        <TabsList className="console-app-tabs">
          {APP_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
