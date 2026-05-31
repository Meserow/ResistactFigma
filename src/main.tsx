
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { ErrorBoundary } from "./app/components/ErrorBoundary.tsx";
  import "./styles/index.css";

  // Stale-deploy recovery. Every deploy renames Vite's content-hashed JS
  // chunks. A tab opened before a deploy still references the OLD filenames,
  // so the next lazy import (e.g. the Changelog modal) 404s with "Failed to
  // fetch dynamically imported module". Vite fires `vite:preloadError` for
  // exactly this — we reload once to pull the fresh build. The timestamp guard
  // stops an infinite reload loop if the chunk is genuinely broken (a bad
  // build) rather than just stale.
  const CHUNK_RELOAD_KEY = "resistact:lastChunkReload";
  window.addEventListener("vite:preloadError", (e) => {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
    if (Date.now() - last < 10_000) return; // already reloaded recently — let it surface
    e.preventDefault();
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    window.location.reload();
  });

  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
  