import { AppPeopleQuerySchema, PlatformPeopleQuerySchema, type AppPerson, type PlatformPerson, type PlatformPeopleQuery, type PeoplePage } from "@unicas/admin-protocol";
import { PlatformAccessError } from "./platform-access.js";

export type PeopleScope = { readonly appId: string } | { readonly platform: true };
export interface PeopleEntry {
  readonly key: string;
  readonly time: number;
  readonly item: AppPerson | PlatformPerson;
}
export interface PeopleRepository {
  readSnapshot(): Promise<number>;
  list(input: {
    scope: PeopleScope;
    query: PlatformPeopleQuery | { filter?: "members"; query?: string };
    after: { key: string; time: number } | null;
    now: number;
    limit: number;
  }): Promise<readonly PeopleEntry[]>;
  nextExpiry(scope: PeopleScope, now: number): Promise<number | null>;
}

export class PeopleService {
  constructor(readonly repository: PeopleRepository, readonly prepare: (scope: PeopleScope) => Promise<void>, readonly now: () => number = Date.now) { }

  async list(scope: PeopleScope, input: unknown): Promise<PeoplePage<AppPerson | PlatformPerson>> {
    await this.prepare(scope);
    const parsed = ("appId" in scope ? AppPeopleQuerySchema : PlatformPeopleQuerySchema).safeParse(input);
    if (!parsed.success) throw new PlatformAccessError("INVALID_REQUEST", 400);
    const { limit = 50, cursor, ...filters } = parsed.data;
    const query = { ...filters, query: filters.query?.trim().toLowerCase() || undefined, filter: filters.filter ?? "current" };
    const binding = JSON.stringify([scope, query.query ?? null, query.filter, "authority" in query ? query.authority ?? null : null, "effectiveAccess" in query ? query.effectiveAccess ?? null : null]);
    const clock = this.now();
    const snapshot = await this.repository.readSnapshot();
    let after: { key: string; time: number } | null = null;
    let expiresAt = await this.repository.nextExpiry(scope, clock);
    if (cursor) {
      try {
        const decoded = JSON.parse(decodeURIComponent(atob(cursor)));
        if (decoded.version !== 1 || decoded.binding !== binding || decoded.snapshot !== snapshot
          || !Number.isSafeInteger(decoded.time) || decoded.time < 0 || typeof decoded.key !== "string" || !decoded.key
          || (decoded.expiresAt !== null && (!Number.isSafeInteger(decoded.expiresAt) || decoded.expiresAt <= clock))) throw new Error("invalid");
        after = { key: decoded.key, time: decoded.time };
        expiresAt = decoded.expiresAt;
      } catch { throw new PlatformAccessError("INVALID_CURSOR", 400); }
    }
    const rows = await this.repository.list({ scope, query, after, now: clock, limit: limit + 1 });
    if (snapshot !== await this.repository.readSnapshot() || (expiresAt !== null && expiresAt <= this.now())) {
      throw new PlatformAccessError("INVALID_CURSOR", 400);
    }
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(row => row.item),
      nextCursor: rows.length > limit && last
        ? btoa(encodeURIComponent(JSON.stringify({ version: 1, binding, snapshot, time: last.time, key: last.key, expiresAt })))
        : null,
    };
  }
}