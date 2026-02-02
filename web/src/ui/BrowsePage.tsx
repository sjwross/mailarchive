import React from "react";
import { ArchiveBrowserSection } from "./ArchiveBrowserSection";

const TOKEN_KEY = "ma_token";

export function BrowsePage() {
  const token = localStorage.getItem(TOKEN_KEY);

  const mainUrl = `${window.location.origin}${window.location.pathname}`.replace(/#.*$/, "");

  if (!token?.trim()) {
    return (
      <div className="page browse-page-standalone">
        <header className="header">
          <h1>mailarchive</h1>
          <p className="subtitle">Browse archive</p>
        </header>
        <main className="content">
          <section className="card">
            <p>Please log in on the main page first.</p>
            <a href={mainUrl} className="link-button" style={{ marginTop: 8, display: "inline-block" }}>
              ← Back to mailarchive
            </a>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="page browse-page-standalone">
      <header className="header browse-page-header">
        <div>
          <h1>mailarchive</h1>
          <p className="subtitle">Browse archive</p>
        </div>
        <a href={mainUrl} className="link-button browse-back">
          ← Back to app
        </a>
      </header>
      <main className="content">
        <ArchiveBrowserSection
          token={token}
          onUnauthorized={() => {
            window.location.href = mainUrl;
          }}
        />
      </main>
    </div>
  );
}
