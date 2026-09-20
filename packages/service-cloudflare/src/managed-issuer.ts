import { exportJWK, importPKCS8 } from "jose";
import { CapabilityAlgorithm } from "@unicas/tenant-protocol";

export interface ManagedIssuerOptions {
  readonly publicOrigin: string;
  readonly privateKeyPkcs8: string;
  readonly keyId: string;
}

export class CloudflareManagedIssuer {
  readonly #origin: string;
  readonly #privateKeyPkcs8: string;
  readonly #keyId: string;
  #materialPromise: Promise<KeyMaterial> | null = null;

  constructor(options: ManagedIssuerOptions) {
    this.#origin = new URL(options.publicOrigin).origin;
    if (!options.privateKeyPkcs8) throw new TypeError("managed issuer private key is required");
    if (!options.keyId) throw new TypeError("managed issuer key ID is required");
    this.#privateKeyPkcs8 = options.privateKeyPkcs8;
    this.#keyId = options.keyId;
  }

  async metadata(stackId: string): Promise<Readonly<Record<string, unknown>>> {
    const issuer = this.issuer(stackId);
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["cas:read", "cas:write", "cas:manage"],
    };
  }

  async jwks(): Promise<Readonly<Record<string, unknown>>> {
    return { keys: [(await this.#material()).publicJwk] };
  }

  ownsJwksUri(value: string): boolean {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return url.origin === this.#origin
      && url.search === ""
      && url.hash === ""
      && /^\/managed-issuers\/[^/]+\/jwks\.json$/.test(url.pathname);
  }

  issuer(stackId: string): string {
    return `${this.#origin}/managed-issuers/${encodeURIComponent(stackId)}`;
  }

  #material(): Promise<KeyMaterial> {
    this.#materialPromise ??= loadKeyMaterial(this.#privateKeyPkcs8, this.#keyId);
    return this.#materialPromise;
  }
}

interface KeyMaterial {
  readonly publicJwk: Readonly<Record<string, unknown>>;
}

async function loadKeyMaterial(privateKeyPkcs8: string, keyId: string): Promise<KeyMaterial> {
  const privateKey = await importPKCS8(privateKeyPkcs8, CapabilityAlgorithm, { extractable: true });
  const exported = await exportJWK(privateKey);
  if (exported.kty !== "EC" || exported.crv !== "P-256" || !exported.x || !exported.y) {
    throw new TypeError("managed issuer key must be EC P-256");
  }
  const publicJwk = {
    kty: exported.kty,
    crv: exported.crv,
    x: exported.x,
    y: exported.y,
    alg: CapabilityAlgorithm,
    use: "sig",
    kid: keyId,
  } as const;
  return {
    publicJwk,
  };
}