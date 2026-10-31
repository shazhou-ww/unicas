const PRODUCTION_ORIGIN = "https://api.unicas.work";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeSmokeBaseUrl(value, allowOtherOrigin = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("smoke base URL must be an absolute URL");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("smoke base URL must contain only scheme, host, and optional port");
  }
  const isProduction = url.origin === PRODUCTION_ORIGIN;
  const isLoopback = url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
  const isExplicitOther = allowOtherOrigin && url.protocol === "https:";
  if (!isProduction && !isLoopback && !isExplicitOther) {
    throw new TypeError(
      `smoke target ${url.origin} is not allowed; set UNICAS_SMOKE_ALLOW_OTHER_ORIGIN=true for an explicit HTTPS override`,
    );
  }
  return url.origin;
}