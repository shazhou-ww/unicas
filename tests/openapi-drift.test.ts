import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  generateAdminOpenApiDocument,
  generateAppAdminOpenApiDocument,
} from "../packages/admin-protocol/scripts/openapi.js";
import {
  generateSpaceOpenApiDocument,
  generateTenantOpenApiDocument,
} from "../packages/tenant-protocol/scripts/openapi.js";

const ROOT = join(import.meta.dirname, "..");

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(ROOT, path), "utf8"));
}

function jsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("generated OpenAPI documents", () => {
  test("admin document is current", async () => {
    expect(jsonValue(await generateAdminOpenApiDocument())).toEqual(
      await readJson("packages/admin-protocol/openapi/admin-v1.openapi.json"),
    );
  });

  test("App admin v2 document is current", async () => {
    expect(jsonValue(await generateAppAdminOpenApiDocument())).toEqual(
      await readJson("packages/admin-protocol/openapi/admin-v2.openapi.json"),
    );
  });

  test("tenant document is current", async () => {
    expect(jsonValue(await generateTenantOpenApiDocument())).toEqual(
      await readJson("packages/tenant-protocol/openapi/tenant-v1.openapi.json"),
    );
  });

  test("Space v2 document is current", async () => {
    expect(jsonValue(await generateSpaceOpenApiDocument())).toEqual(
      await readJson("packages/tenant-protocol/openapi/space-v2.openapi.json"),
    );
  });
});