#!/usr/bin/env node
/**
 * Read the SEED_CARDS in index.ts and write a client-side manifest of
 * { card id → synopsis } pairs to `src/app/data/synopsis-manifest.ts`.
 *
 * Why a manifest? Synopses are SEED_CARD edits — they only reach the
 * live API after an Edge Function deploy. The manifest lets the client
 * fall back to the synopsis instantly, so the subtitle row populates
 * without needing to redeploy/migrate KV.
 *
 * resolveCard() in App.tsx already prefers the server-provided synopsis
 * when present (raw.synopsis), then falls back to SYNOPSES[id].
 *
 * Run after every synopsis-authoring run:
 *   node scripts/build-synopsis-manifest.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "..", "supabase", "functions", "make-server-9eb1ae04", "index.ts");
const OUT_PATH = path.join(__dirname, "..", "src", "app", "data", "synopsis-manifest.ts");

/** Parse the current manifest to recover existing entries — these
 *  include live-KV synopses authored via `generate-live-synopses.mjs`
 *  and `normalize-synopses.mjs`, which are NOT in index.ts. We MUST
 *  preserve them; otherwise rebuilding wipes ~336 live entries. */
async function readExistingManifest() {
  const out = new Map();
  try {
    const src = await fs.readFile(OUT_PATH, "utf8");
    for (const line of src.split("\n")) {
      const m = line.match(/^\s*(\d+):\s*"((?:[^"\\]|\\.)+)",?\s*$/);
      if (m) {
        const id = Number(m[1]);
        const text = m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        out.set(id, text);
      }
    }
  } catch {
    // First run — no existing manifest. Fine.
  }
  return out;
}

async function main() {
  const src = await fs.readFile(INDEX_PATH, "utf8");
  // Start from existing manifest so live-KV entries survive.
  const merged = await readExistingManifest();
  const existingCount = merged.size;
  let seedCount = 0;
  // Layer SEED_CARDS synopses on top (seed wins for IDs in both sets).
  for (const line of src.split("\n")) {
    if (!/^  \{ id: \d+/.test(line)) continue;
    const idMatch = line.match(/id: (\d+)/);
    const synMatch = line.match(/\bsynopsis: "((?:[^"\\]|\\.)+)"/);
    if (idMatch && synMatch) {
      const id = Number(idMatch[1]);
      const text = synMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      merged.set(id, text);
      seedCount++;
    }
  }
  const entries = [...merged.entries()].sort((a, b) => a[0] - b[0]);

  // Re-escape any quotes / special chars for safe embedding in TS literals
  const escape = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const body = `/**
 * Client-side fallback for card synopses (the short two-line subtitle
 * below each card's title). Lets us ship subtitle copy without an Edge
 * Function deploy — resolveCard() prefers the server's value when
 * present, then falls back to SYNOPSES[id].
 *
 * Maintained by \`scripts/build-synopsis-manifest.mjs\` (merges
 * SEED_CARDS synopses from \`supabase/functions/make-server-9eb1ae04/index.ts\`
 * into the existing manifest, preserving live-KV entries authored via
 * \`generate-live-synopses.mjs\` and \`normalize-synopses.mjs\`).
 *
 * Hand edits will be overwritten on the next regeneration; edit the
 * source data (index.ts for seeds, the live card via admin for KV
 * entries) and rerun the appropriate script instead.
 *
 * Cards listed here: ${entries.length}.
 */
export const SYNOPSES: Record<number, string> = {
${entries.map(([id, text]) => `  ${id}: "${escape(text)}",`).join("\n")}
};

/** Look up a synopsis fallback by card id. Returns undefined if the
 *  card isn't in the manifest (which is fine — the title-split logic
 *  in ActionCard.tsx handles the missing case). */
export function synopsisFor(id: number | undefined | null): string | undefined {
  if (typeof id !== "number") return undefined;
  return SYNOPSES[id];
}
`;

  await fs.writeFile(OUT_PATH, body);
  console.log(
    `Wrote ${OUT_PATH}: ${entries.length} total synopses ` +
      `(${seedCount} from SEED_CARDS, ${entries.length - seedCount} preserved live-KV entries, ` +
      `started from ${existingCount}).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
