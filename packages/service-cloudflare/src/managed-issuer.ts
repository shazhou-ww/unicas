import { exportJWK, importPKCS8, SignJWT } from "jose";
import {
  CapabilityAlgorithm,
  CapabilityTokenType,
  SpaceCapabilityVersion,
  spaceCasManagePermission,
  spaceCasReadPermission,
  spaceCasWritePermission,
} from "@unicas/tenant-protocol";
import type {
  AccountManagedCapabilityIssuer,
  AccountOAuthIssuerRecord,
} from "@unicas/service";
import { managedAccountOwnerKey } from "@unicas/service";

const CAPABILITY_LIFETIME_SECONDS = 60 * 60;

export interface ManagedIssuerOptions {
  readonly publicOrigin: string;
  readonly privateKeyPkcs8: string;
  readonly keyId: string;
  readonly now?: () => number;
}

export class CloudflareManagedIssuer implements AccountManagedCapabilityIssuer {
  readonly #origin: string;
  readonly #privateKeyPkcs8: string;
  readonly #keyId: string;
  readonly #now: () => number;
  #materialPromise: Promise<KeyMaterial> | null = null;

  constructor(options: ManagedIssuerOptions) {
    this.#origin = new URL(options.publicOrigin).origin;
    if (!options.privateKeyPkcs8) throw new TypeError("managed issuer private key is required");
    if (!options.keyId) throw new TypeError("managed issuer key ID is required");
    this.#privateKeyPkcs8 = options.privateKeyPkcs8;
    this.#keyId = options.keyId;
    this.#now = options.now ?? (() => Date.now());
  }

  async provision(appId: string, createdAt: number): Promise<AccountOAuthIssuerRecord> {
    const material = await this.#material();
    const issuer = this.issuer(appId);
    return {
      appId,
      mode: "managed",
      issuer,
      audience: `${this.#origin}/v2/apps/${encodeURIComponent(appId)}`,
      metadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
      metadataType: "oauth",
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      jwksUri: `${issuer}/jwks.json`,
      registrationEndpoint: null,
      scopesSupported: ["cas:read", "cas:write", "cas:manage"],
      codeChallengeMethodsSupported: ["S256"],
      status: "active",
      verifiedAt: createdAt,
      lastRefreshAt: createdAt,
      lastRefreshError: null,
      jwksDigest: material.digest,
      capabilityMaxLifetimeSeconds: CAPABILITY_LIFETIME_SECONDS,
      revision: 1,
    };
  }

  async issueAccountSpace(input: Parameters<AccountManagedCapabilityIssuer["issueAccountSpace"]>[0]) {
    const expectedIssuer = this.issuer(input.app.appId);
    if (input.issuer.issuer !== expectedIssuer || input.issuer.mode !== "managed") {
      throw new TypeError("managed issuer binding does not match the app");
    }
    const material = await this.#material();
    const accountDigest = await managedAccountOwnerKey(input.app.appId, input.accountId);
    const spaceId = `member_${accountDigest.slice(0, 24)}`;
    const permissions = [
      spaceCasReadPermission(spaceId),
      spaceCasWritePermission(spaceId),
      spaceCasManagePermission(spaceId),
    ];
    const issuedAt = Math.floor(this.#now() / 1000);
    const expiresAt = issuedAt + CAPABILITY_LIFETIME_SECONDS;
    const accessToken = await new SignJWT({
      ver: SpaceCapabilityVersion,
      spaceId,
      permissions,
      refDomain: `account:${accountDigest.slice(0, 16)}`,
    })
      .setProtectedHeader({ alg: CapabilityAlgorithm, kid: this.#keyId, typ: CapabilityTokenType })
      .setIssuer(expectedIssuer)
      .setSubject(`account:${accountDigest}`)
      .setAudience(input.issuer.audience)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt - 5)
      .setExpirationTime(expiresAt)
      .setJti(crypto.randomUUID())
      .sign(material.privateKey);
    return {
      accessToken,
      tokenType: "Bearer" as const,
      expiresIn: CAPABILITY_LIFETIME_SECONDS,
      expiresAt: expiresAt * 1000,
      issuer: expectedIssuer,
      audience: input.issuer.audience,
      spaceId,
      permissions,
    };
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
  readonly privateKey: CryptoKey;
  readonly publicJwk: Readonly<Record<string, unknown>>;
  readonly digest: string;
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
    privateKey,
    publicJwk,
    digest: await sha256Hex(JSON.stringify({ keys: [publicJwk] })),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}