import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";
import { BrowsePage } from "./ui/BrowsePage";
import "./styles.css";

function Root() {
  const [hash, setHash] = useState(() => (typeof window !== "undefined" ? window.location.hash : ""));
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const isBrowse = hash === "#browse";
  return isBrowse ? <BrowsePage /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

