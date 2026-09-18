import { describe, expect, test, vi } from "vitest";
import { CloudflareEmailChallengeSender } from "../src/email-challenge-sender.js";

describe("Cloudflare email challenge sender", () => {
  test("uses the structured binding without exposing challenge state", async () => {
    const send = vi.fn(async () => ({ messageId: "message-1" }));
    const sender = new CloudflareEmailChallengeSender(
      { send } as unknown as SendEmail,
      "no-reply@unicas.work",
    );
    await sender.send({
      to: "invitee@example.com",
      code: "123456",
      expiresAt: Date.parse("2026-09-17T12:10:00Z"),
    });
    expect(send).toHaveBeenCalledWith({
      from: "no-reply@unicas.work",
      to: "invitee@example.com",
      subject: "Your UniCAS verification code",
      text: expect.stringContaining("123456"),
      html: expect.stringContaining("<strong>123456</strong>"),
    });
    const message = send.mock.calls[0]![0];
    expect(JSON.stringify(message)).not.toContain("challenge-");
  });
});