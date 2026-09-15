import { useEffect, useState } from "react";
import { BookOpenText, Cable } from "lucide-react";
import type { App as AppResource, AppAdminMeResponse } from "@unicas/admin-client";
import { api } from "./api.js";
import { matchRoute, navigate, useHashRoute } from "./router.js";
import { MyAppsView } from "./views/my-stacks.js";
import { AppView } from "./views/stack.js";
import { InvitationView } from "./views/invitations.js";
import { LoginErrorView } from "./views/login-error.js";
import { Button, ErrorState, LoadingState, Page } from "./components.js";
import { McpConfigurationDialog } from "./mcp-configuration-dialog.js";
import { UserMenu } from "./user-menu.js";
import { formatErrorSafe } from "./views/view-helpers.js";
import { createPlaygroundCacheSession, PlaygroundCacheContext, type PlaygroundCacheSession } from "./playground-cache.js";

export function App() {
  const route = useHashRoute();
  const [me, setMe] = useState<AppAdminMeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mcpConfigurationOpen, setMcpConfigurationOpen] = useState(false);
  const [activeApp, setActiveApp] = useState<AppResource | null>(null);
  const [cacheSession, setCacheSession] = useState<PlaygroundCacheSession | null>(null);

  useEffect(() => {
    let active = true;
    let session: PlaygroundCacheSession | undefined;
    void api<AppAdminMeResponse>("/admin/me")
      .then((response) => {
        if (!active) return;
        session = createPlaygroundCacheSession({
          identityIssuer: response.principal.issuer,
          subject: response.principal.subject,
        });
        setCacheSession(session);
        setMe(response);
      })
      .catch((caught) => { if (active) setError(formatErrorSafe(caught)); });
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

  let content: React.ReactNode;
  const appMatch = matchRoute("/apps/:appId", route);
  const inviteMatch = matchRoute("/invitations/:token", route);
  if (route === "/login-error") {
    content = <LoginErrorView />;
  } else if (appMatch) {
    content = (
      <AppView
        appId={appMatch.params.appId!}
        onAppChange={setActiveApp}
        onOpenMcpConfiguration={() => setMcpConfigurationOpen(true)}
        onLogout={() => void logout()}
      />
    );
  } else if (inviteMatch) {
    content = <InvitationView token={inviteMatch.params.token!} />;
  } else {
    content = <MyAppsView />;
  }

  if (me === null && error === null) {
    return <Page title="CAS Admin"><LoadingState label="Loading session…" /></Page>;
  }

  return (
    <div className={`app${appMatch ? " app-stack" : ""}`}>
      <header className="app-header">
        <a className="brand" href="#/">
          <span className="brand-mark">U</span>
          <span>UniCAS</span>
        </a>
        {appMatch && activeApp?.appId === appMatch.params.appId ? (
          <div className="desktop-stack-title">
            <strong>{activeApp.displayName}</strong>
          </div>
        ) : null}
        <div className="app-header-right">
          {me ? (
            <>
              <a
                className="docs-header-link"
                href="https://docs.unicas.work"
                target="_blank"
                rel="noreferrer"
                aria-label="Open UniCAS documentation"
              >
                <BookOpenText size={15} aria-hidden="true" />
                <span>Documentation</span>
              </a>
              <span className="mcp-header-action">
                <Button
                  variant="plain"
                  icon={<Cable size={15} />}
                  onClick={() => setMcpConfigurationOpen(true)}
                >
                  Connect AI tools
                </Button>
              </span>
              <UserMenu
                name={me.profile.displayName ?? me.profile.emailForDisplay ?? "Account"}
                onLogout={() => void logout()}
              />
            </>
          ) : null}
        </div>
      </header>
      {error ? <div className="app-error"><ErrorState message={error} /></div> : null}
      <main className="app-main">
        <PlaygroundCacheContext value={cacheSession}>{me || route === "/login-error" ? content : null}</PlaygroundCacheContext>
      </main>
      <McpConfigurationDialog
        open={mcpConfigurationOpen}
        onClose={() => setMcpConfigurationOpen(false)}
      />
    </div>
  );
}

export { navigate };
