import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CompactSign, importPKCS8 } from "jose";

export async function signIssuerChallenge(input) {
  if (!input.challenge || !input.keyId || !input.privateKeyPem) {
    throw new Error("challenge, keyId, and privateKeyPem are required");
  }
  const privateKey = await importPKCS8(input.privateKeyPem, "ES256");
  return new CompactSign(new TextEncoder().encode(input.challenge))
    .setProtectedHeader({ alg: "ES256", kid: input.keyId })
    .sign(privateKey);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!value || (name !== "--challenge-file" && name !== "--key-file" && name !== "--key-fixture" && name !== "--kid")) {
      throw new Error("usage: pnpm spaces:issuer-proof -- --challenge-file <path> --key-fixture <path>");
    }
    options[name.slice(2)] = value;
  }
  if (!options["challenge-file"] || (!options["key-fixture"] && (!options["key-file"] || !options.kid))) {
    throw new Error("challenge file and either key fixture or key file with kid are required");
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const fixture = options["key-fixture"]
      ? JSON.parse(await readFile(options["key-fixture"], "utf8"))
      : null;
    console.log(await signIssuerChallenge({
      challenge: await readFile(options["challenge-file"], "utf8"),
      keyId: fixture?.kid ?? options.kid,
      privateKeyPem: fixture?.privateKeyPkcs8 ?? await readFile(options["key-file"], "utf8"),
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}