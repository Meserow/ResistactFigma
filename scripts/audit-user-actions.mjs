// Read-only audit of user-action cards in production KV.
//
// Compares two things and reports the gap:
//   1. The `user-action:ids` index (what the UI thinks exists)
//   2. The actual `user-action:*` records (what's really in KV)
//
// Run with the service role key as env var:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/audit-user-actions.mjs
//
// Outputs:
//   - Console summary: total in KV, total in index, orphan count, missing-data count
//   - reports/user-actions-audit-<date>.json: full payload of every card + the index
//
// READ ONLY — performs no writes, no deletes, no mutations.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const SUPABASE_URL = "https://zkihnylrvdofdbnhmmoq.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY env var. Aborting.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("→ Querying kv_store_9eb1ae04 for user-action records…");

// 1. Get every user-action:* record by prefix
const { data: kvRows, error: kvErr } = await supabase
  .from("kv_store_9eb1ae04")
  .select("key, value")
  .like("key", "user-action:%");

if (kvErr) {
  console.error("KV query failed:", kvErr);
  process.exit(1);
}

// Split into the index row and the data rows
const indexRow = kvRows.find((r) => r.key === "user-action:ids");
const dataRows = kvRows.filter((r) => r.key !== "user-action:ids");

const indexIds = Array.isArray(indexRow?.value) ? indexRow.value : [];
const dataIdSet = new Set(dataRows.map((r) => Number(r.key.split(":")[1])));

// 2. Find orphans (in KV data but not in the index — these are RECOVERABLE)
const orphanIds = [...dataIdSet].filter((id) => !indexIds.includes(id)).sort((a, b) => a - b);
const orphanCards = dataRows
  .filter((r) => orphanIds.includes(Number(r.key.split(":")[1])))
  .map((r) => ({
    id: r.value?.id,
    title: r.value?.title,
    authorName: r.value?.authorName,
    adminApproved: r.value?.adminApproved,
    hasImage: Boolean(r.value?.topImageUrl || r.value?.topImageKey || r.value?.topImage),
    createdAt: r.value?.createdAt,
  }));

// 3. Find phantoms (in index but NOT in KV data — these are LOST and unrecoverable from KV)
const phantomIds = indexIds.filter((id) => !dataIdSet.has(Number(id))).sort((a, b) => a - b);

// 4. Find any "Pretti Good" cards specifically (sanity check for the user's missing card)
const prettiMatches = dataRows
  .filter((r) => {
    const title = (r.value?.title ?? "").toLowerCase();
    return title.includes("pretti") || title.includes("memorial beanie");
  })
  .map((r) => ({ key: r.key, title: r.value?.title, adminApproved: r.value?.adminApproved }));

// 5. Summary
console.log("\n──── KV USER-ACTION AUDIT ─────────────────────────────");
console.log(`Records in KV (by prefix scan):  ${dataRows.length}`);
console.log(`IDs in user-action:ids index:    ${indexIds.length}`);
console.log(`Orphans (in KV, missing from idx): ${orphanIds.length}`);
console.log(`Phantoms (in idx, missing from KV): ${phantomIds.length}`);
console.log(`"Pretti Good" / "memorial beanie" matches: ${prettiMatches.length}`);
console.log("───────────────────────────────────────────────────────\n");

if (orphanCards.length > 0) {
  console.log("ORPHANED CARDS (recoverable via heal-user-action-ids):");
  for (const c of orphanCards) {
    console.log(`  ${c.id}\t${c.adminApproved ? "✓" : "✗"} ${c.hasImage ? "[img]" : "[no img]"}\t${c.title?.slice(0, 70)}`);
  }
  console.log("");
}

if (phantomIds.length > 0) {
  console.log("PHANTOM IDs (in index but data is gone — not in KV):");
  for (const id of phantomIds) {
    console.log(`  ${id}`);
  }
  console.log("");
}

if (prettiMatches.length > 0) {
  console.log("PRETTI GOOD MATCHES:");
  for (const m of prettiMatches) {
    console.log(`  ${m.key}\tadminApproved=${m.adminApproved}\t${m.title}`);
  }
  console.log("");
} else {
  console.log("⚠ No card with 'pretti' or 'memorial beanie' in title found in KV.");
  console.log("");
}

// Dump full payload to disk for downstream restore work
mkdirSync(`${REPO_ROOT}/reports`, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const outPath = `${REPO_ROOT}/reports/user-actions-audit-${date}.json`;
writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      indexIds,
      orphanIds,
      phantomIds,
      orphanCards,
      prettiMatches,
      allRecords: dataRows.map((r) => ({ key: r.key, value: r.value })),
    },
    null,
    2,
  ),
);
console.log(`Wrote full audit to ${outPath}`);
