import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import type { AppSection } from "../router.js";

const APP_TABS: readonly { id: AppSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "change-logs", label: "Change Logs" },
];

export function WorkspaceDetailHeader({ title, value, onValueChange, navigationLabel, children, content }: {
  title: string;
  value: string;
  onValueChange: (value: string) => void;
  navigationLabel: string;
  children: ReactNode;
  content: ReactNode;
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange}>
      <div className="console-app-detail-header">
        <h1 className="console-app-detail-title" title={title}>{title}</h1>
        <TabsList className="console-app-tabs" aria-label={navigationLabel}>
          {children}
        </TabsList>
      </div>
      <TabsContent value={value} className="mt-0">{content}</TabsContent>
    </Tabs>
  );
}

/**
 * App detail tab navigation using shadcn Tabs (line-style).
 * Active tab derived from route section, switching tabs updates the hash route.
 */
export function AppDetailTabs({
  appId,
  displayName,
  activeSection,
  onTabChange,
  content,
}: {
  appId: string;
  displayName: string;
  activeSection: AppSection;
  onTabChange: (section: AppSection) => void;
  content: ReactNode;
}) {
  return (
    <WorkspaceDetailHeader
      title={displayName}
      value={activeSection}
      onValueChange={(value) => onTabChange(value as AppSection)}
      navigationLabel="App sections"
      content={content}
    >
      {APP_TABS.map((tab) => (
        <TabsTrigger key={tab.id} value={tab.id}>
          {tab.label}
        </TabsTrigger>
      ))}
    </WorkspaceDetailHeader>
  );
}
