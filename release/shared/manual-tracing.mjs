import {
  parseManualTraceSampleRate,
  parseTraceHmacKeyRing,
  requiredTraceConfig,
  validateOtlpTraceEndpoint,
} from "../../packages/observability/src/trace-config.ts";

export const ManualTracingSecretNames = Object.freeze([
  "UNICAS_OTLP_AUTHORIZATION",
  "UNICAS_TRACE_HMAC_KEYS",
]);

export function resolveManualTracingDeployment(environment = {}) {
  const sampleRate = parseManualTraceSampleRate(environment.UNICAS_MANUAL_TRACE_SAMPLE_RATE);
  if (sampleRate === 0) {
    return {
      enabled: false,
      variables: {},
      secrets: {},
    };
  }

  const endpoint = validateOtlpTraceEndpoint(requiredTraceConfig(
    environment.UNICAS_OTLP_TRACES_ENDPOINT,
    "UNICAS_OTLP_TRACES_ENDPOINT",
  ));
  const authorization = requiredTraceConfig(
    environment.UNICAS_OTLP_AUTHORIZATION,
    "UNICAS_OTLP_AUTHORIZATION",
  );
  if (/[\r\n]/.test(authorization)) {
    throw new TypeError("UNICAS_OTLP_AUTHORIZATION must be a single HTTP header value");
  }
  const hmacKeys = requiredTraceConfig(
    environment.UNICAS_TRACE_HMAC_KEYS,
    "UNICAS_TRACE_HMAC_KEYS",
  );
  parseTraceHmacKeyRing(hmacKeys);

  return {
    enabled: true,
    variables: {
      UNICAS_MANUAL_TRACE_SAMPLE_RATE: environment.UNICAS_MANUAL_TRACE_SAMPLE_RATE.trim(),
      UNICAS_OTLP_TRACES_ENDPOINT: endpoint,
    },
    secrets: {
      UNICAS_OTLP_AUTHORIZATION: authorization,
      UNICAS_TRACE_HMAC_KEYS: hmacKeys,
    },
  };
}
