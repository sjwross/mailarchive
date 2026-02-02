import { db } from "../db.js";
import { getMicrosoftToken } from "./microsoft-token.js";
import {
  getWellKnownFolder,
  listMessages,
  moveMessage,
  MicrosoftMessage,
} from "./microsoft-graph.js";

export type JunkDeleteConfig = {
  keywords: string[];
  senderPatterns: string[];
};

export type JunkDeleteRuleRow = {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  last_run_at: Date | null;
  max_per_run: number;
  config: JunkDeleteConfig;
};

export type JunkDeleteRunSummary = {
  ruleId: string;
  scanned: number;
  matched: number;
  moved: number;
  failed: number;
  firstError?: string;
};

const DEFAULT_CONFIG: JunkDeleteConfig = {
  keywords: [],
  senderPatterns: [],
};

/** Decode RFC 2047 encoded words in subject (e.g. =?UTF-8?B?ZnJlZQ==?= -> "free"). */
function decodeRfc2047Subject(subject: string): string {
  return subject.replace(/\?=\s*=\?/g, "?= =?").replace(/=\?([^?]*)\?([BQbq])\?([^?]*)\?=/g, (_, _charset, enc, payload) => {
    try {
      if (enc.toUpperCase() === "B") {
        return Buffer.from(payload.replace(/\s/g, ""), "base64").toString("utf8");
      }
      if (enc.toUpperCase() === "Q") {
        return payload.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) =>
          String.fromCharCode(parseInt(hex, 16))
        );
      }
    } catch {
      /* ignore */
    }
    return payload;
  });
}

function normalizeConfig(config: unknown): JunkDeleteConfig {
  if (!config || typeof config !== "object") return { ...DEFAULT_CONFIG };
  const c = config as Record<string, unknown>;
  return {
    keywords: Array.isArray(c.keywords) ? c.keywords.filter((x): x is string => typeof x === "string") : [],
    senderPatterns: Array.isArray(c.senderPatterns)
      ? c.senderPatterns.filter((x): x is string => typeof x === "string")
      : [],
  };
}

/** Normalize string for matching: collapse whitespace, trim, lowercase. */
function normalizeForMatch(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Strip optional leading/trailing * so *manpower* matches substring "manpower". */
function keywordForMatch(s: string): string {
  let k = s.trim().toLowerCase();
  if (k.startsWith("*")) k = k.slice(1);
  if (k.endsWith("*")) k = k.slice(0, -1);
  return k;
}

/** Check if a message matches the rule (subject, bodyPreview, From address/name keywords, or sender patterns). */
function messageMatches(msg: MicrosoftMessage, config: JunkDeleteConfig): boolean {
  const rawSubject = msg.subject || "";
  const decodedSubject = decodeRfc2047Subject(rawSubject);
  const subjectNorm = normalizeForMatch(decodedSubject);
  const rawSubjectNorm = normalizeForMatch(rawSubject);
  const bodyPreviewNorm = normalizeForMatch(msg.bodyPreview || "");
  const fromAddress = (msg.from?.emailAddress?.address || "").toLowerCase();
  const fromName = (msg.from?.emailAddress?.name || "").toLowerCase();

  for (const kw of config.keywords) {
    if (typeof kw !== "string" || !kw.trim()) continue;
    const k = keywordForMatch(kw);
    if (!k) continue;
    if (subjectNorm.includes(k) || rawSubjectNorm.includes(k) || bodyPreviewNorm.includes(k) || fromAddress.includes(k) || fromName.includes(k)) return true;
  }

  for (const pattern of config.senderPatterns) {
    if (typeof pattern !== "string" || !pattern.trim()) continue;
    const p = pattern.trim().toLowerCase();
    if (p.includes("*")) {
      const regex = new RegExp("^" + p.replace(/\*/g, ".*") + "$", "i");
      if (regex.test(fromAddress) || regex.test(fromName)) return true;
    } else if (fromAddress === p || fromAddress.endsWith("@" + p) || fromAddress.includes(p) || fromName.includes(p)) {
      return true;
    }
  }

  return false;
}

export async function runJunkDeleteOnce(
  userId: string,
  ruleId: string
): Promise<JunkDeleteRunSummary> {
  const ruleResult = await db.query<JunkDeleteRuleRow>(
    "SELECT id, user_id, name, enabled, schedule, last_run_at, max_per_run, config FROM mailarchive_junk_delete_rules WHERE id = $1 AND user_id = $2",
    [ruleId, userId]
  );
  if (ruleResult.rows.length === 0) {
    throw new Error("Junk delete rule not found");
  }
  const rule = ruleResult.rows[0];
  const config = normalizeConfig(rule.config);
  if (config.keywords.length === 0 && config.senderPatterns.length === 0) {
    return { ruleId, scanned: 0, matched: 0, moved: 0, failed: 0 };
  }

  const tokenResult = await getMicrosoftToken(userId);
  if (!tokenResult) {
    throw new Error("Microsoft account not connected");
  }
  const { client, tokenData } = tokenResult;
  const accountId = tokenData.accountId;

  const [junkFolder, deletedFolder] = await Promise.all([
    getWellKnownFolder(client, accountId, "junkemail"),
    getWellKnownFolder(client, accountId, "deleteditems"),
  ]);

  const moveLimit = Math.min(500, Math.max(1, rule.max_per_run));
  const scanLimit = 500; // Scan up to 500 messages so we don't miss matches in older Junk
  let scanned = 0;
  let matched = 0;
  let moved = 0;
  let failed = 0;
  let firstError: string | undefined;

  const messageSelect = ["id", "subject", "bodyPreview", "from", "receivedDateTime"];
  let messages: MicrosoftMessage[] = await listMessages(
    client,
    accountId,
    junkFolder.id,
    100,
    undefined,
    messageSelect
  );

  while (messages.length > 0 && scanned < scanLimit && moved < moveLimit) {
    const batch = messages;
    scanned += batch.length;

    for (const msg of batch) {
      if (moved >= moveLimit) break;
      if (!messageMatches(msg, config)) continue;
      matched++;
      try {
        await moveMessage(client, accountId, msg.id, deletedFolder.id);
        moved++;
      } catch (err) {
        failed++;
        const e = err as { message?: string };
        if (!firstError) firstError = e.message || "Move failed";
      }
    }

    if (scanned >= scanLimit || moved >= moveLimit || messages.length < 100) break;
    const oldestInBatch = batch[batch.length - 1];
    const receivedBefore = oldestInBatch?.receivedDateTime ? new Date(oldestInBatch.receivedDateTime) : undefined;
    messages = await listMessages(client, accountId, junkFolder.id, 100, receivedBefore, messageSelect);
  }

  await db.query(
    "UPDATE mailarchive_junk_delete_rules SET last_run_at = NOW() WHERE id = $1",
    [ruleId]
  );

  return { ruleId, scanned, matched, moved, failed, firstError };
}
