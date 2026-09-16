import { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import type { App as AppResource, AppAdminMeResponse } from "@unicas/admin-client";
import { api } from "./api.js";
import { navigate, parseAppRoute, parsePlatformRoute, useHashRoute, matchRoute } from "./router.js";
import { AppSidebar } from "./components/app-sidebar.js";
import { AppDetailTabs } from "./components/app-detail-tabs.js";
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
import { PlatformPrincipalsView } from "./views/platform/principals.js";
import { PlatformInvitationsView } from "./views/platform/invitations.js";
import { PlatformAuditView } from "./views/platform/audit.js";

export function App() {
  const route = useHashRoute();
  const inviteMatch = matchRoute("/invitations/:token", route);
  const inviteToken = inviteMatch?.params.token ?? null;
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
    if (inviteToken !== null) return;
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
  }, [inviteToken]);

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

  const authorities = me?.platformAccess?.authorities ?? [];
  const hasPlatformAdmin = authorities.includes("platform.admin");
  const canCreateApps = authorities.includes("apps.create");

  let detail: React.ReactNode;
  if (route === "/login-error") {
    detail = <LoginErrorView />;
  } else if (inviteMatch) {
    detail = <InvitationView token={inviteMatch.params.token!} />;
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
    } else if (!currentApp) {
      detail = (
        <div className="page">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            <span>Loading app…</span>
          </div>
        </div>
      );
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
    const renderPlatformSection = () => {
      switch (platformRoute.section) {
        case "principals": return <PlatformPrincipalsView />;
        case "invitations": return <PlatformInvitationsView />;
        case "audit": return <PlatformAuditView />;
        default: return null;
      }
    };
    detail = (
      <div>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Platform Administration</h1>
          <nav className="flex gap-1 border-b" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={platformRoute.section === "principals"}
              onClick={() => navigate("/platform/principals")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${platformRoute.section === "principals"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
            >
              Principals
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={platformRoute.section === "invitations"}
              onClick={() => navigate("/platform/invitations")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${platformRoute.section === "invitations"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
            >
              Invitations
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={platformRoute.section === "audit"}
              onClick={() => navigate("/platform/audit")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${platformRoute.section === "audit"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
            >
              Audit
            </button>
          </nav>
        </div>
        {renderPlatformSection()}
      </div>
    );
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

  if (me === null && error === null) {
    return (
      <div className="loading-shell">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span>Loading session…</span>
        </div>
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
        onCreateApp={() => navigate("/")}
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
        <PlaygroundCacheContext value={cacheSession}>
          {me || route === "/login-error" ? detail : null}
        </PlaygroundCacheContext>
      </main>
      <McpConfigurationDialog open={mcpOpen} onClose={() => setMcpOpen(false)} />
    </div>
  );
}

export { navigate };
