export type EntryType = "directory" | "file";

export interface FileEntry {
  readonly path: string;
  readonly name: string;
  readonly type: EntryType;
  readonly size?: number;
  readonly mediaType?: string;
}

export interface DirectoryResult {
  readonly path: string;
  readonly revision: number;
  readonly entries: readonly FileEntry[];
}

export interface SessionResult {
  readonly principal: {
    readonly id: string;
    readonly displayName: string;
    readonly provider: "google" | "microsoft" | "github" | "smoke";
  };
}

export interface MutationResult {
  readonly revision: number;
  readonly rootRetained: true;
  readonly entry?: FileEntry;
}

export class SpacesApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly correlationId: string | null,
    message: string,
  ) {
    super(message);
  }
}

export class SpacesApi {
  async session(signal?: AbortSignal): Promise<SessionResult> {
    return this.#json("/api/session", { signal });
  }

  async list(path: string, signal?: AbortSignal): Promise<DirectoryResult> {
    return this.#json(`/api/entries?path=${encodeURIComponent(path)}`, { signal });
  }

  async createFolder(input: {
    readonly parentPath: string;
    readonly name: string;
    readonly revision: number;
  }): Promise<MutationResult> {
    return this.#json("/api/folders", {
      method: "POST",
      headers: this.#mutationHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
  }

  async upload(input: {
    readonly parentPath: string;
    readonly file: File;
    readonly revision: number;
    readonly signal?: AbortSignal;
  }): Promise<MutationResult> {
    const body = new FormData();
    body.set("parentPath", input.parentPath);
    body.set("revision", String(input.revision));
    body.set("file", input.file);
    return this.#json("/api/files", {
      method: "POST",
      headers: this.#mutationHeaders(),
      body,
      signal: input.signal,
    });
  }

  async rename(input: {
    readonly path: string;
    readonly name: string;
    readonly revision: number;
  }): Promise<MutationResult> {
    return this.#json("/api/files", {
      method: "PATCH",
      headers: this.#mutationHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
  }

  async deleteFile(path: string, revision: number): Promise<void> {
    await this.#response(`/api/files?path=${encodeURIComponent(path)}&revision=${revision}`, {
      method: "DELETE",
      headers: this.#mutationHeaders(),
    });
  }

  downloadUrl(path: string): string {
    return `/api/files/content?path=${encodeURIComponent(path)}`;
  }

  async logout(): Promise<void> {
    await this.#response("/auth/logout", {
      method: "POST",
      headers: this.#mutationHeaders(),
    });
  }

  #mutationHeaders(initial?: HeadersInit): Headers {
    const headers = new Headers(initial);
    const csrfToken = readCookie("__Host-spaces-csrf");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
    return headers;
  }

  async #json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.#response(url, init);
    return response.json() as Promise<T>;
  }

  async #response(url: string, init: RequestInit): Promise<Response> {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...init,
    });
    if (response.ok) return response;
    const body = await response.json().catch(() => null) as {
      error?: { code?: unknown; message?: unknown; correlationId?: unknown };
    } | null;
    throw new SpacesApiError(
      response.status,
      typeof body?.error?.code === "string" ? body.error.code : "request_failed",
      typeof body?.error?.correlationId === "string" ? body.error.correlationId : null,
      typeof body?.error?.message === "string" ? body.error.message : "Request failed",
    );
  }
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}