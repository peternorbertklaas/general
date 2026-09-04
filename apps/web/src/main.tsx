import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// App-shell service worker (US-8.13 / R4-F3): production build only – the dev
// server serves modules on the fly, and jsdom has no `serviceWorker`. Registration
// failures are non-fatal: the app works without the worker, only the offline
// reload needs it.
if (import.meta.env.PROD && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
