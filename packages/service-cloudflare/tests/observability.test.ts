import { describe, expect, test, vi } from "vitest";
import { CapabilityAuthenticationError } from "@unicas/space-protocol";
import {
  logUnexpectedError,
  traceCapabilityVerification,
  traceCleanupRun,
  traceNodeValidation,
  traceRootRefCommit,
  type TraceSpan,
  type TracingPort,
} from "../src/observability.js";

describe("unexpected error telemetry", () => {
  test("serializes only the reviewed bounded event", () => {
    const canaries = [
      "Bearer secret-capability",
      "session=secret-cookie",
      "csrf-secret",
      "oauth-code-secret",
      "-----BEGIN PRIVATE KEY-----",
      "https://upload.example/object?X-Amz-Signature=secret",
      "app-secret/space-secret/node-secret",
      "SELECT secret FROM private_content",
      "private request body",
    ];
    const error = Object.assign(new Error(canaries.join(" | ")), {
      cause: { authorization: canaries[0], requestBody: canaries.at(-1) },
    });
    const messages: string[] = [];

    logUnexpectedError(
      { event: "unicas_authorization_failed", plane: "space" },
      error,
      (message) => messages.push(message),
    );

    expect(messages).toEqual([
      JSON.stringify({ event: "unicas_authorization_failed", plane: "space" }),
    ]);
    for (const canary of canaries) {
      expect(messages[0]).not.toContain(canary);
    }
  });
});

describe("reviewed custom spans", () => {
  test("records only approved low-cardinality names and attributes", async () => {
    const recorded: Array<{ name: string; attributes: Record<string, unknown> }> = [];
    const tracing = recordingTracing(recorded);

    await traceCapabilityVerification(tracing, "lease", async () => "verified");
    await traceNodeValidation(tracing, async () => ({
      ok: true,
      validation: { storedBytes: 42, refs: ["redacted", "redacted"] },
    }));
    await traceRootRefCommit(tracing, 3, async () => "committed");
    await traceCleanupRun(tracing, async () => ({ examined: 7, deleted: 2, failed: 1 }));

    expect(recorded).toEqual([
      {
        name: "unicas.capability.verify",
        attributes: { "unicas.operation": "lease", "unicas.outcome": "ok" },
      },
      {
        name: "unicas.node.validate",
        attributes: {
          "unicas.node.bytes": 42,
          "unicas.node.refs": 2,
          "unicas.outcome": "ok",
        },
      },
      {
        name: "unicas.root_refs.commit",
        attributes: { "unicas.root_refs.mutations": 3, "unicas.outcome": "ok" },
      },
      {
        name: "unicas.cleanup.run",
        attributes: {
          "unicas.cleanup.examined": 7,
          "unicas.cleanup.deleted": 2,
          "unicas.cleanup.failed": 1,
          "unicas.outcome": "ok",
        },
      },
    ]);
  });

  test("classifies rejections and failures without swallowing errors", async () => {
    const recorded: Array<{ name: string; attributes: Record<string, unknown> }> = [];
    const tracing = recordingTracing(recorded);
    const rejection = new CapabilityAuthenticationError("missing_token", "secret detail");
    const failure = new Error("private failure detail");

    await expect(traceCapabilityVerification(tracing, "readMetadata", async () => {
      throw rejection;
    })).rejects.toBe(rejection);
    await expect(traceRootRefCommit(tracing, 1, async () => {
      throw failure;
    })).rejects.toBe(failure);
    await expect(traceNodeValidation(tracing, async () => ({ ok: false })))
      .resolves.toEqual({ ok: false });

    expect(recorded.map(({ attributes }) => attributes["unicas.outcome"]))
      .toEqual(["rejected", "failed", "rejected"]);
    expect(JSON.stringify(recorded)).not.toContain("secret detail");
    expect(JSON.stringify(recorded)).not.toContain("private failure detail");
  });

  test("skips attribute work for unsampled spans", async () => {
    const setAttribute = vi.fn();
    const tracing: TracingPort = {
      enterSpan: (_name, callback) => callback({ isTraced: false, setAttribute }),
    };

    await traceCleanupRun(tracing, async () => ({ examined: 1 }));

    expect(setAttribute).not.toHaveBeenCalled();
  });
});

function recordingTracing(
  target: Array<{ name: string; attributes: Record<string, unknown> }>,
): TracingPort {
  return {
    enterSpan(name, callback) {
      const entry = { name, attributes: {} };
      target.push(entry);
      const span: TraceSpan = {
        isTraced: true,
        setAttribute(key, value) {
          entry.attributes[key] = value;
        },
      };
      return callback(span);
    },
  };
}