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
};

type OneDriveStatus = {
  configured: boolean;
  note?: string;
};

export function StatusSection({ token, onUnauthorized }: Props) {
  const [msStatus, setMsStatus] = useState<MicrosoftStatus | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [oneDriveStatus, setOneDriveStatus] = useState<OneDriveStatus | null>(null);
  const [preferredArchive, setPreferredArchive] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function parseJson(res: Response): Promise<Record<string, unknown>> {
    return res.json().catch(() => ({}));
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
        throw new Error((data.error as string) || `Failed to start Microsoft connect (${res.status})`);
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
        throw new Error((data.error as string) || "Failed to start Google Drive connect");
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
        throw new Error((data.error as string) || "Failed to disconnect");
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
        throw new Error((data.error as string) || "Failed to disconnect");
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
        throw new Error((data.error as string) || "Failed to disconnect");
      }
      void refresh();
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to disconnect Google Drive");
    }
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
              <strong>Configured</strong> — {storageStatus.bucket} ({storageStatus.region}){" "}
              {storageStatus.basePath && <>@ {storageStatus.basePath}</>}
            </p>
          ) : (
            <p>
              <strong>Not configured</strong>. Use the API or future UI to add S3 credentials.
            </p>
          )
        ) : (
          <p>Loading…</p>
        )}
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

