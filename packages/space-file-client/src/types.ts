import type {
  CasBlobClientOptions,
  CasBlobSource,
  CasBlobWriteOptions,
} from "@unicas/space-blob-client";
import type { SpaceCasClient } from "@unicas/space-client";

export interface SpaceFileRootInfo {
  readonly rootId: string;
  readonly name: string;
  readonly manifestHash: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Business-database port. Implementations persist root identity, not file data. */
export interface SpaceFileRootCatalog {
  list(): Promise<readonly SpaceFileRootInfo[]>;
  create(input: { readonly rootId: string; readonly name: string; readonly manifestHash: string }): Promise<SpaceFileRootInfo>;
  update(input: { readonly rootId: string; readonly revision: number; readonly name: string; readonly manifestHash: string }): Promise<SpaceFileRootInfo>;
  delete(input: { readonly rootId: string; readonly revision: number }): Promise<void>;
}

export interface SpaceFileStat {
  readonly path: string;
  readonly name: string;
  readonly type: "file" | "directory";
  readonly size?: number;
  readonly mediaType?: string;
}

export interface SpaceFileWriteOptions extends CasBlobWriteOptions { }

/** Mutable in-memory view of one immutable manifest snapshot. */
export interface SpaceFileRoot {
  readonly info: SpaceFileRootInfo;
  readonly dirty: boolean;
  stat(path: string): Promise<SpaceFileStat>;
  readdir(path: string): Promise<readonly SpaceFileStat[]>;
  read(path: string, range?: { readonly offset: number; readonly length?: number }, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  write(path: string, source: CasBlobSource, options: SpaceFileWriteOptions): Promise<void>;
  mkdir(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(name: string): Promise<void>;
  commit(): Promise<SpaceFileRootInfo>;
  discard(): void;
}

export interface SpaceFileSystem {
  listRoots(): Promise<readonly SpaceFileRootInfo[]>;
  createRoot(name: string): Promise<SpaceFileRoot>;
  openRoot(rootId: string): Promise<SpaceFileRoot>;
  deleteRoot(rootId: string): Promise<void>;
}

export interface SpaceFileSystemOptions {
  readonly cas: SpaceCasClient;
  readonly catalog: SpaceFileRootCatalog;
  readonly blobOptions?: CasBlobClientOptions;
  readonly createId?: () => string;
  readonly createRequestId?: () => string;
}