import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { generateSpaceOpenApiDocument } from "./openapi.js";

const document = await generateSpaceOpenApiDocument();
const jsonPath = resolve(process.cwd(), "openapi/space-v2.openapi.json");

await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
process.stdout.write(`Generated ${relative(process.cwd(), jsonPath)}\n`);