import React, { useState } from "react";

type Props = {
  token: string | null;
  onTokenChange: (token: string | null) => void;
};

export function AuthSection({ token, onTokenChange }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("test@example.com");
  const [password, setPassword] = useState("testpass123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        throw new Error(data.error || "Authentication failed");
      }
      onTokenChange(data.token);
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    onTokenChange(null);
  }

  if (token) {
    return (
      <div>
        <p>You are logged in.</p>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="tabs">
        <button
          type="button"
          className={mode === "login" ? "tab active" : "tab"}
          onClick={() => setMode("login")}
        >
          Login
        </button>
        <button
          type="button"
          className={mode === "register" ? "tab active" : "tab"}
          onClick={() => setMode("register")}
        >
          Register
        </button>
      </div>

      <label>
        <span>Email</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
      </label>

      <label>
        <span>Password</span>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
        />
      </label>

      {error && <div className="error">{error}</div>}

      <button type="submit" disabled={loading}>
        {loading ? "Please wait…" : mode === "login" ? "Login" : "Register"}
      </button>
    </form>
  );
}

