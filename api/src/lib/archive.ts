import { db } from "../db.js";
import { getMicrosoftToken } from "./microsoft-token.js";
import { getUserS3Config, buildObjectKey, uploadEml } from "./s3.js";
import {
  listMessages,
  getMessageMime,
  listFolders,
  getWellKnownFolder,
  MicrosoftFolder,
  MicrosoftMessage,
  moveMessage,
} from "./microsoft-graph.js";
import { getDriveForUser, ensureDrivePath, uploadEmlToDrive } from "./google-drive.js";
import { getOneDriveForUser, uploadEmlToOneDrive } from "./onedrive.js";

type RuleRow = {
  id: string;
  user_id: string;
  name: string;
  age_threshold_days: number;
  folder_ids: string[];
  safety_mode: "archive_only" | "archive_move" | "archive_delete";
  schedule: "manual" | "daily" | "weekly";
};

export type ArchiveStorageUsed = "s3" | "gdrive" | "onedrive";

export type ArchiveRunSummary = {
  ruleId: string;
  processedFolders: string[];
  totalMessagesConsidered: number;
  totalArchived: number;
  totalFailed: number;
  /** Which storage backend was used (priority: S3 > Google Drive > OneDrive) */
  storageUsed?: ArchiveStorageUsed;
  /** First error message when totalFailed > 0, so UI can show why without reading logs */
  firstError?: string;
  /** Saved folder IDs that no longer exist (e.g. after Microsoft reconnect) */
  staleFolderIds?: string[];
  safetyMode: RuleRow["safety_mode"];
};

function resolveFolderIds(
  requestedIds: string[],
  folders: MicrosoftFolder[]
): { folderIds: string[]; staleFolderIds: string[] } {
  const folderMap = new Map(folders.map((f) => [f.id, f]));
  const valid = requestedIds.filter((id) => folderMap.has(id));
  const stale = requestedIds.filter((id) => !folderMap.has(id));

  if (valid.length > 0) {
    return { folderIds: valid, staleFolderIds: stale };
  }

  if (requestedIds.length === 0) {
    const inbox = folders.find((f) => f.displayName.toLowerCase() === "inbox");
    return { folderIds: inbox ? [inbox.id] : [], staleFolderIds: [] };
  }

  // All saved folder IDs are stale (common after Microsoft reconnect)
  const inbox = folders.find((f) => f.displayName.toLowerCase() === "inbox");
  return { folderIds: inbox ? [inbox.id] : [], staleFolderIds: stale };
}

export async function runArchiveOnce(
  userId: string,
  ruleId: string,
  maxMessages: number = 50
): Promise<ArchiveRunSummary> {
  const ruleResult = await db.query<RuleRow>(
    "SELECT id, user_id, name, age_threshold_days, folder_ids, safety_mode, schedule FROM mailarchive_rules WHERE id = $1 AND user_id = $2",
    [ruleId, userId]
  );
  if (ruleResult.rows.length === 0) {
    throw new Error("Rule not found for user");
  }
  const rule = ruleResult.rows[0];

  const tokenResult = await getMicrosoftToken(userId);
  if (!tokenResult) {
    throw new Error("Microsoft account not connected");
  }

  const s3Config = await getUserS3Config(userId);
  const drive = await getDriveForUser(userId);
  const oneDrive = await getOneDriveForUser(userId);

  if (!s3Config && !drive && !oneDrive) {
    throw new Error("No storage configured (S3, Google Drive, or Microsoft OneDrive)");
  }

  const prefResult = await db.query<{ preferred_archive_storage: string | null }>(
    "SELECT preferred_archive_storage FROM mailarchive_users WHERE id = $1",
    [userId]
  );
  const preferred = prefResult.rows[0]?.preferred_archive_storage as ArchiveStorageUsed | undefined;
  const preferredAndConfigured =
    preferred === "s3" && s3Config
      ? "s3"
      : preferred === "gdrive" && drive
        ? "gdrive"
        : preferred === "onedrive" && oneDrive
          ? "onedrive"
          : null;
  const storageUsed: ArchiveRunSummary["storageUsed"] =
    preferredAndConfigured ?? (s3Config ? "s3" : oneDrive ? "onedrive" : "gdrive");

  const { client, tokenData } = tokenResult;

  const folders: MicrosoftFolder[] = await listFolders(client, tokenData.accountId);
  const folderMap = new Map<string, MicrosoftFolder>();
  folders.forEach((f) => folderMap.set(f.id, f));

  const archiveFolder =
    folders.find((f) => f.displayName.toLowerCase() === "archive") ||
    folders.find((f) => f.displayName.toLowerCase().includes("archive"));
  const archiveFolderId = archiveFolder?.id;

  let deletedFolderId: string | undefined;
  if (rule.safety_mode === "archive_delete") {
    const deleted = await getWellKnownFolder(client, tokenData.accountId, "deleteditems");
    deletedFolderId = deleted.id;
  }

  const cutoff = new Date(Date.now() - rule.age_threshold_days * 24 * 60 * 60 * 1000);

  const { folderIds: folderIdsToProcess, staleFolderIds } = resolveFolderIds(
    rule.folder_ids,
    folders
  );

  if (folderIdsToProcess.length === 0) {
    return {
      ruleId,
      processedFolders: [],
      totalMessagesConsidered: 0,
      totalArchived: 0,
      totalFailed: 0,
      storageUsed,
      firstError:
        staleFolderIds.length > 0
          ? "Saved mail folders are no longer valid. Reconnect Microsoft and re-select folders for this rule."
          : undefined,
      staleFolderIds: staleFolderIds.length > 0 ? staleFolderIds : undefined,
      safetyMode: rule.safety_mode,
    };
  }

  if (staleFolderIds.length > 0) {
    await db.query(
      "UPDATE mailarchive_rules SET folder_ids = $1 WHERE id = $2 AND user_id = $3",
      [JSON.stringify(folderIdsToProcess), ruleId, userId]
    );
  }

  let totalConsidered = 0;
  let totalArchived = 0;
  let totalFailed = 0;
  let firstError: string | undefined;
  const processedFolderIds: string[] = [];

  for (const folderId of folderIdsToProcess) {
    if (totalArchived + totalFailed >= maxMessages) break;

    const folder = folderMap.get(folderId);
    const folderName = folder?.displayName ?? folderId;

    let messages: MicrosoftMessage[];
    try {
      messages = await listMessages(
        client,
        tokenData.accountId,
        folderId,
        maxMessages,
        cutoff
      );
    } catch (err) {
      // Graph sometimes rejects $filter; retry without server filter and apply cutoff in memory.
      try {
        messages = await listMessages(client, tokenData.accountId, folderId, maxMessages * 2);
      } catch (retryErr) {
        const errMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (!firstError) firstError = errMsg;
        // eslint-disable-next-line no-console
        console.error("[archive] Failed to list messages for folder", folderId, retryErr);
        continue;
      }
    }

    const eligible = messages.filter((m) => {
      if (!m.receivedDateTime) return false;
      const received = new Date(m.receivedDateTime);
      return received < cutoff;
    });

    for (const msg of eligible) {
      if (totalArchived + totalFailed >= maxMessages) break;
      totalConsidered += 1;

      try {
        const mime = await getMessageMime(client, tokenData.accountId, msg.id);
        const received = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date();
        const subject = msg.subject || "no-subject";
        const subjectHash = createSubjectHash(subject, msg.id);
        if (storageUsed === "s3" && s3Config) {
          const key = buildObjectKey({
            userId,
            folderName,
            receivedAt: received,
            subjectHash,
            basePath: s3Config.basePath,
          });
          await uploadEml(s3Config, key, mime);
        } else if (storageUsed === "onedrive" && oneDrive) {
          const year = received.getUTCFullYear();
          const month = String(received.getUTCMonth() + 1).padStart(2, "0");
          const filename = `${subjectHash}.eml`;
          await uploadEmlToOneDrive({
            client: oneDrive.client,
            userId,
            folderName,
            year,
            month,
            filename,
            mimeContent: mime,
          });
        } else if (storageUsed === "gdrive" && drive) {
          const year = received.getUTCFullYear();
          const month = String(received.getUTCMonth() + 1).padStart(2, "0");
          const folderId = await ensureDrivePath(
            drive.drive,
            drive.config,
            userId,
            folderName,
            year,
            month
          );
          const filename = `${subjectHash}.eml`;
          await uploadEmlToDrive({
            drive: drive.drive,
            folderId,
            filename,
            mimeContent: mime,
          });
        }

        if (rule.safety_mode === "archive_move") {
          if (!archiveFolderId) {
            // eslint-disable-next-line no-console
            console.warn("[archive] No Archive folder found; skipping move for message", msg.id);
          } else {
            await moveMessage(client, tokenData.accountId, msg.id, archiveFolderId);
          }
        } else if (rule.safety_mode === "archive_delete") {
          if (!deletedFolderId) {
            // eslint-disable-next-line no-console
            console.warn("[archive] No Deleted Items folder found; skipping move for message", msg.id);
          } else {
            await moveMessage(client, tokenData.accountId, msg.id, deletedFolderId);
          }
        }

        totalArchived += 1;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const alreadyGone =
          /not found in the store|errorinvalidid|itemnotfound|mailboxitemnotfound/i.test(errMsg);
        if (alreadyGone) {
          // Message was already archived/moved in a prior run; skip without counting as failed.
          continue;
        }
        totalFailed += 1;
        if (!firstError) firstError = errMsg;
        // eslint-disable-next-line no-console
        console.error("[archive] Failed to archive message", msg.id, errMsg);
      }
    }

    processedFolderIds.push(folderId);
  }

  return {
    ruleId,
    processedFolders: processedFolderIds,
    totalMessagesConsidered: totalConsidered,
    totalArchived,
    totalFailed,
    storageUsed,
    firstError,
    staleFolderIds: staleFolderIds.length > 0 ? staleFolderIds : undefined,
    safetyMode: rule.safety_mode,
  };
}

function createSubjectHash(subject: string, fallback: string): string {
  const input = subject || fallback;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    const chr = input.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  const hex = (hash >>> 0).toString(16);
  return hex.padStart(8, "0");
}

