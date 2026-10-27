import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(join(root, "package.json"));
const { build } = require("esbuild");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
const workerRequire = createRequire(join(root, "packages", "service-cloudflare", "package.json"));
const wranglerPackage = workerRequire.resolve("wrangler/package.json");
const wrangler = join(dirname(wranglerPackage), "bin", "wrangler.js");
const app = "local-root-ref-rehearsal";
const hash = "a".repeat(64);
const digest = value => createHash("sha256").update(value).digest("hex");
const moduleUrl = path => pathToFileURL(join(root, path)).href;
const quote = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => value === null ? "NULL"
  : typeof value === "number" || typeof value === "bigint" ? String(value)
    : ArrayBuffer.isView(value) ? `X'${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex")}'`
      : `'${value.replaceAll("'", "''")}'`;

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: "false",
      CLOUDFLARE_API_TOKEN: "",
      CLOUDFLARE_ACCOUNT_ID: "",
    },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function dump(db) {
  const objects = db.prepare(
    "SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).all();
  const lines = [];
  for (const object of objects.filter(row => row.type === "table")) {
    lines.push(`${object.sql.replaceAll("\n", " ")};`);
    const columns = db.prepare(`PRAGMA table_info(${quote(object.name)})`).all().map(row => row.name);
    for (const row of db.prepare(`SELECT * FROM ${quote(object.name)}`).all()) {
      lines.push(`INSERT INTO ${quote(object.name)} (${columns.map(quote).join(",")}) VALUES (${columns.map(name => literal(row[name])).join(",")});`);
    }
  }
  for (const type of ["index", "trigger"]) {
    for (const object of objects.filter(row => row.type === type)) {
      lines.push(`${object.sql.replaceAll("\n", " ")};`);
    }
  }
  return `${lines.join("\n")}\n`;
}

await mkdir(join(root, ".wrangler"), { recursive: true });
const directory = await mkdtemp(join(root, ".wrangler", "root-ref-rehearsal-"));
let runtime;
try {
  const config = join(directory, "wrangler.json");
  await writeFile(config, JSON.stringify({
    name: "root-ref-local-rehearsal",
    compatibility_date: "2025-08-17",
    d1_databases: [
      { binding: "SOURCE", database_name: "rehearsal-source", database_id: "00000000-0000-4000-8000-000000000001" },
      { binding: "TARGET", database_name: "rehearsal-target", database_id: "00000000-0000-4000-8000-000000000002" },
      { binding: "RECOVERY", database_name: "rehearsal-recovery", database_id: "00000000-0000-4000-8000-000000000003" },
    ],
  }));
  const local = (operation, binding, options) => {
    assert.ok(["execute", "export"].includes(operation));
    assert.ok(["SOURCE", "TARGET", "RECOVERY"].includes(binding));
    assert.ok(!options.includes("--remote"));
    return run([wrangler, "d1", operation, binding, "--local", "--config", config, ...options], directory);
  };
  const query = (binding, command) => JSON.parse(local("execute", binding, ["--command", command, "--json", "--yes"]))[0].results;
  const baseline = await readFile(join(root, "packages", "service-cloudflare", "migrations", "app-space", "0001_baseline.sql"), "utf8");
  const changes = count => JSON.stringify({ [hash]: count });
  const seeds = [];
  for (const [space, domain, count] of [["/one", "old-one", 2], ["/two", "old-two", 3]]) {
    const payload = changes(count);
    seeds.push(
      `INSERT INTO cas_nodes (app_id,space_id,hash,content_size,content_type,root_ref_count) VALUES ('${app}','${space}','${hash}',1,'text/plain',${count});`,
      `INSERT INTO cas_root_domain_refs VALUES ('${app}','${domain}','${space}','${hash}',${count});`,
      `INSERT INTO cas_root_domain_revisions VALUES ('${app}','${domain}',1);`,
      `INSERT INTO cas_root_domain_events VALUES ('${app}','${domain}',1,'${space}','legacy','${digest(payload)}','${payload}',100);`,
      `INSERT INTO cas_root_ref_requests VALUES ('${app}','${space}','${domain}','legacy','${digest(payload)}',1,100);`,
    );
  }
  const seedSql = join(directory, "seed.sql");
  await writeFile(seedSql, `${baseline}\n${seeds.join("\n")}\n`);
  local("execute", "SOURCE", ["--file", seedSql, "--yes"]);
  const sourceSql = join(directory, "source.sql");
  local("export", "SOURCE", ["--output", sourceSql]);
  const sourcePath = join(directory, "source.sqlite");
  const source = new DatabaseSync(sourcePath);
  try { source.exec(await readFile(sourceSql, "utf8")); } finally { source.close(); }
  const sourceDigest = digest(await readFile(sourcePath));
  const migration = join(root, "release", "service", "migrate-root-refs.mjs");
  const plan = JSON.parse(run([migration, "--input", sourcePath, "--dry-run"], root));
  assert.equal(plan.nodes, 2);
  assert.equal(plan.replayRecords, 2);
  const candidatePath = join(directory, "candidate.sqlite");
  run([migration, "--input", sourcePath, "--output", candidatePath], root);
  assert.equal(digest(await readFile(sourcePath)), sourceDigest);
  const candidate = new DatabaseSync(candidatePath, { readOnly: true });
  let candidateSql;
  try {
    assert.deepEqual({ ...candidate.prepare("SELECT revision, checkpoint FROM cas_app_root_revisions").get() }, { revision: 1, checkpoint: 1 });
    assert.equal(candidate.prepare("SELECT COUNT(*) AS n FROM cas_app_root_events").get().n, 0);
    candidateSql = dump(candidate);
  } finally { candidate.close(); }
  const targetSql = join(directory, "target.sql");
  await writeFile(targetSql, candidateSql);
  local("execute", "TARGET", ["--file", targetSql, "--yes"]);
  local("execute", "RECOVERY", ["--file", sourceSql, "--yes"]);
  const totals = binding => query(binding, "SELECT space_id, root_ref_count FROM cas_nodes ORDER BY space_id");
  const expected = [{ space_id: "/one", root_ref_count: 2 }, { space_id: "/two", root_ref_count: 3 }];
  assert.deepEqual(totals("SOURCE"), expected);
  assert.deepEqual(totals("TARGET"), expected);
  assert.deepEqual(totals("RECOVERY"), expected);
  assert.equal(query("RECOVERY", "SELECT COUNT(*) AS n FROM cas_root_domain_events")[0].n, 2);
  assert.equal(query("TARGET", "SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='trigger' AND name LIKE '%archive_%'")[0].n, 12);

  const entry = join(directory, "probe.mjs");
  await writeFile(entry, `
import { CasDurableObject, RootRefDomainDurableObject } from ${JSON.stringify(moduleUrl("packages/service-cloudflare/dist/worker.js"))};
import { listAppRootRefs, listAppRootEvents, AuditReadError } from ${JSON.stringify(moduleUrl("packages/service-cloudflare/dist/audit-reads.js"))};
export { CasDurableObject, RootRefDomainDurableObject };
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/health") return new Response("local-ready");
  const appId = ${JSON.stringify(app)};
  const spaceId = url.searchParams.get("spaceId") ?? "/one";
  if (!["/one", "/two"].includes(spaceId)) return new Response("invalid fixture scope", { status: 400 });
  try {
    if (url.pathname === "/audit/refs") return Response.json(await listAppRootRefs({ db: env.CAS_DB, appId, limit: 1, ...(url.searchParams.has("cursor") ? { cursor: url.searchParams.get("cursor") } : {}) }));
    if (url.pathname === "/audit/events") return Response.json(await listAppRootEvents({ db: env.CAS_DB, appId }));
    if (url.pathname !== "/root-refs") return new Response("not found", { status: 404 });
    const id = env.CAS_DO.idFromName(encodeURIComponent(appId) + "|" + encodeURIComponent(spaceId));
    const stub = env.CAS_DO.get(id);
    return stub.fetch(new Request("https://space.internal/" + (request.method === "POST" ? "updateRootRefs" : "rootRefs"), {
      method: request.method,
      headers: { "X-CAS-App-Id": appId, "X-CAS-Space-Id": spaceId, "X-CAS-Route-Family": "app-space" },
      ...(request.method === "POST" ? { body: await request.text() } : {})
    }));
  } catch (error) {
    if (error instanceof AuditReadError) return Response.json({ error: error.code }, { status: error.status });
    throw error;
  }
} };
`);
  const bundle = join(directory, "worker.mjs");
  await build({
    entryPoints: [entry], outfile: bundle, bundle: true, format: "esm",
    platform: "browser", target: "es2024",
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:workers", "node:*"], logLevel: "silent",
  });
  runtime = new Miniflare(convertV4MiniflareOptions({
    host: "127.0.0.1", port: 0,
    workers: [{
      name: "root-ref-rehearsal", modules: true, scriptPath: bundle,
      compatibilityDate: "2025-08-17", compatibilityFlags: ["nodejs_compat"],
      d1Databases: { CAS_DB: "local-runtime-database" },
      r2Buckets: { CAS_R2: "local-runtime-bucket" },
      durableObjects: {
        CAS_DO: { className: "CasDurableObject" },
        CAS_DOMAIN_DO: { className: "RootRefDomainDurableObject" },
      },
    }],
  }));
  const origin = (await runtime.ready).origin;
  assert.equal(await (await fetch(`${origin}/health`)).text(), "local-ready");
  const db = await runtime.getD1Database("CAS_DB", "root-ref-rehearsal");
  await db.exec(candidateSql);
  const bucket = await runtime.getR2Bucket("CAS_R2", "root-ref-rehearsal");
  const { appCanonicalNodeKey } = await import(moduleUrl("packages/service-cloudflare/dist/do-names.js"));
  for (const space of ["/one", "/two"]) await bucket.put(appCanonicalNodeKey(app, space, hash), "synthetic");
  const update = async (spaceId, requestId, delta) => {
    const response = await fetch(`${origin}/root-refs?spaceId=${encodeURIComponent(spaceId)}`, {
      method: "POST", body: JSON.stringify({ requestId, changes: { [hash]: delta } }),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.deepEqual(await update("/one", "legacy", 2), { status: 200, body: { success: true, idempotent: true, revision: 1 } });
  assert.equal((await update("/one", "legacy", 1)).body.error, "IDEMPOTENCY_CONFLICT");
  const writes = await Promise.all([update("/one", "shared", 1), update("/two", "shared", 2)]);
  assert.deepEqual(writes.map(result => result.status), [200, 200]);
  assert.deepEqual(writes.map(result => result.body.revision).sort(), [2, 3]);
  assert.equal((await update("/two", "shared", 2)).body.idempotent, true);
  const first = await (await fetch(`${origin}/audit/refs`)).json();
  assert.equal(first.revision, 3);
  assert.equal(first.refs.length, 1);
  assert.equal(typeof first.nextCursor, "string");
  const next = await (await fetch(`${origin}/audit/refs?cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  assert.equal(next.refs.length, 1);
  assert.equal(next.nextCursor, null);
  assert.equal((await update("/one", "cursor-change", 1)).body.revision, 4);
  const stale = await fetch(`${origin}/audit/refs?cursor=${encodeURIComponent(first.nextCursor)}`);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, "ROOT_REF_SNAPSHOT_CHANGED");
  const before = await db.prepare("SELECT space_id,root_ref_count FROM cas_nodes ORDER BY space_id").all();
  await db.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON cas_app_root_events BEGIN SELECT RAISE(ABORT,'local-rehearsal'); END;");
  assert.equal((await update("/one", "failed", 1)).status, 503);
  assert.deepEqual((await db.prepare("SELECT space_id,root_ref_count FROM cas_nodes ORDER BY space_id").all()).results, before.results);
  const afterFailure = await (await fetch(`${origin}/audit/events`)).json();
  assert.equal(afterFailure.latestRevision, 4);
  assert.equal(afterFailure.events.length, 3);
  await db.exec("DROP TRIGGER injected_failure;");
  assert.equal((await update("/one", "after-failure", 1)).body.revision, 5);
  const events = await (await fetch(`${origin}/audit/events`)).json();
  assert.deepEqual(events.events.map(event => event.revision), [2, 3, 4, 5]);
  assert.equal(events.nextAfter, 5);
  await assert.rejects(() => db.prepare("DELETE FROM cas_root_domain_events").run(), /read-only/);
  await assert.rejects(() => db.prepare("DELETE FROM cas_app_root_events").run(), /append-only/);
  assert.equal(digest(await readFile(sourcePath)), sourceDigest);
  console.log(JSON.stringify({
    outcome: "local-rehearsal-passed",
    target: "isolated-local-d1-and-workerd",
    sourceNodes: 2, originalAggregate: [2, 3], restoredAggregate: [2, 3],
    archiveWriteGuards: 12, checkpoint: 1, newRevisions: [2, 3, 4, 5],
    legacyReplay: true, crossSpaceReplay: true, cursorInvalidation: true,
    lateBatchRollback: true, httpResponsive: true, sourceUnchanged: true,
    publicCapabilityValidation: "not-exercised-by-trusted-fixture-harness",
    remoteOperations: 0,
  }));
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
