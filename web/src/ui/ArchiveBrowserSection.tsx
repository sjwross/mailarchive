import React, { useEffect, useState, useCallback } from "react";

type Props = {
  token: string;
  onUnauthorized?: () => void;
};

type DriveStatus = {
  connected: boolean;
  email?: string | null;
};

type ListResponse = {
  folders: { id: string; name: string }[];
  files: { id: string; name: string; modifiedTime: string | null }[];
};

type BreadcrumbItem = { id: string; name: string };

export type ParsedAttachment = {
  filename: string;
  mimeType: string;
  contentBase64: string;
};

export type ParsedEmail = {
  from: string;
  to: string;
  subject: string;
  date: string;
  bodyPlain: string | null;
  bodyHtml: string | null;
  attachments: ParsedAttachment[];
};

/** Minimal .eml parser: headers + single/multipart body. */
function parseEml(raw: string): ParsedEmail {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blank = normalized.indexOf("\n\n");
  const headersStr = blank >= 0 ? normalized.slice(0, blank) : normalized;
  let bodyStr = blank >= 0 ? normalized.slice(blank + 2) : "";

  // Unfold header lines (continuation lines start with space/tab)
  const headerLines: string[] = [];
  for (const line of headersStr.split("\n")) {
    if (/^[ \t]/.test(line) && headerLines.length > 0) {
      headerLines[headerLines.length - 1] += " " + line.trim();
    } else {
      headerLines.push(line);
    }
  }

  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (!headers[key]) headers[key] = value;
    }
  }

  const get = (key: string) => headers[key] ?? "";

  // Decode body if transfer-encoding present
  const encoding = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  if (bodyStr && (encoding === "base64" || encoding === "quoted-printable")) {
    bodyStr = decodeBody(bodyStr, encoding);
  }

  // Multipart: find first text/plain or text/html part + attachments
  let bodyPlain: string | null = null;
  let bodyHtml: string | null = null;
  const attachments: ParsedAttachment[] = [];
  const contentType = get("content-type");
  const boundaryMatch = contentType.match(/boundary\s*=\s*["']?([^"'\s;]+)/i);
  const boundary = boundaryMatch?.[1]?.trim();

  function getPartDisposition(partHeadersStr: string): { disposition: string; filename: string } {
    const disp = partHeadersStr.match(/content-disposition:\s*([^;\n]+)/i)?.[1]?.trim().toLowerCase() ?? "";
    const filename = partHeadersStr.match(/filename\s*=\s*[\"']?([^\"'\n]+)[\"']?/i)?.[1]?.trim() ?? "";
    return { disposition: disp, filename: filename.replace(/^["']|["']$/g, "") };
  }

  if (boundary && bodyStr) {
    const parts = bodyStr.split("--" + boundary);
    for (const part of parts) {
      if (part.trim() === "" || part.trim() === "--") continue;
      const partBlank = part.indexOf("\n\n");
      const partHeadersStr = partBlank >= 0 ? part.slice(0, partBlank) : part;
      const partBody = partBlank >= 0 ? part.slice(partBlank + 2).trim() : "";
      const partType = partHeadersStr.match(/content-type:\s*([^;\n]+)/i)?.[1]?.trim().toLowerCase() ?? "";
      const partEnc = partHeadersStr.match(/content-transfer-encoding:\s*([^\s;]+)/i)?.[1]?.trim().toLowerCase() ?? "";
      const { disposition, filename } = getPartDisposition(partHeadersStr);
      const isAttachment = disposition.includes("attachment") || (filename && !partType.includes("text/plain") && !partType.includes("text/html"));

      if (isAttachment && filename) {
        let contentBase64: string;
        if (partEnc === "base64") {
          contentBase64 = partBody.replace(/\s/g, "");
        } else if (partEnc === "quoted-printable") {
          const decoded = decodeBody(partBody, "quoted-printable");
          const bytes = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i) & 0xff;
          contentBase64 = bytesToBase64(bytes);
        } else {
          const bytes = new TextEncoder().encode(partBody);
          contentBase64 = bytesToBase64(bytes);
        }
        attachments.push({
          filename,
          mimeType: partType || "application/octet-stream",
          contentBase64,
        });
        continue;
      }

      let decoded = partBody;
      if (partEnc === "base64" || partEnc === "quoted-printable") {
        decoded = decodeBody(partBody, partEnc);
      }
      if (partType.includes("text/plain") && !bodyPlain) bodyPlain = decoded;
      if (partType.includes("text/html") && !bodyHtml) bodyHtml = decoded;
    }
  }
  if (!bodyPlain && !bodyHtml) {
    if (contentType.toLowerCase().includes("text/html")) bodyHtml = bodyStr;
    else bodyPlain = bodyStr || null;
  }

  return {
    from: get("from"),
    to: get("to"),
    subject: get("subject"),
    date: get("date"),
    bodyPlain: bodyPlain || null,
    bodyHtml: bodyHtml || null,
    attachments,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

function decodeBody(str: string, encoding: string): string {
  if (encoding === "base64") {
    try {
      const raw = atob(str.replace(/\s/g, ""));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch {
      return str;
    }
  }
  if (encoding === "quoted-printable") {
    return str
      .replace(/=\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return str;
}

export function ArchiveBrowserSection({ token, onUnauthorized }: Props) {
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [path, setPath] = useState<BreadcrumbItem[]>([]);
  const [list, setList] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewContent, setViewContent] = useState<ParsedEmail | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [fileHeaders, setFileHeaders] = useState<Record<string, { subject: string; date: string; from: string; hasAttachments?: boolean }>>({});

  const checkUnauthorized = useCallback(
    (res: Response): boolean => {
      if (res.status === 401) {
        onUnauthorized?.();
        setError("Session expired; please log in again.");
        return true;
      }
      return false;
    },
    [onUnauthorized]
  );

  const loadStatus = useCallback(async () => {
    if (!token?.trim()) return;
    try {
      const res = await fetch("/api/gdrive/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkUnauthorized(res)) return;
      const data = (await res.json()) as DriveStatus;
      setDriveConnected(data.connected);
    } catch {
      setDriveConnected(false);
    }
  }, [token, checkUnauthorized]);

  const loadList = useCallback(
    async (folderId: string | null) => {
      if (!token?.trim()) return;
      setLoading(true);
      setError(null);
      try {
        const url = folderId
          ? `/api/gdrive/archive/list?folderId=${encodeURIComponent(folderId)}`
          : "/api/gdrive/archive/list";
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (checkUnauthorized(res)) return;
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || `List failed: ${res.status}`);
        }
        const data = (await res.json()) as ListResponse;
        setList(data);
        setFileHeaders({});
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load list";
        setError(msg);
        setList(null);
      } finally {
        setLoading(false);
      }
    },
    [token, checkUnauthorized]
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (driveConnected !== true) return;
    const folderId = path.length > 0 ? path[path.length - 1].id : null;
    void loadList(folderId);
  }, [driveConnected, path, loadList]);

  // Fetch headers (subject, date, from) for each file in the list
  useEffect(() => {
    if (!list?.files.length || !token?.trim()) return;
    const CONCURRENCY = 6;
    const ids = list.files.map((f) => f.id).filter((id) => !fileHeaders[id]);
    let cancelled = false;
    const run = async () => {
      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        if (cancelled) return;
        const batch = ids.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (fileId) => {
            const res = await fetch(`/api/gdrive/archive/files/${encodeURIComponent(fileId)}/headers`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(await res.text());
            return { fileId, data: (await res.json()) as { subject: string; date: string; from: string; hasAttachments?: boolean } };
          })
        );
        if (cancelled) return;
        setFileHeaders((prev) => {
          const next = { ...prev };
          for (const r of results) {
            if (r.status === "fulfilled") next[r.value.fileId] = r.value.data;
          }
          return next;
        });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [list?.files, token]);

  const goToFolder = (item: BreadcrumbItem) => {
    setPath((prev) => [...prev, item]);
  };

  const goToBreadcrumb = (index: number) => {
    if (index < 0) {
      setPath([]);
      return;
    }
    setPath((prev) => prev.slice(0, index + 1));
  };

  const downloadFile = async (fileId: string, filename: string) => {
    if (!token?.trim()) return;
    try {
      const res = await fetch(`/api/gdrive/archive/files/${encodeURIComponent(fileId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkUnauthorized(res) || !res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "message.eml";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  };

  const viewFile = async (fileId: string) => {
    if (!token?.trim()) return;
    setViewLoading(true);
    setViewError(null);
    setViewContent(null);
    try {
      const res = await fetch(`/api/gdrive/archive/files/${encodeURIComponent(fileId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkUnauthorized(res) || !res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `Failed to load: ${res.status}`);
      }
      const text = await res.text();
      const parsed = parseEml(text);
      setViewContent(parsed);
    } catch (e) {
      setViewError(e instanceof Error ? e.message : "Failed to load email");
    } finally {
      setViewLoading(false);
    }
  };

  const closeViewer = () => {
    setViewContent(null);
    setViewError(null);
  };

  const downloadAttachment = (att: ParsedAttachment) => {
    try {
      const binary = atob(att.contentBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: att.mimeType || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.filename || "attachment";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setViewError(e instanceof Error ? e.message : "Failed to download attachment");
    }
  };

  if (driveConnected === null) {
    return (
      <section className="card">
        <h2>Browse archive</h2>
        <p>Loading…</p>
      </section>
    );
  }

  if (!driveConnected) {
    return (
      <section className="card">
        <h2>Browse archive</h2>
        <p className="subtitle">Connect Google Drive above to browse archived emails.</p>
      </section>
    );
  }

  return (
    <section className="card archive-browser">
      <h2>Browse archive</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Navigate folders and download .eml files from your Google Drive archive.
      </p>

      <nav className="archive-breadcrumb" aria-label="Archive path">
        <button
          type="button"
          className="link-button archive-crumb"
          onClick={() => goToBreadcrumb(-1)}
        >
          Archive
        </button>
        {path.map((item, i) => (
          <span key={item.id} className="archive-crumb-wrap">
            <span className="archive-crumb-sep">/</span>
            <button
              type="button"
              className="link-button archive-crumb"
              onClick={() => goToBreadcrumb(i)}
            >
              {item.name}
            </button>
          </span>
        ))}
      </nav>

      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}

      {loading ? (
        <p style={{ marginTop: 12 }}>Loading…</p>
      ) : list ? (
        <div className="archive-list" style={{ marginTop: 12 }}>
          {list.folders.length === 0 && list.files.length === 0 && (
            <p className="archive-empty">This folder is empty.</p>
          )}
          {list.folders.length > 0 && (
            <div className="archive-folders-block">
              {list.folders.map((f) => (
                <div key={f.id} className="archive-row archive-folder">
                  <button
                    type="button"
                    className="link-button archive-folder-btn"
                    onClick={() => goToFolder(f)}
                  >
                    📁 {f.name}
                  </button>
                </div>
              ))}
            </div>
          )}
          {list.files.length > 0 && (
            <table className="archive-mail-table">
              <thead>
                <tr>
                  <th className="archive-mail-th-from">From</th>
                  <th className="archive-mail-th-subject">Subject</th>
                  <th className="archive-mail-th-attach" title="Attachments"></th>
                  <th className="archive-mail-th-date">Date</th>
                  <th className="archive-mail-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.files.map((f) => {
                  const h = fileHeaders[f.id];
                  const displayFrom = h?.from?.trim() || "—";
                  const displaySubject = h?.subject?.trim() || f.name;
                  const hasAttachments = Boolean(h?.hasAttachments);
                  const displayDate = h?.date
                    ? (() => {
                        try {
                          const d = new Date(h.date);
                          return isNaN(d.getTime()) ? h.date : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
                        } catch {
                          return h.date;
                        }
                      })()
                    : f.modifiedTime
                      ? new Date(f.modifiedTime).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                      : "—";
                  return (
                    <tr key={f.id} className="archive-mail-row">
                      <td className="archive-mail-td-from" title={displayFrom}>{displayFrom}</td>
                      <td className="archive-mail-td-subject" title={displaySubject}>
                        <span className="archive-mail-subject-text">{displaySubject}</span>
                      </td>
                      <td className="archive-mail-td-attach" title={hasAttachments ? "Has attachments" : ""}>
                        {hasAttachments ? <span className="archive-mail-attachment-indicator">📎</span> : "—"}
                      </td>
                      <td className="archive-mail-td-date">{displayDate}</td>
                      <td className="archive-mail-td-actions">
                        <button type="button" className="link-button archive-view" onClick={() => viewFile(f.id)}>View</button>
                        <span className="archive-mail-action-sep"> </span>
                        <button type="button" className="link-button archive-download" onClick={() => downloadFile(f.id, f.name)}>Download</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {/* Email viewer modal */}
      {(viewLoading || viewContent || viewError) && (
        <div className="archive-viewer-overlay" role="dialog" aria-modal="true" aria-label="View email">
          <div className="archive-viewer">
            <div className="archive-viewer-header">
              <h3>Email</h3>
              <button type="button" className="archive-viewer-close" onClick={closeViewer} aria-label="Close">
                ×
              </button>
            </div>
            {viewLoading && <p className="archive-viewer-loading">Loading…</p>}
            {viewError && <div className="error archive-viewer-error">{viewError}</div>}
            {viewContent && !viewLoading && (
              <div className="archive-viewer-body">
                <dl className="archive-viewer-headers">
                  <dt>From</dt>
                  <dd>{viewContent.from || "—"}</dd>
                  <dt>To</dt>
                  <dd>{viewContent.to || "—"}</dd>
                  <dt>Subject</dt>
                  <dd>{viewContent.subject || "—"}</dd>
                  <dt>Date</dt>
                  <dd>{viewContent.date || "—"}</dd>
                </dl>
                {(viewContent.attachments?.length ?? 0) > 0 && (
                  <div className="archive-viewer-attachments">
                    <h4 className="archive-viewer-attachments-title">Attachments</h4>
                    <ul className="archive-viewer-attachments-list">
                      {viewContent.attachments.map((att, i) => (
                        <li key={i} className="archive-viewer-attachment-item">
                          <span className="archive-viewer-attachment-name" title={att.filename}>{att.filename}</span>
                          <button
                            type="button"
                            className="link-button archive-viewer-attachment-dl"
                            onClick={() => downloadAttachment(att)}
                          >
                            Download
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="archive-viewer-content">
                  {viewContent.bodyHtml ? (
                    <iframe
                      title="Email body"
                      className="archive-viewer-iframe"
                      sandbox=""
                      srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:12px;color:#e5e7eb;background:#0f172a;font-size:14px;line-height:1.5;} a{color:#60a5fa;}</style></head><body>${viewContent.bodyHtml}</body></html>`}
                    />
                  ) : viewContent.bodyPlain ? (
                    <pre className="archive-viewer-plain">{viewContent.bodyPlain}</pre>
                  ) : (
                    <p className="archive-viewer-empty">No body content.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
