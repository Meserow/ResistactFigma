#!/usr/bin/env node
/**
 * Generate per-Smack share pages for social-media link previews.
 *
 * Why: Facebook / Twitter / etc. don't allow JavaScript apps to attach
 * arbitrary images to a share dialog. They scrape the shared URL for
 * Open Graph meta tags and use the og:image they find there. Our SPA
 * has one set of OG tags (the resistact.org homepage), so every smack
 * share previewed the same generic image.
 *
 * What this does: for every smack in STATIC_SMACKS, write a tiny static
 * HTML file at `public/s/<id>.html`. The file:
 *   - Sets og:image to the smack's actual image URL
 *   - Sets og:title / og:description to the smack's title + caption
 *   - Includes a meta-refresh + JS redirect to the main app so anyone who
 *     clicks the link goes to ResistAct (not a dead-end HTML page)
 *
 * Run automatically via the `prebuild` npm script. Re-run manually if you
 * add or edit a static smack:
 *
 *     node scripts/generate-smack-share-pages.mjs
 *
 * Note: this only handles STATIC_SMACKS (id ≥ 5000, hardcoded in the app).
 * User-submitted smacks live in the KV store and would need a server-side
 * route to get per-smack OG tags.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SMACKS_TS = path.join(REPO_ROOT, "src/app/components/SmacksPage.tsx");
const OUT_DIR = path.join(REPO_ROOT, "public/s");

const SITE = "https://www.resistact.org";

// Parse STATIC_SMACKS out of the .tsx source. We use a regex on the source
// file because that keeps the script dep-free (no tsx / esbuild needed).
// If the source structure changes, this script will scream loudly.
function parseStaticSmacks() {
  const src = fs.readFileSync(SMACKS_TS, "utf8");
  const start = src.indexOf("export const STATIC_SMACKS");
  if (start === -1) throw new Error("Couldn't find STATIC_SMACKS declaration");
  // Find the array literal that opens after the `=`. We have to skip past
  // the TypeScript type annotation `: ReceiptCard[]` which also contains
  // square brackets — find the `=` first, then the first `[` after it.
  const eq = src.indexOf("=", start);
  if (eq === -1) throw new Error("Couldn't find = after STATIC_SMACKS");
  const arrOpen = src.indexOf("[", eq);
  // Walk forward, counting brackets, to find the matching closing `]`
  let depth = 0;
  let arrClose = -1;
  for (let i = arrOpen; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) { arrClose = i; break; }
    }
  }
  if (arrClose === -1) throw new Error("Couldn't find end of STATIC_SMACKS array");

  // Pull out each `{ ... }` object literal inside the array.
  const arrBody = src.slice(arrOpen + 1, arrClose);
  const objects = [];
  let i = 0;
  while (i < arrBody.length) {
    if (arrBody[i] === "{") {
      let d = 1;
      let j = i + 1;
      while (j < arrBody.length && d > 0) {
        if (arrBody[j] === "{") d++;
        else if (arrBody[j] === "}") d--;
        j++;
      }
      objects.push(arrBody.slice(i, j));
      i = j;
    } else {
      i++;
    }
  }

  // Extract the fields we need from each object via regex. Brittle by
  // design — the .tsx file is the source of truth and we want any deviation
  // (new field, renamed key) to fail loud during build.
  function fieldString(obj, key) {
    const m = obj.match(new RegExp(`${key}:\\s*("([^"\\\\]|\\\\.)*"|'([^'\\\\]|\\\\.)*'|\`([^\`\\\\]|\\\\.)*\`)`));
    if (!m) return null;
    return JSON.parse(
      // Convert any single-quoted / backtick form to JSON-safe double quotes
      m[1]
        .replace(/^['`]/, '"')
        .replace(/['`]$/, '"')
        // Re-escape any literal double quotes that came from a backtick
        .replace(/(?<!\\)"(?!$)/g, (s, idx) => idx === 0 ? '"' : '\\"')
    );
  }
  function fieldNumber(obj, key) {
    const m = obj.match(new RegExp(`${key}:\\s*(\\d+)`));
    return m ? Number(m[1]) : null;
  }
  function fieldStringArray(obj, key) {
    const m = obj.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
    if (!m) return [];
    return [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
  }

  return objects.map((obj) => ({
    id: fieldNumber(obj, "id"),
    title: fieldString(obj, "title"),
    imageUrl: fieldString(obj, "imageUrl"),
    caption: fieldString(obj, "caption"),
    tags: fieldStringArray(obj, "tags"),
  })).filter((s) => s.id && s.title && s.imageUrl);
}

function escapeHtml(s) {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pageFor(smack) {
  // Use the SMACK's own image as og:image so each per-smack share page
  // shows that specific smack as the FB preview (not the homepage OG).
  // Prefer the WebP sibling if the original is a PNG/JPG — FB scrapers
  // are happiest with smaller files. (An earlier diagnostic version of
  // this script swapped this for `${SITE}/og-image-v3.jpg` while we were
  // debugging FB's stuck cache — left in only as a comment so the
  // history of that experiment isn't lost.)
  function webpSibling(src) {
    if (!/^\/[^/]/.test(src)) return null;
    if (!/\.(jpe?g|png)(\?|#|$)/i.test(src)) return null;
    return src.replace(/\.(jpe?g|png)(\?|#|$)/i, ".webp$2");
  }
  const webp = webpSibling(smack.imageUrl);
  const ogPath = webp ?? smack.imageUrl;
  const absoluteImage = ogPath.startsWith("http") ? ogPath : `${SITE}${ogPath}`;
  const title = `${smack.title} — ResistAct`;
  const description = smack.caption
    ? smack.caption.slice(0, 280)
    : `A ResistAct Smack: ${smack.title}. Save it. Post it. Move on.`;
  // Use a relative redirect target so the page works on localhost / preview
  // deploys / production without per-environment builds. og:* tags still use
  // the absolute SITE URL because social scrapers need a fully-qualified URL.
  const target = `/?smack=${smack.id}`;

  // STRIPPED-DOWN VERSION for FB scraper compatibility. We removed:
  //   - canonical link  (FB may follow it back to a cached-failure URL)
  //   - twitter:* tags  (extra parse load + duplicate of og:*)
  //   - <noscript>, body image, etc.  (FB shouldn't care, but minimise risk)
  // What remains is the absolute minimum FB needs: charset, title,
  // og:type/url/title/description/image, and a JS redirect for real users.
  // If FB can scrape this version successfully, we know whatever was tripping
  // the previous scrape was structural HTML noise — and we can add things
  // back carefully one at a time.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="article">
<meta property="og:url" content="${SITE}/s/${smack.id}.html">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(absoluteImage)}">
<meta property="og:site_name" content="ResistAct">
<script>window.location.replace(${JSON.stringify(target)});</script>
</head>
<body><a href="${target}">Continue to ResistAct</a></body>
</html>
`;
}

// Read projectId + publicAnonKey from the autogenerated Supabase info file so
// this script has a single source of truth (no hardcoded key drift).
function readSupabaseInfo() {
  const infoPath = path.resolve(REPO_ROOT, "utils/supabase/info.tsx");
  const src = fs.readFileSync(infoPath, "utf8");
  const projectId = src.match(/projectId\s*=\s*"([^"]+)"/)?.[1];
  const publicAnonKey = src.match(/publicAnonKey\s*=\s*"([^"]+)"/)?.[1];
  if (!projectId || !publicAnonKey) throw new Error("Couldn't parse utils/supabase/info.tsx");
  return { projectId, publicAnonKey };
}

/**
 * Fetch approved KV smacks (receipts) so they get per-smack OG pages too.
 * FAIL-SOFT: any network / parse error logs a warning and returns [] — a
 * transient outage (or an offline build) must NEVER break the build. KV smacks
 * without a page just fall back to the ?smack=<id> deep link at runtime (which
 * still works — see shareUrlFor + the SMACK_SHARE_PAGE_IDS manifest).
 */
async function fetchApprovedReceipts() {
  try {
    const { projectId, publicAnonKey } = readSupabaseInfo();
    const url = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04/receipts`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${publicAnonKey}` } });
    if (!res.ok) {
      console.warn(`[generate-smack-share-pages] /receipts returned ${res.status}; skipping KV smack pages.`);
      return [];
    }
    const data = await res.json();
    const receipts = Array.isArray(data?.receipts) ? data.receipts : [];
    // Public endpoint already filters to approved; belt-and-suspenders here.
    return receipts
      .filter((r) => r && typeof r.id === "number" && r.adminApproved !== false && r.title && r.imageUrl)
      .map((r) => ({
        id: r.id,
        title: String(r.title),
        imageUrl: String(r.imageUrl),
        caption: r.caption ? String(r.caption) : null,
        tags: Array.isArray(r.tags) ? r.tags : [],
      }));
  } catch (err) {
    console.warn(`[generate-smack-share-pages] Could not fetch KV smacks (${err}); skipping KV smack pages.`);
    return [];
  }
}

function writeManifest(ids) {
  const MANIFEST = path.resolve(REPO_ROOT, "src/app/data/smack-share-pages.ts");
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const body = `/* AUTOGENERATED by scripts/generate-smack-share-pages.mjs — DO NOT EDIT.
 * IDs of smacks that have a static /s/<id>.html OG share page (static smacks
 * plus approved KV smacks captured at the last build). shareUrlFor() upgrades
 * only these to the OG page; any other id falls back to the ?smack=<id> deep
 * link so a brand-new smack shared before the next build never 404s. */
export const SMACK_SHARE_PAGE_IDS: ReadonlySet<number> = new Set([
${sorted.map((n) => `  ${n},`).join("\n")}
]);
`;
  fs.writeFileSync(MANIFEST, body);
  return path.relative(REPO_ROOT, MANIFEST);
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const staticSmacks = parseStaticSmacks();
  if (staticSmacks.length === 0) {
    console.error("[generate-smack-share-pages] No STATIC_SMACKS parsed — aborting.");
    process.exit(1);
  }
  const kvSmacks = await fetchApprovedReceipts();
  // Static smacks (id >= 5000) live in source; KV smacks come from the API.
  // On an id collision, prefer the KV record (it's the live source of truth).
  const byId = new Map();
  for (const s of staticSmacks) byId.set(s.id, s);
  for (const s of kvSmacks) byId.set(s.id, s);
  const smacks = [...byId.values()];

  for (const s of smacks) {
    const file = path.join(OUT_DIR, `${s.id}.html`);
    fs.writeFileSync(file, pageFor(s));
  }
  const manifestPath = writeManifest(smacks.map((s) => s.id));
  console.log(
    `[generate-smack-share-pages] Wrote ${smacks.length} pages ` +
    `(${staticSmacks.length} static + ${kvSmacks.length} KV) to ${path.relative(REPO_ROOT, OUT_DIR)}/ ` +
    `and manifest ${manifestPath}`,
  );
}

main();
