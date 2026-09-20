import { describe, expect, test } from "vitest";
import {
  CanonicalUploadContentType,
  R2UploadPresigner,
} from "../src/r2-upload-presigner.js";

const presigner = () => new R2UploadPresigner({
  accountId: "account-id",
  bucketName: "cas-bucket",
  accessKeyId: "access-key-id",
  secretAccessKey: "secret-access-key",
  expiresInSeconds: 300,
  now: () => 1_000,
});

describe("R2UploadPresigner", () => {
  test("signs a short-lived, write-once canonical PUT without a declared length", async () => {
    const upload = await presigner().signPut("_uploads/v2/a b");
    const url = new URL(upload.url);

    expect(upload.method).toBe("PUT");
    expect(url.origin).toBe("https://account-id.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/cas-bucket/_uploads/v2/a%20b");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;if-none-match",
    );
    expect(upload.expiresAt).toBe(301_000);
    expect(upload.headers).toEqual({
      "Content-Type": CanonicalUploadContentType,
      "If-None-Match": "*",
    });
    expect(upload.url).not.toContain("secret-access-key");
  });

  test("rejects invalid expiry and keys", async () => {
    expect(() => new R2UploadPresigner({
      accountId: "account-id",
      bucketName: "cas-bucket",
      accessKeyId: "access-key-id",
      secretAccessKey: "secret-access-key",
      expiresInSeconds: 0,
    })).toThrow("expiry");
    await expect(presigner().signPut("_uploads//bad")).rejects.toThrow("key segment");
  });
});