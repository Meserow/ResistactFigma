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
  // Prefer the WebP sibling for og:image when one likely exists, because
  // Facebook's scraper has aggressive timeouts and rejects oversized images
  // — a multi-MB PNG can fail to scrape (response code 0 in the FB debug
  // tool). The webp sibling pattern matches what fetchImageBlob does in
  // SmacksPage. Falls back to the original URL for absolute URLs or for
  // formats other than png/jpg.
  function webpSibling(src) {
    if (!/^\/[^/]/.test(src)) return null;          // only root-relative paths
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

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const smacks = parseStaticSmacks();
  if (smacks.length === 0) {
    console.error("[generate-smack-share-pages] No STATIC_SMACKS parsed — aborting.");
    process.exit(1);
  }
  for (const s of smacks) {
    const file = path.join(OUT_DIR, `${s.id}.html`);
    fs.writeFileSync(file, pageFor(s));
  }
  console.log(`[generate-smack-share-pages] Wrote ${smacks.length} pages to ${path.relative(REPO_ROOT, OUT_DIR)}/`);
}

main();
