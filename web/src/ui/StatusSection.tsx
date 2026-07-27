import React, { useEffect, useState } from "react";

type Props = {
  token: string;
  onUnauthorized?: () => void;
};

type MicrosoftStatus = {
  connected: boolean;
  email?: string;
};

type StorageStatus = {
  configured: boolean;
  bucket?: string;
  region?: string;
  basePath?: string;
};

type DriveStatus = {
  connected: boolean;
  email?: string | null;
  baseFolderName?: string;
};

type OneDriveStatus = {
  configured: boolean;
  basePath?: string;
  note?: string;
};

export function StatusSection({ token, onUnauthorized }: Props) {
  const [msStatus, setMsStatus] = useState<MicrosoftStatus | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [oneDriveStatus, setOneDriveStatus] = useState<OneDriveStatus | null>(null);
  const [preferredArchive, setPreferredArchive] = useState<string | null>(null);
  const [s3FolderDraft, setS3FolderDraft] = useState("");
  const [driveFolderDraft, setDriveFolderDraft] = useState("mailarchive");
  const [oneDriveFolderDraft, setOneDriveFolderDraft] = useState("mailarchive");
  const [savingFolder, setSavingFolder] = useState<"s3" | "gdrive" | "onedrive" | null>(null);
  const [folderSaved, setFolderSaved] = useState<"s3" | "gdrive" | "onedrive" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function parseJson(res: Response): Promise<Record<string, unknown>> {
    return res.json().catch(() => ({}));
  }

  function errorMessage(data: Record<string, unknown>, fallback: string): string {
    const msg = typeof data.message === "string" ? data.message : "";
    const err = typeof data.error === "string" ? data.error : "";
    // Fastify 404s use error: "Not Found" with the useful detail in message
    if (err && err !== "Not Found") return err;
    if (msg) return msg;
    return err || fallback;
  }

  function checkUnauthorized(res: Response): boolean {
    if (res.status === 401) {
      onUnauthorized?.();
      setError("Session expired; please log in again.");
      return true;
    }
    return false;
  }

  async function refresh() {
    if (!token?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.allSettled([
        fetch("/api/microsoft/status", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/storage/s3", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/gdrive/status", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/storage/onedrive", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      let got401 = false;
      const [msRes, s3Res, gdRes, odRes] = results.map((r) => {
        if (r.status === "rejected") return null;
        const res = r.value as Response;
        if (res.status === 401) got401 = true;
        return res;
      });
      if (got401) {
        setError("Session expired; please log in again.");
        setLoading(false);
        return;
      }
      const msJson = msRes ? ((await parseJson(msRes)) as MicrosoftStatus) : null;
      const s3Json = s3Res ? ((await parseJson(s3Res)) as StorageStatus) : null;
      const gdJson = gdRes ? ((await parseJson(gdRes)) as DriveStatus) : null;
      const odJson = odRes ? ((await parseJson(odRes)) as OneDriveStatus) : null;
      setMsStatus(msRes?.ok ? (msJson ?? null) : { connected: false });
      setStorageStatus(s3Res?.ok ? (s3Json ?? null) : { configured: false });
      setDriveStatus(gdRes?.ok ? (gdJson ?? null) : { connected: false });
      setOneDriveStatus(odRes?.ok ? (odJson ?? null) : { configured: false });
      if (s3Res?.ok && s3Json?.configured) {
        setS3FolderDraft(s3Json.basePath ?? "");
      }
      if (gdRes?.ok && gdJson?.connected) {
        setDriveFolderDraft(gdJson.baseFolderName || "mailarchive");
      }
      if (odRes?.ok && odJson?.configured) {
        setOneDriveFolderDraft(odJson.basePath || "mailarchive");
      }
      if (!msRes?.ok || !s3Res?.ok || !gdRes?.ok || !odRes?.ok) {
        setError("Some status checks failed. Use Refresh status to retry.");
      }
      const prefRes = await fetch("/api/settings/archive-storage", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (prefRes.ok) {
        const prefData = (await parseJson(prefRes)) as { preferred?: string | null };
        setPreferredArchive(prefData.preferred ?? null);
      }
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to load status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [token]);

  async function startMicrosoftConnect() {
    if (!token?.trim()) {
      setError("Not logged in.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/microsoft/connect", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await parseJson(res);
      if (checkUnauthorized(res)) return;
      if (!res.ok) {
        throw new Error(errorMessage(data, `Failed to start Microsoft connect (${res.status})`));
      }
      const authUrl = data.authUrl as string;
      if (!authUrl) {
        throw new Error("No auth URL returned from server");
      }
      const popup = window.open(authUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        setError("Popup blocked. Please allow popups for this site and try again.");
        setLoading(false);
        return;
      }
      // Clear error after successful popup open
      setError(null);
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to start Microsoft connect");
    } finally {
      setLoading(false);
    }
  }

  async function startDriveConnect() {
    if (!token?.trim()) {
      setError("Not logged in.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gdrive/connect", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await parseJson(res);
      if (checkUnauthorized(res)) return;
      if (!res.ok || !(data.authUrl as string)) {
        throw new Error(errorMessage(data, "Failed to start Google Drive connect"));
      }
      window.open(data.authUrl as string, "_blank", "noopener,noreferrer");
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to start Google Drive connect");
    } finally {
      setLoading(false);
    }
  }

  async function disconnectMicrosoft() {
    if (!token?.trim() || !msStatus?.connected) return;
    if (!confirm("Disconnect Microsoft? Archive (Outlook) and OneDrive will stop working until you reconnect.")) return;
    setError(null);
    try {
      const res = await fetch("/api/microsoft/disconnect", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkUnauthorized(res)) return;
      if (!res.ok) {
        const data = await parseJson(res);
        throw new Error(errorMessage(data, "Failed to disconnect"));
      }
      void refresh();
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to disconnect Microsoft");
    }
  }

  async function disconnectS3() {
    if (!token?.trim() || !storageStatus?.configured) return;
    if (!confirm("Remove S3 storage? Archive will use OneDrive or Google Drive if connected.")) return;
    setError(null);
    try {
      const res = await fetch("/api/storage/s3", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkUnauthorized(res)) return;
      if (!res.ok) {
        const data = await parseJson(res);
        throw new Error(errorMessage(data, "Failed to disconnect"));
      }
      void refresh();
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to remove S3");
    }
  }

  async function disconnectDrive() {
    if (!token?.trim() || !driveStatus?.connected) return;
    if (!confirm("Disconnect Google Drive? Archive will use OneDrive or S3 if configured.")) return;
    setError(null);
    try {
      const res = await fetch("/api/gdrive/disconnect", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkUnauthorized(res)) return;
      if (!res.ok) {
        const data = await parseJson(res);
        throw new Error(errorMessage(data, "Failed to disconnect"));
      }
      void refresh();
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to disconnect Google Drive");
    }
  }

  async function saveS3Folder() {
    if (!token?.trim() || !storageStatus?.configured) return;
    setSavingFolder("s3");
    setFolderSaved(null);
    setError(null);
    try {
      const res = await fetch("/api/storage/s3", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ basePath: s3FolderDraft.trim() }),
      });
      const data = await parseJson(res);
      if (checkUnauthorized(res)) return;
      if (!res.ok) {
        throw new Error(errorMessage(data, "Failed to save S3 folder"));
      }
      const nextPath = (data.basePath as string) ?? s3FolderDraft.trim();
      setS3FolderDraft(nextPath);
      setStorageStatus((prev) => (prev ? { ...prev, basePath: nextPath } : prev));
      setFolderSaved("s3");
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to save S3 folder");
    } finally {
      setSavingFolder(null);
    }
  }

  async function saveDriveFolder() {
    if (!token?.trim() || !driveStatus?.connected) return;
    setSavingFolder("gdrive");
    setFolderSaved(null);
    setError(null);
    try {
      const res = await fetch("/api/gdrive/folder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ baseFolderName: driveFolderDraft.trim() || "mailarchive" }),
      });
      const data = await parseJson(res);
      if (checkUnauthorized(res)) return;
      if (!res.ok) {
        throw new Error(errorMessage(data, "Failed to save Google Drive folder"));
      }
      const nextName = (data.baseFolderName as string) || "mailarchive";
      setDriveFolderDraft(nextName);
      setDriveStatus((prev) => (prev ? { ...prev, baseFolderName: nextName } : prev));
      setFolderSaved("gdrive");
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to save Google Drive folder");
    } finally {
      setSavingFolder(null);
    }
  }

  async function saveOneDriveFolder() {
    if (!token?.trim() || !oneDriveStatus?.configured) return;
    setSavingFolder("onedrive");
    setFolderSaved(null);
    setError(null);
    try {
      const res = await fetch("/api/storage/onedrive", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ basePath: oneDriveFolderDraft.trim() || "mailarchive" }),
      });
      const data = await parseJson(res);
      if (checkUnauthorized(res)) return;
      if (!res.ok) {
        throw new Error(errorMessage(data, "Failed to save OneDrive folder"));
      }
      const nextPath = (data.basePath as string) || "mailarchive";
      setOneDriveFolderDraft(nextPath);
      setOneDriveStatus((prev) => (prev ? { ...prev, basePath: nextPath } : prev));
      setFolderSaved("onedrive");
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to save OneDrive folder");
    } finally {
      setSavingFolder(null);
    }
  }

  function folderEditor(opts: {
    id: "s3" | "gdrive" | "onedrive";
    value: string;
    onChange: (v: string) => void;
    onSave: () => void;
    hint: string;
    placeholder: string;
  }) {
    const busy = savingFolder === opts.id;
    return (
      <div className="folder-path-editor" style={{ marginTop: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.9rem" }}>
          Mailarchive folder
          <span className="subtitle" style={{ margin: 0, fontSize: "0.8rem" }}>
            {opts.hint}
          </span>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={opts.value}
              onChange={(e) => opts.onChange(e.target.value)}
              placeholder={opts.placeholder}
              disabled={loading || busy}
              style={{ minWidth: 180, flex: "1 1 160px" }}
            />
            <button type="button" onClick={opts.onSave} disabled={loading || busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            {folderSaved === opts.id && (
              <span className="subtitle" style={{ margin: 0, fontSize: "0.85rem" }}>
                Saved
              </span>
            )}
          </span>
        </label>
      </div>
    );
  }

  return (
    <div className="grid">
      <div>
        <h3>Microsoft</h3>
        {msStatus ? (
          <p>
            Status:{" "}
            <strong>{msStatus.connected ? `Connected (${msStatus.email ?? "unknown"})` : "Not connected"}</strong>
          </p>
        ) : (
          <p>Loading…</p>
        )}
        <button type="button" onClick={startMicrosoftConnect} disabled={loading}>
          {msStatus?.connected ? "Reconnect Microsoft" : "Connect Microsoft"}
        </button>
        {msStatus?.connected && (
          <button type="button" className="link-button button-remove" onClick={disconnectMicrosoft} disabled={loading} style={{ marginLeft: 8 }}>
            Disconnect
          </button>
        )}
      </div>

      <div>
        <h3>Storage (S3)</h3>
        {storageStatus ? (
          storageStatus.configured ? (
            <p>
              <strong>Configured</strong> — {storageStatus.bucket} ({storageStatus.region})
            </p>
          ) : (
            <p>
              <strong>Not configured</strong>. Use the API or future UI to add S3 credentials.
            </p>
          )
        ) : (
          <p>Loading…</p>
        )}
        {storageStatus?.configured &&
          folderEditor({
            id: "s3",
            value: s3FolderDraft,
            onChange: setS3FolderDraft,
            onSave: () => void saveS3Folder(),
            hint: "Optional key prefix for archived mail (e.g. mailarchive/). Leave blank for bucket root. Applies to new archives only.",
            placeholder: "mailarchive/",
          })}
        {storageStatus?.configured && (
          <button type="button" className="link-button button-remove" onClick={disconnectS3} disabled={loading} style={{ marginTop: 8 }}>
            Remove S3
          </button>
        )}
      </div>

      <div>
        <h3>Storage (Google Drive)</h3>
        {driveStatus ? (
          <p>
            Status:{" "}
            <strong>
              {driveStatus.connected
                ? `Connected (${driveStatus.email ?? "unknown"})`
                : "Not connected"}
            </strong>
          </p>
        ) : (
          <p>Loading…</p>
        )}
        <button type="button" onClick={startDriveConnect} disabled={loading}>
          {driveStatus?.connected ? "Reconnect Google Drive" : "Connect Google Drive"}
        </button>
        {driveStatus?.connected && (
          <button type="button" className="link-button button-remove" onClick={disconnectDrive} disabled={loading} style={{ marginLeft: 8 }}>
            Disconnect
          </button>
        )}
        {driveStatus?.connected &&
          folderEditor({
            id: "gdrive",
            value: driveFolderDraft,
            onChange: setDriveFolderDraft,
            onSave: () => void saveDriveFolder(),
            hint: "Top-level Drive folder for archives. Changing this creates/uses a new folder; existing archives stay in the old one.",
            placeholder: "mailarchive",
          })}
      </div>

      <div>
        <h3>Storage (Microsoft OneDrive)</h3>
        {oneDriveStatus ? (
          <p>
            Status:{" "}
            <strong>
              {oneDriveStatus.configured ? "Available (uses Microsoft account)" : "Not available"}
            </strong>
          </p>
        ) : (
          <p>Loading…</p>
        )}
        <p className="subtitle" style={{ marginTop: 4, fontSize: "0.9rem" }}>
          Uses your Microsoft account. Archive uses OneDrive when S3 and Google Drive are not configured. Reconnect Microsoft if you connected before OneDrive was added to grant file access.
        </p>
        {oneDriveStatus?.configured &&
          folderEditor({
            id: "onedrive",
            value: oneDriveFolderDraft,
            onChange: setOneDriveFolderDraft,
            onSave: () => void saveOneDriveFolder(),
            hint: "Root folder path for archives (e.g. mailarchive or backups/mailarchive). Applies to new archives only.",
            placeholder: "mailarchive",
          })}
      </div>

      <div>
        <h3>Archive to</h3>
        <p className="subtitle" style={{ marginTop: 0, marginBottom: 8, fontSize: "0.9rem" }}>
          Choose where archived emails are stored. Microsoft is always used for reading mail; this only affects storage.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select
            value={preferredArchive ?? ""}
            onChange={async (e) => {
              const value = e.target.value || null;
              setPreferredArchive(value);
              if (!token?.trim()) return;
              try {
                const res = await fetch("/api/settings/archive-storage", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ preferred: value }),
                });
                if (!res.ok) {
                  const data = await parseJson(res);
                  setError((data.error as string) || "Failed to save preference");
                }
              } catch (err) {
                const ex = err as { message?: string };
                setError(ex.message || "Failed to save preference");
              }
            }}
            disabled={loading}
            style={{ minWidth: 160 }}
          >
            <option value="">Auto (S3 → OneDrive → Google Drive)</option>
            {storageStatus?.configured && <option value="s3">S3</option>}
            {oneDriveStatus?.configured && <option value="onedrive">OneDrive</option>}
            {driveStatus?.connected && <option value="gdrive">Google Drive</option>}
          </select>
        </label>
      </div>

      <div className="status-footer">
        {error && <div className="error">{error}</div>}
        <button type="button" onClick={refresh} disabled={loading}>
          Refresh status
        </button>
      </div>
    </div>
  );
}
