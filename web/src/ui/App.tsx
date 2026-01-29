import React, { useEffect, useState } from "react";
import { AuthSection } from "./AuthSection";
import { StatusSection } from "./StatusSection";
import { RulesSection } from "./RulesSection";

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("ma_token"));

  useEffect(() => {
    if (token) {
      localStorage.setItem("ma_token", token);
    } else {
      localStorage.removeItem("ma_token");
    }
  }, [token]);

  return (
    <div className="page">
      <header className="header">
        <h1>mailarchive</h1>
        <p className="subtitle">Outlook.com archiving to your own storage</p>
      </header>

      <main className="content">
        <section className="card">
          <h2>Authentication</h2>
          <AuthSection token={token} onTokenChange={setToken} />
        </section>

        {token && (
          <>
            <section className="card">
              <h2>Connections</h2>
              <StatusSection token={token} onUnauthorized={() => setToken(null)} />
            </section>

            <section className="card">
              <h2>Archive Rules</h2>
              <RulesSection token={token} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}

