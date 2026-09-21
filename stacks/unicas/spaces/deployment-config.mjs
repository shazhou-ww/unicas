import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const SpacesTemplatePath = resolve(ROOT, "stacks/unicas/spaces/wrangler.jsonc");
export const SpacesProductionConfigPath = resolve(ROOT, ".wrangler/spaces/wrangler.production.json");
export const SpacesProductionSecretsPath = resolve(ROOT, ".wrangler/spaces/secrets.json");

export const SpacesProductionVariables = Object.freeze([
  "SPACES_D1_DATABASE_ID",
  "SPACES_GOOGLE_CLIENT_ID",
  "SPACES_SIGNING_KID",
  "SPACES_SIGNING_PUBLIC_JWKS",
  "SPACES_SMOKE_PRINCIPAL_ID",
  "SPACES_UNICAS_AUDIENCE",
]);

export const SpacesProductionSecrets = Object.freeze([
  "SPACES_GOOGLE_CLIENT_SECRET",
  "SPACES_SIGNING_PRIVATE_KEY_PKCS8",
  "SPACES_SMOKE_CREDENTIAL",
]);

export function buildProductionSpacesConfig(template, environment) {
  const missing = SpacesProductionVariables.filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new Error(`Spaces production configuration is missing: ${missing.join(", ")}`);
  }
  const databaseId = environment.SPACES_D1_DATABASE_ID;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(databaseId)) {
    throw new Error("SPACES_D1_DATABASE_ID must be a UUID");
  }
  let publicJwks;
  try {
    publicJwks = JSON.parse(environment.SPACES_SIGNING_PUBLIC_JWKS);
  } catch {
    throw new Error("SPACES_SIGNING_PUBLIC_JWKS must be valid JSON");
  }
  const privateFields = ["d", "p", "q", "dp", "dq", "qi", "k", "oth"];
  const keyIds = Array.isArray(publicJwks?.keys) ? publicJwks.keys.map((key) => key?.kid) : [];
  if (!publicJwks || !Array.isArray(publicJwks.keys)
    || publicJwks.keys.length === 0 || publicJwks.keys.length > 5
    || !keyIds.includes(environment.SPACES_SIGNING_KID)
    || new Set(keyIds).size !== keyIds.length
    || publicJwks.keys.some((key) => !key || key.kty !== "EC" || key.crv !== "P-256"
      || typeof key.kid !== "string" || typeof key.x !== "string" || typeof key.y !== "string"
      || privateFields.some((field) => field in key))) {
    throw new Error("SPACES_SIGNING_PUBLIC_JWKS must contain the active public EC P-256 key");
  }
  const config = structuredClone(template);
  config.d1_databases[0].database_id = databaseId;
  Object.assign(config.vars, {
    GOOGLE_CLIENT_ID: environment.SPACES_GOOGLE_CLIENT_ID,
    SPACES_SIGNING_KID: environment.SPACES_SIGNING_KID,
    SPACES_SIGNING_PUBLIC_JWKS: environment.SPACES_SIGNING_PUBLIC_JWKS,
    SPACES_SMOKE_ENABLED: environment.SPACES_SMOKE_ENABLED === "false" ? "false" : "true",
    SPACES_SMOKE_PRINCIPAL_ID: environment.SPACES_SMOKE_PRINCIPAL_ID,
    UNICAS_AUDIENCE: environment.SPACES_UNICAS_AUDIENCE,
  });
  return config;
}

export function writeProductionSpacesConfig(environment = process.env, outputPath = SpacesProductionConfigPath) {
  const template = JSON.parse(readFileSync(SpacesTemplatePath, "utf8"));
  const config = buildProductionSpacesConfig(template, environment);
  const outputDirectory = dirname(outputPath);
  for (const field of ["main"]) {
    config[field] = portableRelative(outputDirectory, resolve(dirname(SpacesTemplatePath), config[field]));
  }
  config.assets.directory = portableRelative(
    outputDirectory,
    resolve(dirname(SpacesTemplatePath), config.assets.directory),
  );
  config.d1_databases[0].migrations_dir = portableRelative(
    outputDirectory,
    resolve(dirname(SpacesTemplatePath), config.d1_databases[0].migrations_dir),
  );
  delete config.$schema;
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return outputPath;
}

export function writeProductionSpacesSecrets(environment = process.env, outputPath = SpacesProductionSecretsPath) {
  const missing = SpacesProductionSecrets.filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new Error(`Spaces production secrets are missing: ${missing.join(", ")}`);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    GOOGLE_CLIENT_SECRET: environment.SPACES_GOOGLE_CLIENT_SECRET,
    SPACES_SIGNING_PRIVATE_KEY: environment.SPACES_SIGNING_PRIVATE_KEY_PKCS8,
    SPACES_SMOKE_CREDENTIAL: environment.SPACES_SMOKE_CREDENTIAL,
  }), { mode: 0o600 });
  return outputPath;
}

function portableRelative(from, to) {
  const path = relative(from, to).replace(/\\/g, "/");
  return path.startsWith(".") ? path : `./${path}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(writeProductionSpacesConfig());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}