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

export function StatusSection({ token, onUnauthorized }: Props) {
  const [msStatus, setMsStatus] = useState<MicrosoftStatus | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
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
      const [msRes, s3Res, gdRes] = await Promise.all([
        fetch("/api/microsoft/status", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/storage/s3", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/gdrive/status", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (checkUnauthorized(msRes) || checkUnauthorized(s3Res) || checkUnauthorized(gdRes)) return;
      const msJson = (await parseJson(msRes)) as MicrosoftStatus;
      const s3Json = (await parseJson(s3Res)) as StorageStatus;
      const gdJson = (await parseJson(gdRes)) as DriveStatus;
      setMsStatus(msJson);
      setStorageStatus(s3Json);
      setDriveStatus(gdJson);
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

