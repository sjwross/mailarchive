import React, { useEffect, useState } from "react";

type Props = {
  token: string;
  onUnauthorized?: () => void;
};

type JunkRule = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  last_run_at: string | null;
  max_per_run: number;
  config: { keywords: string[]; senderPatterns: string[] };
  created_at: string;
};

export function JunkCleanupSection({ token, onUnauthorized }: Props) {
  const [rules, setRules] = useState<JunkRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ ruleId: string; scanned: number; matched?: number; moved: number; failed: number; firstError?: string } | null>(null);
  const [newName, setNewName] = useState("Junk cleanup");
  const [newSchedule, setNewSchedule] = useState("manual");
  const [newMaxPerRun, setNewMaxPerRun] = useState(50);
  const [newKeywords, setNewKeywords] = useState("");
  const [newSenderPatterns, setNewSenderPatterns] = useState("");
  const runResultRef = React.useRef<HTMLDivElement>(null);

  function checkUnauthorized(res: Response): boolean {
    if (res.status === 401) {
      onUnauthorized?.();
      setError("Session expired; please log in again.");
      return true;
    }
    return false;
  }

  async function load() {
    if (!token?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/junk-delete/rules", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkUnauthorized(res)) return;
      const data = (await res.json()) as { rules?: JunkRule[] };
      if (!res.ok) throw new Error((data as { error?: string }).error || "Failed to load rules");
      setRules(data.rules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function createRule() {
    if (!token?.trim()) return;
    setCreating(true);
    setError(null);
    const keywords = newKeywords
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const senderPatterns = newSenderPatterns
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (keywords.length === 0 && senderPatterns.length === 0) {
      setError("Add at least one keyword or sender pattern.");
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/junk-delete/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: newName.trim() || "Junk cleanup",
          schedule: newSchedule,
          max_per_run: newMaxPerRun,
          keywords,
          senderPatterns,
        }),
      });
      if (checkUnauthorized(res)) return;
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to create rule");
      setNewName("Junk cleanup");
      setNewKeywords("");
      setNewSenderPatterns("");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  }

  async function runRule(id: string) {
    if (!token?.trim()) return;
    setRunningId(id);
    setRunResult(null);
    setError(null);
    try {
      const res = await fetch(`/api/junk-delete/rules/${encodeURIComponent(id)}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkUnauthorized(res)) return;
      let data: { ok?: boolean; error?: string; summary?: { ruleId: string; scanned: number; matched?: number; moved: number; failed: number; firstError?: string } };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        setError(res.ok ? "Run completed but response was not JSON." : `Run failed (${res.status}). Check that the API proxy allows POST.`);
        return;
      }
      if (!res.ok) {
        setError(data.error || `Run failed (${res.status})`);
        return;
      }
      const summary = data.summary ?? {
        ruleId: id,
        scanned: 0,
        matched: 0,
        moved: 0,
        failed: 0,
      };
      setRunResult(summary);
      const msg =
        summary.failed > 0 && summary.firstError
          ? `Junk cleanup: scanned ${summary.scanned}, matched ${summary.matched ?? "—"}, moved ${summary.moved}, failed ${summary.failed}.\n\nFirst error: ${summary.firstError}`
          : `Junk cleanup: scanned ${summary.scanned}, matched ${summary.matched ?? "—"}, moved ${summary.moved} to Deleted Items${summary.failed > 0 ? `, ${summary.failed} failed` : ""}.`;
      alert(msg);
      void load();
      setTimeout(() => {
        try {
          runResultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch {
          /* ignore scroll errors */
        }
      }, 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunningId(null);
    }
  }

  async function deleteRule(id: string) {
    if (!token?.trim()) return;
    if (!confirm("Delete this junk cleanup rule?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/junk-delete/rules/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (checkUnauthorized(res)) return;
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || "Delete failed");
      }
      setRunResult(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <section className="card">
      <h2>Junk folder cleanup</h2>
      <p className="subtitle" style={{ marginTop: 0 }}>
        Move suspected unwanted emails from <strong>Junk</strong> to Deleted Items. Keywords match subject, body preview, and From address; sender patterns match From with wildcards (e.g. <code>*@spam.com</code>).
      </p>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      {runResult && (
        <div ref={runResultRef} className="junk-run-result" style={{ marginBottom: 12, padding: 10, background: "#0f172a", borderRadius: 6, fontSize: "0.9rem" }}>
          Last run: scanned <strong>{runResult.scanned}</strong>
          {runResult.matched != null && <>, matched <strong>{runResult.matched}</strong></>}
          , moved to Deleted Items <strong>{runResult.moved}</strong>
          {runResult.failed > 0 && <>, <strong>{runResult.failed}</strong> failed</>}.
          {runResult.firstError && <div style={{ marginTop: 6, color: "#f87171" }}>{runResult.firstError}</div>}
        </div>
      )}

      <div className="form junk-form" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Add rule</h3>
        <label>
          Name
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Junk cleanup"
          />
        </label>
        <label>
          Schedule
          <select value={newSchedule} onChange={(e) => setNewSchedule(e.target.value)}>
            <option value="manual">Manual only</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <label>
          Max per run
          <input
            type="number"
            min={1}
            max={500}
            value={newMaxPerRun}
            onChange={(e) => setNewMaxPerRun(Number(e.target.value) || 50)}
          />
        </label>
        <label>
          Keywords (one per line, match subject, body preview, and From address)
          <textarea
            value={newKeywords}
            onChange={(e) => setNewKeywords(e.target.value)}
            placeholder="unsubscribe\nfree offer\n..."
            rows={3}
            style={{ fontFamily: "inherit", resize: "vertical" }}
          />
        </label>
        <label>
          Sender patterns (one per line, e.g. *@spam.com)
          <textarea
            value={newSenderPatterns}
            onChange={(e) => setNewSenderPatterns(e.target.value)}
            placeholder="*@spam.com\nnoreply@*"
            rows={2}
            style={{ fontFamily: "inherit", resize: "vertical" }}
          />
        </label>
        <button type="button" onClick={createRule} disabled={creating}>
          {creating ? "Creating…" : "Add rule"}
        </button>
      </div>

      <h3 style={{ fontSize: "1rem" }}>Rules</h3>
      {loading ? (
        <p>Loading…</p>
      ) : rules.length === 0 ? (
        <p className="subtitle">No junk cleanup rules yet. Add one above.</p>
      ) : (
        <table className="rules-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Schedule</th>
              <th>Keywords / patterns</th>
              <th>Last run</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.schedule}</td>
                <td className="rules-folders-cell">
                  {[...(r.config?.keywords ?? []), ...(r.config?.senderPatterns ?? [])].slice(0, 3).join(", ")}
                  {((r.config?.keywords?.length ?? 0) + (r.config?.senderPatterns?.length ?? 0)) > 3 ? "…" : ""}
                </td>
                <td>
                  {r.last_run_at
                    ? new Date(r.last_run_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                    : "—"}
                </td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => runRule(r.id)}
                    disabled={runningId !== null}
                  >
                    {runningId === r.id ? "Running…" : "Run now"}
                  </button>
                  {" "}
                  <button
                    type="button"
                    className="link-button button-remove"
                    onClick={() => deleteRule(r.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
