import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { appAdminApiContract } from "../src/app-v2-contract.js";

export function generateAppAdminOpenApiDocument() {
  const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });
  return generator.generate(appAdminApiContract, {
    info: {
      title: "UniCAS App Administrator API",
      version: "2.0.0",
      description: "Administrator control plane for Apps, Principal memberships, OAuth issuers, Playground roots, and App/Space audit data.",
    },
    tags: [
      { name: "Identity" }, { name: "Apps" }, { name: "Members" },
      { name: "OAuth Issuer" }, { name: "Managed Issuer" },
      { name: "Playground" }, { name: "Audit" }, { name: "Root Ref Audit" },
    ],
    security: [{ adminSession: [] }],
    components: {
      securitySchemes: {
        adminSession: {
          type: "apiKey",
          in: "cookie",
          name: "__Host-unicas_admin",
          description: "HttpOnly same-origin administrator session cookie.",
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
