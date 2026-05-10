#!/usr/bin/env node
/**
 * Scans all action cards in the KV store for descriptions ending with "..."
 * and attempts to fill them in by fetching each card's targetUrl.
 *
 * Usage:
 *   node tools/fix-truncated.mjs <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Get the key from: Supabase dashboard → Project Settings → API → service_role
 */

const PROJECT_ID = "zkihnylrvdofdbnhmmoq";
const SERVICE_ROLE_KEY = process.argv[2];

if (!SERVICE_ROLE_KEY) {
  console.error("Usage: node tools/fix-truncated.mjs <SUPABASE_SERVICE_ROLE_KEY>");
  process.exit(1);
}

const BASE = `https://${PROJECT_ID}.supabase.co/rest/v1`;
const HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function queryRows(keyPattern) {
  const url = `${BASE}/kv_store_9eb1ae04?key=like.${encodeURIComponent(keyPattern)}&select=key,value`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function upsertRow(key, value) {
  const res = await fetch(`${BASE}/kv_store_9eb1ae04`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error(`Upsert failed for ${key}: ${res.status} ${await res.text()}`);
}

async function extractDescription(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ResistActBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Try og:description first, then meta description, then first <p> text
    const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    if (og?.[1]) return og[1].trim();

    const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    if (meta?.[1]) return meta[1].trim();

    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("Scanning KV store for truncated descriptions...\n");

  const [actionRows, userActionRows] = await Promise.all([
    queryRows("action:%"),
    queryRows("user-action:%"),
  ]);

  const allRows = [
    ...actionRows.map((r) => ({ ...r, store: "action" })),
    ...userActionRows.map((r) => ({ ...r, store: "user-action" })),
  ];

  const truncated = allRows.filter(
    (r) => r.value && typeof r.value.description === "string" && r.value.description.trimEnd().endsWith("...")
  );

  if (truncated.length === 0) {
    console.log("✓ No truncated descriptions found.");
    return;
  }

  console.log(`Found ${truncated.length} truncated description(s):\n`);

  let fixed = 0;
  let skipped = 0;

  for (const row of truncated) {
    const card = row.value;
    console.log(`[${row.key}] ${card.title}`);
    console.log(`  Current: "${card.description.slice(0, 80)}..."`);

    if (!card.targetUrl) {
      console.log(`  ⚠ No targetUrl — skipping (fix manually)\n`);
      skipped++;
      continue;
    }

    console.log(`  Fetching: ${card.targetUrl}`);
    const extracted = await extractDescription(card.targetUrl);

    if (!extracted || extracted.length < card.description.length - 10) {
      console.log(`  ⚠ Could not extract a longer description from the page — skipping\n`);
      skipped++;
      continue;
    }

    const updated = { ...card, description: extracted };
    await upsertRow(row.key, updated);
    console.log(`  ✓ Fixed: "${extracted.slice(0, 80)}${extracted.length > 80 ? "..." : ""}"\n`);
    fixed++;
  }

  console.log(`\nDone. Fixed: ${fixed}, Skipped: ${skipped}`);
  if (skipped > 0) {
    console.log("Skipped cards need manual description fixes via the admin panel.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
