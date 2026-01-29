import React, { useEffect, useState } from "react";

type Props = {
  token: string;
};

type Rule = {
  id: string;
  name: string;
  age_threshold_days: number;
  folder_ids: string[];
  safety_mode: string;
  schedule: string;
  max_per_run?: number;
  created_at: string;
  last_run_at?: string | null;
};

type Folder = { id: string; displayName: string };

export function RulesSection({ token }: Props) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("Archive old mail");
  const [newAge, setNewAge] = useState(365);
  const [newMaxPerRun, setNewMaxPerRun] = useState(50);
  const [newSafety, setNewSafety] = useState("archive_only");
  const [newSchedule, setNewSchedule] = useState("manual");

  async function loadFolders() {
    setFoldersLoading(true);
    setFoldersError(null);
    try {
      const res = await fetch("/api/microsoft/folders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setFoldersError(data.error || "Failed to load folders");
        setFolders([]);
        return;
      }
      const list = data.folders ?? [];
      setFolders(list);
      if (list.length > 0) {
        setSelectedFolderIds((prev) => {
          if (prev.length > 0) return prev;
          const inbox = list.find((f: Folder) => f.displayName.toLowerCase() === "inbox");
          return inbox ? [inbox.id] : [];
        });
      }
    } catch {
      setFoldersError("Failed to load folders");
      setFolders([]);
    } finally {
      setFoldersLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rules", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load rules");
      }
      setRules(data.rules ?? []);
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to load rules");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadFolders();
  }, [token]);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newName,
          age_threshold_days: newAge,
          max_per_run: Math.min(500, Math.max(1, newMaxPerRun)),
          folder_ids: selectedFolderIds,
          safety_mode: newSafety,
          schedule: newSchedule,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create rule");
      }
      setRules((prev) => [data, ...prev]);
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to create rule");
    } finally {
      setCreating(false);
    }
  }

  async function runNow(ruleId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/rules/${ruleId}/run-now`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to run archive");
      }
      const msg =
        data.summary.totalFailed > 0 && data.summary.firstError
          ? `Archive run completed.\nArchived: ${data.summary.totalArchived}\nFailed: ${data.summary.totalFailed}\n\nFirst error: ${data.summary.firstError}`
          : `Archive run completed.\nArchived: ${data.summary.totalArchived}\nFailed: ${data.summary.totalFailed}`;
      alert(msg);
      await load();
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to run rule");
    }
  }

  async function removeRule(ruleId: string) {
    if (!confirm("Remove this rule? This cannot be undone.")) return;
    setDeletingId(ruleId);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove rule");
      }
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Failed to remove rule");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <form className="form rules-form" onSubmit={createRule}>
        <div className="folder-picker-section">
          <h3 className="folder-picker-title">Folders to archive from</h3>
          {foldersLoading ? (
            <p className="folders-hint">Loading folders…</p>
          ) : foldersError ? (
            <p className="folders-hint">
              {foldersError}{" "}
              <button type="button" className="link-button" onClick={() => loadFolders()}>
                Retry
              </button>
            </p>
          ) : folders.length === 0 ? (
            <p className="folders-hint">
              No folders loaded (new rules will use Inbox).{" "}
              <button type="button" className="link-button" onClick={() => loadFolders()}>
                Load folders
              </button>
            </p>
          ) : (
            <div className="folder-checkboxes">
              {folders.map((f) => (
                <label key={f.id} className="folder-check">
                  <input
                    type="checkbox"
                    checked={selectedFolderIds.includes(f.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedFolderIds((prev) => [...prev, f.id]);
                      } else {
                        setSelectedFolderIds((prev) => prev.filter((id) => id !== f.id));
                      }
                    }}
                  />
                  <span>{f.displayName}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="form inline form-row">
          <label>
            <span>Name</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label>
            <span>Age (days)</span>
            <input
              type="number"
              value={newAge}
              onChange={(e) => setNewAge(Number(e.target.value))}
              min={1}
            />
          </label>
          <label>
            <span>Max per run</span>
            <input
              type="number"
              value={newMaxPerRun}
              onChange={(e) => setNewMaxPerRun(Number(e.target.value) || 50)}
              min={1}
              max={500}
              title="Messages to archive per run (1–500)"
            />
          </label>
          <label>
            <span>Safety</span>
            <select value={newSafety} onChange={(e) => setNewSafety(e.target.value)}>
              <option value="archive_only">Archive only</option>
              <option value="archive_move">Archive + move</option>
              <option value="archive_delete">Archive + delete</option>
            </select>
          </label>
          <label>
            <span>Schedule</span>
            <select value={newSchedule} onChange={(e) => setNewSchedule(e.target.value)}>
              <option value="manual">Manual</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Add rule"}
          </button>
        </div>
      </form>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <p>Loading rules…</p>
      ) : rules.length === 0 ? (
        <p>No rules yet.</p>
      ) : (
        <table className="rules-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Age (days)</th>
              <th>Max/run</th>
              <th>Safety</th>
              <th>Schedule</th>
              <th>Last run</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.name}</td>
                <td>{rule.age_threshold_days}</td>
                <td>{rule.max_per_run ?? 50}</td>
                <td>{rule.safety_mode}</td>
                <td>{rule.schedule}</td>
                <td>{rule.last_run_at ? new Date(rule.last_run_at).toLocaleString() : "Never"}</td>
                <td className="rules-actions">
                  <button type="button" onClick={() => runNow(rule.id)}>
                    Run now
                  </button>
                  <button
                    type="button"
                    className="button-remove"
                    onClick={() => removeRule(rule.id)}
                    disabled={deletingId === rule.id}
                  >
                    {deletingId === rule.id ? "Removing…" : "Remove"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

