import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { db } from "../db.js";
import { decrypt } from "./encryption.js";

export interface S3Config {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  basePath?: string;
}

export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: !!config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function buildObjectKey(params: {
  userId: string;
  folderName: string;
  receivedAt: Date;
  subjectHash: string;
  basePath?: string;
}): string {
  const year = params.receivedAt.getUTCFullYear();
  const month = String(params.receivedAt.getUTCMonth() + 1).padStart(2, "0");
  const safeFolder = params.folderName.replace(/[^\w.-]/g, "_");
  const prefix = params.basePath ? params.basePath.replace(/\/?$/, "/") : "";
  return `${prefix}${params.userId}/${safeFolder}/${year}/${month}/${params.subjectHash}.eml`;
}

export async function uploadEml(
  config: S3Config,
  key: string,
  body: string | Uint8Array
): Promise<{ bucket: string; key: string }> {
  const client = createS3Client(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: "message/rfc822",
    })
  );
  return { bucket: config.bucket, key };
}

export async function getUserS3Config(userId: string): Promise<S3Config | null> {
  const result = await db.query(
    "SELECT config_encrypted FROM mailarchive_connections WHERE user_id = $1 AND provider = $2 ORDER BY created_at DESC LIMIT 1",
    [userId, "s3"]
  );
  if (result.rows.length === 0) return null;
  try {
    const parsed = JSON.parse(decrypt(result.rows[0].config_encrypted));
    return parsed as S3Config;
  } catch {
    return null;
  }
}

