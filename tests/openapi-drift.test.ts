import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  generateAppAdminOpenApiDocument,
} from "../packages/admin-protocol/scripts/openapi.js";
import {
  generateSpaceOpenApiDocument,
} from "../packages/space-protocol/scripts/openapi.js";
import {
  SpaceCapabilityClaimsSchema,
} from "../packages/space-protocol/src/space-capability.js";

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

  test("App/Space v1 document is current", async () => {
    expect(jsonValue(await generateSpaceOpenApiDocument())).toEqual(
      await readJson("packages/space-protocol/openapi/app-space-v1.openapi.json"),
    );
  });

  test("embeds capability claims inline without changing runtime schema metadata", async () => {
    const document = await generateSpaceOpenApiDocument();
    const claims = document.components?.schemas?.SpaceCapabilityClaims;
    expect(claims).toMatchObject({ type: "object" });
    expect(claims).not.toHaveProperty("$ref");
    expect(claims).not.toHaveProperty("$defs");
    expect(SpaceCapabilityClaimsSchema.meta()?.id).toBe("SpaceCapabilityClaims");
  });
});