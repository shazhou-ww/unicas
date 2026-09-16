import { useContext, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUp,
  ChevronRight,
  Copy,
  Download,
  File,
  Folder,
  FolderPlus,
  HardDrive,
  Move,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import type { AppOAuthIssuer, ManagedSpaceCapability } from "@unicas/admin-client";
import { createSpaceCasClient } from "@unicas/tenant-client";
import {
  createTenantFileSystem,
  type TenantFileRoot,
  type TenantFileRootCatalog,
  type TenantFileRootInfo,
  type TenantFileStat,
} from "@unicas/tenant-file-client";
import type { CasGcResult, CasUsage } from "@unicas/tenant-client";
import { api, ifMatch } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";
import { PlaygroundCacheContext } from "../playground-cache.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";
import { cn } from "@/lib/utils.js";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let size = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

function joinPath(directory: string, name: string): string {
  return directory === "/" ? `/${name}` : `${directory}/${name}`;
}

function parentPath(path: string): string {
  if (path === "/") return "/";
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent || "/";
}

function rootNameError(value: string, roots: readonly TenantFileRootInfo[]): string | null {
  const name = value.trim();
  if (name.length === 0) return "Root name is required.";
  if (name.length > 120) return "Root name must be at most 120 characters.";
  if (/[\u0000-\u001f]/.test(name)) return "Root name contains invalid characters.";
  if (roots.some((root) => root.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)) {
    return "A root with this name already exists.";
  }
  return null;
}

export function PlaygroundView({ appId, onOpenManagedIssuer }: { appId: string; onOpenManagedIssuer?: () => void }) {
  return <FilePlayground key={appId} appId={appId} onOpenManagedIssuer={onOpenManagedIssuer} />;
}

function FilePlayground({ appId, onOpenManagedIssuer }: { appId: string; onOpenManagedIssuer?: () => void }) {
  const cacheSession = useContext(PlaygroundCacheContext);
  const [issuer, setIssuer] = useState<AppOAuthIssuer | null>(null);
  const [capability, setCapability] = useState<ManagedSpaceCapability | null>(null);
  const capabilityRef = useRef<ManagedSpaceCapability | null>(null);
  const capabilityRequestRef = useRef<Promise<ManagedSpaceCapability> | null>(null);
  const rootCache = useRef(new Map<string, TenantFileRoot>());
  const uploadInput = useRef<HTMLInputElement>(null);
  const [roots, setRoots] = useState<readonly TenantFileRootInfo[]>([]);
  const [selection, setSelection] = useState<string>("usage");
  const [openedRoot, setOpenedRoot] = useState<TenantFileRoot | null>(null);
  const [directory, setDirectory] = useState("/");
  const [entries, setEntries] = useState<readonly TenantFileStat[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);
  const [folderDraft, setFolderDraft] = useState<string | null>(null);
  const folderDraftAttempt = useRef<string | null>(null);
  const folderDraftCancelled = useRef(false);
  const [sort, setSort] = useState<{ column: "name" | "type" | "size"; descending: boolean }>({ column: "name", descending: false });
  const directories = useRef(new Map<string, string>());
  const runningRef = useRef(false);
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [rootDraft, setRootDraft] = useState("");
  const [rootDraftError, setRootDraftError] = useState<string | null>(null);
  const rootDraftRef = useRef<HTMLInputElement>(null);
  const rootDraftCancelledRef = useRef(false);
  const rootDraftCommitRef = useRef(false);
  const [usage, setUsage] = useState<CasUsage | null>(null);
  const [gcResult, setGcResult] = useState<CasGcResult | null>(null);
  const [gcMaxNodes, setGcMaxNodes] = useState("100");
  const [gcConfirmed, setGcConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (creatingRoot) rootDraftRef.current?.focus();
  }, [creatingRoot]);

  const catalog: TenantFileRootCatalog = {
    async list() {
      const response = await api<{ items: readonly TenantFileRootInfo[] }>(
        `/admin/apps/${encodeURIComponent(appId)}/playground/file-roots`,
      );
      return response.items;
    },
    create(input) {
      return api(`/admin/apps/${encodeURIComponent(appId)}/playground/file-roots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },
    update(input) {
      return api(`/admin/apps/${encodeURIComponent(appId)}/playground/file-roots/${encodeURIComponent(input.rootId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...ifMatch(input.revision) },
        body: JSON.stringify({ name: input.name, manifestHash: input.manifestHash }),
      });
    },
    async delete(input) {
      await api(`/admin/apps/${encodeURIComponent(appId)}/playground/file-roots/${encodeURIComponent(input.rootId)}`, {
        method: "DELETE",
        headers: ifMatch(input.revision),
      });
    },
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setCapability(null);
    capabilityRef.current = null;
    capabilityRequestRef.current = null;
    rootCache.current.clear();
    setOpenedRoot(null);
    setSelection("usage");
    setError(null);
    Promise.all([
      api<AppOAuthIssuer>(`/admin/apps/${encodeURIComponent(appId)}/managed-issuer`),
      catalog.list(),
    ]).then(([nextIssuer, nextRoots]) => {
      if (!active) return;
      setIssuer(nextIssuer);
      setRoots(nextRoots);
    }).catch((caught) => {
      if (active) setError(formatErrorSafe(caught));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [appId]);

  async function ensureCapability(): Promise<ManagedSpaceCapability> {
    if (capabilityRef.current && capabilityRef.current.expiresAt > Date.now()) return capabilityRef.current;
    if (capabilityRequestRef.current) return capabilityRequestRef.current;
    const request = api<ManagedSpaceCapability>(
      `/admin/apps/${encodeURIComponent(appId)}/managed-capabilities`,
      { method: "POST" },
    ).then((next) => {
      capabilityRef.current = next;
      setCapability(next);
      return next;
    }).finally(() => { capabilityRequestRef.current = null; });
    capabilityRequestRef.current = request;
    return request;
  }

  function clients(current: ManagedSpaceCapability) {
    const cas = createSpaceCasClient({
      baseUrl: new URL(current.audience).origin,
      appId,
      spaceId: current.spaceId,
      cache: cacheSession?.get(new URL(current.audience).origin),
      getToken: async () => {
        const current = await ensureCapability();
        return current.accessToken;
      },
      uploadMode: "legacy",
    });
    return { cas, files: createTenantFileSystem({ cas, catalog }) };
  }

  async function run(action: () => Promise<void>) {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  async function refreshRoots(): Promise<readonly TenantFileRootInfo[]> {
    const next = await catalog.list();
    for (const [rootId, cached] of rootCache.current) {
      const info = next.find((root) => root.rootId === rootId);
      if (!info || info.revision !== cached.info.revision || info.manifestHash !== cached.info.manifestHash) {
        rootCache.current.delete(rootId);
      }
    }
    setRoots(next);
    return next;
  }

  async function openRoot(rootId: string, force = false) {
    await run(async () => {
      if (force) {
        rootCache.current.delete(rootId);
        await refreshRoots();
      }
      let root = rootCache.current.get(rootId);
      if (!root) {
        const current = await ensureCapability();
        root = await clients(current).files.openRoot(rootId);
        rootCache.current.set(rootId, root);
      }
      let path = directories.current.get(rootId) ?? "/";
      try { await root.stat(path); } catch { path = "/"; }
      const nextEntries = await root.readdir(path);
      setSelection(rootId);
      setOpenedRoot(root);
      setDirectory(path);
      setSelectedPaths([]);
      setEntries(nextEntries);
      setFolderDraft(null);
    });
  }

  async function refreshFiles(root = openedRoot, path = directory) {
    if (!root) return;
    setEntries(await root.readdir(path));
    setDirectory(path);
    setFolderDraft(null);
    directories.current.set(root.info.rootId, path);
    setSelectedPaths([]);
  }

  async function commitRootDraft() {
    if (rootDraftCancelledRef.current) {
      rootDraftCancelledRef.current = false;
      return;
    }
    if (rootDraftCommitRef.current) return;
    const validationError = rootNameError(rootDraft, roots);
    if (validationError) {
      setRootDraftError(validationError);
      requestAnimationFrame(() => rootDraftRef.current?.focus());
      return;
    }
    const name = rootDraft.trim();
    rootDraftCommitRef.current = true;
    await run(async () => {
      const current = await ensureCapability();
      const root = await clients(current).files.createRoot(name);
      rootCache.current.set(root.info.rootId, root);
      setCreatingRoot(false);
      setRootDraft("");
      setRootDraftError(null);
      await refreshRoots();
      setSelection(root.info.rootId);
      setOpenedRoot(root);
      setDirectory("/");
      setEntries([]);
      setSelectedPaths([]);
    });
    rootDraftCommitRef.current = false;
  }

  async function commitMutation(mutate: (root: TenantFileRoot) => Promise<void>, onSuccess?: () => void) {
    if (!openedRoot) return;
    await run(async () => {
      try {
        await mutate(openedRoot);
        await openedRoot.commit();
      } catch (caught) {
        openedRoot.discard();
        rootCache.current.delete(openedRoot.info.rootId);
        throw caught;
      }
      await refreshRoots();
      await refreshFiles(openedRoot);
      onSuccess?.();
    });
  }

  async function downloadEntry(entry: TenantFileStat) {
    if (!openedRoot || entry.type === "directory") return;
    const stream = await openedRoot.read(entry.path);
    const url = URL.createObjectURL(await new Response(stream).blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = entry.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function entryName(value: string | null): string | null {
    if (value === null) return null;
    const name = value.trim();
    if (!name || name === "." || name === ".." || /[/\\\u0000-\u001f\u007f]/.test(name)) {
      setError("Enter a file or folder name without path separators or control characters.");
      return null;
    }
    return name;
  }

  async function createFolder() {
    if (folderDraftCancelled.current || runningRef.current || folderDraft === null) return;
    if (!folderDraft.trim()) { setFolderDraft(null); return; }
    if (folderDraftAttempt.current === folderDraft) return;
    folderDraftAttempt.current = folderDraft;
    const name = entryName(folderDraft);
    if (name && entries.some((entry) => entry.name === name)) {
      setError("A file or folder with this name already exists.");
      return;
    }
    if (name) await commitMutation((root) => root.mkdir(joinPath(directory, name)), () => setFolderDraft(null));
  }

  async function renameEntry() {
    const entry = entries.find((item) => selectedPaths.includes(item.path));
    if (!entry) return;
    const name = entryName(window.prompt("Name", entry.name));
    if (name && name !== entry.name) await commitMutation((root) => root.move(entry.path, joinPath(directory, name)));
  }

  async function transferEntries(operation: "copy" | "move") {
    const destination = window.prompt("Destination folder path", directory)?.trim();
    if (!destination) return;
    await commitMutation(async (root) => {
      const occupied = new Set((await root.readdir(destination)).map((entry) => entry.name));
      for (const entry of entries.filter((item) => selectedPaths.includes(item.path))) {
        let name = entry.name;
        if (operation === "copy" && occupied.has(name)) {
          const extensionIndex = entry.type === "file" ? name.lastIndexOf(".") : -1;
          const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
          const extension = extensionIndex > 0 ? name.slice(extensionIndex) : "";
          for (let copy = 1; occupied.has(name); copy += 1) {
            name = `${stem} copy${copy === 1 ? "" : ` ${copy}`}${extension}`;
          }
        }
        const target = joinPath(destination, name);
        if (target !== entry.path) await root[operation](entry.path, target);
        occupied.add(name);
      }
    });
  }

  async function renameRoot() {
    if (!openedRoot) return;
    const name = window.prompt("Root name", openedRoot.info.name)?.trim();
    if (!name || name === openedRoot.info.name) return;
    await commitMutation((root) => root.rename(name));
  }

  async function deleteRoot() {
    if (!openedRoot || !window.confirm(`Delete root "${openedRoot.info.name}"?`)) return;
    await run(async () => {
      const current = await ensureCapability();
      await clients(current).files.deleteRoot(openedRoot.info.rootId);
      rootCache.current.delete(openedRoot.info.rootId);
      directories.current.delete(openedRoot.info.rootId);
      await refreshRoots();
      setSelection("usage");
      setOpenedRoot(null);
      setEntries([]);
      setSelectedPaths([]);
    });
  }

  async function readUsage() {
    await run(async () => {
      const current = await ensureCapability();
      setUsage(await clients(current).cas.usage());
    });
  }

  async function collectGarbage() {
    if (!gcConfirmed) return;
    await run(async () => {
      const current = await ensureCapability();
      const { cas } = clients(current);
      setGcResult(await cas.gc({ maxNodes: Number(gcMaxNodes) }));
      setGcConfirmed(false);
      setUsage(await cas.usage());
    });
  }

  if (loading) {
    return (
      <div className="file-playground">
        <div className="flex items-center justify-center p-8">
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (!issuer) {
    return error ? (
      <div className="file-playground">
        <div className="state error" role="alert">
          <AlertCircle className="state-icon" size={18} />
          <span>{error}</span>
        </div>
      </div>
    ) : null;
  }

  if (issuer.status !== "active") return (
    <section aria-label="Playground unavailable">
      <h2>Managed issuer required</h2>
      <p className="hint">Playground needs a short-lived Space capability from the managed issuer. Your admin session alone does not grant access to Space data.</p>
      {onOpenManagedIssuer ? <Button size="sm" onClick={onOpenManagedIssuer}><ChevronRight size={16} />Go to managed issuer settings</Button> : null}
    </section>
  );

  const selectedEntries = entries.filter((entry) => selectedPaths.includes(entry.path));
  const sortedEntries = [...entries].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    const order = sort.column === "size" ? (left.size ?? 0) - (right.size ?? 0)
      : sort.column === "type" ? (left.mediaType ?? "").localeCompare(right.mediaType ?? "")
        : left.name.localeCompare(right.name, undefined, { numeric: true });
    return (sort.descending ? -1 : 1) * order;
  });

  return (
    <div className="file-playground">
      <aside className="file-root-list" aria-label="File roots">
        <div className="file-root-list-header">
          <div>
            <strong>File roots</strong>
            <span>{roots.length}</span>
            <Button
              variant="ghost"
              size="icon"
              className="file-root-add"
              type="button"
              aria-label="Create root"
              title="Create root"
              disabled={running || creatingRoot}
              onClick={() => {
                rootDraftCancelledRef.current = false;
                setRootDraft("");
                setRootDraftError(null);
                setCreatingRoot(true);
              }}
            >
              <Plus size={15} />
            </Button>
          </div>
          {creatingRoot ? (
            <div className="file-root-inline-editor">
              <HardDrive size={16} />
              <Input
                ref={rootDraftRef}
                aria-label="New root name"
                aria-invalid={rootDraftError ? true : undefined}
                value={rootDraft}
                maxLength={120}
                placeholder="Untitled root"
                onChange={(event) => {
                  setRootDraft(event.target.value);
                  setRootDraftError(null);
                }}
                onBlur={() => void commitRootDraft()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    rootDraftCancelledRef.current = true;
                    setCreatingRoot(false);
                    setRootDraft("");
                    setRootDraftError(null);
                  }
                }}
              />
              {rootDraftError ? <span role="alert">{rootDraftError}</span> : null}
            </div>
          ) : null}
        </div>
        <nav className="file-root-nav">
          {roots.map((root) => (
            <Button variant="ghost" key={root.rootId} type="button" disabled={running} aria-current={selection === root.rootId ? "true" : undefined} className={selection === root.rootId ? "active" : ""} onClick={() => void openRoot(root.rootId)}>
              <HardDrive size={16} /><span>{root.name}</span><small>r{root.revision}</small>
            </Button>
          ))}
          {roots.length === 0 ? <p className="muted file-root-empty">No roots yet.</p> : null}
          <Button variant="ghost" type="button" disabled={running} className={selection === "usage" ? "active" : ""} onClick={() => { setSelection("usage"); setOpenedRoot(null); }}>
            <Activity size={16} /><span>Usage</span>
          </Button>
        </nav>
      </aside>

      <section className="file-detail">
        {selection === "usage" ? (
          <div className="file-usage">
            <h2>Space usage</h2>
            <Button size="sm" onClick={() => void readUsage()} disabled={running}>
              <RefreshCw size={15} />
              Refresh usage
            </Button>
            {usage ? (
              <Card className="playground-metrics-card">
                <CardContent className="pt-6">
                  <dl className="playground-metrics">
                    <div><dt>Nodes</dt><dd>{usage.nodeCount}</dd></div>
                    <div><dt>Content</dt><dd>{formatBytes(usage.readyContentBytes)}</dd></div>
                    <div><dt>Stored</dt><dd>{formatBytes(usage.readyStoredBytes)}</dd></div>
                    <div><dt>Reserved</dt><dd>{formatBytes(usage.reservedBytes)}</dd></div>
                    <div><dt>Not ready</dt><dd>{usage.notReadyNodeCount}</dd></div>
                    <div><dt>Leased</dt><dd>{usage.leasedNodeCount}</dd></div>
                  </dl>
                </CardContent>
              </Card>
            ) : null}
            <section className="playground-tool-section" aria-labelledby="playground-gc-title">
              <h3 id="playground-gc-title">Garbage collection</h3>
              <div className="field-row">
                <label htmlFor="playground-gc-limit">Maximum nodes to examine</label>
                <Input id="playground-gc-limit" type="number" min="1" value={gcMaxNodes} onChange={(event) => setGcMaxNodes(event.target.value)} />
              </div>
              <label className="playground-check"><Checkbox checked={gcConfirmed} onCheckedChange={checked => setGcConfirmed(checked === true)} /> I understand that unreferenced, expired nodes may be deleted</label>
              <Button variant="destructive" size="sm" onClick={() => void collectGarbage()} disabled={!gcConfirmed || running || !Number.isSafeInteger(Number(gcMaxNodes)) || Number(gcMaxNodes) < 1}>
                <Trash2 size={15} />
                Run garbage collection
              </Button>
              {gcResult ? <p className="playground-result">Examined {gcResult.examined}, deleted {gcResult.deleted}, reclaimed {formatBytes(gcResult.reclaimedContentBytes)}.</p> : null}
            </section>
          </div>
        ) : openedRoot ? (
          <div className="file-explorer" aria-busy={running}>
            <div className="file-pathbar">
              <Button variant="ghost" size="icon" type="button" className="file-icon-button" title="Parent folder" aria-label="Parent folder" disabled={running || directory === "/"} onClick={() => void run(() => refreshFiles(openedRoot, parentPath(directory)))}><ArrowUp size={16} /></Button>
              <nav className="file-breadcrumbs" aria-label="Folder path">
                <Button variant="ghost" size="sm" type="button" disabled={running} aria-current={directory === "/" ? "page" : undefined} onClick={() => void run(() => refreshFiles(openedRoot, "/"))}><HardDrive size={16} /><span>{openedRoot.info.name}</span></Button>
                {directory.split("/").filter(Boolean).map((segment, index, parts) => (
                  <span key={parts.slice(0, index + 1).join("/")}>
                    <ChevronRight size={14} />
                    <Button variant="ghost" size="sm" type="button" disabled={running} aria-current={index === parts.length - 1 ? "page" : undefined} onClick={() => void run(() => refreshFiles(openedRoot, `/${parts.slice(0, index + 1).join("/")}`))}>{segment}</Button>
                  </span>
                ))}
              </nav>
              <Button variant="ghost" size="icon" type="button" className="file-icon-button" title="Refresh files" aria-label="Refresh files" disabled={running} onClick={() => void openRoot(openedRoot.info.rootId, true)}><RefreshCw size={16} className={running ? "file-refreshing" : undefined} /></Button>
              <Button variant="ghost" size="icon" type="button" className="file-icon-button" title="Rename root" aria-label="Rename root" disabled={running} onClick={() => void renameRoot()}><Pencil size={16} /></Button>
              <Button variant="ghost" size="icon" type="button" className="file-icon-button file-danger" title="Delete root" aria-label="Delete root" disabled={running} onClick={() => void deleteRoot()}><Trash2 size={16} /></Button>
            </div>
            <div className="file-toolbar" role="toolbar" aria-label="File actions">
              <Button size="sm" disabled={running || folderDraft !== null} onClick={() => { setError(null); setSelectedPaths([]); folderDraftAttempt.current = null; folderDraftCancelled.current = false; setFolderDraft(""); }}>
                <FolderPlus size={16} />
                New folder
              </Button>
              <Button variant="outline" size="sm" disabled={running} onClick={() => uploadInput.current?.click()}><Upload size={15} />Upload</Button>
              <input ref={uploadInput} hidden aria-label="Upload files" type="file" multiple onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.some((file) => entries.some((entry) => entry.name === file.name)) && !window.confirm("Replace existing files with the same names?")) {
                  event.target.value = "";
                  return;
                }
                void commitMutation(async (root) => {
                  for (const file of files) {
                    await root.write(joinPath(directory, file.name), file, {
                      contentType: file.type || "application/octet-stream",
                      size: file.size,
                    });
                  }
                });
                event.target.value = "";
              }} disabled={running} />
              <span className="file-toolbar-divider" />
              <Button variant="ghost" size="icon" type="button" className="file-icon-button" title="Download selected files" aria-label="Download selected files" disabled={running || !selectedEntries.length || selectedEntries.some((entry) => entry.type === "directory")} onClick={() => void run(async () => { for (const entry of selectedEntries) await downloadEntry(entry); })}><Download size={16} /></Button>
              <Button variant="ghost" size="icon" type="button" className="file-icon-button" title="Rename selected item" aria-label="Rename selected item" disabled={running || selectedEntries.length !== 1} onClick={() => void renameEntry()}><Pencil size={16} /></Button>
              <Button variant="ghost" size="icon" type="button" className="file-icon-button" title="Copy selected items" aria-label="Copy selected items" disabled={running || !selectedEntries.length} onClick={() => void transferEntries("copy")}><Copy size={16} /></Button>
              <Button variant="ghost" size="icon" type="button" className="file-icon-button" title="Move selected items" aria-label="Move selected items" disabled={running || !selectedEntries.length} onClick={() => void transferEntries("move")}><Move size={16} /></Button>
              <Button variant="ghost" size="icon" type="button" className="file-icon-button file-danger" title="Delete selected items" aria-label="Delete selected items" disabled={running || !selectedEntries.length} onClick={() => {
                if (window.confirm(`Delete ${selectedEntries.length} selected item(s)?`)) void commitMutation(async (root) => { for (const entry of selectedEntries) await root.remove(entry.path); });
              }}><Trash2 size={16} /></Button>
            </div>
            <div className="file-table-scroll">
              <Table className="file-table" aria-label="Folder contents">
                <TableHeader>
                  <TableRow>
                    <TableHead className="file-selection">
                      <Checkbox aria-label="Select all items" disabled={running || !entries.length} checked={entries.length > 0 && selectedPaths.length === entries.length ? true : selectedPaths.length > 0 ? "indeterminate" : false} onCheckedChange={checked => setSelectedPaths(checked === true ? entries.map((entry) => entry.path) : [])} />
                    </TableHead>
                    {(["name", "type", "size"] as const).map((column) => (
                      <TableHead key={column} className={`file-column-${column}`} aria-sort={sort.column === column ? sort.descending ? "descending" : "ascending" : "none"}>
                        <Button variant="ghost" size="sm" type="button" onClick={() => setSort({ column, descending: sort.column === column && !sort.descending })}>
                          {column === "name" ? "Name" : column === "type" ? "Type" : "Size"}
                          {sort.column === column ? <ArrowUp size={12} style={{ transform: sort.descending ? "rotate(180deg)" : undefined }} /> : null}
                        </Button>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {folderDraft !== null ? (
                    <TableRow aria-label="New folder" aria-busy={running}>
                      <TableCell className="file-selection" />
                      <TableCell>
                        <div className="file-folder-draft">
                          <Folder size={17} />
                          <Input
                            autoFocus
                            aria-label="Folder name"
                            aria-invalid={Boolean(error)}
                            placeholder="Folder name"
                            value={folderDraft}
                            disabled={running}
                            onChange={(event) => { folderDraftAttempt.current = null; setError(null); setFolderDraft(event.target.value); }}
                            onBlur={() => void createFolder()}
                            onKeyDown={(event) => {
                              if (event.nativeEvent.isComposing) return;
                              if (event.key === "Enter") { event.preventDefault(); folderDraftAttempt.current = null; void createFolder(); }
                              if (event.key === "Escape" && !runningRef.current) {
                                event.preventDefault();
                                folderDraftCancelled.current = true;
                                setFolderDraft(null);
                                setError(null);
                              }
                            }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="file-column-type">Folder</TableCell>
                      <TableCell className="file-column-size">-</TableCell>
                    </TableRow>
                  ) : null}
                  {sortedEntries.map((entry) => (
                    <TableRow key={entry.path} aria-selected={selectedPaths.includes(entry.path)}>
                      <TableCell className="file-selection">
                        <Checkbox aria-label={`Select ${entry.name}`} disabled={running} checked={selectedPaths.includes(entry.path)} onCheckedChange={checked => setSelectedPaths(checked === true ? [...selectedPaths, entry.path] : selectedPaths.filter((path) => path !== entry.path))} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" type="button" className="file-entry" title={entry.type === "directory" ? `Open ${entry.name}` : `Download ${entry.name}`} disabled={running} onClick={() => void run(() => entry.type === "directory" ? refreshFiles(openedRoot, entry.path) : downloadEntry(entry))}>
                          {entry.type === "directory" ? <Folder size={17} /> : <File size={17} />}
                          <span>{entry.name}</span>
                        </Button>
                      </TableCell>
                      <TableCell className="file-column-type" title={entry.mediaType}>
                        {entry.type === "directory" ? "Folder" : entry.mediaType ?? "File"}
                      </TableCell>
                      <TableCell className="file-column-size">
                        {entry.type === "file" && entry.size !== undefined ? formatBytes(entry.size) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!entries.length && folderDraft === null ? <div className="file-empty"><Folder size={30} /><p>This folder is empty.</p></div> : null}
            </div>
            <div className="file-list-status" role="status">{running ? "Working..." : `${entries.length} item${entries.length === 1 ? "" : "s"}${selectedPaths.length ? ` / ${selectedPaths.length} selected` : ""}`}</div>
          </div>
        ) : (
          <div className="flex items-center justify-center p-8">
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {capability ? <p className="file-capability-status">Personal Space <code>{capability.spaceId}</code></p> : null}
        {error ? (
          <div className="state error" role="alert">
            <AlertCircle className="state-icon" size={18} />
            <span>{error}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
