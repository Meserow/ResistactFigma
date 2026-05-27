#!/usr/bin/env node
/**
 * Author short two-line synopses for SEED_CARDS that don't yet have one
 * and don't get a subtitle from a title colon/em-dash split.
 *
 * Uses gpt-4o-mini for cost — these are very short generations and the
 * mini model is more than capable of the writing task.
 *
 * Pipeline:
 *   1. Read SEED_CARDS lines from index.ts
 *   2. For each line that has no `synopsis:` AND no `: ` / ` — ` in the
 *      title, send the title + first ~300 chars of description to the
 *      chat API with a tight authoring prompt
 *   3. Insert `synopsis: "..."` between title and description in the line
 *   4. Write the file back after each batch so a crash mid-run still
 *      leaves a consistent partial state
 *
 * Run:
 *   OPENAI_API_KEY=sk-... node scripts/generate-card-synopses.mjs
 *   COUNT=20 OPENAI_API_KEY=sk-... node scripts/generate-card-synopses.mjs  # cap per-run
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "..", "supabase", "functions", "make-server-9eb1ae04", "index.ts");

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

async function authorSynopsis(title, description) {
  const userMsg =
    `Card title: ${title}\n\n` +
    `Card description: ${(description || "").slice(0, 300)}\n\n` +
    `Write the subtitle now.`;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
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
  // Strip quotes the model sometimes adds anyway
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  // Strip trailing period
  text = text.replace(/\.$/, "").trim();
  // CRITICAL: TypeScript double-quoted strings can't contain raw newlines.
  // Collapse any newlines (the model sometimes splits into two lines) plus
  // any runs of whitespace down to single spaces. CSS will wrap the
  // subtitle to two visual lines naturally based on card width.
  text = text.replace(/\s+/g, " ").trim();
  // Escape any double quotes for safe inline in TS string
  text = text.replace(/"/g, '\\"');
  return text;
}

/** True if the line has a card with no synopsis AND no title split.
 *  Spread the Word (pinToTop) is intentionally skipped — that card is
 *  the welcome hero and gets no subtitle. */
function needsSynopsis(line) {
  if (!/^  \{ id: \d+/.test(line)) return false;
  if (/\bsynopsis:/.test(line)) return false;
  if (/\bpinToTop: true/.test(line)) return false;
  const titleMatch = line.match(/title: "([^"]+)"/);
  if (!titleMatch) return false;
  const title = titleMatch[1];
  if (title.includes(": ") || title.includes(" — ")) return false;
  return true;
}

function extractFields(line) {
  const idMatch = line.match(/id: (\d+)/);
  const titleMatch = line.match(/title: "((?:[^"\\]|\\.)+)"/);
  const descMatch = line.match(/description: "((?:[^"\\]|\\.)+)"/);
  return {
    id: idMatch ? Number(idMatch[1]) : null,
    title: titleMatch ? titleMatch[1].replace(/\\"/g, '"') : null,
    description: descMatch ? descMatch[1].replace(/\\"/g, '"') : null,
  };
}

/** Replace `title: "X", description:` with `title: "X", synopsis: "Y", description:`. */
function patchLine(line, synopsis) {
  return line.replace(
    /(title: "(?:[^"\\]|\\.)+",\s*)(description:)/,
    `$1synopsis: "${synopsis}", $2`,
  );
}

async function main() {
  console.log(`Reading ${INDEX_PATH}`);
  const original = await fs.readFile(INDEX_PATH, "utf8");
  const lines = original.split("\n");
  const todo = [];
  for (let i = 0; i < lines.length; i++) {
    if (needsSynopsis(lines[i])) todo.push(i);
    if (todo.length >= COUNT) break;
  }
  console.log(`Found ${todo.length} cards needing a synopsis (cap COUNT=${COUNT}).`);

  let ok = 0;
  let fail = 0;
  for (const idx of todo) {
    const fields = extractFields(lines[idx]);
    if (!fields.id || !fields.title) {
      console.log(`  skip line ${idx + 1} — couldn't parse`);
      continue;
    }
    process.stdout.write(`[${fields.id}] ${fields.title.slice(0, 60)}... `);
    try {
      const synopsis = await authorSynopsis(fields.title, fields.description ?? "");
      const newLine = patchLine(lines[idx], synopsis);
      if (newLine === lines[idx]) {
        console.log(`MISS (regex didn't insert)`);
        fail++;
        continue;
      }
      lines[idx] = newLine;
      ok++;
      console.log(`✓ "${synopsis.slice(0, 70)}${synopsis.length > 70 ? "…" : ""}"`);
      // Persist after every successful card so partial runs are safe.
      await fs.writeFile(INDEX_PATH, lines.join("\n"));
    } catch (err) {
      fail++;
      console.log(`✗ ${err.message}`);
    }
  }

  console.log(`\nDone. ${ok} authored, ${fail} failed.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
