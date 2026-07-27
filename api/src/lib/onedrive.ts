import type { Client } from "@microsoft/microsoft-graph-client";
import { db } from "../db.js";
import { encrypt, decrypt } from "./encryption.js";
import { getMicrosoftToken } from "./microsoft-token.js";

const DEFAULT_BASE_PATH = "mailarchive";

/**
 * OneDrive uses the same Microsoft connection as Outlook. Returns the Graph client
 * when the user has Microsoft connected (with Files.ReadWrite scope).
 */
export async function getOneDriveForUser(
  userId: string
): Promise<{ client: Client; accountId: string; basePath: string } | null> {
  const tokenResult = await getMicrosoftToken(userId);
  if (!tokenResult) return null;
  return {
    client: tokenResult.client,
    accountId: tokenResult.tokenData.accountId,
    basePath: getOneDriveBasePathFromToken(tokenResult.tokenData),
  };
}

function getOneDriveBasePathFromToken(tokenData: { onedriveBasePath?: string }): string {
  const raw = (tokenData.onedriveBasePath ?? DEFAULT_BASE_PATH).trim().replace(/^\/+|\/+$/g, "");
  return raw || DEFAULT_BASE_PATH;
}

/** Validate OneDrive archive root path (one or more folder segments). */
export function normalizeOneDriveBasePath(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return DEFAULT_BASE_PATH;
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || !/^[\w.\- ]+$/.test(p))) {
    throw new Error(
      "Folder path may only contain letters, numbers, spaces, dots, hyphens, and underscores"
    );
  }
  return parts.join("/");
}

export async function updateOneDriveBasePath(
  userId: string,
  basePath: string
): Promise<string | null> {
  const connection = await db.query(
    "SELECT config_encrypted FROM mailarchive_connections WHERE user_id = $1 AND provider = $2 ORDER BY created_at DESC LIMIT 1",
    [userId, "microsoft"]
  );
  if (connection.rows.length === 0) return null;

  let tokenData: Record<string, unknown>;
  try {
    tokenData = JSON.parse(decrypt(connection.rows[0].config_encrypted));
  } catch {
    return null;
  }

  const normalized = normalizeOneDriveBasePath(basePath);
  const updated = { ...tokenData, onedriveBasePath: normalized };
  const encrypted = encrypt(JSON.stringify(updated));
  await db.query(
    "UPDATE mailarchive_connections SET config_encrypted = $1 WHERE user_id = $2 AND provider = $3",
    [encrypted, userId, "microsoft"]
  );
  return normalized;
}

/** Build OneDrive path: {basePath}/{userId}/{folderName}/{year}/{month} */
function buildArchivePath(
  basePath: string,
  userId: string,
  folderName: string,
  year: number,
  month: string
): string {
  const safeFolder = folderName.replace(/[^\w.-]/g, "_");
  const root = (basePath || DEFAULT_BASE_PATH).replace(/^\/+|\/+$/g, "") || DEFAULT_BASE_PATH;
  return `${root}/${userId}/${safeFolder}/${year}/${month}`;
}

/**
 * Upload .eml content to OneDrive at path {basePath}/{userId}/{folderName}/{year}/{month}/{filename}.
 * Parent folders are created by Graph when using path-based upload.
 */
export async function uploadEmlToOneDrive(params: {
  client: Client;
  userId: string;
  folderName: string;
  year: number;
  month: string;
  filename: string;
  mimeContent: string;
  basePath?: string;
}): Promise<string> {
  const { client, userId, folderName, year, month, filename, mimeContent } = params;
  const folderPath = buildArchivePath(
    params.basePath ?? DEFAULT_BASE_PATH,
    userId,
    folderName,
    year,
    month
  );
  // Path-based upload: PUT /me/drive/root:/path/to/file:/content
  const itemPath = `${folderPath}/${filename}`;
  const apiPath = `/me/drive/root:/${itemPath}:/content`;

  const response = await client.api(apiPath).put(mimeContent);
  return response?.id ?? "";
}
