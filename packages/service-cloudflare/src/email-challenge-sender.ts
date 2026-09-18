import type { EmailChallengeSender } from "./admin-bff/bff.js";

export class CloudflareEmailChallengeSender implements EmailChallengeSender {
  constructor(
    readonly binding: SendEmail,
    readonly from: string,
  ) { }

  async send(input: Parameters<EmailChallengeSender["send"]>[0]): Promise<void> {
    const expiresAt = new Date(input.expiresAt).toISOString();
    await this.binding.send({
      from: this.from,
      to: input.to,
      subject: "Your UniCAS verification code",
      text: `Your UniCAS verification code is ${input.code}. It expires at ${expiresAt}. If you did not request this code, you can ignore this message.`,
      html: `<p>Your UniCAS verification code is <strong>${escapeHtml(input.code)}</strong>.</p><p>It expires at ${escapeHtml(expiresAt)}.</p><p>If you did not request this code, you can ignore this message.</p>`,
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}