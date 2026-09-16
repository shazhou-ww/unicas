import { useEffect, useState } from "react";

/** Parse the location hash into a route path, e.g. "#/apps/cas_x" -> "/apps/cas_x". */
export function currentHashRoute(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash.length === 0 ? "/" : hash;
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function useHashRoute(): string {
  const [route, setRoute] = useState(currentHashRoute);
  useEffect(() => {
    const onChange = () => setRoute(currentHashRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export interface RouteMatch {
  readonly pattern: string;
  readonly params: Readonly<Record<string, string>>;
}

/** Match a route path against a pattern with `:param` segments. */
export function matchRoute(pattern: string, path: string): RouteMatch | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const segment = patternParts[i]!;
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeURIComponent(pathParts[i]!);
    } else if (segment !== pathParts[i]) {
      return null;
    }
  }
  return { pattern, params };
}

export type AppSection = "overview" | "members" | "invitations" | "playground" | "change-logs";

export interface AppRoute {
  readonly appId: string;
  readonly section: AppSection;
  readonly peopleFilter?: string;
}

/** Parse an app route like /apps/{appId}/overview into appId and section. */
export function parseAppRoute(path: string): AppRoute | null {
  const [pathname, search] = path.split("?");
  const segments = pathname!.split("/").filter(Boolean);
  if (segments.length < 2 || segments[0] !== "apps") return null;
  const appId = decodeURIComponent(segments[1]!);
  const section = segments[2] ?? "overview";
  const validSections: AppSection[] = ["overview", "members", "invitations", "playground", "change-logs"];
  if (!validSections.includes(section as AppSection)) return null;
  return { appId, section: section as AppSection, ...(search ? { peopleFilter: new URLSearchParams(search).get("filter") ?? "current" } : {}) };
}

export type PlatformSection = "people" | "principals" | "invitations" | "audit";

export interface PlatformRoute {
  readonly section: PlatformSection;
  readonly peopleFilter?: string;
}

/** Parse a platform route like /platform/principals into section. */
export function parsePlatformRoute(path: string): PlatformRoute | null {
  const [pathname, search] = path.split("?");
  const segments = pathname!.split("/").filter(Boolean);
  if (segments.length < 1 || segments[0] !== "platform") return null;
  const section = segments[1] ?? "people";
  const validSections: PlatformSection[] = ["people", "principals", "invitations", "audit"];
  if (!validSections.includes(section as PlatformSection)) return null;
  return { section: section as PlatformSection, ...(search ? { peopleFilter: new URLSearchParams(search).get("filter") ?? "current" } : {}) };
}
