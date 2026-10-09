declare const spaceSelectorBrand: unique symbol;

export const SPACE_ID_MAX_LENGTH = 256;
export const SPACE_ID_PATTERN = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
export const SPACE_SELECTOR_MAX_LENGTH = SPACE_ID_MAX_LENGTH + 2;

export type SpaceSelector = string & {
  readonly [spaceSelectorBrand]: true;
};

export type SpaceSelectorKind = "exact" | "segment-prefix" | "recursive-prefix";

export interface ParsedSpaceSelector {
  readonly selector: SpaceSelector;
  readonly kind: SpaceSelectorKind;
  readonly literalPrefix: string;
}

export function validateSpaceId(value: unknown): string | null {
  if (typeof value !== "string") return "spaceId must be a string";
  if (value.length > SPACE_ID_MAX_LENGTH) {
    return `spaceId must be at most ${SPACE_ID_MAX_LENGTH} characters`;
  }
  if (!SPACE_ID_PATTERN.test(value)) {
    return "spaceId must start with '/' and contain non-empty ASCII letter, digit, '_' or '-' path segments";
  }
  return null;
}

export function parseSpaceSelector(value: string): ParsedSpaceSelector | null {
  if (value.length > SPACE_SELECTOR_MAX_LENGTH) return null;
  if (value.endsWith("/**")) {
    const prefix = value.slice(0, -3);
    if (validateSpaceId(prefix) !== null) return null;
    return {
      selector: value as SpaceSelector,
      kind: "recursive-prefix",
      literalPrefix: `${prefix}/`,
    };
  }
  if (value.endsWith("*")) {
    if (value.indexOf("*") !== value.length - 1) return null;
    const prefix = value.slice(0, -1);
    if (validateSpaceId(prefix) !== null) return null;
    return {
      selector: value as SpaceSelector,
      kind: "segment-prefix",
      literalPrefix: prefix,
    };
  }
  if (validateSpaceId(value) !== null) return null;
  return {
    selector: value as SpaceSelector,
    kind: "exact",
    literalPrefix: value,
  };
}

export function spaceSelectorMatches(
  selector: string | ParsedSpaceSelector,
  spaceId: string,
): boolean {
  if (validateSpaceId(spaceId) !== null) return false;
  const parsed = typeof selector === "string" ? parseSpaceSelector(selector) : selector;
  if (!parsed) return false;
  switch (parsed.kind) {
    case "exact":
      return spaceId === parsed.literalPrefix;
    case "segment-prefix": {
      if (!spaceId.startsWith(parsed.literalPrefix)) return false;
      return !spaceId.slice(parsed.literalPrefix.length).includes("/");
    }
    case "recursive-prefix":
      return spaceId.startsWith(parsed.literalPrefix);
  }
}
