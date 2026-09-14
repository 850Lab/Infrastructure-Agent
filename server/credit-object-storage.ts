import { randomUUID } from "crypto";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const SIGNED_UPLOAD_TTL_SECONDS = 5 * 60;

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

function readR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function createClient(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function isCreditStorageConfigured(): boolean {
  return readR2Config() !== null;
}

export function areCreditUploadsEnabled(): boolean {
  return process.env.CREDIT_STORAGE_UPLOADS_ENABLED === "true";
}

export function makeCreditStorageKey(input: {
  clientId: string;
  caseId: string;
  documentType: string;
}): string {
  // The key contains internal identifiers only—never a consumer name, email,
  // original filename, address, account number, or Social Security number.
  return [
    "credit",
    encodeURIComponent(input.clientId),
    encodeURIComponent(input.caseId),
    encodeURIComponent(input.documentType),
    randomUUID(),
  ].join("/");
}

export async function createCreditUploadUrl(input: {
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}): Promise<{ uploadUrl: string; expiresInSeconds: number; requiredHeaders: Record<string, string> }> {
  const config = readR2Config();
  if (!config) throw new Error("Credit object storage is not configured");

  const requiredHeaders = {
    "content-type": input.contentType,
    "x-amz-meta-sha256": input.sha256,
  };
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: input.storageKey,
    ContentType: input.contentType,
    ContentLength: input.sizeBytes,
    Metadata: { sha256: input.sha256 },
  });

  const uploadUrl = await getSignedUrl(createClient(config), command, {
    expiresIn: SIGNED_UPLOAD_TTL_SECONDS,
  });
  return { uploadUrl, expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS, requiredHeaders };
}

export async function verifyCreditUpload(input: {
  storageKey: string;
  expectedContentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
}): Promise<void> {
  const config = readR2Config();
  if (!config) throw new Error("Credit object storage is not configured");

  const result = await createClient(config).send(new HeadObjectCommand({
    Bucket: config.bucket,
    Key: input.storageKey,
  }));

  const actualType = result.ContentType?.split(";")[0]?.trim().toLowerCase();
  const actualSha256 = result.Metadata?.sha256?.trim().toLowerCase();
  if (result.ContentLength !== input.expectedSizeBytes) throw new Error("Uploaded file size does not match");
  if (actualType !== input.expectedContentType) throw new Error("Uploaded file type does not match");
  if (actualSha256 !== input.expectedSha256) throw new Error("Uploaded file fingerprint does not match");
}
