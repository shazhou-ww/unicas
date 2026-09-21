import { AwsClient } from "aws4fetch";

export const CanonicalUploadContentType = "application/vnd.unidocs.cas-node.v1";

export interface R2UploadPresignerConfig {
  readonly accountId: string;
  readonly bucketName: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly expiresInSeconds: number;
  readonly now?: () => number;
}

export interface PresignedR2Upload {
  readonly method: "PUT";
  readonly url: string;
  readonly expiresAt: number;
  readonly headers: Readonly<Record<string, string>>;
}

export class R2UploadPresigner {
  readonly #accountId: string;
  readonly #bucketName: string;
  readonly #expiresInSeconds: number;
  readonly #now: () => number;
  readonly #client: AwsClient;

  constructor(config: R2UploadPresignerConfig) {
    this.#accountId = requireComponent(config.accountId, "R2 account ID");
    this.#bucketName = requireComponent(config.bucketName, "R2 bucket name");
    if (!Number.isSafeInteger(config.expiresInSeconds)
      || config.expiresInSeconds < 1
      || config.expiresInSeconds > 604_800) {
      throw new TypeError("R2 upload URL expiry must be an integer between 1 and 604800 seconds");
    }
    this.#expiresInSeconds = config.expiresInSeconds;
    this.#now = config.now ?? (() => Date.now());
    this.#client = new AwsClient({
      accessKeyId: requireComponent(config.accessKeyId, "R2 access key ID"),
      secretAccessKey: requireComponent(config.secretAccessKey, "R2 secret access key"),
      service: "s3",
      region: "auto",
    });
  }

  async signPut(objectKey: string): Promise<PresignedR2Upload> {
    const encodedKey = objectKey.split("/").map(segment => encodeURIComponent(
      requireComponent(segment, "R2 object key segment"),
    )).join("/");
    const url = new URL(
      `https://${encodeURIComponent(this.#accountId)}.r2.cloudflarestorage.com/`
      + `${encodeURIComponent(this.#bucketName)}/${encodedKey}`,
    );
    url.searchParams.set("X-Amz-Expires", String(this.#expiresInSeconds));
    const headers = {
      "Content-Type": CanonicalUploadContentType,
      "If-None-Match": "*",
    } as const;
    const signed = await this.#client.sign(url, {
      method: "PUT",
      headers,
      aws: { signQuery: true, allHeaders: true },
    });
    return {
      method: "PUT",
      url: signed.url,
      expiresAt: this.#now() + this.#expiresInSeconds * 1000,
      headers,
    };
  }
}

function requireComponent(value: string, name: string): string {
  if (value.length === 0 || /[\r\n]/.test(value)) throw new TypeError(`${name} must not be empty`);
  return value;
}