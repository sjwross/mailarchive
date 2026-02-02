import type { Client } from "@microsoft/microsoft-graph-client";
import { getMicrosoftToken } from "./microsoft-token.js";

const BASE_PATH = "mailarchive";

/**
 * OneDrive uses the same Microsoft connection as Outlook. Returns the Graph client
 * when the user has Microsoft connected (with Files.ReadWrite scope).
 */
export async function getOneDriveForUser(
  userId: string
): Promise<{ client: Client; accountId: string } | null> {
  const tokenResult = await getMicrosoftToken(userId);
  if (!tokenResult) return null;
  return { client: tokenResult.client, accountId: tokenResult.tokenData.accountId };
}

/** Build OneDrive path: mailarchive/{userId}/{folderName}/{year}/{month} */
function buildArchivePath(
  userId: string,
  folderName: string,
  year: number,
  month: string
): string {
  const safeFolder = folderName.replace(/[^\w.-]/g, "_");
  return `${BASE_PATH}/${userId}/${safeFolder}/${year}/${month}`;
}

/**
 * Upload .eml content to OneDrive at path mailarchive/{userId}/{folderName}/{year}/{month}/{filename}.
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
}): Promise<string> {
  const { client, userId, folderName, year, month, filename, mimeContent } = params;
  const folderPath = buildArchivePath(userId, folderName, year, month);
  // Path-based upload: PUT /me/drive/root:/path/to/file:/content
  const itemPath = `${folderPath}/${filename}`;
  const apiPath = `/me/drive/root:/${itemPath}:/content`;

  const response = await client.api(apiPath).put(mimeContent);
  return response?.id ?? "";
}
