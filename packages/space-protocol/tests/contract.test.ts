import type {
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import { describe, expect, test } from "vitest";
import type { AppId, Space, SpaceId } from "../src/index.js";
import {
  AppIdSchema,
  CasHashSchema,
  CasRootRefUpdateSchema,
  SpaceOperationPolicies,
  SpaceIdSchema,
  SpaceSchema,
  spaceApiContract,
} from "../src/index.js";
import { generateSpaceOpenApiDocument } from "../scripts/openapi.js";

describe("CAS schemas", () => {
  test("validates hashes and signed Root Ref changes", () => {
    expect(CasHashSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(CasHashSchema.safeParse("ABC").success).toBe(false);
    expect(CasRootRefUpdateSchema.safeParse({
      requestId: "commit-1",
      changes: { ["a".repeat(64)]: -1 },
    }).success).toBe(true);
  });

  test("defines App and Space scope identity without catalog metadata", () => {
    const appId: AppId = "app-1";
    const spaceId: SpaceId = "/space-1";
    const space: Space = { appId, spaceId };
    expect(AppIdSchema.safeParse(appId).success).toBe(true);
    expect(SpaceIdSchema.safeParse(spaceId).success).toBe(true);
    expect(SpaceIdSchema.safeParse("space-1").success).toBe(false);
    expect(SpaceIdSchema.safeParse("/space/with.dot").success).toBe(false);
    expect(SpaceSchema.safeParse(space)).toMatchObject({ success: true });
    expect(SpaceSchema.safeParse({ stackId: appId, tenantId: spaceId }).success).toBe(false);
  });
});

describe("CAS App/Space v1 OpenAPI", () => {
  test("models readContent query scope and byte range input", () => {
    type Inputs = InferContractRouterInputs<typeof spaceApiContract>;
    type Outputs = InferContractRouterOutputs<typeof spaceApiContract>;
    const input: Inputs["nodes"]["readContent"] = {
      params: { hash: "a".repeat(64) },
      query: { appId: "app-1", spaceId: "/space-1" },
      headers: { Range: "bytes=0-99" },
    };
    const output: Outputs["nodes"]["readContent"] = new ReadableStream<Uint8Array>();

    expect(input.headers).toEqual({ Range: "bytes=0-99" });
    expect(output).toBeInstanceOf(ReadableStream);
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
    expect(document.paths?.["/v1/cas/usage"]?.get)
      .toHaveProperty("operationId", "getUsage");
    expect(document.paths?.["/v2/apps/{appId}/spaces/{spaceId}/cas/usage"]).toBeUndefined();
    expect(document.paths?.["/v1/apps/{appId}/cas/usage"]).toBeUndefined();
    const usage = document.paths?.["/v1/cas/usage"]?.get;
    expect(usage?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ in: "query", name: "appId", required: true }),
      expect.objectContaining({ in: "query", name: "spaceId", required: true }),
    ]));
    const readContent = document.paths
      ?.["/v1/cas/nodes/{hash}"]?.get;
    expect(readContent?.parameters?.find(parameter =>
      "in" in parameter && parameter.in === "header"
    )).toMatchObject({
      name: "Range",
      required: undefined,
      schema: {
        type: "string",
        pattern: "^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$",
      },
    });
    for (const status of ["200", "206"] as const) {
      expect(readContent?.responses?.[status]).toMatchObject({
        content: {
          "application/vnd.unidocs.cas-node.v1": {
            schema: {
              type: "string",
              contentMediaType: "application/vnd.unidocs.cas-node.v1",
              contentEncoding: "binary",
            },
          },
        },
      });
      expect(readContent?.responses?.[status]).toHaveProperty("headers.Accept-Ranges.required", true);
      expect(readContent?.responses?.[status]).toHaveProperty("headers.Content-Length.required", true);
      expect(readContent?.responses?.[status]).toHaveProperty("headers.Content-Type.required", true);
      expect(readContent?.responses?.[status]).toHaveProperty("headers.X-CAS-Refs.required", true);
    }
    expect(readContent?.responses?.["206"]).toHaveProperty("headers.Content-Range.required", true);
    expect(readContent?.responses?.["416"]).toMatchObject({
      description: "Range Not Satisfiable",
      headers: {
        "Content-Range": {
          required: true,
          schema: { type: "string", pattern: "^bytes \\*/[0-9]+$" },
        },
      },
    });
    expect(readContent?.responses?.["416"]).toHaveProperty(
      "content.application/json.schema.properties.error.const",
      "INVALID_REQUEST",
    );
    expect(readContent?.responses?.["404"]).toHaveProperty(
      "content.application/json.schema.properties.error.enum",
      ["NODE_NOT_FOUND"],
    );
    expect(readContent?.responses?.["429"]).toHaveProperty(
      "content.application/json.schema.properties.error.enum",
      ["CAS_UPLOAD_LIMIT"],
    );
    const lease = document.paths?.["/v1/cas/nodes/{hash}/lease"]?.post;
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
      document.paths?.["/v1/cas/root-refs"]?.post,
    );
    expect(updateJson).toContain('"minProperties":1');
    expect(updateJson).toContain('"maxProperties":1000');
    expect(updateJson).toContain('"minimum":-1000000');
    expect(updateJson).toContain('"maximum":1000000');
    expect(updateJson).toContain('"not":{"const":0}');
    expect(document.components?.schemas?.SpaceCapabilityClaims).toMatchObject({
      type: "object",
      properties: {
        ver: { const: 2 },
        grants: {
          type: "array",
          minItems: 1,
          maxItems: 32,
          items: {
            type: "object",
            additionalProperties: false,
            readOnly: true,
            required: ["selector", "permissions"],
            properties: {
              selector: {
                type: "string",
                minLength: 1,
                maxLength: 258,
                description: "Exact, terminal segment-prefix, or terminal recursive-prefix Space selector.",
              },
              permissions: {
                type: "array",
                minItems: 1,
                readOnly: true,
                items: {
                  type: "string",
                  enum: [
                    "cas:nodes:read",
                    "cas:nodes:lease",
                    "cas:root-refs:read",
                    "cas:root-refs:update",
                    "cas:usage:read",
                    "cas:gc:execute",
                  ],
                },
              },
            },
          },
        },
      },
    });
    expect(document.components?.schemas?.SpaceRefDomainClaim).toMatchObject({
      type: "string",
      maxLength: 64,
      pattern: "^[a-z][a-z0-9]*(?::[a-z0-9]+)*$",
    });
    expect(document.components?.securitySchemes?.spaceCapability).toHaveProperty(
      "x-unicas-capability",
      expect.objectContaining({
        version: 2,
        claimsSchema: "#/components/schemas/SpaceCapabilityClaims",
        oauthScopes: false,
      }),
    );
    for (const policy of Object.values(SpaceOperationPolicies)) {
      const operation = Object.values(document.paths ?? {}).flatMap(path =>
        [path?.get, path?.post, path?.put, path?.patch, path?.delete]
      ).find(candidate => candidate?.operationId === policy.operationId);
      expect(operation).toHaveProperty("x-unicas-authorization", {
        capabilityVersion: 2,
        requiredPermission: policy.permission,
        requiredClaims: [...policy.requiredClaims],
        ...(policy.requiredClaims.some(claim => claim === "refDomain")
          ? {
              claimSchemas: {
                refDomain: "#/components/schemas/SpaceRefDomainClaim",
              },
            }
          : {}),
      });
    }
    expect(serialized).not.toContain("stackId");
    expect(serialized).not.toContain("tenantId");
    expect(serialized).not.toContain("Tenant");
    expect(serialized).not.toContain("/stacks/");
  });
});