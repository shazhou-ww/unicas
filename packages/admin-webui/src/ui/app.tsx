import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import type { App as AppResource, AppAdminMeResponse } from "@unicas/admin-client";
import { api } from "./api.js";
import { navigate, parseAppRoute, parsePlatformRoute, useHashRoute, matchRoute } from "./router.js";
import { AppSidebar } from "./components/app-sidebar.js";
import { AppDetailTabs, WorkspaceDetailHeader } from "./components/app-detail-tabs.js";
import { CopyNotifications } from "./components/copy-bubble.js";
import { LoadingState } from "./components/loading-state.js";
import { McpConfigurationDialog } from "./mcp-configuration-dialog.js";
import { MyAppsView } from "./views/my-apps.js";
import { InvitationView } from "./views/invitations.js";
import { LoginErrorView } from "./views/login-error.js";
import { AppOverviewView } from "./views/app-overview.js";
import { IssuerView } from "./views/issuer.js";
import { UsageView } from "./views/usage.js";
import { PeopleView } from "./views/people.js";
import { ControlAuditView } from "./views/control-audit.js";
import { formatErrorSafe } from "./views/view-helpers.js";
import { PlatformAuditView } from "./views/platform/audit.js";
import { PlatformInvitationAcceptanceView } from "./views/platform-invitation-acceptance.js";
import { AccountView } from "./views/account.js";
import { TabsTrigger } from "@/components/ui/tabs.js";

export function App() {
  const route = useHashRoute();
  const [routePath, routeSearch] = route.split("?", 2);
  const inviteMatch = matchRoute("/invitations/:token", route);
  const platformInviteMatch = matchRoute("/platform-invitations/:token", route);
  const inviteToken = inviteMatch?.params.token ?? platformInviteMatch?.params.token ?? null;
  const [me, setMe] = useState<AppAdminMeResponse | null>(null);
  const [apps, setApps] = useState<AppResource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);

  // Per-app detail state
  const [currentApp, setCurrentApp] = useState<AppResource | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (inviteToken !== null) return;
    let active = true;
    Promise.all([
      api<AppAdminMeResponse>("/admin/me"),
      api<{ items: AppResource[] }>("/admin/apps"),
    ]).then(([meResponse, appsResponse]) => {
      if (!active) return;
      setMe(meResponse);
      setApps(appsResponse.items);
    }).catch((caught) => {
      if (active) setError(formatErrorSafe(caught));
    });
    return () => { active = false; };
  }, [inviteToken]);

  async function refreshNavigation() {
    try {
      const [meResponse, appsResponse] = await Promise.all([
        api<AppAdminMeResponse>("/admin/me"),
        api<{ items: AppResource[] }>("/admin/apps"),
      ]);
      setMe(meResponse);
      setApps(appsResponse.items);
      setError(null);
    } catch (caught) {
      setError(formatErrorSafe(caught));
    }
  }

  async function logout() {
    setMe(null);
    try {
      await fetch("/admin/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.href = "/admin/auth/login";
    }
  }

  const appRoute = parseAppRoute(route);
  const platformRoute = parsePlatformRoute(route);

  useEffect(() => {
    if (appRoute?.section === "invitations") {
      window.location.replace(`#/apps/${encodeURIComponent(appRoute.appId)}/members?filter=pending`);
    } else if (platformRoute?.section === "invitations") {
      window.location.replace("#/platform/people?filter=pending");
    }
  }, [route]);

  // Fetch the current app when appRoute changes
  useEffect(() => {
    if (!appRoute) {
      setCurrentApp(null);
      setAppError(null);
      return;
    }
    let active = true;
    setAppError(null);
    api<AppResource>(`/admin/apps/${encodeURIComponent(appRoute.appId)}`)
      .then((app) => {
        if (!active) return;
        setCurrentApp(app);
        // Also update in the apps list
        setApps((prev) => prev ? prev.map((a) => a.appId === app.appId ? app : a) : prev);
      })
      .catch((caught) => {
        if (active) setAppError(formatErrorSafe(caught));
      });
    return () => { active = false; };
  }, [appRoute?.appId, appRoute?.section, reloadKey]);

  const selectedAppId = appRoute?.appId ?? null;

  const authorities = me?.account.platformAuthorities ?? [];
  const hasPlatformAdmin = authorities.includes("platform.admin");
  const canCreateApps = authorities.includes("apps.create");

  let detail: React.ReactNode;
  if (route === "/login-error") {
    detail = <LoginErrorView />;
  } else if (inviteMatch) {
    detail = <InvitationView token={inviteMatch.params.token!} />;
  } else if (routePath === "/account") {
    detail = <AccountView identityError={new URLSearchParams(routeSearch ?? "").get("identityError")} />;
  } else if (appRoute) {
    if (appError) {
      detail = (
        <div className="page">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <CircleAlert className="h-4 w-4" />
            <span>{appError}</span>
          </div>
        </div>
      );
    } else if (!currentApp || currentApp.appId !== appRoute.appId) {
      detail = (
        <LoadingState
          className="page"
          label="Loading App"
          detail="Navigation stays available while settings load."
        />
      );
    } else {
      const renderSection = () => {
        switch (appRoute.section) {
          case "overview":
            return (
              <div className="space-y-6">
                <AppOverviewView key={currentApp.appId} app={currentApp} onChanged={() => setReloadKey((k) => k + 1)} />
                <IssuerView appId={appRoute.appId} />
                <UsageView appId={appRoute.appId} />
              </div>
            );
          case "members":
            return <PeopleView scope={{ appId: appRoute.appId, appRevision: currentApp.revision, onChanged: () => { setReloadKey((k) => k + 1); void refreshNavigation(); } }} initialFilter={appRoute.peopleFilter} />;
          case "invitations":
            return null;
          case "change-logs":
            return <ControlAuditView appId={appRoute.appId} />;
          default:
            return null;
        }
      };
      detail = (
        <div>
          <AppDetailTabs
            appId={appRoute.appId}
            activeSection={appRoute.section}
            displayName={currentApp.displayName}
            onTabChange={(section) => navigate(`/apps/${encodeURIComponent(appRoute.appId)}/${section}`)}
            content={renderSection()}
          />
        </div>
      );
    }
  } else if (platformRoute) {
    if (!hasPlatformAdmin) {
      detail = (
        <div className="page">
          <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
            <CircleAlert className="h-4 w-4" />
            <span>Platform administrator access is required.</span>
          </div>
        </div>
      );
    } else {
      const renderPlatformSection = () => {
        switch (platformRoute.section) {
          case "people": return <PeopleView scope={{ platform: true }} initialFilter={platformRoute.peopleFilter} />;
          case "invitations": return null;
          case "audit": return <PlatformAuditView />;
          default: return null;
        }
      };
      detail = (
        <div>
          <WorkspaceDetailHeader
            title="Administration"
            value={platformRoute.section}
            onValueChange={value => navigate(`/platform/${value}`)}
            navigationLabel="Administration sections"
            content={renderPlatformSection()}
          >
            <TabsTrigger value="people">Members</TabsTrigger>
            <TabsTrigger value="audit">Change Logs</TabsTrigger>
          </WorkspaceDetailHeader>
        </div>
      );
    }
  } else {
    detail = <MyAppsView canCreateApps={canCreateApps} />;
  }

  if (inviteMatch) {
    return (
      <main className="min-h-screen bg-background p-4 sm:p-8">
        <InvitationView token={inviteMatch.params.token!} />
      </main>
    );
  }
  if (platformInviteMatch) {
    return (
      <main className="min-h-screen bg-background p-4 sm:p-8">
        <PlatformInvitationAcceptanceView token={platformInviteMatch.params.token!} />
      </main>
    );
  }

  if (me === null && error === null) {
    return (
      <div className="loading-shell">
        <LoadingState
          label="Loading Console session"
          detail="Preparing your Apps and navigation."
        />
      </div>
    );
  }

  return (
    <div className="console-layout">
      <AppSidebar
        apps={apps ?? []}
        selectedAppId={selectedAppId}
        me={me}
        canCreateApps={canCreateApps}
        hasPlatformAdmin={hasPlatformAdmin}
        onCreateApp={appId => { navigate(`/apps/${encodeURIComponent(appId)}/overview`); void refreshNavigation(); }}
        onOpenMcp={() => setMcpOpen(true)}
        onLogout={() => void logout()}
      />
      <main className="console-main">
        {error ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <CircleAlert className="h-4 w-4" />
            <span>{error}</span>
          </div>
        ) : null}
        {me || route === "/login-error" ? detail : null}
      </main>
      <McpConfigurationDialog open={mcpOpen} onClose={() => setMcpOpen(false)} />
      <CopyNotifications />
    </div>
  );
}

export { navigate };
