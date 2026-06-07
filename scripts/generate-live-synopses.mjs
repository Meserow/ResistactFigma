#!/usr/bin/env node
/**
 * Author synopses for live KV cards that don't have one and don't get
 * a subtitle from a title colon/em-dash split. Extends the existing
 * synopsis-manifest.ts (built from SEED_CARDS) with entries for cards
 * that exist only in KV (user submissions, inbox imports, etc.).
 *
 * Pipeline:
 *   1. Read current synopsis-manifest.ts → set of already-covered IDs
 *   2. Fetch live cards from the Edge Function /actions endpoint
 *   3. Filter to ones not covered + no title split + has a description
 *   4. For each, call gpt-4o-mini with the same tone prompt as the
 *      SEED_CARDS authoring run
 *   5. Rewrite synopsis-manifest.ts with the union (existing + new)
 *      after every successful card, so interrupts leave a consistent
 *      partial state
 *
 * Run:
 *   OPENAI_API_KEY=sk-... node scripts/generate-live-synopses.mjs
 *   COUNT=50 OPENAI_API_KEY=sk-... node scripts/generate-live-synopses.mjs  # cap per-run
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "..", "src", "app", "data", "synopsis-manifest.ts");
const INDEX_PATH = path.join(__dirname, "..", "supabase", "functions", "make-server-9eb1ae04", "index.ts");

const PROJECT_ID = "zkihnylrvdofdbnhmmoq";
const PUBLIC_ANON_KEY =
  "sb_publishable_leJ13K9-4bbJ4n9v_R68LA__A2GqGdx";

const COUNT = Number(process.env.COUNT ?? "9999");
const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
  process.exit(1);
}

const SYSTEM_PROMPT =
  "You write very short subtitle text for an anti-Trump resistance website's action cards. " +
  "Style: punchy, action-focused, specific. About 15–20 words total, splittable into two short lines. " +
  "Do NOT restate the title. Add CONTEXT — what kind of action it is, who runs it, the format, the angle. " +
  "Avoid promotional language ('great', 'amazing'). Avoid 'click here' style. " +
  "No emojis. No quotation marks around the output. No trailing period. " +
  "Output ONLY the subtitle text — no labels, no explanations.";

/** Pull live cards from the API. */
async function fetchLiveCards() {
  const r = await fetch(`https://${PROJECT_ID}.supabase.co/functions/v1/make-server-9eb1ae04/actions?limit=2000`, {
    headers: { Authorization: `Bearer ${PUBLIC_ANON_KEY}` },
  });
  if (!r.ok) throw new Error(`actions ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const json = await r.json();
  return Array.isArray(json) ? json : (json.cards ?? json.data ?? []);
}

/** Parse the current synopsis-manifest.ts to recover existing entries. */
async function readExistingManifest() {
  const src = await fs.readFile(MANIFEST_PATH, "utf8");
  const out = new Map();
  // Lines look like `  1234: "synopsis text",`
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
 * via \`scripts/generate-live-synopses.mjs\`).
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

function needsSynopsis(card, existing) {
  if (!card || typeof card.id !== "number") return false;
  if (existing.has(card.id)) return false;
  if (card.pinToTop) return false;
  if (typeof card.synopsis === "string" && card.synopsis.trim().length > 0) return false;
  const title = (card.title ?? "").trim();
  if (!title) return false;
  if (title.includes(": ") || title.includes(" — ")) return false;
  // Description gives the model context; skip if absent.
  if (!card.description || card.description.trim().length < 20) return false;
  return true;
}

async function authorSynopsis(title, description) {
  const userMsg =
    `Card title: ${title}\n\n` +
    `Card description: ${(description || "").slice(0, 300)}\n\n` +
    `Write the subtitle now.`;
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
  // Manifest is a TS string — squash newlines/runs of whitespace.
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

async function main() {
  console.log(`Reading existing manifest: ${MANIFEST_PATH}`);
  const existing = await readExistingManifest();
  console.log(`  ${existing.size} cards already in manifest`);

  console.log(`Fetching live cards...`);
  const cards = await fetchLiveCards();
  console.log(`  ${cards.length} live cards total`);

  const todo = cards.filter((c) => needsSynopsis(c, existing));
  console.log(`  ${todo.length} cards need a synopsis (cap COUNT=${COUNT})`);
  const slice = todo.slice(0, COUNT);

  let ok = 0;
  let fail = 0;
  for (const card of slice) {
    process.stdout.write(`[${card.id}] ${(card.title ?? "").slice(0, 60)}... `);
    try {
      const syn = await authorSynopsis(card.title, card.description ?? "");
      existing.set(card.id, syn);
      ok++;
      console.log(`✓ "${syn.slice(0, 70)}${syn.length > 70 ? "…" : ""}"`);
      // Persist after every successful card.
      await writeManifest(existing);
    } catch (err) {
      fail++;
      console.log(`✗ ${err.message}`);
    }
  }

  console.log(`\nDone. ${ok} authored, ${fail} failed.`);
  console.log(`Manifest now: ${existing.size} entries`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
