/**
 * Read-only D1-backed authority repository over the App registry.
 *
 * The registry is written exclusively by the control plane through the App
 * OAuth discovery/activation flow. Signing keys are resolved from the
 * discovered jwks_uri, with refresh bounded by the verifier's cache policy.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type {
  AppAuthorityResolver,
  ResolvedAppAuthority,
  ResolvedStackAuthority,
  StackAuthorityResolver,
} from "@unicas/service";

export class AuthorityRepository implements StackAuthorityResolver {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /** Resolve a globally unique issuer to its stack authority; null when
   *  unknown. The issuer value is unique across stacks (registry invariant). */
  async resolveIssuer(issuer: string): Promise<ResolvedStackAuthority | null> {
    const oauthRow = await readIssuer(this.#db, issuer);
    if (!oauthRow || oauthRow.app_status !== "active") return null;
    return toAuthority(oauthRow);
  }
}

export class AppAuthorityRepository implements AppAuthorityResolver {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async resolveIssuer(issuer: string): Promise<ResolvedAppAuthority | null> {
    const row = await readIssuer(this.#db, issuer);
    if (!row) return null;
    return {
      appId: row.app_id,
      appStatus: row.app_status,
      issuer: row.issuer,
      audience: row.audience,
      jwksUri: row.jwks_uri,
      capabilityMaxLifetimeSeconds: row.capability_max_lifetime_seconds,
    };
  }
}

function toAuthority(row: IssuerRow): ResolvedStackAuthority {
  return {
    stackId: row.app_id,
    issuer: row.issuer,
    audience: row.audience,
    jwksUri: row.jwks_uri,
    capabilityMaxLifetimeSeconds: row.capability_max_lifetime_seconds,
  };
}

function readIssuer(db: D1Database, issuer: string): Promise<IssuerRow | null> {
  return db
    .prepare(
            `SELECT issuer_record.app_id, issuer_record.issuer, issuer_record.audience,
              issuer_record.jwks_uri, issuer_record.capability_max_lifetime_seconds,
              app.status AS app_status
        FROM cas_app_oauth_issuers AS issuer_record
        JOIN cas_apps AS app ON app.app_id = issuer_record.app_id
        WHERE issuer_record.issuer = ? AND issuer_record.status = 'active' AND issuer_record.mode = 'external'
       LIMIT 1`,
    )
    .bind(issuer)
    .first<IssuerRow>();
}

interface IssuerRow {
  readonly app_id: string;
  readonly app_status: "active" | "suspended";
  readonly issuer: string;
  readonly audience: string;
  readonly jwks_uri: string;
  readonly capability_max_lifetime_seconds: number;
}
