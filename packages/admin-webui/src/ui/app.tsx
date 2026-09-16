import { useEffect, useState } from "react";
import type { App as AppResource, AppAdminMeResponse } from "@unicas/admin-client";
import { api } from "./api.js";
import { navigate, parseAppRoute, parsePlatformRoute, useHashRoute, matchRoute } from "./router.js";
import { AppSidebar } from "./components/app-sidebar.js";
import { AppDetailTabs } from "./components/app-detail-tabs.js";
import { ErrorState, LoadingState } from "./components.js";
import { McpConfigurationDialog } from "./mcp-configuration-dialog.js";
import { MyAppsView } from "./views/my-stacks.js";
import { InvitationView } from "./views/invitations.js";
import { LoginErrorView } from "./views/login-error.js";
import { AppOverviewView } from "./views/stack-overview.js";
import { MembersView } from "./views/members.js";
import { ControlAuditView } from "./views/control-audit.js";
import { PlaygroundView } from "./views/file-playground.js";
import { AppInvitationsView } from "./views/app-invitations.js";
import { PlaygroundCacheContext, createPlaygroundCacheSession, type PlaygroundCacheSession } from "./playground-cache.js";
import { formatErrorSafe } from "./views/view-helpers.js";

export function App() {
  const route = useHashRoute();
  const [me, setMe] = useState<AppAdminMeResponse | null>(null);
  const [apps, setApps] = useState<AppResource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [cacheSession, setCacheSession] = useState<PlaygroundCacheSession | null>(null);

  // Per-app detail state
  const [currentApp, setCurrentApp] = useState<AppResource | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    let session: PlaygroundCacheSession | undefined;
    Promise.all([
      api<AppAdminMeResponse>("/admin/me"),
      api<{ items: AppResource[] }>("/admin/apps"),
    ]).then(([meResponse, appsResponse]) => {
      if (!active) return;
      session = createPlaygroundCacheSession({
        identityIssuer: meResponse.principal.issuer,
        subject: meResponse.principal.subject,
      });
      setCacheSession(session);
      setMe(meResponse);
      setApps(appsResponse.items);
    }).catch((caught) => {
      if (active) setError(formatErrorSafe(caught));
    });
    return () => { active = false; session?.close(); };
  }, []);

  async function logout() {
    setMe(null);
    try {
      await cacheSession?.clear();
      await fetch("/admin/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.href = "/admin/auth/login";
    }
  }

  const appRoute = parseAppRoute(route);
  const platformRoute = parsePlatformRoute(route);
  const inviteMatch = matchRoute("/invitations/:token", route);

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

  // Check authorities
  const hasPlatformAdmin = false;
  const canCreateApps = true;

  let detail: React.ReactNode;
  if (route === "/login-error") {
    detail = <LoginErrorView />;
  } else if (inviteMatch) {
    detail = <InvitationView token={inviteMatch.params.token!} />;
  } else if (appRoute) {
    if (appError) {
      detail = <div className="page"><ErrorState message={appError} /></div>;
    } else if (!currentApp) {
      detail = <div className="page"><LoadingState label="Loading app…" /></div>;
    } else {
      const renderSection = () => {
        switch (appRoute.section) {
          case "overview":
            return <AppOverviewView app={currentApp} onChanged={() => setReloadKey((k) => k + 1)} />;
          case "members":
            return <MembersView appId={appRoute.appId} appRevision={currentApp.revision} onChanged={() => setReloadKey((k) => k + 1)} />;
          case "invitations":
            return <AppInvitationsView appId={appRoute.appId} />;
          case "playground":
            return <PlaygroundView appId={appRoute.appId} />;
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
          />
          {renderSection()}
        </div>
      );
    }
  } else if (platformRoute) {
    detail = (
      <div className="page">
        <h1>Platform Administration</h1>
        <p>Section: {platformRoute.section} — coming soon</p>
      </div>
    );
  } else {
    detail = <MyAppsView />;
  }

  if (me === null && error === null) {
    return <div className="loading-shell"><LoadingState label="Loading session…" /></div>;
  }

  return (
    <div className="console-layout">
      <AppSidebar
        apps={apps ?? []}
        selectedAppId={selectedAppId}
        me={me}
        canCreateApps={canCreateApps}
        hasPlatformAdmin={hasPlatformAdmin}
        onCreateApp={() => navigate("/")}
        onOpenMcp={() => setMcpOpen(true)}
        onLogout={() => void logout()}
      />
      <main className="console-main">
        {error ? <ErrorState message={error} /> : null}
        <PlaygroundCacheContext value={cacheSession}>
          {me || route === "/login-error" ? detail : null}
        </PlaygroundCacheContext>
      </main>
      <McpConfigurationDialog open={mcpOpen} onClose={() => setMcpOpen(false)} />
    </div>
  );
}

export { navigate };
