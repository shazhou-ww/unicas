import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import type { AppSection } from "../router.js";

const APP_TABS: readonly { id: AppSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
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
  playgroundEnabled,
  onTabChange,
}: {
  appId: string;
  displayName: string;
  activeSection: AppSection;
  playgroundEnabled: boolean;
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
          <TabsTrigger
            value="playground"
            className="console-playground-tab"
            disabled={!playgroundEnabled}
            title={playgroundEnabled ? "Playground" : "Enable the managed issuer to use Playground"}
          >
            Playground
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
