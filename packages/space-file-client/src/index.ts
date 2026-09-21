export {
  FileManifestContentType,
  FileManifestMaxEntries,
  FileManifestMaxFiles,
  FileManifestMaxPathBytes,
  FileManifestVersion,
} from "./file-protocol.js";
export type {
  SpaceDirectoryEntry,
  SpaceFileEntry,
  SpaceFileManifestEntry,
  SpaceFileManifestV1,
} from "./file-protocol.js";
export {
  createFileManifest,
  decodeFileManifest,
  encodeFileManifest,
  fileManifestRefs,
  validateFileManifest,
} from "./file-manifest.js";
export { createSpaceFileSystem } from "./file-client.js";
export type {
  SpaceFileRoot,
  SpaceFileRootCatalog,
  SpaceFileRootInfo,
  SpaceFileStat,
  SpaceFileSystem,
  SpaceFileSystemOptions,
  SpaceFileWriteOptions,
} from "./types.js";