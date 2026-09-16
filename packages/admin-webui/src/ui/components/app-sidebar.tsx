import { useEffect, useState } from "react";
import { Menu, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet.js";
import type { App, AppAdminMeResponse } from "@unicas/admin-client";
import { UserMenu } from "../user-menu.js";

export interface AppSidebarProps {
  apps: App[];
  selectedAppId: string | null;
  me: AppAdminMeResponse | null;
  canCreateApps: boolean;
  hasPlatformAdmin: boolean;
  onCreateApp: () => void;
  onOpenMcp: () => void;
  onLogout: () => void;
}

export function AppSidebar({
  apps,
  selectedAppId,
  me,
  canCreateApps,
  hasPlatformAdmin,
  onCreateApp,
  onOpenMcp,
  onLogout,
}: AppSidebarProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 900);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const sortedApps = [...apps].sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );

  const getInitials = (name: string) => {
    return name.slice(0, 2).toUpperCase();
  };

  const sidebarContent = (
    <div className="console-sidebar">
      {/* Header - Brand */}
      <div className="console-sidebar-header">
        <div className="console-sidebar-brand">
          <div className="console-sidebar-brand-mark">U</div>
          <span className="console-sidebar-brand-text">UniCAS</span>
        </div>
      </div>

      {/* Content */}
      <div className="console-sidebar-content">
        {/* Apps Section */}
        <div className="console-sidebar-section">
          <div className="console-sidebar-section-header">
            <span className="console-sidebar-section-title">Apps</span>
            {canCreateApps && (
              <Button
                variant="ghost"
                size="icon"
                className="console-sidebar-create-button"
                onClick={onCreateApp}
                title="Create App"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="console-sidebar-app-list">
            {sortedApps.map((app) => {
              const isSelected = selectedAppId === app.appId;
              return (
                <a
                  key={app.appId}
                  href={`#/apps/${app.appId}/overview`}
                  className={`console-sidebar-app-item ${isSelected ? "console-sidebar-app-item-selected" : ""
                    }`}
                >
                  {isSelected && <div className="console-sidebar-selected-indicator" />}
                  <div className="console-sidebar-app-mark">
                    {getInitials(app.displayName)}
                  </div>
                  <span
                    className="console-sidebar-app-name"
                    title={app.displayName}
                  >
                    {app.displayName}
                  </span>
                </a>
              );
            })}
          </div>
        </div>

        {/* Administration Section */}
        {hasPlatformAdmin && (
          <div className="console-sidebar-section">
            <div className="console-sidebar-section-header">
              <span className="console-sidebar-section-title">Administration</span>
            </div>
            <a
              href="#/platform/people"
              className="console-sidebar-admin-item"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>Platform access</span>
            </a>
          </div>
        )}
      </div>

      {/* Footer - Profile Menu */}
      {me && (
        <div className="console-sidebar-footer">
          <UserMenu
            me={me}
            onOpenMcpConfiguration={onOpenMcp}
            onLogout={onLogout}
          />
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="console-mobile-sidebar-trigger"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="p-0 w-[17rem]">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebarContent}
        </SheetContent>
      </Sheet>
    );
  }

  return sidebarContent;
}
