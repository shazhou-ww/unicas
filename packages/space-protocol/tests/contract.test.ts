import type { ContractRouterClient } from "@orpc/contract";
import { describe, expect, expectTypeOf, test } from "vitest";
import type { AppId, CasUsage, Space, SpaceId } from "../src/index.js";
import {
  AppIdSchema,
  CasHashSchema,
  CasRootRefUpdateSchema,
  SpaceIdSchema,
  SpaceSchema,
} from "../src/index.js";
import { casTenantApiContract } from "../src/v1.js";
import {
  generateSpaceOpenApiDocument,
  generateV1OpenApiDocument,
} from "../scripts/openapi.js";

describe("CAS frozen-v1 schemas", () => {
  test("validates hashes and signed Root Ref changes", () => {
    expect(CasHashSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(CasHashSchema.safeParse("ABC").success).toBe(false);
    expect(CasRootRefUpdateSchema.safeParse({
      requestId: "commit-1",
      changes: { ["a".repeat(64)]: -1 },
    }).success).toBe(true);
  });

  test("exposes a client type derived from the contract", () => {
    type Client = ContractRouterClient<typeof casTenantApiContract>;
    type Usage = Awaited<ReturnType<Client["operations"]["getUsage"]>>;
    expectTypeOf<Usage>().toEqualTypeOf<CasUsage>();
  });

  test("defines App and Space scope identity without catalog metadata", () => {
    const appId: AppId = "app-1";
    const spaceId: SpaceId = "space-1";
    const space: Space = { appId, spaceId };
    expect(AppIdSchema.safeParse(appId).success).toBe(true);
    expect(SpaceIdSchema.safeParse(spaceId).success).toBe(true);
    expect(SpaceSchema.safeParse(space)).toMatchObject({ success: true });
    expect(SpaceSchema.safeParse({ stackId: appId, tenantId: spaceId }).success).toBe(false);
  });
});

describe("CAS frozen-v1 OpenAPI", () => {
  test("describes every operation and embeds the specification in HTML", async () => {
    const document = await generateV1OpenApiDocument();
    const operationIds = Object.values(document.paths ?? {}).flatMap((item) =>
      [item?.get, item?.post, item?.put, item?.patch, item?.delete]
        .flatMap((operation) => operation?.operationId ? [operation.operationId] : []),
    );

    expect(document.openapi).toBe("3.1.1");
    expect(Object.keys(document.paths ?? {})).toHaveLength(6);
    expect(operationIds).toHaveLength(7);
    expect(document.security).toEqual([{ tenantCapability: [] }]);
    expect(document.info.description).toContain("## Node lifecycle");
    expect(document.info.description).toContain("## Root Ref commit");
    expect(document.paths?.["/stacks/{stackId}/tenants/{tenantId}/cas/nodes/{hash}/lease"]?.post?.description)
      .toContain("direct `PUT` upload");
    expect(document.paths?.["/stacks/{stackId}/tenants/{tenantId}/root-refs"]?.post?.description)
      .toContain("business commit boundary");
    expect(document.paths?.["/stacks/{stackId}/tenants/{tenantId}/cas/usage"]?.get)
      .toHaveProperty(
        "responses.200.content.application/json.schema.properties.reservedBytes.description",
      );
  });

  test("generates the released App/Space v1 document", async () => {
    const document = await generateSpaceOpenApiDocument();
    const serialized = JSON.stringify(document);
    const operationIds = Object.values(document.paths ?? {}).flatMap((item) =>
      [item?.get, item?.post, item?.put, item?.patch, item?.delete]
        .flatMap((operation) => operation?.operationId ? [operation.operationId] : []),
    );

    expect(Object.keys(document.paths ?? {})).toHaveLength(6);
    expect(operationIds).toHaveLength(7);
    expect(document.security).toEqual([{ spaceCapability: [] }]);
    expect(document.servers).toEqual([
      { url: "https://api.unicas.work", description: "Production" },
    ]);
    expect(document.info.version).toBe("1.0.0");
    expect(operationIds).toEqual([
      "readContent",
      "readMetadata",
      "leaseNode",
      "getUsage",
      "runGc",
      "listRootRefs",
      "updateRootRefs",
    ]);
    expect(document.paths?.["/v1/apps/{appId}/spaces/{spaceId}/cas/usage"]?.get)
      .toHaveProperty("operationId", "getUsage");
    expect(document.paths?.["/v2/apps/{appId}/spaces/{spaceId}/cas/usage"]).toBeUndefined();
    const lease = document.paths?.["/v1/apps/{appId}/spaces/{spaceId}/cas/nodes/{hash}/lease"]?.post;
    const leaseJson = JSON.stringify(lease);
    expect(lease?.parameters?.filter((parameter) => "in" in parameter && parameter.in === "header"))
      .toEqual([]);
    expect(lease).toHaveProperty("requestBody.required", true);
    expect(leaseJson).toContain("leaseDurationMs");
    expect(leaseJson).toContain("awaiting_upload");
    expect(leaseJson).toContain("awaiting_replacement_upload");
    expect(leaseJson).toContain("validated_awaiting_children");
    expect(leaseJson).toContain("ready");
    expect(leaseJson).not.toContain("uploadId");
    expect(leaseJson).not.toContain("x-cas-upload");
    const updateJson = JSON.stringify(
      document.paths?.["/v1/apps/{appId}/spaces/{spaceId}/root-refs"]?.post,
    );
    expect(updateJson).toContain('"minProperties":1');
    expect(updateJson).toContain('"maxProperties":1000');
    expect(updateJson).toContain('"minimum":-1000000');
    expect(updateJson).toContain('"maximum":1000000');
    expect(updateJson).toContain('"not":{"const":0}');
    expect(serialized).not.toContain("stackId");
    expect(serialized).not.toContain("tenantId");
    expect(serialized).not.toContain("Tenant");
  });
});