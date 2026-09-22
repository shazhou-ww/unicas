import { tracing } from "cloudflare:workers";
import type { TracingPort } from "./observability.js";

export const runtimeTracing: TracingPort = tracing;