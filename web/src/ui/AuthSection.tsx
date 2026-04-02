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
      const normalizedEmail = email.trim();
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      let data: { token?: string; error?: string } | null = null;
      try {
        data = (await res.json()) as { token?: string; error?: string };
      } catch {
        throw new Error(`Authentication service returned an invalid response (${res.status}).`);
      }
      if (!res.ok || !data.token) {
        throw new Error(data.error || "Authentication failed");
      }
      onTokenChange(data.token);
    } catch (err) {
      const e = err as { message?: string; name?: string };
      const message = e.message || "Request failed";
      if (
        message.includes("Failed to fetch") ||
        message.includes("did not match the expected pattern")
      ) {
        setError("Unable to reach mailarchive API. Start the API server (port 3000) and try again.");
      } else {
        setError(message);
      }
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

