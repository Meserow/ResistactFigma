#!/usr/bin/env node
/**
 * Rewrite card synopses that are too short or missing so each one
 * renders as ~2 lines of italic subtitle at the wide-desktop 4-col
 * grid layout (~280px columns) — the layout where the user originally
 * spotted the imbalance.
 *
 * Why this exists: line-clamp-2 (added in ActionCard.tsx) already
 * caps overflow at 2 lines. This script handles the opposite
 * problem — subtitles that are 1 line of text and leave the card
 * feeling thin compared to its neighbors.
 *
 * What it touches:
 *   - SEED_CARDS in supabase/functions/make-server-9eb1ae04/index.ts
 *     (synopses for org-curated cards; flow into the manifest via
 *     build-synopsis-manifest.mjs)
 *   - src/app/data/synopsis-manifest.ts (client-side fallback,
 *     authoritative for live KV cards that don't have a server-side
 *     synopsis)
 *
 * What it does NOT touch:
 *   - KV-stored synopses on live cards. If a live KV card has
 *     `synopsis` set in KV, the resolveCard() chain picks that
 *     value first, so manifest edits won't show. Those need to be
 *     fixed via the admin panel one at a time.
 *
 * Target: 60–75 chars / ~10–13 words. Anything in [55, 85] is left
 * alone (close enough). Anything missing OR <55 chars gets rewritten.
 * We do NOT trim long synopses here — line-clamp-2 already handles
 * those visually with an ellipsis.
 *
 * Modes (env vars):
 *   OPENAI_API_KEY    required
 *   DRY_RUN=1         don't write to any files; print a preview JSON
 *   COUNT=N           cap iterations (defaults to 9999)
 *   IDS=1,1000,1254   only operate on these specific IDs
 *   TARGET_MIN=55     minimum acceptable char count (default 55)
 *   TARGET_GOAL=68    desired char count (default 68)
 *   SCOPE=seeds|live|all  which set to process (default all)
 *
 * Run:
 *   OPENAI_API_KEY=sk-... DRY_RUN=1 COUNT=10 node scripts/normalize-synopses.mjs
 *   OPENAI_API_KEY=sk-... node scripts/normalize-synopses.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "..", "supabase", "functions", "make-server-9eb1ae04", "index.ts");
const MANIFEST_PATH = path.join(__dirname, "..", "src", "app", "data", "synopsis-manifest.ts");

const PROJECT_ID = "zkihnylrvdofdbnhmmoq";
const PUBLIC_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpraWhueWxydmRvZmRibmhtbW9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzczNTEsImV4cCI6MjA4ODY1MzM1MX0.gkm2fiQHlBrexo4FHcn-a-WH1QZ8ewabcEcL5rTZF-0";

const DRY_RUN = process.env.DRY_RUN === "1";
const COUNT = Number(process.env.COUNT ?? "9999");
const TARGET_MIN = Number(process.env.TARGET_MIN ?? "55");
const TARGET_GOAL = Number(process.env.TARGET_GOAL ?? "68");
const SCOPE = (process.env.SCOPE ?? "all").toLowerCase();
const ONLY_IDS = (process.env.IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number)
  .filter((n) => Number.isFinite(n));
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
  process.exit(1);
}

const SYSTEM_PROMPT = `You write subtitle text that sits below the title on an anti-Trump
resistance website's action cards. Each subtitle wraps onto exactly two
short lines at a narrow column width.

LENGTH: 60–75 characters total, 10–13 words. Hit that range tightly.

VOICE: punchy, plainspoken, specific. Reads like a knowing friend, not
marketing copy. Concrete nouns and named details beat generic verbs.

DO NOT START with these dead-on-arrival phrases (they're banned):
"Support", "Stay informed", "Get involved", "Shop smarter", "Commit to",
"Take action", "Make your voice heard", "Join the movement", "Participate
in", "Empower", "Discover", "Explore", "Learn about", "Engage with".

DO NOT restate the title. DO NOT promise vague outcomes ("for change",
"for the future", "today"). DO NOT use exclamation marks. DO NOT add
trailing filler words like "now", "today", "this season".

INSTEAD, lead with the SPECIFIC THING the card does: a number, a brand
name, an org name, a place, a date, a verb-object that names exactly
what action the user takes. If the original synopsis already nails a
punchy detail, KEEP it and add only the missing context.

DO NOT invent specifics not in the card data. Do NOT add days of the
week ("this Saturday"), times ("at noon"), exact counts, locations, or
deadlines unless they appear in the provided description, location, or
event date fields. If you don't have a concrete detail to add, just
state the WHO or the FORMAT plainly instead of fabricating one.

Examples of the voice we want (do not output these — they're for tone):
  "7,000+ brand donations searchable before you check out"
  "Dog poop bags featuring Trump's face — leak-proof, BSCI-compliant"
  "24-hour buy-nothing blackouts, dates on a shared calendar"
  "Pledge to sell Tesla stock and picket dealerships in your city"
  "Curated Etsy storefronts for one-of-a-kind resistance merch"

Examples of voice we DON'T want (avoid this register):
  "Support eco-friendly activism with every bag you use. Get involved!"
  "Stay informed on retailers linked to Trump—update before you shop"
  "Shop smarter by identifying MAGA-aligned brands in real-time"

FORMAT: no emojis, no quotation marks around the output, no trailing
period, no labels. Output ONLY the subtitle text.`;

async function authorSynopsis({ title, description, location, eventDate, existing }) {
  const parts = [`Card title: ${title}`];
  if (description) parts.push(`Card description: ${String(description).slice(0, 300)}`);
  if (location) parts.push(`Location: ${location}`);
  if (eventDate) parts.push(`Event date: ${eventDate}`);
  if (existing) {
    parts.push(
      `Existing subtitle (it's already punchy but too short — KEEP its specific details and ADD missing context to reach 10–13 words): ${existing}`,
    );
  }
  parts.push(`Write the subtitle now. Aim for ~${TARGET_GOAL} characters (60–75).`);
  const userMsg = parts.join("\n\n");

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      max_tokens: 80,
      temperature: 0.7,
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`OpenAI ${r.status}: ${err.slice(0, 300)}`);
  }
  const json = await r.json();
  let text = json?.choices?.[0]?.message?.content?.trim() ?? "";
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  text = text.replace(/\.$/, "").trim();
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

// ──────────────────────────────────────────────────────────────────────
// SEED side (index.ts)
// ──────────────────────────────────────────────────────────────────────

function parseSeedLine(line) {
  if (!/^  \{ id: \d+/.test(line)) return null;
  const idMatch = line.match(/id: (\d+)/);
  if (!idMatch) return null;
  const id = Number(idMatch[1]);
  const titleMatch = line.match(/title: "((?:[^"\\]|\\.)+)"/);
  const descMatch = line.match(/description: "((?:[^"\\]|\\.)+)"/);
  const synMatch = line.match(/\bsynopsis: "((?:[^"\\]|\\.)+)"/);
  const locMatch = line.match(/\blocation: "((?:[^"\\]|\\.)+)"/);
  const dateMatch = line.match(/\beventDate: "((?:[^"\\]|\\.)+)"/);
  const unescape = (s) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return {
    id,
    title: titleMatch ? unescape(titleMatch[1]) : null,
    description: descMatch ? unescape(descMatch[1]) : null,
    synopsis: synMatch ? unescape(synMatch[1]) : null,
    location: locMatch ? unescape(locMatch[1]) : null,
    eventDate: dateMatch ? unescape(dateMatch[1]) : null,
    pinToTop: /\bpinToTop: true/.test(line),
    isFeatured: /\bisFeatured: true/.test(line),
  };
}

function seedNeedsRewrite(parsed) {
  if (!parsed?.title) return null;
  if (ONLY_IDS.length && !ONLY_IDS.includes(parsed.id)) return null;
  // Skip the pinToTop hero — it has hand-authored copy we shouldn't auto-rewrite.
  if (parsed.pinToTop) return null;
  if (parsed.synopsis == null) return "missing";
  if (parsed.synopsis.length < TARGET_MIN) return "short";
  return null;
}

function patchSeedLine(line, synopsis) {
  const escaped = synopsis.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (/\bsynopsis: "/.test(line)) {
    return line.replace(/\bsynopsis: "(?:[^"\\]|\\.)+"/, `synopsis: "${escaped}"`);
  }
  // Insert synopsis between title and description.
  return line.replace(
    /(title: "(?:[^"\\]|\\.)+",\s*)(description:)/,
    `$1synopsis: "${escaped}", $2`,
  );
}

async function processSeeds(previews) {
  const src = await fs.readFile(INDEX_PATH, "utf8");
  const lines = src.split("\n");
  const todo = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseSeedLine(lines[i]);
    if (!parsed) continue;
    const reason = seedNeedsRewrite(parsed);
    if (reason) todo.push({ lineIdx: i, parsed, reason });
  }
  console.log(`SEEDS: ${todo.length} candidates (missing or <${TARGET_MIN} chars).`);

  let ok = 0;
  let fail = 0;
  for (const { lineIdx, parsed, reason } of todo) {
    if (previews.processed >= COUNT) break;
    previews.processed++;
    const before = parsed.synopsis ?? "";
    process.stdout.write(`[seed ${parsed.id}] ${reason.padEnd(7)} ${(parsed.title ?? "").slice(0, 50)}... `);
    try {
      const next = await authorSynopsis({
        title: parsed.title,
        description: parsed.description ?? "",
        location: parsed.location,
        eventDate: parsed.eventDate,
        existing: reason === "short" ? before : null,
      });
      previews.changes.push({
        source: "seed",
        id: parsed.id,
        title: parsed.title,
        reason,
        before,
        after: next,
        beforeLen: before.length,
        afterLen: next.length,
      });
      if (!DRY_RUN) {
        const newLine = patchSeedLine(lines[lineIdx], next);
        if (newLine === lines[lineIdx]) {
          console.log("MISS (regex didn't insert)");
          fail++;
          continue;
        }
        lines[lineIdx] = newLine;
        await fs.writeFile(INDEX_PATH, lines.join("\n"));
      }
      ok++;
      console.log(`✓ (${next.length}c) "${next.slice(0, 60)}${next.length > 60 ? "…" : ""}"`);
    } catch (err) {
      fail++;
      console.log(`✗ ${err.message}`);
    }
  }
  console.log(`SEEDS done. ok=${ok} fail=${fail}`);
}

// ──────────────────────────────────────────────────────────────────────
// LIVE KV side (via manifest)
// ──────────────────────────────────────────────────────────────────────

async function fetchLiveCards() {
  const r = await fetch(
    `https://${PROJECT_ID}.supabase.co/functions/v1/make-server-9eb1ae04/actions?limit=2000`,
    { headers: { Authorization: `Bearer ${PUBLIC_ANON_KEY}` } },
  );
  if (!r.ok) throw new Error(`actions ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const json = await r.json();
  return Array.isArray(json) ? json : (json.cards ?? json.data ?? []);
}

async function readManifest() {
  const src = await fs.readFile(MANIFEST_PATH, "utf8");
  const out = new Map();
  for (const line of src.split("\n")) {
    const m = line.match(/^\s*(\d+):\s*"((?:[^"\\]|\\.)+)",?\s*$/);
    if (m) {
      const id = Number(m[1]);
      const text = m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      out.set(id, text);
    }
  }
  return out;
}

async function writeManifest(entries) {
  const sorted = [...entries.entries()].sort((a, b) => a[0] - b[0]);
  const escape = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const body = `/**
 * Client-side fallback for card synopses (the short two-line subtitle
 * below each card's title). Lets us ship subtitle copy without an Edge
 * Function deploy — resolveCard() prefers the server's value when
 * present, then falls back to SYNOPSES[id].
 *
 * Covers both SEED_CARDS (authored from index.ts via
 * \`scripts/build-synopsis-manifest.mjs\`) and live KV cards (authored
 * via \`scripts/generate-live-synopses.mjs\` and length-normalized via
 * \`scripts/normalize-synopses.mjs\`).
 *
 * Hand edits will be overwritten on the next regeneration; edit the
 * source data (index.ts for seeds, the live card via admin for KV
 * entries) and rerun the appropriate script instead.
 *
 * Cards listed here: ${sorted.length}.
 */
export const SYNOPSES: Record<number, string> = {
${sorted.map(([id, text]) => `  ${id}: "${escape(text)}",`).join("\n")}
};

/** Look up a synopsis fallback by card id. Returns undefined if the
 *  card isn't in the manifest (which is fine — the title-split logic
 *  in ActionCard.tsx handles the missing case). */
export function synopsisFor(id: number | undefined | null): string | undefined {
  if (typeof id !== "number") return undefined;
  return SYNOPSES[id];
}
`;
  await fs.writeFile(MANIFEST_PATH, body);
}

async function processLive(previews) {
  const manifest = await readManifest();
  const liveCards = await fetchLiveCards();
  console.log(`LIVE: ${liveCards.length} cards fetched, manifest has ${manifest.size} entries.`);

  // Build a set of seed IDs so we don't double-process anything that's
  // already in SEED_CARDS — those flow through index.ts.
  const seedSrc = await fs.readFile(INDEX_PATH, "utf8");
  const seedIds = new Set();
  for (const line of seedSrc.split("\n")) {
    const m = line.match(/^  \{ id: (\d+)/);
    if (m) seedIds.add(Number(m[1]));
  }

  const todo = [];
  for (const card of liveCards) {
    if (!card || typeof card.id !== "number") continue;
    if (ONLY_IDS.length && !ONLY_IDS.includes(card.id)) continue;
    if (seedIds.has(card.id)) continue; // handled by processSeeds
    if (card.pinToTop) continue;
    // If the live card has a server-side synopsis we can't override via
    // the manifest. Skip — those need an admin-panel fix.
    if (typeof card.synopsis === "string" && card.synopsis.trim().length > 0) continue;

    const manifestSyn = manifest.get(card.id);
    let reason = null;
    if (!manifestSyn) reason = "missing";
    else if (manifestSyn.length < TARGET_MIN) reason = "short";
    if (!reason) continue;

    if (!card.description || card.description.trim().length < 20) continue;
    todo.push({ card, reason, existing: manifestSyn ?? "" });
  }
  console.log(`LIVE: ${todo.length} candidates (missing or <${TARGET_MIN} chars).`);

  let ok = 0;
  let fail = 0;
  for (const { card, reason, existing } of todo) {
    if (previews.processed >= COUNT) break;
    previews.processed++;
    process.stdout.write(`[live ${card.id}] ${reason.padEnd(7)} ${(card.title ?? "").slice(0, 50)}... `);
    try {
      const next = await authorSynopsis({
        title: card.title,
        description: card.description ?? "",
        location: card.location,
        eventDate: card.eventDate,
        existing: reason === "short" ? existing : null,
      });
      previews.changes.push({
        source: "live",
        id: card.id,
        title: card.title,
        reason,
        before: existing,
        after: next,
        beforeLen: existing.length,
        afterLen: next.length,
      });
      if (!DRY_RUN) {
        manifest.set(card.id, next);
        await writeManifest(manifest);
      }
      ok++;
      console.log(`✓ (${next.length}c) "${next.slice(0, 60)}${next.length > 60 ? "…" : ""}"`);
    } catch (err) {
      fail++;
      console.log(`✗ ${err.message}`);
    }
  }
  console.log(`LIVE done. ok=${ok} fail=${fail}`);
}

async function main() {
  console.log(
    `Mode: ${DRY_RUN ? "DRY-RUN (no files written)" : "WRITE"}  ` +
      `COUNT=${COUNT}  TARGET_MIN=${TARGET_MIN}  TARGET_GOAL=${TARGET_GOAL}  SCOPE=${SCOPE}` +
      (ONLY_IDS.length ? `  IDS=${ONLY_IDS.join(",")}` : ""),
  );
  const previews = { processed: 0, changes: [] };
  if (SCOPE === "all" || SCOPE === "seeds") await processSeeds(previews);
  if (SCOPE === "all" || SCOPE === "live") await processLive(previews);

  if (DRY_RUN) {
    const previewPath = path.join(__dirname, "..", "reports", `synopsis-normalize-preview-${Date.now()}.json`);
    await fs.mkdir(path.dirname(previewPath), { recursive: true });
    await fs.writeFile(previewPath, JSON.stringify(previews.changes, null, 2));
    console.log(`\nPreview written: ${previewPath}`);
    console.log(`Total proposed changes: ${previews.changes.length}`);
  } else {
    console.log(`\nTotal applied changes: ${previews.changes.length}`);
    console.log("Remember to run: node scripts/build-synopsis-manifest.mjs");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
