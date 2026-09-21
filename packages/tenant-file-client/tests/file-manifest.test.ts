import { describe, expect, test } from "vitest";
import { createFileManifest, decodeFileManifest, encodeFileManifest, fileManifestRefs } from "../src/index.js";

describe("file manifest protocol", () => {
  test("canonicalizes paths and assigns file ref ordinals", () => {
    const manifest = createFileManifest([
      { type: "file", path: "notes/todo.txt", ref: 99, size: 4, mediaType: "text/plain" },
      { type: "directory", path: "empty" },
      { type: "file", path: "avatar.png", ref: 99, size: 8, mediaType: "image/png" },
      { type: "file", path: "B.txt", ref: 99, size: 2, mediaType: "text/plain" },
    ]);
    expect(manifest.entries).toEqual([
      { type: "file", path: "B.txt", ref: 0, size: 2, mediaType: "text/plain" },
      { type: "file", path: "avatar.png", ref: 1, size: 8, mediaType: "image/png" },
      { type: "directory", path: "empty" },
      { type: "file", path: "notes/todo.txt", ref: 2, size: 4, mediaType: "text/plain" },
    ]);
    expect(decodeFileManifest(encodeFileManifest(manifest))).toEqual(manifest);
    expect(fileManifestRefs(manifest, ["a", "b", "c"])).toEqual(new Map([
      ["B.txt", "a"],
      ["avatar.png", "b"],
      ["notes/todo.txt", "c"],
    ]));
  });

  test("rejects unsafe and structurally ambiguous paths", () => {
    expect(() => createFileManifest([{ type: "directory", path: "../escape" }])).toThrow("Invalid file path");
    expect(() => createFileManifest([
      { type: "file", path: "docs", ref: 0, size: 1, mediaType: "text/plain" },
      { type: "file", path: "docs/readme", ref: 1, size: 1, mediaType: "text/plain" },
    ])).toThrow("descends from file");
  });

  test("rejects non-canonical CBOR", () => {
    const canonical = encodeFileManifest(createFileManifest([]));
    const nonCanonical = Uint8Array.from([0xa2, 0x61, 0x76, 0x18, 0x01, 0x61, 0x65, 0x80]);
    expect(nonCanonical).not.toEqual(canonical);
    expect(() => decodeFileManifest(nonCanonical)).toThrow("not canonical");
  });
});