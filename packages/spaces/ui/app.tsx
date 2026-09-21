import {
  ChevronRight,
  Download,
  File,
  Folder,
  FolderPlus,
  LogOut,
  Menu,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import {
  SpacesApi,
  SpacesApiError,
  type DirectoryResult,
  type FileEntry,
  type SessionResult,
} from "./api.js";

const api = new SpacesApi();

type ViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "login"; readonly error: string | null }
  | { readonly kind: "files"; readonly session: SessionResult };

type DialogState =
  | { readonly kind: "folder" }
  | { readonly kind: "rename"; readonly entry: FileEntry }
  | { readonly kind: "delete"; readonly entry: FileEntry }
  | null;

const uploadStages = ["hash", "lease", "upload", "commit", "verify"] as const;

export function App() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    api.session(controller.signal).then((session) => {
      startTransition(() => setView({ kind: "files", session }));
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const loginError = new URL(window.location.href).searchParams.get("error");
      if (error instanceof SpacesApiError && error.status === 401) {
        setView({ kind: "login", error: loginError });
      } else {
        setView({ kind: "login", error: "auth_unavailable" });
      }
    });
    return () => controller.abort();
  }, []);

  if (view.kind === "loading") return <LoadingScreen />;
  if (view.kind === "login") return <LoginScreen error={view.error} />;
  return <FileWorkspace session={view.session} onSignedOut={() => setView({ kind: "login", error: null })} />;
}

function LoadingScreen() {
  return (
    <main className="center-screen" aria-busy="true">
      <div className="brand-lockup"><BrandMark /><span>Spaces</span></div>
      <p>Opening your files...</p>
    </main>
  );
}

function LoginScreen({ error }: { readonly error: string | null }) {
  const message = error === "principal_not_admitted"
    ? "This Google account has not been admitted to Spaces."
    : error === "principal_suspended"
      ? "This Spaces account is suspended."
      : error ? "Google sign-in could not be completed. Try again." : null;
  return (
    <main className="login-screen">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-lockup"><BrandMark /><span>UniCAS Spaces</span></div>
        <div>
          <h1 id="login-title">Sign in to your files</h1>
          <p>Use the Google account admitted to this private App.</p>
        </div>
        {message && <ErrorNotice message={message} code={error ?? "auth_invalid"} correlationId={null} />}
        <a className="button google-button" href="/auth/google/start">
          <GoogleMark />
          Continue with Google
        </a>
        <p className="provider-note">Microsoft and GitHub are not available in this release.</p>
      </section>
    </main>
  );
}

function FileWorkspace({
  session,
  onSignedOut,
}: {
  readonly session: SessionResult;
  readonly onSignedOut: () => void;
}) {
  const [currentPath, setCurrentPath] = useState(pathFromLocation());
  const [directory, setDirectory] = useState<DirectoryResult | null>(null);
  const [error, setError] = useState<SpacesApiError | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploadStage, setUploadStage] = useState<typeof uploadStages[number] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load(path: string) {
    setError(null);
    try {
      const next = await api.list(path);
      startTransition(() => {
        setCurrentPath(next.path);
        setDirectory(next);
        window.history.replaceState(null, "", next.path === "/" ? "/files" : `/files${next.path}`);
      });
    } catch (reason) {
      setError(toApiError(reason));
    }
  }

  useEffect(() => { void load(currentPath); }, []);

  async function runMutation(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      setDialog(null);
      await load(currentPath);
    } catch (reason) {
      const nextError = toApiError(reason);
      setError(nextError);
      if (nextError.status === 409) await load(currentPath);
      throw nextError;
    }
  }

  async function uploadSelected(file: File) {
    if (!directory) return;
    setUploadStage("hash");
    setError(null);
    try {
      for (const stage of uploadStages.slice(1, -2)) setUploadStage(stage);
      await api.upload({ parentPath: currentPath, file, revision: directory.revision });
      setUploadStage("commit");
      await load(currentPath);
      setUploadStage("verify");
    } catch (reason) {
      setError(toApiError(reason));
    } finally {
      setUploadStage(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const breadcrumbs = breadcrumbParts(currentPath);
  const folderCount = directory?.entries.filter((entry) => entry.type === "directory").length ?? 0;
  const fileCount = directory?.entries.filter((entry) => entry.type === "file").length ?? 0;

  return (
    <div className="app-shell">
      <Sidebar session={session} onSignOut={async () => { await api.logout(); onSignedOut(); }} />
      <button className="mobile-menu-button icon-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>
        <Menu size={20} />
      </button>
      {menuOpen && <MobileNavigation session={session} onClose={() => setMenuOpen(false)} onSignOut={async () => {
        await api.logout();
        onSignedOut();
      }} />}

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <h1>{breadcrumbs.at(-1)?.name ?? "Files"}</h1>
            <p>{directory ? `${folderCount} ${plural(folderCount, "folder")} · ${fileCount} ${plural(fileCount, "file")}` : "Loading folder"}</p>
          </div>
          <div className="page-actions">
            <button className="button" onClick={() => setDialog({ kind: "folder" })} disabled={!directory}>
              <FolderPlus size={16} /> New folder
            </button>
            <button className="button primary" onClick={() => fileInput.current?.click()} disabled={!directory || uploadStage !== null}>
              <Upload size={16} /> Upload file
            </button>
            <input ref={fileInput} className="visually-hidden" type="file" onChange={(event) => {
              const selected = event.currentTarget.files?.[0];
              if (selected) void uploadSelected(selected);
            }} />
          </div>
        </header>

        <nav className="breadcrumbs" aria-label="Current folder">
          {breadcrumbs.map((part, index) => (
            <span className="breadcrumb-group" key={part.path}>
              {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
              <button
                className="breadcrumb"
                aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}
                onClick={() => void load(part.path)}
              >{part.name}</button>
            </span>
          ))}
        </nav>

        {error && <ErrorNotice message={error.message} code={error.code} correlationId={error.correlationId} onRetry={() => void load(currentPath)} />}
        {uploadStage && <UploadProgress stage={uploadStage} />}

        <section className="file-surface" aria-label="Files">
          {!directory ? <div className="empty-state" aria-busy="true">Loading files...</div>
            : directory.entries.length === 0 ? (
              <div className="empty-state">
                <Folder size={28} strokeWidth={1.5} />
                <strong>This folder is empty</strong>
                <span>Upload a file or create a folder here.</span>
              </div>
            ) : (
              <div className="file-table" role="table" aria-label={`Files in ${currentPath}`}>
                <div className="file-row file-header" role="row">
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Type</span>
                  <span role="columnheader">Size</span>
                  <span role="columnheader">Actions</span>
                </div>
                {directory.entries.map((entry) => (
                  <FileRow
                    key={entry.path}
                    entry={entry}
                    onOpen={() => void load(entry.path)}
                    onRename={() => setDialog({ kind: "rename", entry })}
                    onDelete={() => setDialog({ kind: "delete", entry })}
                  />
                ))}
              </div>
            )}
        </section>
      </main>

      {dialog?.kind === "folder" && directory && (
        <NameDialog
          title="New folder"
          description={`Create a folder in ${breadcrumbs.at(-1)?.name ?? "Files"}.`}
          actionLabel="Create folder"
          initialValue=""
          onClose={() => setDialog(null)}
          onConfirm={(name) => runMutation(() => api.createFolder({ parentPath: currentPath, name, revision: directory.revision }))}
        />
      )}
      {dialog?.kind === "rename" && directory && (
        <NameDialog
          title="Rename file"
          description="The existing content will be reused when this change commits."
          actionLabel="Rename"
          initialValue={dialog.entry.name}
          onClose={() => setDialog(null)}
          onConfirm={(name) => runMutation(() => api.rename({ path: dialog.entry.path, name, revision: directory.revision }))}
        />
      )}
      {dialog?.kind === "delete" && directory && (
        <ConfirmDialog
          title="Delete file?"
          description={`${dialog.entry.name} will be removed from this file root.`}
          onClose={() => setDialog(null)}
          onConfirm={() => runMutation(() => api.deleteFile(dialog.entry.path, directory.revision))}
        />
      )}
    </div>
  );
}

function FileRow({
  entry,
  onOpen,
  onRename,
  onDelete,
}: {
  readonly entry: FileEntry;
  readonly onOpen: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <div className="file-row" role="row">
      <div className="file-name" role="cell">
        {entry.type === "directory" ? <Folder size={18} /> : <File size={18} />}
        {entry.type === "directory"
          ? <button className="file-link" onClick={onOpen}>{entry.name}</button>
          : <span>{entry.name}</span>}
      </div>
      <span className="file-meta" role="cell">{entry.type === "directory" ? "Folder" : entry.mediaType ?? "File"}</span>
      <span className="file-meta" role="cell">{entry.type === "file" ? formatBytes(entry.size ?? 0) : "-"}</span>
      <div className="row-actions" role="cell">
        {entry.type === "directory" ? (
          <button className="icon-button" aria-label={`Open ${entry.name}`} title="Open" onClick={onOpen}>
            <ChevronRight size={17} />
          </button>
        ) : (
          <>
            <a className="icon-button" aria-label={`Download ${entry.name}`} title="Download" href={api.downloadUrl(entry.path)}>
              <Download size={16} />
            </a>
            <button className="icon-button" aria-label={`Rename ${entry.name}`} title="Rename" onClick={onRename}>
              <Pencil size={15} />
            </button>
            <button className="icon-button danger-icon" aria-label={`Delete ${entry.name}`} title="Delete" onClick={onDelete}>
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Sidebar({ session, onSignOut }: { readonly session: SessionResult; readonly onSignOut: () => Promise<void> }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><BrandMark /><span>Spaces</span></div>
      <nav aria-label="Spaces navigation">
        <p className="nav-label">Personal</p>
        <a className="nav-item active" href="/files"><Folder size={17} /><span>Files</span></a>
      </nav>
      <UserFooter session={session} onSignOut={onSignOut} />
    </aside>
  );
}

function MobileNavigation({
  session,
  onClose,
  onSignOut,
}: {
  readonly session: SessionResult;
  readonly onClose: () => void;
  readonly onSignOut: () => Promise<void>;
}) {
  const sheet = useRef<HTMLElement>(null);
  useModalKeyboard(sheet, onClose);
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside ref={sheet} className="mobile-sheet" role="dialog" aria-modal="true" aria-label="Navigation">
        <div className="sheet-head"><div className="sidebar-brand"><BrandMark /><span>Spaces</span></div><button autoFocus className="icon-button" aria-label="Close navigation" onClick={onClose}><X size={18} /></button></div>
        <nav aria-label="Spaces navigation"><a className="nav-item active" href="/files"><Folder size={17} />Files</a></nav>
        <UserFooter session={session} onSignOut={onSignOut} />
      </aside>
    </div>
  );
}

function UserFooter({ session, onSignOut }: { readonly session: SessionResult; readonly onSignOut: () => Promise<void> }) {
  return (
    <div className="user-footer">
      <div><strong>{session.principal.displayName}</strong><span>{providerLabel(session.principal.provider)}</span></div>
      <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => void onSignOut()}><LogOut size={16} /></button>
    </div>
  );
}

function NameDialog({
  title,
  description,
  actionLabel,
  initialValue,
  onClose,
  onConfirm,
}: {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly initialValue: string;
  readonly onClose: () => void;
  readonly onConfirm: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return (
    <DialogFrame title={title} onClose={onClose}>
      <p>{description}</p>
      <label className="field-label" htmlFor="name-input">Name</label>
      <input ref={input} id="name-input" className="text-input" value={name} aria-invalid={Boolean(error)} onChange={(event) => { setName(event.target.value); setError(null); }} />
      {error && <p className="field-error">{error}</p>}
      <div className="dialog-actions">
        <button className="button" onClick={onClose}>Cancel</button>
        <button className="button primary" disabled={submitting || !name.trim()} onClick={async () => {
          setSubmitting(true);
          try { await onConfirm(name); }
          catch (reason) { setError(toApiError(reason).message); setSubmitting(false); }
        }}>{submitting ? "Saving..." : actionLabel}</button>
      </div>
    </DialogFrame>
  );
}

function ConfirmDialog({
  title,
  description,
  onClose,
  onConfirm,
}: {
  readonly title: string;
  readonly description: string;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<unknown>;
}) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <DialogFrame title={title} onClose={onClose}>
      <p>{description}</p>
      <div className="dialog-actions">
        <button className="button" data-modal-autofocus onClick={onClose}>Cancel</button>
        <button className="button danger" disabled={submitting} onClick={async () => {
          setSubmitting(true);
          try { await onConfirm(); } catch { setSubmitting(false); }
        }}>{submitting ? "Deleting..." : "Delete"}</button>
      </div>
    </DialogFrame>
  );
}

function DialogFrame({ title, onClose, children }: { readonly title: string; readonly onClose: () => void; readonly children: ReactNode }) {
  const dialog = useRef<HTMLElement>(null);
  useModalKeyboard(dialog, onClose);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialog} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
        {children}
      </section>
    </div>
  );
}

function ErrorNotice({
  message,
  code,
  correlationId,
  onRetry,
}: {
  readonly message: string;
  readonly code: string;
  readonly correlationId: string | null;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="error-notice" role="alert">
      <div><strong>{message}</strong><span>{code}{correlationId ? ` · ${correlationId}` : ""}</span></div>
      {onRetry && <button className="button compact" onClick={onRetry}><RefreshCw size={14} /> Retry</button>}
    </div>
  );
}

function UploadProgress({ stage }: { readonly stage: typeof uploadStages[number] }) {
  const index = uploadStages.indexOf(stage);
  const percent = Math.round(((index + 1) / uploadStages.length) * 100);
  return (
    <section className="upload-status" aria-live="polite">
      <div><strong>Uploading file</strong><span>{capitalize(stage)}</span></div>
      <div className="progress-track" role="progressbar" aria-label={`Upload stage: ${stage}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

function BrandMark() { return <span className="brand-mark" aria-hidden="true">UC</span>; }

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285f4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.3h2.9c1.7-1.6 2.7-3.9 2.7-6.7z" />
      <path fill="#34a853" d="M9 18c2.4 0 4.5-.8 6-2.2L12 13.6c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H1V13A9 9 0 0 0 9 18z" />
      <path fill="#fbbc05" d="M4 10.8A5.4 5.4 0 0 1 3.7 9c0-.6.1-1.2.3-1.7V5H1A9 9 0 0 0 1 13l3-2.2z" />
      <path fill="#ea4335" d="M9 3.6c1.3 0 2.5.4 3.4 1.3L15 2.3A9 9 0 0 0 1 5l3 2.3c.7-2.1 2.7-3.7 5-3.7z" />
    </svg>
  );
}

function pathFromLocation(): string {
  const pathname = decodeURIComponent(window.location.pathname);
  if (pathname === "/files" || !pathname.startsWith("/files/")) return "/";
  return pathname.slice("/files".length);
}

function breadcrumbParts(path: string): readonly { readonly name: string; readonly path: string }[] {
  const result = [{ name: "Files", path: "/" }];
  let current = "";
  for (const segment of path.split("/").filter(Boolean)) {
    current += `/${segment}`;
    result.push({ name: segment, path: current });
  }
  return result;
}

function toApiError(reason: unknown): SpacesApiError {
  return reason instanceof SpacesApiError
    ? reason
    : new SpacesApiError(500, "request_failed", null, "The request could not be completed.");
}

function plural(count: number, word: string): string { return count === 1 ? word : `${word}s`; }
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function providerLabel(provider: SessionResult["principal"]["provider"]): string {
  if (provider === "google") return "Google";
  if (provider === "microsoft") return "Microsoft";
  if (provider === "github") return "GitHub";
  return "Smoke";
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useModalKeyboard(
  container: React.RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    container.current?.querySelector<HTMLElement>("[data-modal-autofocus]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !container.current) return;
      const focusable = Array.from(container.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
    };
  }, [container, onClose]);
}