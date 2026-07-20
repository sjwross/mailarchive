/**
 * Best-effort ntfy push. No-op when NTFY_TOPIC is unset. Never throws.
 *
 * Env (project .env for API / UI runs):
 *   NTFY_TOPIC=...
 *   NTFY_URL=https://ntfy.sh   (optional)
 *   NTFY_TOKEN=...            (optional)
 *   NTFY_ON_SUCCESS=0         (optional; default on)
 */

export type NtfyOptions = {
  title: string;
  message: string;
  priority?: number;
  tags?: string[];
};

export function ntfyEnabled(): boolean {
  return Boolean(process.env.NTFY_TOPIC?.trim());
}

export function ntfySuccessEnabled(): boolean {
  return ntfyEnabled() && process.env.NTFY_ON_SUCCESS !== "0";
}

export async function sendNtfy(opts: NtfyOptions): Promise<void> {
  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) return;

  const base = (process.env.NTFY_URL || "https://ntfy.sh").replace(/\/$/, "");
  const url = `${base}/${topic}`;
  const headers: Record<string, string> = {
    Title: opts.title,
    Priority: String(opts.priority ?? 3),
  };
  if (opts.tags?.length) {
    headers.Tags = opts.tags.join(",");
  }
  const token = process.env.NTFY_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: opts.message,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[ntfy] send failed: HTTP ${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn("[ntfy] send failed:", msg);
  }
}

function storageLabel(storage?: string | null): string {
  if (storage === "gdrive") return "Google Drive";
  if (storage === "onedrive") return "OneDrive";
  if (storage === "s3") return "S3";
  return storage || "unknown";
}

export async function notifyArchiveSuccess(summary: {
  totalArchived: number;
  totalFailed: number;
  storageUsed?: string | null;
  source?: "manual" | "scheduled";
}): Promise<void> {
  if (!ntfySuccessEnabled()) return;
  const noun = summary.totalArchived === 1 ? "email" : "emails";
  const storage = storageLabel(summary.storageUsed);
  const source = summary.source === "scheduled" ? "Scheduled" : "Manual";
  let message = `${source}: archived ${summary.totalArchived} ${noun} to ${storage}.`;
  if (summary.totalFailed > 0) {
    message += ` Failed: ${summary.totalFailed}.`;
  }
  await sendNtfy({
    title: "Mail Archive OK",
    message,
    priority: 3,
    tags: ["white_check_mark", "email"],
  });
}

export async function notifyArchiveFailure(
  error: string,
  source: "manual" | "scheduled" = "manual"
): Promise<void> {
  if (!ntfyEnabled()) return;
  const label = source === "scheduled" ? "Scheduled" : "Manual";
  await sendNtfy({
    title: "Mail Archive failed",
    message: `${label}: ${error}`,
    priority: 5,
    tags: ["warning", "email"],
  });
}
