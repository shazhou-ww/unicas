import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  generateAppAdminOpenApiDocument,
} from "../packages/admin-protocol/scripts/openapi.js";
import {
  generateSpaceOpenApiDocument,
  generateTenantOpenApiDocument,
} from "../packages/space-protocol/scripts/openapi.js";

const ROOT = join(import.meta.dirname, "..");

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(ROOT, path), "utf8"));
}

function jsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("generated OpenAPI documents", () => {
  test("App admin v2 document is current", async () => {
    expect(jsonValue(await generateAppAdminOpenApiDocument())).toEqual(
      await readJson("packages/admin-protocol/openapi/admin-v2.openapi.json"),
    );
  });

  test("tenant document is current", async () => {
    expect(jsonValue(await generateTenantOpenApiDocument())).toEqual(
      await readJson("packages/space-protocol/openapi/tenant-v1.openapi.json"),
    );
  });

  test("Space v2 document is current", async () => {
    expect(jsonValue(await generateSpaceOpenApiDocument())).toEqual(
      await readJson("packages/space-protocol/openapi/space-v2.openapi.json"),
    );
  });
});