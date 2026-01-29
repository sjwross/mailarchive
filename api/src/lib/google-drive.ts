import { Readable } from "stream";
import { google, drive_v3 } from "googleapis";
import { db } from "../db.js";
import { encrypt, decrypt } from "./encryption.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/gdrive/callback";

const BASE_FOLDER_NAME = "mailarchive";

export interface DriveConfig {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  rootFolderId?: string;
  email?: string;
}

export function getOAuthClient() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google Drive not configured (missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET)");
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

export function getDriveAuthUrl(state: string): string {
  const oauth2 = getOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      // drive.file only allows files the app created; we need to list/create folders under root
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/userinfo.email", // Needed to get user email
    ],
    state,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<DriveConfig> {
  const oauth2 = getOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Missing Google tokens");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date || Date.now() + 3600_000,
  };
}

export async function getDriveForUser(
  userId: string
): Promise<{ drive: drive_v3.Drive; config: DriveConfig } | null> {
  const res = await db.query(
    "SELECT config_encrypted FROM mailarchive_connections WHERE user_id = $1 AND provider = $2 ORDER BY created_at DESC LIMIT 1",
    [userId, "gdrive"]
  );
  if (res.rows.length === 0) return null;

  let cfg: DriveConfig;
  try {
    cfg = JSON.parse(decrypt(res.rows[0].config_encrypted));
  } catch {
    return null;
  }

  const oauth2 = getOAuthClient();
  oauth2.setCredentials({
    access_token: cfg.accessToken,
    refresh_token: cfg.refreshToken,
    expiry_date: cfg.expiryDate,
  });

  // Refresh token if near expiry
  if (cfg.expiryDate && Date.now() >= cfg.expiryDate - 60_000) {
    const { credentials } = await oauth2.refreshAccessToken();
    cfg = {
      ...cfg,
      accessToken: credentials.access_token || cfg.accessToken,
      refreshToken: credentials.refresh_token || cfg.refreshToken,
      expiryDate: credentials.expiry_date || Date.now() + 3600_000,
    };
    const encrypted = encrypt(JSON.stringify(cfg));
    await db.query(
      "UPDATE mailarchive_connections SET config_encrypted = $1 WHERE user_id = $2 AND provider = $3",
      [encrypted, userId, "gdrive"]
    );
    oauth2.setCredentials({
      access_token: cfg.accessToken,
      refresh_token: cfg.refreshToken,
      expiry_date: cfg.expiryDate,
    });
  }

  const drive = google.drive({ version: "v3", auth: oauth2 });
  return { drive, config: cfg };
}

async function ensureFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string
): Promise<string> {
  const qParts = [`mimeType = 'application/vnd.google-apps.folder'`, `name = '${name.replace(/'/g, "\\'")}'`];
  if (parentId) {
    qParts.push(`'${parentId}' in parents`);
  } else {
    qParts.push("'root' in parents");
  }
  const q = qParts.join(" and ");
  const list = await drive.files.list({ q, fields: "files(id,name)" });
  if (list.data.files && list.data.files.length > 0 && list.data.files[0].id) {
    return list.data.files[0].id;
  }
  const create = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : ["root"],
    },
    fields: "id",
  });
  if (!create.data.id) {
    throw new Error("Failed to create folder in Google Drive");
  }
  return create.data.id;
}

export async function ensureDrivePath(
  drive: drive_v3.Drive,
  config: DriveConfig,
  userId: string,
  folderName: string,
  year: number,
  month: string
): Promise<string> {
  let rootId = config.rootFolderId;
  if (!rootId) {
    rootId = await ensureFolder(drive, BASE_FOLDER_NAME);
    const updated: DriveConfig = { ...config, rootFolderId: rootId };
    const encrypted = encrypt(JSON.stringify(updated));
    await db.query(
      "UPDATE mailarchive_connections SET config_encrypted = $1 WHERE provider = $2 AND config_encrypted = $3",
      [encrypted, "gdrive", encrypt(JSON.stringify(config))]
    );
  }

  const userFolder = await ensureFolder(drive, userId, rootId);
  const safeFolder = folderName.replace(/[^\w.-]/g, "_");
  const folderFolder = await ensureFolder(drive, safeFolder, userFolder);
  const yearFolder = await ensureFolder(drive, String(year), folderFolder);
  const monthFolder = await ensureFolder(drive, month, yearFolder);

  return monthFolder;
}

export async function uploadEmlToDrive(params: {
  drive: drive_v3.Drive;
  folderId: string;
  filename: string;
  mimeContent: string;
}): Promise<string> {
  const { drive, folderId, filename, mimeContent } = params;
  // googleapis multipartUpload expects body to have .pipe() (a Readable stream), not a Buffer
  const body = Readable.from(Buffer.from(mimeContent, "utf8"));
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: "message/rfc822",
      body,
    },
    fields: "id",
  });
  if (!res.data.id) {
    throw new Error("Failed to upload .eml to Google Drive");
  }
  return res.data.id;
}

