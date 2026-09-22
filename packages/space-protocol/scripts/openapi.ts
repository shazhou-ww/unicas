import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { spaceApiContract } from "../src/space-contract.js";

export function generateSpaceOpenApiDocument() {
  const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

  return generator.generate(spaceApiContract, {
    info: {
      title: "UniCAS Space API",
      version: "1.0.0",
      description: [
        "App-scoped Space API for immutable content-addressed nodes, leases, usage accounting, garbage collection, and atomic Root Ref commits.",
        "",
        "Every request uses a version 1 JWT capability on the version 1 HTTP API. The registered issuer establishes App authority; the token's signed `spaceId` must match the route and its exact operation permission must authorize the request.",
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
          description: "Version 1 Space capability. Issuer authority and signed spaceId must match the request path, and the permission set must contain the operation's exact CAS authority.",
        },
      },
    },
    customErrorResponseBodySchema: (definedErrors) => ({
      type: "object",
      properties: {
        error: { type: "string", enum: definedErrors.map(([code]) => code) },
        message: { type: "string" },
      },
      required: ["error"],
    }),
  });
}