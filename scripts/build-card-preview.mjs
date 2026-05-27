#!/usr/bin/env node
/**
 * Build /public/preview-card-art/all.html — a static gallery of every
 * card that's been cartoonized so far, using the actual ResistAct card
 * layout. Lets us see what the feed will look like once the cartoonize
 * pipeline is deployed.
 *
 * Run: node scripts/build-card-preview.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART_DIR = path.join(__dirname, "..", "public", "preview-card-art");
const OUT_FILE = path.join(ART_DIR, "all.html");

const PROJECT_ID = "zkihnylrvdofdbnhmmoq";
const PUBLIC_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpraWhueWxydmRvZmRibmhtbW9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzczNTEsImV4cCI6MjA4ODY1MzM1MX0.gkm2fiQHlBrexo4FHcn-a-WH1QZ8ewabcEcL5rTZF-0";

const CATEGORY_COLORS = {
  "Act of Kindness": "#127f05", "Art/Performance Art": "#896312",
  "Bird-Dog": "#5a3e9e", "Bird-dog": "#5a3e9e",
  "Boost": "#8a00e6", "Boycott": "#7c2d12", "Call": "#c2185b",
  "Crafting": "#c34e00", "Email Campaign": "#e44b4b",
  "Flash Mob": "#ff00d5", "Funding": "#127f05", "Host": "#b45309",
  "Housing": "#896312", "Irreverence": "#ff00d5",
  "Join a Group": "#0891b2", "Labor": "#127f05", "Learn": "#126d89",
  "Letter to Editor": "#c34e00", "Letter Writing": "#c34e00",
  "Meeting": "#23297e", "Mental Health": "#ff00d5",
  "News Story": "#896312", "Other": "#767574",
  "Personal Commitment": "#23297e", "Petition": "#05737f",
  "Prayer": "#8a00e6", "Professional Skills": "#126d89",
  "Protest": "#23297e", "Purchase": "#b45309",
  "Show Up": "#23297e", "Social Media": "#e44b4b",
  "Spread Positivity": "#8a00e6", "Training": "#126d89",
  "Transportation": "#126d89", "Video": "#e44b4b",
  "Witness": "#767574",
};

const TITLE_CASE_STOPWORDS = new Set(["of", "to", "a", "the", "and", "or", "in", "on", "for", "at"]);
function titleCase(s) {
  return s.toLowerCase().split(/\s+/).map((w, i) =>
    i === 0 || !TITLE_CASE_STOPWORDS.has(w)
      ? w.charAt(0).toUpperCase() + w.slice(1)
      : w
  ).join(" ");
}
function colorFor(cat) {
  if (!cat) return "#23297e";
  return CATEGORY_COLORS[cat] ?? CATEGORY_COLORS[titleCase(cat)] ?? "#23297e";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function splitTitle(t) {
  const emDashIdx = t.indexOf(" — ");
  const colonIdx = t.indexOf(": ");
  if (colonIdx >= 0 && (emDashIdx < 0 || colonIdx < emDashIdx)) {
    return { head: t.slice(0, colonIdx + 1), tail: t.slice(colonIdx + 2) };
  }
  if (emDashIdx >= 0) {
    return { head: t.slice(0, emDashIdx), tail: t.slice(emDashIdx + 3) };
  }
  return { head: t, tail: "" };
}

async function main() {
  // List generated webps
  const files = await fs.readdir(ART_DIR);
  const cardIds = files
    .filter((f) => /^card-\d+\.webp$/.test(f))
    .map((f) => Number(f.match(/^card-(\d+)\.webp$/)[1]))
    .sort((a, b) => a - b);

  console.log(`Found ${cardIds.length} cartoonized cards.`);

  // Fetch live card metadata
  const r = await fetch(`https://${PROJECT_ID}.supabase.co/functions/v1/make-server-9eb1ae04/actions?limit=2000`, {
    headers: { Authorization: `Bearer ${PUBLIC_ANON_KEY}` },
  });
  const json = await r.json();
  const allCards = Array.isArray(json) ? json : (json.cards ?? json.data ?? []);
  const byId = new Map(allCards.map((c) => [c.id, c]));

  const rendered = [];
  let missing = 0;
  for (const id of cardIds) {
    const c = byId.get(id);
    if (!c) { missing++; continue; }
    const cat = titleCase(c.category ?? "Other");
    const color = colorFor(cat);
    const { head, tail } = splitTitle(c.title ?? "");
    const loc = c.isOnline ? "🌐 Online" : (c.location ? `📍 ${c.location}` : "");

    rendered.push(`
    <div class="card">
      <div class="banner">
        <img src="card-${id}.webp" alt="" loading="lazy">
        <div class="cat-pill" style="--cat:${color}">${escapeHtml(cat)}</div>
        ${loc ? `<div class="loc-pill">${escapeHtml(loc)}</div>` : ""}
      </div>
      <div class="content">
        <div class="title">${escapeHtml(head)}${tail ? `<span class="subtitle">${escapeHtml(tail)}</span>` : ""}</div>
        <div class="spacer"></div>
        <div class="footer">
          <div class="stats"></div>
          <div class="author"><div class="name">${escapeHtml(c.authorName ?? "")}</div><div class="role">${escapeHtml(c.authorRole ?? "")}</div></div>
        </div>
      </div>
    </div>`);
  }

  console.log(`Rendered ${rendered.length} cards (${missing} missing from live API).`);

  const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Cartoonized cards — gallery (${rendered.length})</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px; font-family: 'Poppins', system-ui, sans-serif; background: #f8fafc; color: #111827; }
  h1 { font-size: 18px; margin: 0 0 6px; color: #23297e; }
  .sub { font-size: 13px; color: #6b7280; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; max-width: 1600px; margin: 0 auto; }
  .card { background: white; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; transition: border-color .2s, box-shadow .2s; }
  .card:hover { border-color: #d1d5db; box-shadow: 0 4px 6px -1px rgba(0,0,0,.08); }
  .banner { height: 106px; position: relative; overflow: hidden; }
  /* object-position: top matches the production app's banner CSS. Without
     this, a 3:2 master gets center-cropped and faces lose their tops. */
  .banner img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 15%; display: block; }
  .cat-pill { position: absolute; top: 10px; left: 12px; background: var(--cat); color: white; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.1); letter-spacing: .02em; }
  .loc-pill { position: absolute; bottom: 8px; right: 12px; background: rgba(255,255,255,0.95); color: #374151; font-size: 11px; padding: 2px 8px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
  .content { padding: 16px 20px 20px; flex: 1; display: flex; flex-direction: column; gap: 12px; }
  .title { font-weight: 700; color: #111827; font-size: 15px; line-height: 1.35; }
  .subtitle { display: block; font-weight: 400; font-size: 13px; color: #6b7280; margin-top: 4px; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; padding-top: 8px; border-top: 1px solid #f3f4f6; gap: 12px; }
  .author { text-align: right; min-width: 0; }
  .author .name { font-weight: 600; font-size: 12px; color: #1f2937; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .author .role { font-size: 11px; color: #9ca3af; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spacer { flex: 1; }
</style>
</head>
<body>
  <h1>Cartoonized cards — gallery view</h1>
  <div class="sub">${rendered.length} cards rendered in the actual ResistAct card layout. Click any image to view the master 1536×1024.</div>
  <div class="grid">
    ${rendered.join("\n")}
  </div>
</body></html>`;

  await fs.writeFile(OUT_FILE, html);
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
