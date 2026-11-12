#!/usr/bin/env node
/**
 * Generate public/sitemap.xml.
 *
 * Run automatically via the `prebuild` npm script, alongside
 * generate-smack-share-pages.mjs and generate-webp-siblings.mjs.
 *
 *     node scripts/generate-sitemap.mjs
 *
 * ── Why this sitemap is SHORT, and what would make it long ──────────────
 *
 * ResistAct is a single-page app with no router: tabs are component state,
 * not URLs. The only real addressable things are:
 *
 *   1. "/"                  — the app itself.
 *   2. "/s/<id>.html"       — per-smack share pages (Open Graph only).
 *   3. "/?act=N", "/?smack=N" — deep links the app reads from the query
 *                             string (see App.tsx, `searchParams.get("act")`).
 *
 * Only #1 belongs in a sitemap today:
 *
 *   - The /s/ pages are meta-refresh redirects to the app. Search engines
 *     treat those as redirects, so listing them earns "Page with redirect"
 *     warnings in Search Console rather than indexed pages. They exist for
 *     social scrapers, which find them via the shared link, not a sitemap.
 *
 *   - The ?act=N deep links are the tempting ones — there are ~1,000 of
 *     them — but every single one currently serves the SAME near-empty HTML
 *     shell (~31 characters of visible text; the act itself is painted by
 *     JavaScript afterwards). Listing a thousand URLs that are byte-identical
 *     to a crawler invites duplicate-content and soft-404 judgements, which
 *     is actively worse than listing nothing.
 *
 * So: when prerendering lands and each ?act=N returns that act's real title
 * and description in the HTML, flip INCLUDE_ACT_URLS to true and give the
 * script an act-id source. Until then a one-URL sitemap is the honest answer
 * — its real job right now is declaring the canonical host and giving Search
 * Console something valid to accept.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT = path.join(REPO_ROOT, "public", "sitemap.xml");

// Canonical host: the apex 301-redirects to www, so www is the real home.
// Every URL in a sitemap must be on the canonical host or it's ignored.
const SITE = "https://www.resistact.org";

// Flip to true once act pages are prerendered with real per-act HTML.
const INCLUDE_ACT_URLS = false;

/** YYYY-MM-DD — the W3C date form sitemaps want for <lastmod>. */
const today = new Date().toISOString().slice(0, 10);

const urls = [
  { loc: `${SITE}/`, changefreq: "daily", priority: "1.0", lastmod: today },
];

if (INCLUDE_ACT_URLS) {
  // Intentionally unimplemented — see the header comment. Wiring this up
  // without prerendering would list ~1,000 identical HTML shells.
  throw new Error(
    "INCLUDE_ACT_URLS is on but act pages aren't prerendered yet — " +
    "listing them would submit ~1,000 identical empty shells. " +
    "Add prerendering first, then supply the act-id source here.",
  );
}

const xml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls
    .map(
      (u) =>
        `  <url>\n` +
        `    <loc>${u.loc}</loc>\n` +
        `    <lastmod>${u.lastmod}</lastmod>\n` +
        `    <changefreq>${u.changefreq}</changefreq>\n` +
        `    <priority>${u.priority}</priority>\n` +
        `  </url>\n`,
    )
    .join("") +
  `</urlset>\n`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, xml, "utf8");
console.log(`generate-sitemap: wrote ${urls.length} URL(s) → public/sitemap.xml`);
