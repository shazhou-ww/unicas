import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { z } from "zod";
import {
  SpaceApiBasePath,
  SpaceApiStableErrorCodesByStatus,
  SpaceReadContentRangeNotSatisfiable,
  spaceApiContract,
} from "../src/space-contract.js";
import {
  SpaceCapabilityClaimsSchema,
  SpaceCapabilityPermissionKinds,
  SpaceCapabilityVersion,
  SpaceOperationPolicies,
  SpaceRefDomainClaimSchema,
} from "../src/space-capability.js";

export async function generateSpaceOpenApiDocument() {
  const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

  const document = await generator.generate(spaceApiContract, {
    info: {
      title: "UniCAS Space API",
      version: "1.0.0",
      description: [
        "App-scoped Space API for immutable content-addressed nodes, leases, usage accounting, garbage collection, and atomic Root Ref commits.",
        "",
        "Every request uses a version 2 JWT capability for the shared CAS v1 audience. The registered issuer establishes App authority; one signed grant must select query `spaceId` and contain the operation's exact permission.",
        "",
        "Principal identity and Profile metadata are independent of Space ownership and authorization.",
      ].join("\n"),
    },
    servers: [
      { url: "https://api.unicas.work", description: "Production" },
    ],
    tags: [
      { name: "Nodes", description: "Read immutable nodes and establish temporary protection leases within a Space." },
      { name: "Root Refs", description: "Read and atomically update business-root balances in the verified capability's refDomain." },
      { name: "Operations", description: "Inspect Space accounting and run bounded garbage collection." },
    ],
    security: [{ spaceCapability: [] }],
    components: {
      securitySchemes: {
        spaceCapability: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Version 2 Space capability for the shared CAS v1 audience. The verified issuer authority must match query appId, and one signed grant must both select query spaceId and contain the operation's exact CAS permission.",
        },
      },
    },
    customErrorResponseBodySchema: (definedErrors, status) => ({
      type: "object",
      properties: {
        error: {
          type: "string",
          enum: stableErrorCodes(status) ?? definedErrors.map(([code]) => code),
        },
        message: { type: "string" },
      },
      required: ["error"],
    }),
  });

  const { $schema: _claimsMetaSchema, ...claimsSchema } = z.toJSONSchema(
    SpaceCapabilityClaimsSchema,
  );
  const { $schema: _refDomainMetaSchema, ...refDomainSchema } = z.toJSONSchema(
    SpaceRefDomainClaimSchema,
  );
  document.components ??= {};
  document.components.schemas ??= {};
  Object.assign(document.components.schemas, {
    SpaceCapabilityClaims: claimsSchema,
    SpaceRefDomainClaim: refDomainSchema,
  });

  const securityScheme = document.components.securitySchemes?.spaceCapability;
  if (securityScheme === undefined) {
    throw new Error("Generated Space OpenAPI is missing the spaceCapability security scheme");
  }
  Object.assign(securityScheme, {
    "x-unicas-capability": {
      version: SpaceCapabilityVersion,
      claimsSchema: "#/components/schemas/SpaceCapabilityClaims",
      permissions: [...SpaceCapabilityPermissionKinds],
      oauthScopes: false,
    },
  });

  const policies = Object.values(SpaceOperationPolicies);
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const operation = pathItem?.[method];
      if (operation?.operationId === undefined) continue;
      const policy = policies.find(candidate => candidate.operationId === operation.operationId);
      if (policy === undefined) {
        throw new Error(`Generated Space OpenAPI operation ${operation.operationId} has no authorization policy`);
      }
      Object.assign(operation, {
        "x-unicas-authorization": {
          capabilityVersion: SpaceCapabilityVersion,
          requiredPermission: policy.permission,
          requiredClaims: [...policy.requiredClaims],
          ...(policy.requiredClaims.some(claim => claim === "refDomain")
            ? {
                claimSchemas: {
                  refDomain: "#/components/schemas/SpaceRefDomainClaim",
                },
              }
            : {}),
        },
      });
    }
  }

  const readContent = document.paths?.[
    `${SpaceApiBasePath}/nodes/{hash}`
  ]?.get;
  if (readContent?.responses === undefined) {
    throw new Error("Generated Space OpenAPI is missing the readContent operation");
  }
  Object.assign(readContent.responses, {
    [SpaceReadContentRangeNotSatisfiable.status]: {
      description: "Range Not Satisfiable",
      headers: {
        "Content-Range": {
          required: true,
          schema: {
            type: "string",
            pattern: SpaceReadContentRangeNotSatisfiable.contentRangePattern,
          },
        },
      },
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              error: { const: SpaceReadContentRangeNotSatisfiable.error },
              message: { type: "string" },
            },
            required: ["error"],
          },
        },
      },
    },
  });

  return document;
}

function stableErrorCodes(status: number): readonly string[] | undefined {
  return Object.entries(SpaceApiStableErrorCodesByStatus)
    .find(([candidate]) => Number(candidate) === status)?.[1];
}