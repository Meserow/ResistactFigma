import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import * as kv from "./kv_store.ts";

const app = new Hono();

app.use('*', logger(console.log));

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "X-Admin-Import-Token"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// ─── Auth helpers ──────────────────────────────────────────────────────────────
function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// In-memory debounce for the last-seen side-effect write below. Cuts KV writes
// to ~1/user/minute/instance even under heavy clicking. Lives in module scope;
// cleared on cold start. With multiple instances each may write once per
// window — acceptable since this powers "online now" display only.
const LAST_SEEN_DEBOUNCE_MS = 60_000;
const lastSeenCache = new Map<string, number>();

async function getUser(token: string) {
  const { data: { user }, error } = await adminClient().auth.getUser(token);
  if (error || !user) return null;
  // Presence signal — piggybacks on every authenticated request so we don't
  // need a client-side heartbeat. Fire-and-forget; never block the request.
  const now = Date.now();
  const last = lastSeenCache.get(user.id) ?? 0;
  if (now - last >= LAST_SEEN_DEBOUNCE_MS) {
    lastSeenCache.set(user.id, now);
    kv.set(`user:last-seen:${user.id}`, new Date(now).toISOString()).catch(() => {});
  }
  return user;
}

// Hardcoded admin allowlist. Admin status is granted ONLY to these emails.
// The previous "first user ever wins" pattern was unsafe — any KV reset
// would let the next signup self-promote to admin.
const ADMIN_EMAILS: ReadonlySet<string> = new Set([
  "ellen@meserow.com",
  "mikep@meserow.com",
  "patrick@meserow.com",
  "hank@meserow.com",
]);

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase().trim());
}

// On every login, ensure the approval record reflects the current allowlist.
// Allowlisted emails → approved + admin. Everyone else → pending (or whatever
// status they already have, but never admin). Re-validating existing records
// auto-demotes any account that was promoted under the old buggy logic.
async function ensureApprovalRecord(user: any) {
  const allowedAdmin = isAdminEmail(user.email);
  const existing = await kv.get(`user:approval:${user.id}`) as any;

  if (existing) {
    const correctedAdmin = allowedAdmin;
    const correctedStatus = allowedAdmin ? "approved" : existing.status;
    if (existing.isAdmin !== correctedAdmin || existing.status !== correctedStatus) {
      const updated = { ...existing, isAdmin: correctedAdmin, status: correctedStatus };
      await kv.set(`user:approval:${user.id}`, updated);
      return updated;
    }
    return existing;
  }

  const record = {
    userId: user.id,
    email: user.email ?? "",
    name:
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      user.email?.split("@")[0] ??
      "Resistor",
    avatar: user.user_metadata?.avatar_url ?? null,
    status: allowedAdmin ? "approved" : "pending",
    isAdmin: allowedAdmin,
    provider: user.app_metadata?.provider ?? "email",
    createdAt: new Date().toISOString(),
  };

  await kv.set(`user:approval:${user.id}`, record);

  // Fire the right intro email. We AWAIT the send (rather than firing and
  // forgetting) because Supabase Edge Functions reap the worker once the
  // HTTP response is sent — and that reaping was killing the Resend POST
  // mid-flight, so users were getting no email even though the KV record
  // was being created cleanly. Adds ~200-500ms to the first /auth/status
  // after signup. Errors are still caught so a Resend hiccup never breaks
  // the actual record-creation flow.
  try {
    if (record.status === "approved") {
      await sendApprovalEmail(record);
    } else {
      await sendWaitlistEmail(record);
    }
  } catch (err) {
    console.log(`Intro email failed for ${record.email}:`, err);
  }

  return record;
}

async function requireAdmin(token: string | undefined) {
  if (!token) return null;
  const user = await getUser(token);
  if (!user) return null;
  // Defense in depth: require the email to be on the allowlist regardless
  // of what's in the KV record. Even if a record's isAdmin flag is corrupted
  // or stale, only allowlisted emails can perform admin actions.
  if (!isAdminEmail(user.email)) return null;
  const record = await kv.get(`user:approval:${user.id}`) as any;
  if (!record?.isAdmin) return null;
  return { user, record };
}

// Sweep every approval record and reconcile isAdmin/status with the
// allowlist. Demotes anyone who shouldn't be admin (cleaning up records
// promoted by the old "first user wins" bug) and promotes any allowlisted
// account that hasn't been marked admin yet.
async function sweepAdminAllowlist(): Promise<{ demoted: string[]; promoted: string[]; total: number }> {
  const records = await kv.getByPrefix("user:approval:") as any[];
  const demoted: string[] = [];
  const promoted: string[] = [];
  for (const r of records) {
    if (!r || typeof r !== "object" || !r.userId) continue;
    const allowed = isAdminEmail(r.email);
    const correctedAdmin = allowed;
    const correctedStatus = allowed ? "approved" : r.status;
    if (r.isAdmin === correctedAdmin && r.status === correctedStatus) continue;
    const updated = { ...r, isAdmin: correctedAdmin, status: correctedStatus };
    await kv.set(`user:approval:${r.userId}`, updated);
    if (r.isAdmin && !correctedAdmin) demoted.push(r.email);
    else if (!r.isAdmin && correctedAdmin) promoted.push(r.email);
  }
  return { demoted, promoted, total: records.length };
}

// Run the sweep once after deploy. Gated by a KV flag so it doesn't run on
// every request. Bumping the version suffix forces a re-run.
const ADMIN_SWEEP_VERSION = "v1";
async function sweepAdminAllowlistOnce() {
  const flagKey = `admin:sweep:allowlist:${ADMIN_SWEEP_VERSION}`;
  const alreadyDone = await kv.get(flagKey);
  if (alreadyDone) return;
  try {
    const result = await sweepAdminAllowlist();
    console.log(
      `Admin allowlist sweep (${ADMIN_SWEEP_VERSION}): scanned ${result.total} records — ` +
      `demoted ${result.demoted.length} [${result.demoted.join(", ")}], ` +
      `promoted ${result.promoted.length} [${result.promoted.join(", ")}]`
    );
    await kv.set(flagKey, true);
  } catch (err) {
    console.log("Admin allowlist sweep failed:", err);
  }
}

// ─── Seed Ellen user ──────────────────────────────────────────────────────────
async function seedEllenUser() {
  const alreadySeeded = await getMigrationFlag("seed:ellen:v1");
  if (alreadySeeded) return;
  try {
    const { data, error } = await adminClient().auth.admin.createUser({
      email: "ellen@meserow.com",
      password: "Resist!2026",
      user_metadata: { name: "Ellen Escarcega", full_name: "Ellen Escarcega" },
      email_confirm: true,
    });
    if (error) {
      console.log("Ellen seed note (may already exist):", error.message);
      await setMigrationFlag("seed:ellen:v1");
      return;
    }
    const ellenRecord = {
      userId: data.user.id,
      email: "ellen@meserow.com",
      name: "Ellen Escarcega",
      avatar: null,
      status: "approved",
      isAdmin: false,
      provider: "email",
      createdAt: new Date().toISOString(),
    };
    await kv.set(`user:approval:${data.user.id}`, ellenRecord);
    await setMigrationFlag("seed:ellen:v1");
    console.log("Seeded Ellen Escarcega as approved user.");
  } catch (err) {
    console.log("Error seeding Ellen:", err);
  }
}

// ─── User-action card insertion safety contract ─────────────────────────────
// Edge function instances can run migrations concurrently during deploy or
// cold-start. The `user-action:ids` index is a JSON array maintained by
// read-modify-write — naive code (read currentIds, push, write back) is
// last-write-wins, which has previously dropped or duplicated cards (see
// migrations dedup-restore-race:v1, restore-tom-morello:v1,
// restore-lost-batch1:v1, heal-user-action-ids:v1 for the forensic trail).
//
// Any migration that adds new user-action cards MUST go through
// appendUserActionCards(). The /actions handler also runs an unconditional
// heal once per warm process (see healUserActionIdsRunInProcess) as a
// final safety net, but the helper itself makes per-card writes race-safe:
//
//   1. Idempotent on re-run — if a card with the same id+title already
//      exists, it's skipped (and just re-indexed if missing from the list).
//   2. Collision-bumping — if a card with the same id but a different
//      title already exists (another instance got there first using the
//      same base+i id allocator), the helper picks the next free id
//      instead of overwriting.
//   3. Per-card index commit — re-reading and writing user-action:ids
//      after each card narrows the race window from "whole migration" to
//      a single card, so a concurrent migration in another instance can
//      shadow at most one id, not the entire batch.
//   4. Post-loop reconciliation — one final re-read and set-union with
//      everything we wrote, catching any concurrent writes that landed
//      during the loop.
//
// The function mutates each input card's `id` field in place when bumped.
async function appendUserActionCards(newCards: any[]): Promise<number[]> {
  const writtenIds: number[] = [];
  let liveIds = ((await kv.get("user-action:ids")) ?? []) as number[];
  let liveSet = new Set<number>(liveIds);

  for (const card of newCards) {
    let targetId = card.id;
    const existing: any = await kv.get(`user-action:${targetId}`);

    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      if (existing.title === card.title) {
        if (!liveSet.has(targetId)) {
          liveIds = [...liveIds, targetId];
          liveSet.add(targetId);
          await kv.set("user-action:ids", liveIds);
        }
        writtenIds.push(targetId);
        continue;
      }
      let nextId = Math.max(...(liveIds.length ? liveIds : [targetId]), targetId) + 1;
      while (liveSet.has(nextId) || (await kv.get(`user-action:${nextId}`))) {
        nextId++;
      }
      targetId = nextId;
      card.id = nextId;
    }

    await kv.set(`user-action:${targetId}`, card);

    const current = ((await kv.get("user-action:ids")) ?? []) as number[];
    if (!current.includes(targetId)) {
      const merged = [...current, targetId];
      await kv.set("user-action:ids", merged);
      liveIds = merged;
      liveSet = new Set(merged);
    } else {
      liveIds = current;
      liveSet = new Set(current);
    }
    writtenIds.push(targetId);
  }

  const final = ((await kv.get("user-action:ids")) ?? []) as number[];
  const finalSet = new Set(final);
  let changed = false;
  for (const id of writtenIds) {
    if (!finalSet.has(id)) {
      finalSet.add(id);
      final.push(id);
      changed = true;
    }
  }
  if (changed) await kv.set("user-action:ids", final);

  return writtenIds;
}

// Module-level flag: once per warm process, the /actions handler walks
// every user-action:* record and reconciles user-action:ids. Cold-starts
// align with deploys (the race window for migrations), so this catches
// any drift introduced by the previous deploy.
let healUserActionIdsRunInProcess = false;

// PERF: Module-level cache for migration/cleanup/seed flags. These keys
// are write-once (set to `true` after a one-time migration runs) but
// were being re-read on every /actions request — ~41 sequential KV
// round-trips, ~3-4 seconds of pure flag-check overhead per request.
// On Supabase Edge Functions, fresh isolates often serve each request,
// so the cache is reseeded per request via warmMigrationFlagCache() — a
// single mget batch that reads all 41 flags in one round-trip (~100ms
// vs ~4s sequential). Once the cache is warm, every getMigrationFlag()
// is a Set.has lookup.
const migrationFlagCache = new Set<string>();

// All known migration/cleanup/seed flag keys. Kept in sync with the
// strings passed to getMigrationFlag()/setMigrationFlag() in this file.
// If you add a new migration, add its key here so the warm-up batch
// picks it up — otherwise it'll fall back to an individual kv.get on
// first reference (still correct, just one extra round-trip).
const KNOWN_MIGRATION_FLAG_KEYS: readonly string[] = [
  "cleanup:backfill-cartoon-url:v1",
  "cleanup:backfill-images-1245:v1",
  "cleanup:deep-links-high-confidence:v1",
  "cleanup:social-profile-deeplinks:v1",
  "cleanup:blaire-substack-desc:v1",
  "cleanup:clear-imagecontain-cartoon:v1",
  "cleanup:clear-stray-offtopic:v1",
  "cleanup:dropped-seeds:v1",
  "cleanup:fake-seeds:v1",
  "cleanup:fix-quickaction-mistags:v1",
  "cleanup:unify-remote-location:v1",
  "cleanup:link-to-targeturl:v1",
  "cleanup:purge-fake-seeds:v2",
  "cleanup:reapprove-beanie:v1",
  "cleanup:recategorize-call-cards:v1",
  "cleanup:cw-redistribute:v1",
  "cleanup:boost-color-merge:v1",
  "cleanup:personal-commitment-color:v1",
  "cleanup:category-outliers-2026-05:v1",
  "cleanup:reset-boosts-5:v1",
  "cleanup:reset-boosts-5:v3",
  "cleanup:retire-past-dated-2026-05:v1",
  "cleanup:set-boosts-1-950:v1",
  "cleanup:tiktok-youtube-rekey:v1",
  "migrate:spotsused-to-boosts:v1",
  "migration:admin-approved:v1",
  "migration:approved-without-image-cleanup:v1",
  "migration:cancel-your-10min:v1",
  "migration:common-cause-actions:v1",
  "migration:creators-import-2026-05-batch2:v1",
  "migration:dedup-psy-race:v1",
  "migration:dedup-restore-race:v1",
  "migration:demote-missing-url-or-image:v1",
  "migration:etsy-creators-import-2026-05:v1",
  "migration:event-dates:v1",
  "migration:fix-regional-search-urls:v1",
  "migration:fix-yarn-sisters-url:v1",
  "migration:location-canonicalize:v1",
  "migration:mobilize-actions-v2:v1",
  "migration:mobilize-local-actions:v1",
  "migration:moveon-org-name:v1",
  "migration:moveon-author-link:v1",
  "migration:moveon-role-normalize:v1",
  "migration:no-image-review:v1",
  "migration:nourl-review:v1",
  "migration:petitions-10min:v1",
  "migration:portland-seattle-yolo-import-2026-05:v1",
  "migration:reset-boosts:v1",
  "migration:resistbot-citizens-united:v1",
  "migration:resistbot-citizens-united:v2",
  "migration:restore-lost-batch1:v1",
  "migration:restore-tom-morello:v1",
  "migration:tsv-batch-2026-05-17:v1",
  "migration:user-cards:v1",
  "seed:ellen:v1",
  "seed:org-actions:v27",
  "seed:receipts:v2",
];

// Tracks whether warmMigrationFlagCache() has run in this isolate. On
// long-lived warm isolates this saves the batch read on subsequent
// requests; on fresh isolates it runs once per request lifecycle.
let migrationCacheWarmed = false;

async function warmMigrationFlagCache(): Promise<void> {
  if (migrationCacheWarmed) return;
  // Single batch read: `SELECT key, value WHERE key IN (...)` returns
  // one row per existing key. Bypassing kv.mget here because that helper
  // returns values only (no keys), so we can't tell which key each value
  // belongs to under Postgres's unordered IN-result. One round-trip
  // replaces what was ~41 sequential gets (~4s → ~100ms on cold isolates).
  try {
    const client = adminClient();
    const { data, error } = await client
      .from("kv_store_9eb1ae04")
      .select("key, value")
      .in("key", [...KNOWN_MIGRATION_FLAG_KEYS]);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
      if (row.value === true) migrationFlagCache.add(row.key);
    }
  } catch (err) {
    // Don't fail the whole request if warm-up fails — getMigrationFlag
    // will fall back to individual reads (slower but correct).
    console.log("warmMigrationFlagCache failed (falling back to lazy reads):", err);
  }
  migrationCacheWarmed = true;
}

async function getMigrationFlag(key: string): Promise<boolean> {
  if (migrationFlagCache.has(key)) return true;
  const val = await kv.get(key);
  if (val === true) migrationFlagCache.add(key);
  return val === true;
}
async function setMigrationFlag(key: string): Promise<void> {
  await kv.set(key, true);
  migrationFlagCache.add(key);
}

// PERF: in-process cache for the assembled /actions card list. Short TTL
// trades a few seconds of stale-write visibility for ~5× lower latency
// on warm requests, which is the right tradeoff for a feed that's
// already eventual-consistent (admin approvals, boost counts, etc.).
const ACTIONS_CACHE_TTL_MS = 15_000;
let actionsCache: { cards: any[]; ts: number } | null = null;
function invalidateActionsCache(): void {
  actionsCache = null;
}

// ─── Seed data ────────────────────────────────────────────────────────────────
const SEED_CARDS = [
  { id: 1, isFeatured: true, pinToTop: true, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", timeCommitment: "Ongoing", title: "Spread the Word about ResistAct", synopsis: "Movements scale two-by-two, not virally — send ResistAct to one doomscrolling friend tonight", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct so we can build a stronger resistance network together.", boosts: 950, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", authorAvatarKey: "imgImage34" },
  { id: 19, category: "Represent", categoryColor: "#b45309", actionType: "Online", timeCommitment: "< 1 hour", title: "SH*T Bag: Two Bags, One Movement", synopsis: "Dog waste bags made from plant-based materials, fair-trade certified", description: "Dog poop bags featuring Trump — made from plant-based materials (PBAT + PLA + Corn Starch), leak-proof, strong, traps odors, and 'resistant to hate.' Fair-trade and BSCI-compliant. Buy a pack and put it to good use.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Smolotov LLC", authorRole: "Resistance Merch", targetUrl: "https://www.smolotov.com/products/smolotov-unscented-leakproof-dog-poop-bags", topImageUrl: "https://www.smolotov.com/cdn/shop/files/4-Rolls_Box_Bag_2400px.jpg?v=1771553420&width=800", toneOverride: { energy: 1 } },
  { id: 1000, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Search any brand's political donations before you buy", synopsis: "Database lookup for 7,000+ brands’ political donations before you buy", description: "Search 7,000+ companies' political donations before you buy. Stop accidentally funding the people deporting your neighbors.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Goods Unite Us", authorRole: "Movement Organization", targetUrl: "https://www.goodsuniteus.com/", topImageKey: "org_goods-unite-us" },
  { id: 1001, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Get the browser extension that flags MAGA-aligned brands", synopsis: "Auto-tags MAGA companies in real-time as you shop online", description: "Browser extension auto-flags MAGA-aligned brands as you shop. Make every checkout a small political choice.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Progressive Shopper", authorRole: "Movement Organization", targetUrl: "https://progressiveshopper.com/", topImageKey: "org_progressive-shopper" },
  { id: 1002, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Use the Trump-tied retailers boycott list", synopsis: "Curated list of MAGA-aligned retailers, updated weekly for your shopping choices", description: "Spreadsheet of every retailer carrying Trump-family products. Pull up before you shop — names update weekly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Grab Your Wallet", authorRole: "Movement Organization", targetUrl: "https://grabyourwallet.org/", topImageKey: "org_grab-your-wallet" },
  { id: 1003, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Join coordinated 24-hour economic blackouts", synopsis: "Calendar of organized buy-nothing days to hit corporate giants hard", description: "Coordinated 24-hour buy-nothing blackouts that hit corporate dailies. Sign up for the next date.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The People's Union USA", authorRole: "Movement Organization", targetUrl: "https://thepeoplesunionusa.com/", topImageKey: "org_the-people-s-union-usa" },
  { id: 1004, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Sign the Tesla Takedown commitment", synopsis: "Pledge to sell Tesla stock, dump your lease, and protest dealerships", description: "Sell Tesla stock, dump the lease, and join Saturday dealership protests. Hits Musk where it actually hurts.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/", topImageKey: "org_tesla-takedown" },
  { id: 1005, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Join the Latino-led economic blackout", synopsis: "Spending freeze calendar to protest mass deportation policies by Latinos", description: "Latino-led campaign to freeze spending in protest of mass-deportation policies. Sign up for the calendar.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Latino Freeze Movement", authorRole: "Movement Organization", targetUrl: "https://www.latinofreeze.com/", topImageKey: "org_latino-freeze-movement", amplifiesGroups: ["immigrant"] },
  { id: 1006, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Switch your spending to a Black-women-owned biz", synopsis: "Directory of Black-women-owned businesses to replace your usual orders", description: "Directory of Black-women-owned businesses to swap your usual orders into. Buy here instead of Amazon.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Buy From a Black Woman", authorRole: "Movement Organization", targetUrl: "https://www.buyfromablackwoman.org/", topImageKey: "org_buy-from-a-black-woman", amplifiesGroups: ["woman"] },
  { id: 1007, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Buy Anti-Trump Merch from Individual Makers", synopsis: "Etsy storefronts for handmade anti-Trump shirts, signs, and stickers", description: "Handmade anti-Trump shirts, signs, stickers, and pins from independent Etsy sellers — your dollars go to indie creators, not corporate retailers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Etsy (Anti-Trump Market)", authorRole: "Indie Makers Marketplace", targetUrl: "https://www.etsy.com/market/anti_trump", topImageKey: "org_anti-trump-merch", toneOverride: { energy: 1 }, firstTimerFriendly: true },
  { id: 1008, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Buy from a Native-owned business instead", synopsis: "Native-owned business marketplace and directory to support tribal economies", description: "Native-owned business directory + marketplace. Trump's land-grab and pipeline pushes hit these communities first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Beyond Buckskin", authorRole: "Movement Organization", targetUrl: "https://www.beyondbuckskin.com/", topImageKey: "org_beyond-buckskin" },
  { id: 1009, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "RSVP to the next Saturday Tesla Takedown", synopsis: "Weekly map of Tesla dealership protests + RSVP for Saturday actions", description: "Live map of Tesla dealership protests near you. Saturday actions only — no commitment required.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/", topImageKey: "org_tesla-takedown" },
  { id: 1010, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Subscribe to Free DC mobilization alerts", synopsis: "DC-area alerts for protests, court dates, and federal actions delivered", description: "DC-area mobilization alerts for protests, court days, and federal-building actions. Subscribe and show up.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Free DC", authorRole: "Movement Organization", targetUrl: "https://freedcproject.org/sign-up", topImageKey: "org_free-dc", toneOverride: { energy: 1 } },
  { id: 1011, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Become a Veterans for Peace member", synopsis: "Uniformed vets stand strong to deter cops at local rallies and marches", description: "Vets in service insignia deter cops and counter-protesters at rallies. Be the visible spine of your local march.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Veterans for Peace", authorRole: "Movement Organization", targetUrl: "https://www.veteransforpeace.org/", topImageKey: "org_veterans-for-peace" },
  { id: 1012, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Join About Face: Veterans Against the War", synopsis: "Post-9/11 veterans staging direct actions against endless U.S. wars", description: "Post-9/11 vets organizing direct action against US wars. More aggressive than VFP — for vets ready to risk arrest.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "About Face", authorRole: "Movement Organization", targetUrl: "https://aboutfaceveterans.org/", topImageKey: "org_about-face" },
  { id: 1013, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find an ADAPT chapter (disability direct action)", synopsis: "Disability-rights direct-action chapters for sit-ins, takeovers, and visits", description: "Disability-led direct action — sit-ins, building takeovers, hill visits. Find or start a chapter; remote roles available.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "ADAPT", authorRole: "Movement Organization", targetUrl: "https://adapt.org/", topImageKey: "org_adapt", amplifiesGroups: ["disabled"] },
  { id: 1014, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find a Drag Story Hour to attend / livestream", synopsis: "Adult presence keeps Proud Boys at bay, ensuring Drag Story Hours thrive", description: "Show up to a Drag Story Hour to protect performers from Proud Boys harassment. Adults present = events go forward.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Drag Story Hour", authorRole: "Movement Organization", targetUrl: "https://www.dragstoryhour.org/", topImageKey: "org_drag-story-hour", amplifiesGroups: ["lgbtq"] },
  { id: 1015, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Sign up for Refuse Fascism action alerts", synopsis: "Anti-fascist mobilization email list for timely action alerts and updates", description: "Anti-fascist protest network with simple action alerts. Stand against Trump's authoritarian playbook publicly.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Refuse Fascism", authorRole: "Movement Organization", targetUrl: "https://refusefascism.org/", topImageKey: "org_refuse-fascism", toneOverride: { energy: 1 } },
  { id: 1016, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Sign up with Code Pink", synopsis: "Alerts for disruptive bird-dog actions at Senate hearings in DC", description: "Code Pink runs the disruptive bird-dog actions you see in Senate hearings. Get alerts for the next DC pop-up.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Code Pink", authorRole: "Movement Organization", targetUrl: "https://www.codepink.org/", topImageKey: "org_code-pink", toneOverride: { energy: 1 } },
  { id: 1017, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Volunteer as a Practical Support driver (repro)", synopsis: "Drive abortion-seekers to clinics and safe overnight stays in your area", description: "Drive abortion-seekers to/from clinics and overnight stays. Trump's national-ban push makes practical support life-saving.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Apiary for Practical Support", authorRole: "Movement Organization", targetUrl: "https://apiaryps.org/ps-volunteer", topImageKey: "org_apiary-for-practical-support", amplifiesGroups: ["repro", "woman"] },
  { id: 1018, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Sponsor + drive for refugees via Welcome.US", synopsis: "Drive refugee families to appointments, IKEA runs, and school errands", description: "Drive refugees to appointments, IKEA runs, school. Trump cut admissions but families already here need community.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us", amplifiesGroups: ["immigrant"] },
  { id: 1019, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a tip (anonymous SecureDrop)", synopsis: "Send insider docs to ProPublica anonymously through SecureDrop platform", description: "Submit a tip via SecureDrop. ProPublica turns insider docs into pressure that has fired federal officials.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ProPublica", authorRole: "Movement Organization", targetUrl: "https://www.propublica.org/tips/", topImageKey: "org_propublica" },
  { id: 1020, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a tip on criminal-justice / detention", synopsis: "Tip line for reporting ICE abuses and prosecutor misconduct in prisons", description: "Tip line for prison conditions, ICE detention abuses, and prosecutor misconduct. Their reporting changes laws.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Marshall Project", authorRole: "Movement Organization", targetUrl: "https://www.themarshallproject.org/", topImageKey: "org_the-marshall-project" },
  { id: 1021, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a leak to The Intercept", synopsis: "Investigative leak portal for national security tips using SecureDrop", description: "Submit national-security leaks via SecureDrop. Intercept broke Snowden — they protect sources better than most.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Intercept", authorRole: "Movement Organization", targetUrl: "https://theintercept.com/", topImageKey: "org_the-intercept" },
  { id: 1022, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Tell them about an ICE raid (NYC)", synopsis: "NYC tip line for real-time alerts on ICE raids in your area", description: "NYC tip line for ICE raids and immigration enforcement. Real-time alerts go to neighborhood networks.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://www.mobilize.us/handsoffnyc/event/929506/", topImageKey: "org_handsoffnyc", amplifiesGroups: ["immigrant"] },
  { id: 1023, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a Black-community story", synopsis: "Pitch your Black-community story to a Black-led investigative newsroom", description: "Pitch a Black-community story to a Black-led investigative newsroom. Coverage that mainstream outlets miss.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1024, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a gender + politics story", synopsis: "Abortion, trans care, and gender-politics stories the AP won't cover", description: "Pitch a story on abortion access, trans healthcare bans, or gender + politics. They cover what AP won't.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th", amplifiesGroups: ["woman", "repro", "lgbtq"] },
  { id: 1025, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch on local DA / sheriff / election admin", synopsis: "Bolts: your local-power accountability newsroom covering MAGA's takeover efforts", description: "Pitch on your local DA, sheriff, or election admin. MAGA's takeover happens at county level — Bolts covers it nationally.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bolts Magazine", authorRole: "Movement Organization", targetUrl: "https://boltsmag.org/", topImageKey: "org_bolts-magazine" },
  { id: 1026, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Send an investigative idea", synopsis: "They fund the reporter to chase your lead and uncover the truth", description: "Pitch an investigative idea; they fund the reporter to chase it. Best route for a freelancer with a real lead.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Type Investigations", authorRole: "Movement Organization", targetUrl: "https://www.typeinvestigations.org/", topImageKey: "org_type-investigations" },
  { id: 1027, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a war / civil-liberties story", synopsis: "Ex-Intercept reporters ready to tackle US wars and civil-liberties stories", description: "Pitch ex-Intercept reporters on US wars and civil liberties. Fewer institutional constraints, more aggressive coverage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Drop Site News", authorRole: "Movement Organization", targetUrl: "https://www.dropsitenews.com/", topImageKey: "org_drop-site-news" },
  { id: 1028, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a labor story (video)", synopsis: "More Perfect Union seeks your labor video pitches on strikes and theft", description: "Pitch a labor story for video — strikes, union drives, wage theft. Their content goes viral on TikTok and IG.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "More Perfect Union", authorRole: "Movement Organization", targetUrl: "https://perfectunion.us/", topImageKey: "org_more-perfect-union" },
  { id: 1029, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Send a dark-money tip", synopsis: "Dark-money and corporate corruption tip line for federal investigations", description: "Tip Sirota's team on dark money or corporate corruption. They've forced multiple federal investigations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1030, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a campaign-finance tip", synopsis: "Tip line for reporting campaign-finance violations or shadow donors", description: "Tip on a campaign-finance violation or shadow donor. Sludge specializes in unmasking who's actually paying for what.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sludge", authorRole: "Movement Organization", targetUrl: "https://readsludge.com/", topImageKey: "org_sludge" },
  { id: 1031, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Report a press-freedom violation", synopsis: "Log journalist arrests, equipment seizures, and assaults for public record", description: "Report any arrest, equipment seizure, or assault on a journalist. Trump-era press attacks need a public record.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "U.S. Press Freedom Tracker", authorRole: "Movement Organization", targetUrl: "https://pressfreedomtracker.us/submit-incident/", topImageKey: "org_u-s-press-freedom-tracker", amplifiesGroups: ["journalist"] },
  { id: 1032, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find your nearest chapter + meeting time", synopsis: "Local DSA chapter finder for mutual aid, tenant work, and campaigns", description: "Find your nearest DSA chapter and meeting time. Local chapters run mutual aid, tenant work, and electoral campaigns.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "DSA (Democratic Socialists of America)", authorRole: "Movement Organization", targetUrl: "https://www.dsausa.org/", topImageKey: "org_dsa-democratic-socialists-of-america" },
  { id: 1033, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Apply to a virtual intro call", synopsis: "SURJ white-solidarity orientation for Black, brown, and Indigenous campaigns", description: "White-led solidarity for Black, brown, and Indigenous-led campaigns. Apply for the virtual intro to start showing up.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "SURJ (Showing Up for Racial Justice)", authorRole: "Movement Organization", targetUrl: "https://surj.org/", topImageKey: "org_surj-showing-up-for-racial-justice" },
  { id: 1034, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Sign up for a hub welcome call", synopsis: "Sunrise Movement youth-climate intro call to explore your local hub role", description: "Youth-led climate org with remote-friendly local hubs. Sign up for a welcome call to find your role this season.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sunrise Movement", authorRole: "Movement Organization", targetUrl: "https://www.sunrisemovement.org/", topImageKey: "org_sunrise-movement" },
  { id: 1035, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "RSVP for next event (local + virtual)", synopsis: "Working Families Party state campaigns tackling issues with local events", description: "RSVP to the next local + virtual event. WFP runs electoral campaigns and issue ballot fights state by state.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Working Families Party", authorRole: "Movement Organization", targetUrl: "https://workingfamilies.org/", topImageKey: "org_working-families-party" },
  { id: 1036, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join virtual monthly mass assembly", synopsis: "Rev. Barber's Poor People's Campaign call for faith and policy unity", description: "Rev. Barber's monthly mass assembly fuses faith and policy. Join virtually to plug into Poor People's organizing nationally.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Poor People's Campaign (Rev. Barber)", authorRole: "Movement Organization", targetUrl: "https://www.poorpeoplescampaign.org/", topImageKey: "org_poor-people-s-campaign-rev-barber" },
  { id: 1037, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find your local circle", synopsis: "Indivisible local-chapter finder for Latinx-led immigration defense groups", description: "Latinx-led organizing focused on immigration defense and abolition. Find your local circle.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mijente", authorRole: "Movement Organization", targetUrl: "https://mijente.net/", topImageKey: "org_mijente", amplifiesGroups: ["immigrant"] },
  { id: 1038, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a local team", synopsis: "Mom-led climate teams in your neighborhood, fitting around your schedule", description: "Mom-led climate org with neighborhood teams. Find a local team — work fits around school pickups and naptime.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mothers Out Front", authorRole: "Movement Organization", targetUrl: "https://mothersoutfront.org/", topImageKey: "org_mothers-out-front", amplifiesGroups: ["woman"] },
  { id: 1039, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a local group", synopsis: "MoveOn local action-team finder for progressive Jewish organizing efforts", description: "Progressive Jewish organizing against Christian nationalism and authoritarianism. Find a local group.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bend the Arc (Jewish progressive)", authorRole: "Movement Organization", targetUrl: "https://www.bendthearc.us/", topImageKey: "org_bend-the-arc-jewish-progressive" },
  { id: 1041, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join a federal-worker organizing call", synopsis: "Federal Unionists Network solidarity calls for coordinated cross-agency action", description: "Federal-worker organizing call. Trump's purges and RIFs are coordinated — cross-agency response has to be too.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Federal Unionists Network", authorRole: "Movement Organization", targetUrl: "https://www.federalunionists.net/", topImageKey: "org_federal-unionists-network", amplifiesGroups: ["fedWorker"] },
  { id: 1042, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Migrate your X follows to Bluesky", synopsis: "Sky Follower Bridge auto-import tool moves your X follows to Bluesky", description: "Free extension finds your X follows on Bluesky in one click. Bring your network when you ditch Musk's platform.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sky Follower Bridge", authorRole: "Movement Organization", targetUrl: "https://skyfollowerbridge.com/", topImageKey: "org_sky-follower-bridge" },
  { id: 1043, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Bluesky account", synopsis: "Twitter without the algorithm or Musk — a space for activists to connect", description: "Make a Bluesky account. No algorithm tilt, no Musk, no Meta — where activist Twitter rebuilt itself.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bluesky", authorRole: "Movement Organization", targetUrl: "https://bsky.app/", topImageKey: "org_bluesky" },
  { id: 1044, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Mastodon account on a movement-aligned server", synopsis: "Federated social network on an anti-fascist server, join a leftist instance", description: "Mastodon account on an anti-fascist server. Federated, no corporate owner, harder to deplatform leftists.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Kolektiva (Mastodon)", authorRole: "Movement Organization", targetUrl: "https://kolektiva.social/", topImageKey: "org_kolektiva-mastodon" },
  { id: 1045, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Save a threatened page now", synopsis: "Wayback Machine save-now bookmark for .gov pages and news articles", description: "One-click archive of any URL — .gov pages, news, evidence. Scrub-proof your sources before they vanish.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wayback Machine 'Save Page Now'", authorRole: "Movement Organization", targetUrl: "https://web.archive.org/save", topImageKey: "org_wayback-machine-save-page-now" },
  { id: 1046, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Pixelfed account (federated Insta)", synopsis: "Instagram alternative without Meta, perfect for sharing your activism pics", description: "Federated photo-sharing, no algorithm. Activist-friendly Insta alternative with no Meta tracking or shadowban.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pixelfed", authorRole: "Movement Organization", targetUrl: "https://pixelfed.social/", topImageKey: "org_pixelfed" },
  { id: 1047, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Embroider + ship a Trump quote to the archive", synopsis: "Stitch a Trump quote for the archive project, join the exhibition", description: "Embroider a Trump quote and ship it to the archive. Group exhibitions, gallery shows, permanent record.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Tiny Pricks Project", authorRole: "Movement Organization", targetUrl: "https://www.tinypricksproject.com/", topImageKey: "org_tiny-pricks-project" },
  { id: 1048, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Knit a Welcome Blanket for a new immigrant", synopsis: "Knit a 40\" blanket with a welcome note for a new immigrant family", description: "Knit a 40\" blanket with a welcome note. Each is hand-delivered to a newly-arrived immigrant family.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome Blanket Project", authorRole: "Movement Organization", targetUrl: "https://www.welcomeblanket.org/", topImageKey: "org_welcome-blanket-project", amplifiesGroups: ["immigrant"] },
  { id: 1049, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Knit a Pussyhat from updated patterns", synopsis: "2017 Pussyhat reborn with new resistance patterns for the next march", description: "Knit a Pussyhat from updated patterns or mail one in for the next march. Visible cohort = visible resistance.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Pussyhat Project", authorRole: "Movement Organization", targetUrl: "https://www.pussyhatproject.com/", topImageKey: "org_pussyhat-project", amplifiesGroups: ["woman"] },
  { id: 1050, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Sign up for the postcard drop", synopsis: "Hand-illustrated postcards to swing-district voters, making personal connections", description: "Hand-illustrate postcards to swing-district voters. Personal mail still cuts through algorithm-poisoned discourse.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "The Postcard Posse", authorRole: "Movement Organization", targetUrl: "https://thepostcardposse.org/", topImageKey: "org_the-postcard-posse" },
  { id: 1051, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Mail a handmade card to a detained migrant", synopsis: "Handmade card to an ICE detainee, reminding them they’re not alone", description: "Mail handmade cards to a specific person in ICE detention. Mail breaks isolation; signals 'someone's watching'.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants", amplifiesGroups: ["immigrant"] },
  { id: 1052, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign petitions to overturn Citizens United", synopsis: "Sign petitions for a constitutional amendment to end Citizens United", description: "Sign petitions for the constitutional amendment overturning Citizens United. Long fight; needs persistent pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Move to Amend", authorRole: "Movement Organization", targetUrl: "https://www.movetoamend.org/", topImageKey: "org_move-to-amend" },
  { id: 1053, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign current petitions", synopsis: "MoveOn's petition action queue for corporate accountability and judicial reform", description: "Sign petitions on corporate accountability and judicial reform. Their pressure has produced FTC and SEC actions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Public Citizen", authorRole: "Movement Organization", targetUrl: "https://www.citizen.org/", topImageKey: "org_public-citizen" },
  { id: 1054, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Demand fair maps — end partisan gerrymandering", synopsis: "Sign for independent redistricting to fix maps and restore fairness", description: "Sign for independent redistricting. Gerrymandered maps let MAGA hold state legislatures with 30% of voters.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/tell-congress-we-demand-fair-maps/", topImageKey: "org_common-cause" },
  { id: 1055, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign court-reform petitions", synopsis: "Demand Justice petitions for expanding the Supreme Court's influence", description: "Sign court-reform petitions. Demand Justice drove the SCOTUS-expansion conversation — momentum keeps it alive.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Demand Justice", authorRole: "Movement Organization", targetUrl: "https://demandjustice.org/", topImageKey: "org_demand-justice" },
  { id: 1056, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign media-reform petitions", synopsis: "Free Press media-justice campaigns for net neutrality and disinformation reform", description: "Sign petitions on platform disinfo, net neutrality, and FCC oversight. Trump's FCC is gutting consumer protections.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Free Press", authorRole: "Movement Organization", targetUrl: "https://www.freepress.net/", topImageKey: "org_free-press" },
  { id: 1057, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign civil-rights petitions", synopsis: "ACLU's national petition queue against ICE detention and surveillance abuses", description: "Sign petitions on ICE detention and warrantless surveillance. CCR wins these in court — your name builds standing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Center for Constitutional Rights", authorRole: "Movement Organization", targetUrl: "https://ccrjustice.org/", topImageKey: "org_center-for-constitutional-rights" },
  { id: 1058, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Black-led racial-justice petitions", synopsis: "Color Of Change campaign queue for police accountability and voting rights", description: "Sign Black-led racial-justice petitions — police accountability, voting rights, corporate equity. CoC moves money.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Color of Change", authorRole: "Movement Organization", targetUrl: "https://colorofchange.org/", topImageKey: "org_color-of-change" },
  { id: 1059, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign civil-liberties petitions", synopsis: "EFF digital-rights petition queue targets surveillance, big-tech, and antitrust", description: "Sign civil-liberties petitions on surveillance, big-tech, and antitrust. Their email pressure flips swing senators.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Demand Progress", authorRole: "Movement Organization", targetUrl: "https://demandprogress.org/", topImageKey: "org_demand-progress" },
  { id: 1060, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign AAPI petitions", synopsis: "AAPI Equity Alliance campaigns on hate crimes, immigration, and voting access", description: "Sign AAPI campaigns on hate-crime response, immigration, and voting access. Trump's anti-Asian rhetoric needs counter-pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "18MillionRising", authorRole: "Movement Organization", targetUrl: "https://www.18millionrising.org/actions/", topImageKey: "org_18millionrising" },
  { id: 1061, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Christian-rooted petitions vs. Christian nationalism", synopsis: "Faithful America petitions challenging Christian nationalism and its influence", description: "Sign Christian petitions against Christian nationalism. The right's loudest base needs visible religious dissent — that's you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1062, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign anti-militarism petitions", synopsis: "Win Without War foreign-policy queue with petitions against Pentagon spending", description: "Sign anti-war petitions targeting the Pentagon budget and weapons sales. Restrain Trump's foreign-policy improv.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Win Without War", authorRole: "Movement Organization", targetUrl: "https://winwithoutwar.org/", topImageKey: "org_win-without-war" },
  { id: 1063, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign petitions to close ICE facilities", synopsis: "Detention Watch Network petitions to close specific ICE facilities nationwide", description: "Sign petitions targeting specific ICE detention facilities for closure. Local fights, federal pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Detention Watch Network", authorRole: "Movement Organization", targetUrl: "https://www.detentionwatchnetwork.org/", topImageKey: "org_detention-watch-network", amplifiesGroups: ["immigrant"] },
  { id: 1064, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the open letter against book bans", synopsis: "Authors, librarians, and readers unite in this open letter against bans", description: "Sign the open letter against book bans. Names from authors, librarians, and readers create local-news pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans", amplifiesGroups: ["libraryWorker", "educator", "student"] },
  { id: 1065, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Avaaz US-targeted petitions", synopsis: "Global petition platform's US campaigns to pressure Congress and corporations", description: "Sign Avaaz US-targeted petitions. High signature volume amplifies pressure on Congress and corporations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Avaaz", authorRole: "Movement Organization", targetUrl: "https://secure.avaaz.org/page/en/", topImageKey: "org_avaaz" },
  { id: 1066, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the petition to protect voting rights in the Senate", synopsis: "Senate voting-rights petition push from People For the American Way", description: "Tell your senators to defend voting rights against the assault on free and fair elections. People For's open call to action.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "People For (formerly People For the American Way)", authorRole: "Movement Organization", targetUrl: "https://www.peoplefor.org/urge-senate-protect-voting-rights", topImageKey: "org_people-for-formerly-people-for-the-american-way" },
  { id: 1067, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign children's-rights petitions", synopsis: "Children's Defense Fund petitions on healthcare, gun violence, and poverty", description: "Sign petitions on child healthcare, gun violence, and poverty programs. Trump's budget cuts hit kids first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Children's Defense Fund", authorRole: "Movement Organization", targetUrl: "https://www.childrensdefense.org/", topImageKey: "org_children-s-defense-fund" },
  { id: 1068, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a SURJ member", synopsis: "White-solidarity dues-paying membership with SURJ, apply for the intro call", description: "Become a SURJ member to organize white people for racial justice. Apply for the virtual intro call.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Showing Up for Racial Justice", authorRole: "Movement Organization", targetUrl: "https://surj.org/", topImageKey: "org_showing-up-for-racial-justice" },
  { id: 1069, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a DSA member", synopsis: "Democratic Socialists of America dues support local chapters near you", description: "DSA chapters run mutual aid, electoral, and tenant work in nearly every metro. Joining locally finds the doers near you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Democratic Socialists of America", authorRole: "Movement Organization", targetUrl: "https://www.dsausa.org/", topImageKey: "org_democratic-socialists-of-america" },
  { id: 1070, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Sunrise Movement", synopsis: "Youth-led Sunrise Movement organizing for the Green New Deal and accountability", description: "Climate-led, youth-driven org. Join Sunrise to organize for the Green New Deal and climate accountability.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sunrise Movement", authorRole: "Movement Organization", targetUrl: "https://www.sunrisemovement.org/", topImageKey: "org_sunrise-movement" },
  { id: 1071, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Mijente", synopsis: "Latinx-led pro-immigrant organizing with local circles for immediate action", description: "Latinx organizing for immigration defense and abolition. Local circles plug you in to immediate work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mijente", authorRole: "Movement Organization", targetUrl: "https://mijente.net/", topImageKey: "org_mijente", amplifiesGroups: ["immigrant"] },
  { id: 1072, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join United We Dream", synopsis: "Largest immigrant-youth-led network organizing against deportation and ICE actions", description: "Largest immigrant-youth-led network in the country. Plug into ICE response, deportation defense, and policy work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "United We Dream", authorRole: "Movement Organization", targetUrl: "https://unitedwedream.org/", topImageKey: "org_united-we-dream", amplifiesGroups: ["immigrant"] },
  { id: 1073, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Bend the Arc", synopsis: "Progressive Jewish American advocacy against Christian nationalism in your area", description: "Jewish anti-authoritarian organizing. Join to find Jewish-led action against Christian nationalism near you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bend the Arc (Jewish progressive)", authorRole: "Movement Organization", targetUrl: "https://www.bendthearc.us/", topImageKey: "org_bend-the-arc-jewish-progressive" },
  { id: 1074, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Jewish Voice for Peace", synopsis: "Jewish-led Palestine solidarity org with local chapters in 70+ cities", description: "Jewish-led anti-occupation and civil-liberties organizing. Local chapters in 70+ cities.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Jewish Voice for Peace", authorRole: "Movement Organization", targetUrl: "https://www.jewishvoiceforpeace.org/", topImageKey: "org_jewish-voice-for-peace" },
  { id: 1075, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join T'ruah (rabbinic human rights)", synopsis: "Rabbis and cantors standing up for human rights and dignity in North America", description: "Rabbinic human rights org. Rabbis + cantors lead immigration defense, anti-Christian-nationalism, and dignity work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "T'ruah", authorRole: "Movement Organization", targetUrl: "https://truah.org/", topImageKey: "org_t-ruah" },
  { id: 1076, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Subscribe to FCNL action alerts (Quaker)", synopsis: "Friends Committee on National Legislation alerts on Pentagon budget and immigration", description: "Quaker action alerts for constituent calls and emails. Pacifist-rooted, focused on Pentagon budget and immigration.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1077, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Pax Christi USA (Catholic peace)", synopsis: "Membership in Pax Christi USA for nonviolence training and resistance", description: "Catholic peace + justice movement. Join for nonviolence training and faith-rooted resistance to militarism.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pax Christi USA", authorRole: "Movement Organization", targetUrl: "https://paxchristiusa.org/", topImageKey: "org_pax-christi-usa" },
  { id: 1078, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a NETWORK action (Catholic social justice)", synopsis: "Catholic-led campaigns on healthcare, immigration, and federal budget issues", description: "Catholic social-justice lobby. Take action on healthcare, immigration, and the federal budget — nuns lead this.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NETWORK Lobby", authorRole: "Movement Organization", targetUrl: "https://networklobby.org/", topImageKey: "org_network-lobby" },
  { id: 1080, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Sikh Coalition action", synopsis: "Civil-rights org defending Sikh Americans against hate crimes and profiling", description: "Sikh civil-rights advocacy. Take action on hate-crime response, religious-discrimination, and racial profiling.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sikh Coalition", authorRole: "Movement Organization", targetUrl: "https://www.sikhcoalition.org/", topImageKey: "org_sikh-coalition" },
  { id: 1084, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Volunteer with Mothers Out Front", synopsis: "Mom-led climate organization offering flexible volunteer roles for parents", description: "Volunteer with Mothers Out Front. Mom-led climate org with flexible roles around school and family schedules.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mothers Out Front", authorRole: "Movement Organization", targetUrl: "https://mothersoutfront.org/", topImageKey: "org_mothers-out-front", amplifiesGroups: ["woman"] },
  { id: 1085, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take an ADAPT action (disability rights)", synopsis: "Disability-led direct action against Medicaid cuts and institutionalization", description: "Take an ADAPT action — disability-led direct action against Medicaid cuts and institutionalization.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ADAPT", authorRole: "Movement Organization", targetUrl: "https://adapt.org/", topImageKey: "org_adapt", amplifiesGroups: ["disabled"] },
  { id: 1086, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Black Voters Matter action", synopsis: "Voter mobilization in the South through local county and state actions", description: "Take a Black Voters Matter action. Voter-protection fights happen at county and state level — they target there.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Black Voters Matter", authorRole: "Movement Organization", targetUrl: "https://blackvotersmatterfund.org/", topImageKey: "org_black-voters-matter" },
  { id: 1087, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Mi Familia Vota action", synopsis: "Latinx voter registration and protection efforts in key swing states", description: "Take a Mi Familia Vota action. Latino civic engagement — voter registration and protection in swing states.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mi Familia Vota", authorRole: "Movement Organization", targetUrl: "https://www.mifamiliavota.org/", topImageKey: "org_mi-familia-vota", amplifiesGroups: ["immigrant"] },
  { id: 1088, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Climate Justice Alliance action", synopsis: "Grassroots climate-justice coalition tackling pipelines, refineries, and evictions", description: "Take a Climate Justice Alliance action. Frontline community-led climate fights — pipelines, refineries, evictions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Climate Justice Alliance", authorRole: "Movement Organization", targetUrl: "https://climatejusticealliance.org/", topImageKey: "org_climate-justice-alliance" },
  { id: 1091, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Sponsor a refugee household", synopsis: "Welcome.US private-sponsorship program to support refugee households remotely", description: "Sponsor a refugee household through a verified federal pathway. Remote prep work counts.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us", amplifiesGroups: ["immigrant"] },
  { id: 1092, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Make your city 'welcoming' for immigrants", synopsis: "Welcoming America toolkit for cities to reject ICE cooperation policies", description: "Push your city to certify as a 'welcoming city' for immigrants. Public commitment makes ICE cooperation costly.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcoming America", authorRole: "Movement Organization", targetUrl: "https://welcomingamerica.org/", topImageKey: "org_welcoming-america", amplifiesGroups: ["immigrant"] },
  { id: 1093, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Pressure your mayor on sanctuary policy", synopsis: "Sanctuary-policy advocacy toolkit for urging your mayor to act locally", description: "Pressure your mayor to join the immigrant-friendly cities coalition. Mayoral commitments slow ICE locally.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Cities for Action", authorRole: "Movement Organization", targetUrl: "https://www.citiesforaction.us/", topImageKey: "org_cities-for-action", amplifiesGroups: ["immigrant"] },
  { id: 1094, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Volunteer to furnish + resettle refugee homes", synopsis: "Help refugees set up a new apartment in your city or online", description: "Furnish + resettle refugee homes — physical setup or remote logistics. Trump's cuts mean more families with less support.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Homes Not Borders", authorRole: "Movement Organization", targetUrl: "https://www.homesnotborders.org/", topImageKey: "org_homes-not-borders", amplifiesGroups: ["immigrant"] },
  { id: 1095, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Get an organizer for your workplace", synopsis: "EWOC pairs you with a union organizer to strengthen your workplace effort", description: "Free organizer helps you unionize your workplace, confidentially. Trump's NLRB is gutted — build power directly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "EWOC (Emergency Workplace Organizing Committee)", authorRole: "Movement Organization", targetUrl: "https://workerorganizing.org/", topImageKey: "org_ewoc-emergency-workplace-organizing-committee", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1096, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Join the federal-worker network", synopsis: "Federal Unionists Network for cross-agency support and organizing efforts", description: "Join the federal-worker network. Trump's RIFs and Schedule F purges need cross-agency mutual aid + organizing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Federal Unionists Network", authorRole: "Movement Organization", targetUrl: "https://www.federalunionists.net/", topImageKey: "org_federal-unionists-network", amplifiesGroups: ["fedWorker", "unionWorker"] },
  { id: 1097, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Subscribe to independent labor media", synopsis: "Labor Notes: union news, organizing wins, and training calendar updates", description: "Subscribe to indie labor media + training calendar. Best source for what's happening in shops outside the big unions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Labor Notes", authorRole: "Movement Organization", targetUrl: "https://labornotes.org/", topImageKey: "org_labor-notes", amplifiesGroups: ["unionWorker"] },
  { id: 1098, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Start a workplace petition", synopsis: "Coworker.org platform to launch petitions for raises and policy changes", description: "Host a workplace petition — raises, anti-ICE-cooperation pledges. Public petitions force the boss to acknowledge.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Coworker.org", authorRole: "Movement Organization", targetUrl: "https://home.coworker.org/", topImageKey: "org_coworker-org", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1099, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take a UE solidarity action", synopsis: "Electrical Workers union solidarity actions to support contract fights and rights", description: "Solidarity action with UE — independent rank-and-file union. Often the most aggressive on contract fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "UE (United Electrical Workers)", authorRole: "Movement Organization", targetUrl: "https://www.ueunion.org/", topImageKey: "org_ue-united-electrical-workers", amplifiesGroups: ["unionWorker"] },
  { id: 1100, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Apply for IWW membership", synopsis: "Industrial Workers of the World membership details for remote onboarding", description: "Apply for IWW membership. All-trades radical union; remote onboarding. Best fit if your shop won't tolerate the bigs.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Industrial Workers of the World", authorRole: "Movement Organization", targetUrl: "https://www.iww.org/", topImageKey: "org_industrial-workers-of-the-world", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1101, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Sign on to a National Domestic Workers Alliance campaign", synopsis: "Domestic workers organizing for federal protections through NDWA campaigns", description: "Sign on to NDWA campaigns. Domestic workers (housekeepers, nannies, caregivers) organizing for federal protections.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "National Domestic Workers Alliance", authorRole: "Movement Organization", targetUrl: "https://www.domesticworkers.org/", topImageKey: "org_national-domestic-workers-alliance", amplifiesGroups: ["woman", "immigrant", "lowIncome"] },
  { id: 1102, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Send solidarity to Starbucks Workers United", synopsis: "Solidarity messages to barista unionists fighting corporate union-busting", description: "Send solidarity to Starbucks workers fighting union-busting. Their store-by-store wins set the precedent for service work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Starbucks Workers United", authorRole: "Movement Organization", targetUrl: "https://sbworkersunited.org/", topImageKey: "org_starbucks-workers-united", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1103, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take an Amazon Labor Union action", synopsis: "Support Amazon warehouse union efforts with petitions and solidarity dollars", description: "Take an Amazon Labor Union action. The hardest org fight in the country — solidarity dollars and petitions matter.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Amazon Labor Union (IBT Local 1)", authorRole: "Movement Organization", targetUrl: "https://www.amazonlaborunion.org/", topImageKey: "org_amazon-labor-union-ibt-local-1", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1104, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Use the free legal hotline (workplace family rights)", synopsis: "A Better Balance free legal hotline for family and caregiving rights", description: "Free legal hotline for workplace family + caregiving rights. Use if you're being denied FMLA, pumping breaks, or accommodations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "A Better Balance", authorRole: "Movement Organization", targetUrl: "https://www.abetterbalance.org/", topImageKey: "org_a-better-balance", amplifiesGroups: ["woman", "lowIncome"] },
  { id: 1105, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Sign on to a Fight For A Union worker campaign", synopsis: "Worker-led campaign for living wages and real union representation", description: "Successor to Fight for $15. Sign on to a sectoral campaign for living wages and a real union, not just minimums.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Fight For A Union", authorRole: "Movement Organization", targetUrl: "https://fightforaunion.org/", topImageKey: "org_fight-for-a-union", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1106, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign the moral covenant", synopsis: "Sign Rev. Barber's faith-based covenant to fight poverty and injustice", description: "Sign Rev. Barber's moral covenant. Poor people's commitment to anti-poverty action grounded in faith and policy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Repairers of the Breach (Rev. Barber)", authorRole: "Movement Organization", targetUrl: "https://breachrepairers.org/", topImageKey: "org_repairers-of-the-breach-rev-barber" },
  { id: 1107, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to action alerts", synopsis: "Sojourners' faith-rooted action alerts for progressive Christian advocates", description: "Subscribe to Sojourners' Christian-justice action alerts. Progressive Christian voice in DC policy fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sojourners", authorRole: "Movement Organization", targetUrl: "https://sojo.net/", topImageKey: "org_sojourners" },
  { id: 1108, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to actions", synopsis: "Bread for the World hunger-advocacy alerts delivered to your inbox", description: "Subscribe to Faithful America's Christian-rooted campaigns against Christian nationalism. Visible religious dissent.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1109, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Faith in Public Life advocacy action", synopsis: "Faith leaders unite for racial and economic justice across all faiths", description: "Sign on to multi-faith advocacy actions. Coalition lobbying that fuses Christian, Jewish, Muslim, and Hindu progressives.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faith in Public Life", authorRole: "Movement Organization", targetUrl: "https://www.faithinpubliclife.org/", topImageKey: "org_faith-in-public-life" },
  { id: 1110, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Take a rabbinic action", synopsis: "T'ruah rabbi-led human-rights actions against immigration and nationalism", description: "Take a rabbinic action. Rabbis and cantors organize on immigration, occupation, and Christian nationalism.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "T'ruah", authorRole: "Movement Organization", targetUrl: "https://truah.org/", topImageKey: "org_t-ruah" },
  { id: 1111, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Pax Christi USA peace action", synopsis: "Catholic peace-movement campaigns against militarism and the Pentagon budget", description: "Sign Pax Christi USA peace actions. Catholic-rooted resistance to militarism and the Pentagon budget.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pax Christi USA", authorRole: "Movement Organization", targetUrl: "https://paxchristiusa.org/", topImageKey: "org_pax-christi-usa" },
  { id: 1112, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to Quaker action alerts", synopsis: "American Friends Service Committee action alerts on peace and justice issues", description: "Subscribe to Quaker constituent-action emails. Pacifist-rooted, focused on Pentagon and immigration policy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1113, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to an Auburn Seminary faith-leader campaign", synopsis: "Multifaith leaders driving social justice campaigns across the country", description: "Sign on to faith-leader campaigns. Auburn trains multi-faith clergy in social justice and movement leadership.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Auburn Seminary", authorRole: "Movement Organization", targetUrl: "https://auburnseminary.org/", topImageKey: "org_auburn-seminary" },
  { id: 1115, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Hindus for Human Rights action", synopsis: "Hindu progressive human-rights advocacy against Trump’s ties to Modi allies", description: "Counter Hindu nationalism in US politics. Sign on as a Hindu or ally; Modi's allies have major Trump-admin ties.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Hindus for Human Rights", authorRole: "Movement Organization", targetUrl: "https://www.hindusforhumanrights.org/", topImageKey: "org_hindus-for-human-rights" },
  { id: 1116, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Sikh Coalition civil-rights action", synopsis: "Sikh civil-rights advocacy campaigns targeting hate crimes and discrimination", description: "Sign Sikh Coalition civil-rights actions. Hate-crime response, religious-discrimination, and racial-profiling work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sikh Coalition", authorRole: "Movement Organization", targetUrl: "https://www.sikhcoalition.org/", topImageKey: "org_sikh-coalition" },
  { id: 1117, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up as a volunteer attorney", synopsis: "ImmDef pro bono attorney signup to assist immigrants and whistleblowers", description: "Sign up as a volunteer attorney. Match takes 20 minutes; cases include immigrants, election workers, federal whistleblowers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "We the Action", authorRole: "Movement Organization", targetUrl: "https://wetheaction.org/", topImageKey: "org_we-the-action", amplifiesGroups: ["lawyer", "immigrant", "electionWorker", "whistleblower"] },
  { id: 1118, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as an attorney", synopsis: "Lawyers' Committee for Civil Rights connects you with real cases to assist", description: "Hours go to immigrants and federal workers fighting Trump-era retaliation. Lawyers especially — 20-min match.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Lawyers for Good Government", authorRole: "Movement Organization", targetUrl: "https://www.lawyersforgoodgovernment.org/", topImageKey: "org_lawyers-for-good-government", amplifiesGroups: ["lawyer", "immigrant", "fedWorker"] },
  { id: 1119, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Find pro bono cases (formerly Pro Bono Net)", synopsis: "Probono.net connects volunteer lawyers with civil-legal case listings", description: "Find pro bono cases. Volunteer-attorney matching for civil-legal cases — most need procedural help, not litigation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Scale Justice (Pro Bono Net)", authorRole: "Movement Organization", targetUrl: "https://scalejustice.org/", topImageKey: "org_scale-justice-pro-bono-net", amplifiesGroups: ["lawyer"] },
  { id: 1120, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer your tech skills", synopsis: "Code for America civic-tech volunteer with local brigades improving .gov UX", description: "Volunteer your tech skills. Local brigades build tools for governments and nonprofits — replace shitty .gov UX.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Code for America", authorRole: "Movement Organization", targetUrl: "https://codeforamerica.org/", topImageKey: "org_code-for-america" },
  { id: 1121, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up as a tech volunteer", synopsis: "U.S. Digital Response connecting volunteers with democracy organizations needing tech expertise", description: "Sign up as a tech volunteer. Project matching for devs, designers, and PMs supporting democracy-org tooling.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "DemocracyLab", authorRole: "Movement Organization", targetUrl: "https://www.democracylab.org/", topImageKey: "org_democracylab" },
  { id: 1122, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer your professional skills", synopsis: "Catchafire connects you with nonprofits needing your design or finance skills", description: "Volunteer your professional skills (design, marketing, ops, finance) to nonprofits. 1–10 hour bites; remote-friendly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Catchafire", authorRole: "Movement Organization", targetUrl: "https://www.catchafire.org/", topImageKey: "org_catchafire" },
  { id: 1123, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as a translator", synopsis: "Translators Without Borders connects asylum seekers with bilingual volunteers", description: "Volunteer as a translator for asylum cases. Crisis-language work — hours can save someone from deportation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Respond Crisis Translation", authorRole: "Movement Organization", targetUrl: "https://respondcrisistranslation.org/", topImageKey: "org_respond-crisis-translation", imageContain: true, amplifiesGroups: ["immigrant"] },
  { id: 1124, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as a linguist", synopsis: "Join the Crisis Translation rapid pool for refugees needing your skills", description: "Volunteer as a linguist for crisis-response work. Less-resourced languages especially needed for refugee work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CLEAR Global", authorRole: "Movement Organization", targetUrl: "https://clearglobal.org/", topImageKey: "org_clear-global", amplifiesGroups: ["immigrant"] },
  { id: 1125, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign on to a Doctors for America healthcare campaign", synopsis: "MDs pushing for Medicaid and ACA reforms to influence Congress", description: "Sign on to Doctors for America campaigns. Medical voices that move members of Congress on Medicaid + ACA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Doctors for America", authorRole: "Movement Organization", targetUrl: "https://www.doctorsforamerica.org/", topImageKey: "org_doctors-for-america" },
  { id: 1126, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Train as asylum-evaluation clinician", synopsis: "PHR trains MDs to conduct forensic medical exams for asylum cases", description: "Train as an asylum-evaluation clinician. Forensic medical exams for asylum cases — without one, deportation odds spike.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Physicians for Human Rights", authorRole: "Movement Organization", targetUrl: "https://phr.org/", topImageKey: "org_physicians-for-human-rights", amplifiesGroups: ["immigrant"] },
  { id: 1127, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up to run for office (STEM)", synopsis: "314 Action trains scientists to run for office and fight anti-science policies", description: "Sign up to run for office (STEM). Trump's anti-science agenda needs scientists in office — they'll train you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "314 Action", authorRole: "Movement Organization", targetUrl: "https://314action.org/", topImageKey: "org_314-action", amplifiesGroups: ["scientist"] },
  { id: 1128, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer with Authors Against Book Bans", synopsis: "Author-led organizing at school board meetings to fight book bans", description: "Volunteer with Authors Against Book Bans. Authors, librarians, readers showing up at school-board meetings.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans", amplifiesGroups: ["libraryWorker", "educator"] },
  { id: 1129, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Join Concerned Archivists Alliance", synopsis: "Archivists preserving threatened federal records from Trump's scrubbing efforts", description: "Archivists organizing to preserve federal records as Trump scrubs them. Need archivists, devs, and metadata pros.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Concerned Archivists Alliance", authorRole: "Movement Organization", targetUrl: "https://concernedarchivists.wordpress.com/", topImageKey: "org_concerned-archivists-alliance", amplifiesGroups: ["libraryWorker", "scientist"] },
  { id: 1130, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer on detained-immigrant cases", synopsis: "ImmDef's pro bono training and case matching for detained immigrants", description: "Volunteer on detained-immigrant cases. Free training + case match. Pro bono representation triples release odds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigration Justice Campaign", authorRole: "Movement Organization", targetUrl: "https://immigrationjustice.us/", topImageKey: "org_immigration-justice-campaign", amplifiesGroups: ["immigrant"] },
  { id: 1131, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Take the anti-coup civil-resistance pledge", synopsis: "Choose Democracy's 10-point pledge for nonviolent action against a coup", description: "Take the anti-coup civil-resistance pledge. Public commitment to nonviolent action if Trump refuses to leave office.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Choose Democracy", authorRole: "Movement Organization", targetUrl: "https://choosedemocracy.us/", topImageKey: "org_choose-democracy" },
  { id: 1133, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Make daily-call habit", synopsis: "5 Calls daily-call script generator with direct lines to your reps", description: "Daily script + your reps' direct lines. Two minutes a weekday is what stopped 2017's ACA repeal — same model works.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "5 Calls", authorRole: "Movement Organization", targetUrl: "https://5calls.org/", topImageKey: "org_5-calls" },
  { id: 1134, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set up daily texts to your reps", synopsis: "Text RESIST to 50409 for daily messages to your elected reps", description: "Text RESIST to 50409. Resistbot turns your text into emails, faxes, or letters to your reps — daily takes seconds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistbot", authorRole: "Movement Organization", targetUrl: "https://resist.bot/", topImageKey: "org_resistbot", firstTimerFriendly: true },
  { id: 1135, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Carry KYR cards for ICE encounters", synopsis: "Know-Your-Rights wallet cards from ILRC for every ICE encounter", description: "Print + carry Know-Your-Rights cards. Pull one out if ICE approaches — works for citizen and non-citizen alike.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigrant Defense Project", authorRole: "Movement Organization", targetUrl: "https://www.immigrantdefenseproject.org/", topImageKey: "org_immigrant-defense-project", amplifiesGroups: ["immigrant"] },
  { id: 1137, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set election reminders for every contest", synopsis: "VoteRiders multi-election calendar alerts for primaries, judges, school boards", description: "Reminders for every contest — primaries, school board, judges. Off-cycle elections are where MAGA quietly stacks boards.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote.org", authorRole: "Movement Organization", targetUrl: "https://www.vote.org/", topImageKey: "org_vote-org" },
  { id: 1138, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send an SMS that becomes an email/fax to your reps", synopsis: "ResistBot text-to-fax system sends your messages directly to Congress", description: "Text turns into emails or faxes to your reps. Resistbot is the laziest possible way to keep contacting them.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistbot", authorRole: "Movement Organization", targetUrl: "https://resist.bot/", topImageKey: "org_resistbot", firstTimerFriendly: true },
  { id: 1139, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send today's email script", synopsis: "Daily Action one-tap email-your-rep script from 5 Calls staff to personalize", description: "Send today's email script to your reps. 5 Calls' staff write the message; you spend 90 seconds personalizing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "5 Calls", authorRole: "Movement Organization", targetUrl: "https://5calls.org/", topImageKey: "org_5-calls" },
  { id: 1140, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: reject mass government surveillance", synopsis: "Email your reps to stop Trump’s DHS from tracking citizens and dissent", description: "Email your reps to oppose surveillance expansion. Trump's DHS uses these tools to track immigrants, journalists, and protesters.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/tell-congress-reject-mass-government-surveillance/", topImageKey: "org_common-cause", firstTimerFriendly: true },
  { id: 1141, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send email-your-rep", synopsis: "Common Cause prefilled email tool for consumer protection fights weekly", description: "Email-your-rep on consumer protection and corporate accountability fights. Their tracker is updated weekly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Public Citizen", authorRole: "Movement Organization", targetUrl: "https://www.citizen.org/", topImageKey: "org_public-citizen" },
  { id: 1142, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send anti-militarism email", synopsis: "Win Without War prefilled email to urge your reps on Pentagon votes", description: "Send an anti-militarism email to your reps. Win Without War targets Pentagon budget votes specifically.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Win Without War", authorRole: "Movement Organization", targetUrl: "https://winwithoutwar.org/", topImageKey: "org_win-without-war" },
  { id: 1143, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send Christian-rooted email-your-rep", synopsis: "Faithful America’s prefilled email tool to reach your local representative", description: "Send a Christian-rooted email-your-rep. Religious framing changes which Republicans actually engage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1144, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send Quaker constituent email", synopsis: "FCNL prefilled email to your senator, sent in just seconds", description: "Send a Quaker constituent email. FCNL writes the script; email lands at your senator's office in seconds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1145, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email targeting specific ICE facilities", synopsis: "Detention Watch's tool to email operators at specific ICE facilities", description: "Email actions against specific ICE facility operators. Detention Watch identifies who to pressure for closures.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Detention Watch Network", authorRole: "Movement Organization", targetUrl: "https://www.detentionwatchnetwork.org/", topImageKey: "org_detention-watch-network", amplifiesGroups: ["immigrant"] },
  { id: 1146, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email your school board re: book bans", synopsis: "Pre-written emails to push back against harmful book bans in schools", description: "Email your school board against book bans. Pre-written templates work — boards capitulate when pressure hits.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans", amplifiesGroups: ["libraryWorker", "educator", "student"] },
  { id: 1147, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a workshop", synopsis: "Beautiful Trouble action-design workshops for de-escalation and jail support", description: "Workshops most arrest-action groups send people through. Get de-escalation and jail-support before you need them.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Training for Change", authorRole: "Movement Organization", targetUrl: "https://www.trainingforchange.org/", topImageKey: "org_training-for-change" },
  { id: 1148, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a training", synopsis: "Wellstone Action progressive-organizing training for effective direct action workshops", description: "Direct-action training. Ruckus prepared protesters at Standing Rock and Occupy. Sign up for a workshop.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Ruckus Society", authorRole: "Movement Organization", targetUrl: "https://ruckus.org/", topImageKey: "org_ruckus-society" },
  { id: 1149, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to a cohort", synopsis: "Cohort program for organizations to shift from reactive to strategic action", description: "Apply with your group for movement-strategy training. Best for orgs that need help going from reactive to strategic.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wildfire Project", authorRole: "Movement Organization", targetUrl: "https://wildfireproject.org/", topImageKey: "org_wildfire-project" },
  { id: 1150, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take a course", synopsis: "AROC’s organizer course covers de-escalation, racial justice, and base-building", description: "Take an organizer course. Sliding-scale tuition; classes on de-escalation, racial justice, and base-building.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PeoplesHub", authorRole: "Movement Organization", targetUrl: "https://www.peopleshub.org/", topImageKey: "org_peopleshub" },
  { id: 1151, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in a free training", synopsis: "Free 60-90 minute training on responding to ICE and hate incidents", description: "Learn what to actually do when ICE detains a neighbor or a Nazi accosts someone on transit. Free, 60–90 min.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Right To Be", authorRole: "Movement Organization", targetUrl: "https://righttobe.org/", topImageKey: "org_right-to-be" },
  { id: 1152, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in anti-coup training", synopsis: "Choose Democracy's free training on nonviolent resistance against coups", description: "Enroll in anti-coup training. Free workshop calendar — what to do if Trump refuses a peaceful transfer of power.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Choose Democracy", authorRole: "Movement Organization", targetUrl: "https://choosedemocracy.us/", topImageKey: "org_choose-democracy" },
  { id: 1153, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in programs", synopsis: "Highlander Center’s residential and virtual programs for grassroots organizing", description: "Storied southern movement school — MLK and Rosa Parks trained here. Apply for residential or virtual programs.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Highlander Center", authorRole: "Movement Organization", targetUrl: "https://beta.highlandercenter.org/", topImageKey: "org_highlander-center" },
  { id: 1154, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a curriculum", synopsis: "Resource Generation's wealthy-redistribution program for climate and justice education", description: "Sign up for just-transition + ecological-justice curriculum. Climate work that connects to labor and racial justice.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Movement Generation", authorRole: "Movement Organization", targetUrl: "https://movementgeneration.org/", topImageKey: "org_movement-generation" },
  { id: 1155, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take an abolitionist study course", synopsis: "Critical Resistance's online and in-person prison-abolition study course", description: "Take an abolitionist study course. Free curricula; reading groups online and in cities. Replaces police 101 with care 101.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Project NIA", authorRole: "Movement Organization", targetUrl: "https://project-nia.org/", topImageKey: "org_project-nia" },
  { id: 1156, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a reading group", synopsis: "Critical Resistance's abolitionist reading group co-founded by Angela Davis", description: "Sign up for an abolitionist reading group. Critical Resistance is OG abolition — Angela Davis co-founded it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Critical Resistance", authorRole: "Movement Organization", targetUrl: "https://criticalresistance.org/", topImageKey: "org_critical-resistance" },
  { id: 1157, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to be a paid poll worker", synopsis: "Power the Polls election-worker signup for your local elections plus pay", description: "Apply to be a paid poll worker. Local elections are short on workers; you get paid + protect access for hours of your day.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Power the Polls", authorRole: "Movement Organization", targetUrl: "https://www.powerthepolls.org/", topImageKey: "org_power-the-polls", amplifiesGroups: ["electionWorker"] },
  { id: 1158, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take a Know Your Rights training", synopsis: "ACLU Know Your Rights training for ICE encounters, online and live", description: "Take a Know Your Rights training for ICE encounters. Live calendar; bring your block, household, or workplace.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigrant Defense Project", authorRole: "Movement Organization", targetUrl: "https://www.immigrantdefenseproject.org/", topImageKey: "org_immigrant-defense-project", amplifiesGroups: ["immigrant"] },
  { id: 1160, category: "Act of Kindness", categoryColor: "#d97706", actionType: "Online", title: "Sign up for kindness-toned voter postcards", synopsis: "Vote Forward's warm postcards to swing-state voters for the election", description: "Write hand-written postcards to swing-state voters. Personal mail still cuts through algorithm-fried discourse.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Postcards to Voters", authorRole: "Movement Organization", targetUrl: "https://postcardstovoters.org/", topImageKey: "org_postcards-to-voters" },
  { id: 1161, category: "Act of Kindness", categoryColor: "#d97706", actionType: "Online", title: "Become a pen pal to a detained migrant", synopsis: "Connect with those in need — your letters bring hope and human contact behind detention walls", description: "Become a pen pal to a detained migrant. Mail breaks isolation in ICE detention; bilingual letters welcome.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants", amplifiesGroups: ["immigrant"], firstTimerFriendly: true },
  { id: 1162, category: "Act of Kindness", categoryColor: "#d97706", actionType: "Online", title: "Volunteer (LGBTQ youth digital crisis support)", synopsis: "Trevor Project 24/7 crisis volunteer role — paid training, chat / text / phone shifts", description: "Volunteer for LGBTQ youth digital crisis support. 24/7 chat/text/phone — paid training, ongoing support.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Trevor Project", authorRole: "Movement Organization", targetUrl: "https://www.thetrevorproject.org/", topImageKey: "org_the-trevor-project", amplifiesGroups: ["lgbtq"] },
  { id: 1164, category: "Act of Kindness", categoryColor: "#d97706", actionType: "Online", title: "Practice rest-as-resistance prompts", synopsis: "Tricia Hersey's Nap Ministry prompts — burnout is fascism's goal, sleep is the counter", description: "Practice rest-as-resistance prompts. Tricia Hersey's free library — burnout is the goal of fascism, sleep counters it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Nap Ministry (Tricia Hersey)", authorRole: "Movement Organization", targetUrl: "https://thenapministry.wordpress.com/", topImageKey: "org_the-nap-ministry-tricia-hersey" },
  { id: 1165, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Find + amplify your local mutual aid", synopsis: "US-wide mutual-aid network map — money, supplies, on-the-ground neighbors near you", description: "Find + amplify your local mutual aid network. Map of US-wide groups — money, supplies, people on the ground.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mutual Aid Hub", authorRole: "Movement Organization", targetUrl: "https://www.mutualaidhub.org/", topImageKey: "org_mutual-aid-hub" },
  { id: 1166, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Boost a single Olive Branch family fund", synopsis: "Support a Palestinian family directly Help fund their needs through a vetted GoFundMe campaign", description: "Boost a single Palestinian family's GoFundMe from a vetted queue. Direct, traceable, no big-org skim.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Operation Olive Branch", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/opolivebranch", topImageKey: "org_operation-olive-branch" },
  { id: 1167, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Capital B (Black-led)", synopsis: "Stay informed on underreported Black stories Support investigative journalism that challenges the mainstream narrative", description: "Subscribe + share Capital B coverage. Black-led investigative work that mainstream outlets don't cover.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1168, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share The 19th* (gender + politics)", synopsis: "Stay informed on gender issues and amplify voices fighting for rights", description: "Subscribe + share The 19th. Gender + politics reporting on abortion, trans rights, and women's health under Trump.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th", amplifiesGroups: ["woman", "repro", "lgbtq"] },
  { id: 1169, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Documented (NYC immigration)", synopsis: "Stay informed on ICE activities Support NYC's immigrant communities through real-time journalism", description: "Subscribe + share Documented. NYC immigration-focused journalism that hits ICE operations in real time.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://documentedny.com/", topImageKey: "org_documented", amplifiesGroups: ["immigrant"] },
  { id: 1171, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share The Lever", synopsis: "Stay informed on corporate influence Join a community fighting for transparency and accountability", description: "Subscribe + share The Lever. Sirota's outfit on dark money and corporate corruption — best independent reporting.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1172, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Submit + share a press-freedom incident", synopsis: "Document attacks on press freedom. Share incidents to build a powerful public record and drive change", description: "Submit + share press-freedom incidents. Public record of every press attack — fuels lawsuits and policy fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "U.S. Press Freedom Tracker", authorRole: "Movement Organization", targetUrl: "https://pressfreedomtracker.us/", topImageKey: "org_u-s-press-freedom-tracker", amplifiesGroups: ["journalist"] },
  { id: 1174, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Download free protest art", synopsis: "Access high-quality protest designs for your next march. Create impact with your message", description: "Download free protest art. Pro-grade posters from Shepard Fairey and others; print at home for any march.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Amplifier", authorRole: "Movement Organization", targetUrl: "https://amplifier.org/", topImageKey: "org_amplifier" },
  { id: 1175, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Download free anti-fascist posters", synopsis: "Grab bold designs to amplify your message Print, share, and stand against fascism", description: "Download free anti-fascist posters. Co-op of printmakers; high-quality designs for protests, walls, and zines.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Justseeds Artists' Cooperative", authorRole: "Movement Organization", targetUrl: "https://justseeds.org/", topImageKey: "org_justseeds-artists-cooperative" },
  { id: 1176, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Download educational graphics", synopsis: "Empower your activism with visuals Print and share graphics on critical issues today", description: "Download educational graphics. Hand-drawn movement art — climate, mining, Trump-era issues. Free to print.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Beehive Design Collective", authorRole: "Movement Organization", targetUrl: "https://beehivecollective.org/", topImageKey: "org_beehive-design-collective" },
  { id: 1177, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Submit an embroidery piece", synopsis: "Stitch your resistance into history Join the collective memory and showcase your art", description: "Embroider a Trump quote and ship to the project archive. Permanent record + group-show exhibitions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tiny Pricks Project", authorRole: "Movement Organization", targetUrl: "https://www.tinypricksproject.com/", topImageKey: "org_tiny-pricks-project" },
  { id: 1178, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Apply to programs", synopsis: "Join a community of activists to explore and rehearse powerful protest techniques", description: "Apply for forum theater + virtual workshops. Boal's method for rehearsing political action — practice the protest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Theatre of the Oppressed NYC", authorRole: "Movement Organization", targetUrl: "https://www.tonyc.nyc/", topImageKey: "org_theatre-of-the-oppressed-nyc" },
  { id: 1179, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Use the tactical-prank toolkit", synopsis: "Unleash satire to disrupt corporate deception Follow the Yes Men's playbook for impactful pranks", description: "Use the Yes Men's tactical-prank toolkit. Step-by-step satire playbook — they impersonated execs to expose climate lies.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Yes Men", authorRole: "Movement Organization", targetUrl: "https://theyesmen.org/", topImageKey: "org_the-yes-men" },
  { id: 1180, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Refer an artist at risk", synopsis: "Support artists in peril Join the movement to provide urgent legal and relocation aid", description: "Refer an artist at risk. Solidarity for persecuted artists — visa, legal, and relocation support during crackdowns.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Artists at Risk Connection (PEN America)", authorRole: "Movement Organization", targetUrl: "https://artistsatriskconnection.org/", topImageKey: "org_artists-at-risk-connection-pen-america" },
  { id: 1181, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Find your local mutual aid network", synopsis: "Connect with your community support group Offer help to a neighbor in need this week", description: "Find your local mutual aid network. Pick one neighbor to support this week — money, food, rides, anything.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mutual Aid Hub", authorRole: "Movement Organization", targetUrl: "https://www.mutualaidhub.org/", topImageKey: "org_mutual-aid-hub" },
  { id: 1186, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Volunteer as a translator for asylum seekers", synopsis: "Help asylum seekers navigate the system Your language skills can change lives", description: "Translate documents for asylum seekers. Hours of your time can prevent a deportation; bilingual = high-value.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Respond Crisis Translation", authorRole: "Movement Organization", targetUrl: "https://respondcrisistranslation.org/", topImageKey: "org_respond-crisis-translation", imageContain: true, amplifiesGroups: ["immigrant"] },
  { id: 1192, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Sludge's dark-money & GOP-donor reporting", synopsis: "Stay informed with Sludge's investigations Share facts to challenge dark-money narratives", description: "Subscribe to Sludge and share their campaign-finance investigations on social. Counter dark-money disinfo with sourced reporting.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sludge", authorRole: "Movement Organization", targetUrl: "https://readsludge.com/", topImageKey: "org_sludge" },
  { id: 1193, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Bolts Magazine's local-democracy reporting", synopsis: "Support grassroots journalism that holds local officials accountable. Share vital insights on democracy and elections", description: "Subscribe to Bolts and share their local DA, sheriff, and election-admin coverage. Local democracy is where Trump-era threats land first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bolts Magazine", authorRole: "Movement Organization", targetUrl: "https://boltsmag.org/", topImageKey: "org_bolts-magazine" },
  { id: 1194, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Drop Site News on Trump's wars & civil liberties", synopsis: "Stay informed on critical issues Amplify independent analysis from Drop Site", description: "Subscribe to Drop Site (ex-Intercept staff) and share their war and civil-liberties coverage. Counter the war-machine narrative.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Drop Site News", authorRole: "Movement Organization", targetUrl: "https://www.dropsitenews.com/", topImageKey: "org_drop-site-news" },
  { id: 1196, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Boost More Perfect Union's worker-power journalism", synopsis: "Empower labor voices through impactful journalism Support anti-corporate reporting that challenges Trump’s backers", description: "Subscribe to More Perfect Union and share their worker-power video reporting. Anti-corporate journalism that hits Trump donors directly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "More Perfect Union", authorRole: "Movement Organization", targetUrl: "https://perfectunion.us/", topImageKey: "org_more-perfect-union" },
  { id: 1202, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Inkstick's anti-war foreign-policy reporting", synopsis: "Support independent journalism for a new foreign policy perspective Help amplify anti-war narratives and challenge the status quo", description: "Subscribe to Inkstick and share their non-DC foreign policy coverage. Counter the bipartisan war-and-empire consensus.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inkstick Media", authorRole: "Movement Organization", targetUrl: "https://inkstickmedia.com/", topImageKey: "org_inkstick-media" },
  { id: 1203, category: "Amplify", categoryColor: "#8a00e6", actionType: "Online", title: "Read + share data", synopsis: "Explore key wealth data from Inequality.org and amplify the message against economic injustice", description: "Read + share wealth-concentration data. Inequality.org has the charts that make 'eat the rich' arguments concrete.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inequality.org", authorRole: "Movement Organization", targetUrl: "https://inequality.org/", topImageKey: "org_inequality-org" },
  { id: 1204, category: "Letter Writing", categoryColor: "#3f5c8c", actionType: "Online", title: "Sign up for op-ed training", synopsis: "Join a workshop to amplify your voice Learn to write impactful op-eds for change", description: "Sign up for op-ed training. They've placed thousands of underrepresented voices in major papers — works.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The OpEd Project", authorRole: "Movement Organization", targetUrl: "https://www.theopedproject.org/", topImageKey: "org_the-oped-project" },
  { id: 1205, category: "Letter Writing", categoryColor: "#3f5c8c", actionType: "Online", title: "Use weekly LTE prompts (formerly Sister District)", synopsis: "Mobilize your voice with targeted letters Boost local resistance and influence state politics", description: "Use weekly LTE prompts targeting state-level fights. Coordinated submissions to district papers move ratings.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "States Win (FKA Sister District)", authorRole: "Movement Organization", targetUrl: "https://stateswin.org/", topImageKey: "org_states-win-fka-sister-district" },
  { id: 1206, category: "Letter Writing", categoryColor: "#3f5c8c", actionType: "Online", title: "Use the Two-Minute Activist tool", synopsis: "Quickly craft and send letters to the editor Leverage women's organization strength for impactful change", description: "Use AAUW's two-minute activist tool. LTE templates + submission. Women's-org muscle behind every signature.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "AAUW", authorRole: "Movement Organization", targetUrl: "https://www.aauw.org/", topImageKey: "org_aauw", amplifiesGroups: ["woman"] },
  { id: 1207, category: "Letter Writing", categoryColor: "#3f5c8c", actionType: "Online", title: "Use the LTE writer tool", synopsis: "Craft your message for local impact Engage your community with climate-focused letters", description: "Use Sierra Club's LTE writer. Climate-focused, chapter-targeted, gets published in regional papers regularly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sierra Club", authorRole: "Movement Organization", targetUrl: "https://www.sierraclub.org/", topImageKey: "org_sierra-club" },
  { id: 1208, category: "Letter Writing", categoryColor: "#3f5c8c", actionType: "Online", title: "Use LTE templates with verified statistics", synopsis: "Craft compelling letters to the editor Leverage verified stats from Inequality.org to amplify your message", description: "Use Inequality.org's LTE templates with verified stats. Drop the chart links and let editors do the rest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inequality.org", authorRole: "Movement Organization", targetUrl: "https://inequality.org/", topImageKey: "org_inequality-org" },
  { id: 1215, category: "Phone Calling", categoryColor: "#c2185b", actionType: "Online", title: "Call peer crisis line: 877-565-8860", synopsis: "Trans peer crisis line at 877-565-8860—no police, no holds", description: "Trans peer crisis line: 877-565-8860. No police dispatch, no involuntary holds. Save the number for your friends.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Trans Lifeline", authorRole: "Movement Organization", targetUrl: "https://translifeline.org/", topImageKey: "org_trans-lifeline", amplifiesGroups: ["lgbtq"] },
  { id: 1216, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Reach via 24/7 chat / text / phone", synopsis: "Support LGBTQ youth in crisis anytime. Share this vital resource for those who need it most", description: "LGBTQ youth crisis line — 24/7 chat, text, phone. Save it; share it with any kid in your life feeling targeted.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Trevor Project", authorRole: "Movement Organization", targetUrl: "https://www.thetrevorproject.org/", topImageKey: "org_the-trevor-project", amplifiesGroups: ["lgbtq"] },
  { id: 1217, category: "Phone Calling", categoryColor: "#c2185b", actionType: "Online", title: "Call peer hotline / chat", synopsis: "Connect with supportive peers for LGBTQ folks facing tough times", description: "Peer hotline + chat for LGBTQ folks of any age. Calm peer support, not crisis — for the bad-day moments.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "LGBT National Help Center", authorRole: "Movement Organization", targetUrl: "https://lgbthotline.org/", topImageKey: "org_lgbt-national-help-center", amplifiesGroups: ["lgbtq"] },
  { id: 1218, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Text HOME to 741741", synopsis: "Reach out for support when you need it most Share this resource with those in crisis", description: "Trained counselor 24/7 — free, anonymous, no police dispatch. Save it now; share with anyone queer, trans, or targeted.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Crisis Text Line", authorRole: "Movement Organization", targetUrl: "https://www.crisistextline.org/", topImageKey: "org_crisis-text-line", amplifiesGroups: ["lgbtq"] },
  { id: 1219, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Subscribe to the Movement Memos podcast", synopsis: "Stay engaged with abolitionist insights Fuel your resistance and sustain your activism", description: "Subscribe to Kelly Hayes' podcast. Anti-burnout, abolitionist, movement-stamina lessons — keep going for the long fight.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Truthout / Kelly Hayes", authorRole: "Movement Organization", targetUrl: "https://truthout.org/series/movement-memos/", topImageKey: "org_truthout-kelly-hayes" },
  { id: 1220, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a peer mental-health chapter", synopsis: "Join a supportive community for mental health resources and connection", description: "Find a peer mental-health chapter. Campus + online network — good fit for college students or new grads.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Active Minds", authorRole: "Movement Organization", targetUrl: "https://activeminds.org/", topImageKey: "org_active-minds" },
  { id: 1221, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a free virtual support group", synopsis: "Join peers for emotional support and coping strategies Weekly online meetings, no insurance required", description: "Find a free virtual support group. Family + peer mental-health support; weekly, online, no insurance needed.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAMI", authorRole: "Movement Organization", targetUrl: "https://www.nami.org/", topImageKey: "org_nami" },
  { id: 1223, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up to run for office (under 40, progressive)", synopsis: "Join the movement to reshape leadership Get support for your campaign and make your voice heard", description: "Sign up to run for office. Under 40, progressive — they handle the hard parts, you focus on the door knocks.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Run for Something", authorRole: "Movement Organization", targetUrl: "https://runforsomething.net/", topImageKey: "org_run-for-something" },
  { id: 1224, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to candidate training (women)", synopsis: "Join a powerful network of women leaders Get trained to run for office and make change", description: "Apply for free women's candidate training. They've run thousands of women — training is rigorous, free, ongoing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote Run Lead", authorRole: "Movement Organization", targetUrl: "https://voterunlead.org/", topImageKey: "org_vote-run-lead", amplifiesGroups: ["woman"] },
  { id: 1225, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to candidate training (Dem women)", synopsis: "Join a six-month training program to empower Democratic women leaders and candidates", description: "Apply to candidate training for Democratic women. Six-month program; alumni include 1,200+ elected officials.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Emerge America", authorRole: "Movement Organization", targetUrl: "https://emergeamerica.org/", topImageKey: "org_emerge-america", amplifiesGroups: ["woman"] },
  { id: 1226, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to candidate training (Black women)", synopsis: "Empower Black women to lead. Join our candidate training program and break barriers in politics", description: "Apply to Black women's candidate training. Pipeline org for the most underrepresented group in elected office.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Higher Heights for America", authorRole: "Movement Organization", targetUrl: "https://higherheightsforamerica.org/", topImageKey: "org_higher-heights-for-america", amplifiesGroups: ["woman"] },
  { id: 1230, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Save threatened gov pages with one click", synopsis: "Preserve vital government information Act now to safeguard access before it's erased", description: "One-click archive of any threatened gov page. Save before Trump's admin scrubs it — works on any URL.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wayback Machine 'Save Page Now'", authorRole: "Movement Organization", targetUrl: "https://web.archive.org/save", topImageKey: "org_wayback-machine-save-page-now" },
  { id: 1231, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Pick a banned book + read it", synopsis: "Explore the titles they've tried to silence Join the movement for intellectual freedom through reading", description: "Pick a banned book + read it. Live, sortable list — read what they don't want in school libraries.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PEN America banned-books list", authorRole: "Movement Organization", targetUrl: "https://pen.org/banned-books-list-2022/", topImageKey: "org_pen-america-banned-books-list" },
  { id: 1232, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set election reminders (every contest)", synopsis: "Stay informed on all elections Ensure local contests don't go unnoticed", description: "Set election reminders for every contest. Off-cycle elections (judges, school boards) are where MAGA quietly stacks boards.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote.org", authorRole: "Movement Organization", targetUrl: "https://www.vote.org/", topImageKey: "org_vote-org" },
  { id: 1233, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Find DOJ-accredited rep training", synopsis: "Join the fight against mass deportation Get trained as a DOJ-accredited representative today", description: "Free DOJ-accredited rep training. Trump's mass deportation needs more accredited reps — non-lawyers can do this.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CLINIC (Catholic Legal Immigration Network)", authorRole: "Movement Organization", targetUrl: "https://www.cliniclegal.org/", topImageKey: "org_clinic-catholic-legal-immigration-network", amplifiesGroups: ["immigrant"] },
  // MoveOn front-page petitions — https://front.moveon.org/petitions/
  { id: 1234, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Mandate that ICE agents show their face and identification", synopsis: "Push for transparency in immigration enforcement Join the call to hold ICE accountable and protect communities", description: "Demand Congress require immigration agents to display agency ID and name badges, like other law enforcement.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "MoveOn.org Political Action", authorLink: "https://www.moveon.org/", targetUrl: "https://sign.moveon.org/petitions/unmask-ice", topImageKey: "org_moveon", amplifiesGroups: ["immigrant"] },
  { id: 1235, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Keep the U.S. out of forever wars", synopsis: "Demand your representatives prioritize diplomacy over conflict. Join grassroots efforts to halt military escalation in Iran", description: "Oppose U.S. military action in Iran. Tell Congress to prevent another Middle Eastern war.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "MoveOn.org Political Action", authorLink: "https://www.moveon.org/", targetUrl: "https://sign.moveon.org/petitions/no-war-with-iran-18", topImageKey: "org_moveon" },
  { id: 1236, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Do not cooperate with ICE", synopsis: "Stand against harmful immigration policies Demand local leaders prioritize community safety over federal enforcement", description: "Tell mayors and local officials to refuse cooperation with ICE and protect their residents.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "MoveOn.org Political Action", authorLink: "https://www.moveon.org/", targetUrl: "https://sign.moveon.org/petitions/do-not-cooperate-with-ice", topImageKey: "org_moveon", amplifiesGroups: ["immigrant"] },
  { id: 1237, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Pam Bondi must go", synopsis: "Join the grassroots push for accountability Sign the petition to remove Pam Bondi from office", description: "Demand Attorney General Pam Bondi resign or be impeached over her DOJ agenda.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "MoveOn.org Political Action", authorLink: "https://www.moveon.org/", targetUrl: "https://sign.moveon.org/petitions/pam-bondi-must-go", topImageKey: "org_moveon" },
  { id: 1238, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "No warehouses for ICE detention centers", synopsis: "Stand against ICE's expansion Join local protests and advocate for community-led alternatives", description: "Block ICE's $38B push to convert warehouses into immigration detention facilities.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "MoveOn.org Political Action", authorLink: "https://www.moveon.org/", targetUrl: "https://sign.moveon.org/petitions/no-warehouses-for-ice-detention-centers", topImageKey: "org_moveon", amplifiesGroups: ["immigrant"] },

  // Common Cause direct-action campaigns — https://www.commoncause.org/take-action/
  { id: 1239, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Save the USPS and mail-in voting", synopsis: "Stand up for postal service integrity Protect mail-in voting and rural access from privatization threats", description: "Sign to defend USPS from privatization. Mail-in voting and rural delivery die together — voter suppression by infrastructure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/save-the-us-postal-service/", topImageKey: "org_common-cause" },
  { id: 1240, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Defend the SPLC against right-wing attacks", synopsis: "Stand with the SPLC against extremist attacks on justice and truth", description: "Sign to defend the Southern Poverty Law Center. Trump-aligned groups are using lawfare to discredit hate-tracking research.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/defend-the-splc-and-our-civil-rights/", topImageKey: "org_common-cause" },
  { id: 1241, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Hold Trump's DOJ lawyers accountable", synopsis: "Demand accountability for those enabling Trump's agenda Email state bars to push for ethics reviews now", description: "Email state bars asking for ethics review of DOJ lawyers advancing Trump's anti-democracy agenda. Bar discipline is a real lever.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/hold-trumps-doj-lawyers-accountable/", topImageKey: "org_common-cause" },
  { id: 1242, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Reject Trump's $10B presidential cash grab", synopsis: "Tell Congress to stop the funding for Trump's agenda. Protect taxpayer dollars from political patronage", description: "Email Congress to block Trump's $10B presidential allowance push. Funnels public money toward MAGA-aligned contractors.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/reject-trumps-10-billion-cash-grab/", topImageKey: "org_common-cause" },
  { id: 1243, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Pledge to be the change in your community", synopsis: "Commit to civic engagement Join Common Cause and strengthen democracy, one voter at a time", description: "Take Common Cause's pledge — vote in every election, recruit one neighbor, follow at least one local race. Habit beats vibes.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/take-the-pledge-be-the-change/", topImageKey: "org_common-cause" },
  { id: 1244, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Remove Trump from office", synopsis: "Join the fight for accountability Sign the petition to demand impeachment now", description: "Sign Common Cause's call for impeachment based on documented abuses. Petition pressure feeds the political will needed.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/remove-trump-from-office-now-2/", topImageKey: "org_common-cause" },

  // ── 50501 Movement, Tesla Takedown, Indivisible, satire creators batch ──
  // (Imported from resistact_new_cards_FINAL.csv — author-set tone vectors,
  // categories canonicalized, locations mapped to LOCATION_OPTIONS, amplifies
  // groups set where the action explicitly serves a vulnerable group.)
  { id: 1245, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Vote YES on War Powers Resolution to stop Trump's Iran war", synopsis: "Tell your Congressperson to take a stand Stop Trump's reckless military escalation now", description: "Action Network letter from 50501. Tells your Congressperson to vote YES on the War Powers Resolution to block Trump's unauthorized military escalation against Iran. Pre-written, edits encouraged.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://actionnetwork.org/letters/e8187bd3c13d6812ad7e41897d096f8d3ae76f60", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1246, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Help count the crowd at your next protest", synopsis: "Join the movement to ensure accurate protest turnout data Use We Count to report your rally numbers and photos", description: "50501's We Count tool — submit headcounts and photos from rallies you attend so accurate turnout numbers reach press and Congress instead of MAGA's lowballed counts.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://bit.ly/m/WeCount", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1247, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join the No Kings Twitch organizing stream", synopsis: "Engage with fellow activists for strategy and support in the No Kings campaign", description: "50501's recurring Twitch livestream — strategy briefings, training, and community check-ins for the No Kings campaign. Watch live or follow for replays.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://twitch.tv/50501movement", toneOverride: { anger: 1, comedy: 1, subversion: 1, hope: 2, energy: 0 }, adminApproved: false },
  { id: 1248, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take 50501's Marching 101 protest training", synopsis: "Gear up for your first protest Learn essentials for safety and success", description: "Self-paced first-time-protester guide from 50501 — what to wear, what to bring, how to stay safe in a crowd, what to do if police escalate. Read once before your first march.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/FiftyFiftyOneMovement", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 1 }, firstTimerFriendly: true },
  { id: 1249, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Read 50501's Digital Safety primer for activists", synopsis: "Protect your privacy with essential tips from 50501 on digital safety for activists", description: "Quick guide from 50501 on locking down your phone, secure messaging, and metadata hygiene before joining protests. Trump-era surveillance is real — don't make it easy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/FiftyFiftyOneMovement", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 0 }, firstTimerFriendly: true },
  { id: 1250, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Use 50501's Virtual Actions guide if you can't show up in person", synopsis: "Join 50501 to take action from home Support the resistance through virtual contributions", description: "Disabled, immunocompromised, working two jobs? 50501's virtual-actions guide is a curated list of from-home protest contributions — phone banking, postcard writing, social amplification, doxx-defense.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/FiftyFiftyOneMovement", toneOverride: { anger: 1, comedy: 0, subversion: 0, hope: 2, energy: 0 }, amplifiesGroups: ["disabled"], adminApproved: false },
  { id: 1251, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Sell your Tesla", synopsis: "Join the movement to weaken Musk's influence. Sell your Tesla and make a statement today", description: "Tesla Takedown's headline ask — divest from Musk's company. Trade in, sell to a dealer, or post on Bring-A-Trailer. Every sale chips at the Musk valuation that funds his political project.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 1, energy: 2 }, firstTimerFriendly: true },
  { id: 1252, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Dump your TSLA stock", synopsis: "Take a stand against Musk's influence Divest your Tesla shares and push for change", description: "Tesla Takedown asks anyone holding Tesla shares — directly, in a 401(k), or via index funds — to divest. Switch to a Musk-free ETF; pressure your fund manager.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 1, energy: 2 }, firstTimerFriendly: true },
  { id: 1253, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find a Tesla Takedown protest near you", synopsis: "Join local activists in peaceful protests against Tesla's support for Trump. Find your nearest event and make your voice heard", description: "Map and calendar of weekly Tesla showroom protests across the US. Pick the closest, RSVP, show up. Peaceful, sign-holding, First Amendment.", location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 3 }, adminApproved: false },
  { id: 1254, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Plan a Tesla Takedown protest in your city", synopsis: "Organize a local protest against Tesla's support for Trump Use our toolkit to mobilize your community and make an impact", description: "No protest in your area yet? Tesla Takedown has a host-an-action toolkit — permits, sign templates, safety protocol, comms scripts. Pick a Saturday and start a chapter.", location: "Multi-state", boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 2, energy: 3 }, adminApproved: false },
  { id: 1255, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Push your city to pass a Tesla divestment resolution", synopsis: "Join local activists to cut ties with Tesla. Use our guide to draft a resolution today", description: "Tesla Takedown's City Resolutions track helps you draft and pass a municipal resolution to drop Tesla from city fleets and pension exposure. Templates + sample testimony included.", location: "Multi-state", boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/city-resolutions", topImageKey: "org_tesla-takedown", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1256, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Share your 'I sold my Tesla' story", synopsis: "Join the movement against Tesla's leadership Share why you walked away and amplify your voice", description: "Tesla Takedown collects defection testimonies — short written or video stories about why you ditched the car. They use them in press, social, and recruitment.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/share-your-story", topImageKey: "org_tesla-takedown", toneOverride: { anger: 2, comedy: 1, subversion: 1, hope: 1, energy: 1 }, firstTimerFriendly: true },
  { id: 1257, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Republican Reps: Not One Penny More for ICE Brutality", synopsis: "Pre-written email to GOP reps urging a no vote on ICE funding", description: "Indivisible action — pre-written email to Republican members of Congress demanding they vote against any new ICE funding. Editable script.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/tell-your-republican-members-of-congress-not-one-penny-more-for-ice/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Email-R-MoC-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], firstTimerFriendly: true },
  { id: 1258, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Republican Rep: Stop Bankrolling ICE Brutality", synopsis: "Script and contact info for a 60-second call against ICE funding", description: "Indivisible script + your Rep's number. 60-second call demanding they oppose ICE funding expansion. Currently flagged TRENDING NOW on Indivisible's action board.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/gop-house-stop-bankrolling-ice/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Call-R-Rep-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1259, category: "Phone Calling", categoryColor: "#c2185b", actionType: "Online", title: "Call your Republican Senator: Stop Bankrolling ICE Brutality", synopsis: "Senate phone numbers and a calling script to oppose ICE funding", description: "Indivisible's Senate-side companion call. Same ask: vote no on more ICE money. Senate phone numbers + script provided.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/gop-senate-stop-ice-brutality/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Call-R-Senator-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1260, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Democrats: Fiercely Oppose the New GOP ICE Funding Push", synopsis: "Message your Democratic reps to demand strong opposition to ICE funding", description: "Indivisible action targeting Democratic Reps — telling your own party to actually fight, not just vote no quietly. Anti-rollover messaging.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/urge-democrats-fiercely-oppose-new-gop-effort-shovel-billions-more-dollars-ice-and-border-patrol/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Email-D-MoC-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1261, category: "Phone Calling", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senator: Oppose Warrantless AI Mass Surveillance", synopsis: "Call your Senator using our script to fight AI surveillance funding", description: "Indivisible action against AI-driven mass-surveillance authorities being added to spending bills. Script + Senate switchboard.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/tell-your-senators-oppose-warrantless-ai-mass-surveillance/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/240409_FISA-CTA-2_1240x790-500x319.png", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant", "journalist"], adminApproved: false },
  { id: 1262, category: "Phone Calling", categoryColor: "#c2185b", actionType: "Online", title: "Call your Rep: Oppose Warrantless AI Mass Surveillance", synopsis: "Use the Indivisible script to urge your Rep to block AI spying", description: "Indivisible House-side companion. Same ask, House script.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/tell-representatives-no-to-ai-warrantless-mass-surveillance/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/240409_FISA-CTA-2_1240x790-500x319.png", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant", "journalist"], adminApproved: false },
  { id: 1263, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Reject the Deportation & Detention Agenda", synopsis: "Send a quick email to your Reps and Senators to push back hard", description: "Indivisible omnibus action against the Trump deportation expansion package — email your Reps and Senators with one click.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/reject-the-deportation-and-detention-agenda/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/03/260309_No-More-Detention-Centers-blue_1240x790-500x319.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], firstTimerFriendly: true },
  { id: 1264, category: "Phone Calling", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senators: End the Illegal War on Iran", synopsis: "Use Indivisible's guide to call your Senators and demand action", description: "Indivisible Senate call companion. Phone is louder than email — staff log calls separately.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/no-war-iran-senate/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/250618_1200-x-600_No-War-with-Iran-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1265, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person", title: "Make a 'No Kings' protest sign and bring it to your next rally", synopsis: "Join the grassroots movement against authoritarianism Create your sign, rally with purpose, and amplify your voice", description: "#NoKings has 271K+ posts on TikTok — creators sharing sign templates, slogans, and crowd footage. Make your own using their templates and tag #NoKings to amplify.", location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "No Kings (50501-aligned)", authorRole: "Movement Organization", targetUrl: "https://www.tiktok.com/tag/nokings", toneOverride: { anger: 2, comedy: 1, subversion: 1, hope: 2, energy: 2 }, firstTimerFriendly: true },
  { id: 1266, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Film a '50501 [your state]' intro reel", synopsis: "Show your state's resistance spirit Create a quick intro reel and boost local engagement", description: "TikTok pattern: short intro videos like 'We Are 50501 Georgia' from state chapters. Film one for your state, post on TikTok and Reels, link to your chapter's signup. Recruitment in 30 seconds.", location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "50501 state chapters", authorRole: "Movement Organization", targetUrl: "https://www.tiktok.com/tag/50501", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 1, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1267, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Stitch or duet a Trump clip with your counter-narrative", synopsis: "Use TikTok’s stitch feature to counter Trump’s narrative with your own voice", description: "TikTok's stitch/duet format is being used to debunk and ridicule Trump quotes in real time. Pick a clip, add 30 seconds of your own context or mockery, post with #Resist or #50501.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/tag/50501", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 1 }, firstTimerFriendly: true },
  { id: 1268, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Follow @teslatakedown on Instagram for weekly action drops", synopsis: "Stay informed on upcoming protests Get tools and templates to take action", description: "Their IG posts the next Saturday's protest list, sign templates, and creator-made meme content. Lowest-effort way to plug into a national protest schedule.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.instagram.com/teslatakedown/", topImageKey: "org_tesla-takedown", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 1, energy: 0 }, firstTimerFriendly: true },
  { id: 1269, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Submit your protest photo to a 50501 chapter highlight", synopsis: "Showcase your resistance through visuals Join @50501movement in amplifying our collective voice", description: "Instagram chapters like @50501movement run 'NO KINGS', 'May Day', 'DEFENSE' photo highlights from contributors. Tag your chapter; visibility builds the cohort.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://www.instagram.com/50501movement/", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 0 }, adminApproved: false },
  { id: 1270, category: "MEETING", categoryColor: "#5a3e9e", actionType: "In Person Group", title: "50501 Joplin / Citizens Against Tyranny — monthly meeting", synopsis: "Monthly meet-up in Joplin for local resistance against tyranny", description: "Sat May 16, 2:00 PM. Joplin, MO. 50501 Joplin and Citizens Against Tyranny Network's monthly chapter meeting. Local organizing in deep-red Missouri.", location: "Missouri", eventDate: "2026-05-16", boosts: 0, spotsTotal: "Unlimited", authorName: "Citizens Against Tyranny Network", authorRole: "Movement Organization", targetUrl: "https://events.pol-rev.com/", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1271, category: "MEETING", categoryColor: "#5a3e9e", actionType: "In Person Group", title: "BloNo IL community meeting & cookout (Central IL Iron Front)", synopsis: "Join local antifascists for strategy discussions and community building. Bring a dish to share and connect", description: "Sun May 17, 2:00 PM. Bloomington, IL. Central Illinois Iron Front community meeting + cookout. Antifascist organizing meets potluck. Bring a side dish.", location: "Illinois", eventDate: "2026-05-17", boosts: 0, spotsTotal: "Unlimited", authorName: "Central Illinois Iron Front", authorRole: "Movement Organization", targetUrl: "https://events.pol-rev.com/", toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 1 }, adminApproved: false },
  { id: 1272, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "We The People of Ohio — Constitution day in Mentor", synopsis: "Join Kathy for a family-friendly Constitution visibility action in Mentor", description: "Sun May 17, 8:00 AM. Mentor, OH. Constitution-themed visibility action. Peaceful, free, family-friendly. Hosted by Kathy.", location: "Ohio", eventDate: "2026-05-17", boosts: 0, spotsTotal: "Unlimited", authorName: "Mentor OH locals", authorRole: "Citizen Activist", targetUrl: "https://events.pol-rev.com/", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1273, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Subscribe to MeidasTouch on YouTube", synopsis: "Join the fight for truth Get daily updates and insights on anti-Trump news", description: "2.7M followers on TikTok, even bigger on YouTube. Daily anti-Trump news takedowns. Subscribe so the algorithm pushes their content to your feed and others'.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MeidasTouch Network", authorRole: "Movement Organization", targetUrl: "https://www.youtube.com/@MeidasTouch", topImageKey: "org_youtube", imageContain: true, toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1274, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Share MeidasTouch's latest Trump takedown clip", synopsis: "Amplify the message by sharing hard-hitting clips Help spread the truth and rally the resistance", description: "Pick a recent MeidasTouch reel — the punchier the better — and share it on your story or repost. Their model is reach-driven; sharing is the action.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MeidasTouch Network", authorRole: "Movement Organization", targetUrl: "https://www.tiktok.com/@meidastouch", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1275, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Listen to Lizz Winstead's Feminist Buzzkills podcast", synopsis: "Tune in for sharp commentary on abortion rights and the fight against the Christian right", description: "Daily Show co-creator Lizz Winstead's weekly comedy podcast about abortion rights, post-Roe America, and the fight against the Christian right. Subscribe wherever you get podcasts.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Abortion Access Front", authorRole: "Movement Organization", targetUrl: "https://aafront.org/feminist-buzzkills-live/", toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 2, energy: 0 }, amplifiesGroups: ["repro", "woman"], adminApproved: false },
  { id: 1276, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to Abortion Access Front", synopsis: "Support clinic defenses with funds for road trips and comedy events. Help destigmatize abortion access today", description: "Lizz Winstead's org — comedy meets clinic defense. Road trips to abortion clinics, destigmatizing comedy shows, post-Dobbs clinic-side support.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Abortion Access Front", authorRole: "Movement Organization", targetUrl: "https://aafront.org/donate/", toneOverride: { anger: 3, comedy: 2, subversion: 2, hope: 2, energy: 1 }, amplifiesGroups: ["repro", "woman"], adminApproved: false },
  { id: 1277, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Watch and share a Blaire Erskine satire video", synopsis: "Engage your network with sharp satire Share Blaire's videos to challenge MAGA narratives", description: "Blaire Erskine's deadpan-news-anchor satire reels (1.1M TikTok likes) skewer MAGA talking points one fake interview at a time. Pick one, share it, tag a relative who needs it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Blaire Erskine", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/@blaireerskine", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1278, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Subscribe to Blaire Erskine's Substack", synopsis: "Get weekly doses of sharp satire and exclusive insights from a top voice against Trump", description: "The newsletter version of Blaire Erskine's deadpan-news-anchor MAGA satire — bonus fake interviews skewering Trump talking points, behind-the-scenes on her viral TikTok reels, no algorithm gating. Direct to your inbox.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Blaire Erskine", authorRole: "Citizen Activist", targetUrl: "https://blaireerskine.substack.com/", toneOverride: { anger: 1, comedy: 3, subversion: 1, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1279, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Subscribe to The Lincoln Project's video drops", synopsis: "Get the latest satirical ads directly from The Lincoln Project to share and challenge Trump supporters", description: "Republicans-against-Trump satirical attack ads. Subscribe on YouTube and follow on TikTok/IG for the new releases — they're shareable weapons against MAGA relatives.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lincoln Project", authorRole: "Movement Organization", targetUrl: "https://www.youtube.com/@LincolnProject", topImageKey: "org_youtube", imageContain: true, toneOverride: { anger: 3, comedy: 3, subversion: 2, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1280, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Use a satire creator's audio to make your own anti-Trump TikTok", synopsis: "Harness viral audio for your message Create a 15-second TikTok that amplifies resistance", description: "TikTok's audio-reuse mechanic is a force multiplier. Pick a viral political satire audio (MeidasTouch, Lizz Winstead, Blaire Erskine), film a 15-second take with your local angle, post.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/discover/political-satire", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1281, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Comment-bomb viral Trump videos with action links", synopsis: "Engage undecided voters with informed comments and action links on viral Trump content", description: "TikTok and IG comment sections on Trump-aligned content reach undecided/curious viewers. Drop a clean comment with a link to a 5Calls script or local action — short, no insult, just info. Action over rage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/tag/50501", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 1, subversion: 3, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1282, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: No to Warrantless AI Mass Surveillance", synopsis: "Instantly email your representatives to stop AI surveillance funding", description: "One-click Indivisible email to your full Congressional delegation. Demands they strip warrantless AI surveillance provisions from spending bills before they pass.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/tell-congress-say-no-warrantless-ai-mass-surveillance/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/240409_FISA-CTA_1240x790-500x319.png", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant", "journalist"], adminApproved: false },
  { id: 1283, category: "Phone Calling", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senators: Block the Deportation & Detention Expansion", synopsis: "Call your Senators with our script to stop new ICE detention centers", description: "Call your Senators and demand they publicly oppose new ICE detention centers and the mass deportation expansion. Indivisible script + direct Senate numbers included.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/deportation-detention-agenda-senate/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/03/260309_No-More-Detention-Centers-red_sen_1240x790-500x319.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1284, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Rep: Reject the Deportation & Detention Agenda", synopsis: "Contact your House Rep to stop mass deportations and detention plans", description: "Call your House Representative to block Trump's mass deportation and detention expansion. Indivisible call script and Rep phone numbers provided.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/deportation-detention-agenda-house/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/03/260309_No-More-Detention-Centers-blue_rep_1240x790-500x319.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1285, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Stop Trump's Illegal War on Iran", synopsis: "One-click email to your reps demanding action on Iran's war powers", description: "One-click Indivisible email to your full delegation invoking the War Powers Act. Demands Congress vote to halt Trump's unauthorized military escalation against Iran.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/no-iran-war/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260224_1200-x-600_No-War-with-Iran-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1286, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Rep: End the Illegal War on Iran", synopsis: "Dial your House Rep with our script and get their number here", description: "Call your House Representative to demand a vote to end Trump's unauthorized war on Iran. Indivisible script + direct House phone numbers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/no-war-iran-house/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260224_1200-x-600_No-War-with-Iran-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1287, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Kill the GOP Voter Suppression Bills", synopsis: "Email your full congressional delegation to stop these harmful bills", description: "Email your full delegation to stop the SAVE Act and MEGA Act — GOP bills that would purge millions of eligible voters before the 2026 elections. One-click Indivisible action.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/stop-gops-new-voter-suppression-legislation/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260206_SAVE-MEGA-Act_Email-MoC-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1288, category: "Phone Calling", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senators: Vote NO on GOP Voter Suppression", synopsis: "Dial your Senators to oppose the SAVE and MEGA Acts — script inside", description: "Call your Senators to vote against the SAVE Act and MEGA Act — Republican bills that would gut voter registration and purge eligible voters before 2026. Indivisible script included.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/stop-save-senate/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260206_SAVE-MEGA-Act_Call-Sen-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1289, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email your Governor: Stop the Redistricting Coup", synopsis: "Demand fair maps from your governor before the 2026 elections hit", description: "Republicans are redrawing congressional maps mid-decade to lock in House control before 2026. Email your governor demanding they commit to fair redistricting — not partisan gerrymandering.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/campaigns/redistricting-coup-underway/", topImageUrl: "https://indivisible.org/wp-content/uploads/2025/11/The-Redistricting-Coup-is-Underway-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1290, category: "Phone Calling", categoryColor: "#c2185b", actionType: "Online", title: "Call Democratic Senators: Block Trump's Crypto Corruption Bill", synopsis: "Dial your Senators to oppose the CLARITY Act and protect oversight", description: "Call your Democratic Senators to oppose the CLARITY Act — Trump's crypto deregulation bill that strips SEC authority and enables his own crypto-corruption schemes. Indivisible script provided.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/stop-trumps-crypto-corruption/", topImageUrl: "https://indivisible.org/wp-content/uploads/2025/12/crypto_corruption-500x500.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },

  // ── NAACP (added 2026-05-14) ──────────────────────────────────────────────────
  { id: 1291, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Reject Harmful Cuts to Social Safety Net Programs", synopsis: "Email your reps to oppose cuts harming 11.8 million in healthcare", description: "Congress is moving to eliminate healthcare for 11.8 million people, slash one-third of the SNAP budget ($300B), and gut Social Security, Medicare, Medicaid, and Veterans benefits — all to fund tax breaks for the wealthy. The NAACP calls it un-American. Email your reps to vote NO.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-reject-harmful-funding-cuts", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1281545908.jpg.webp?itok=uA1GiwQi", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1292, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call Your Senator: Vote NO on the SAVE Act Voter Suppression Bill", synopsis: "Demand your senator vote no on the SAVE Act's voter suppression plan", description: "The SAVE Act would disenfranchise 21 million Americans — married women whose ID names differ from voter rolls, elderly without current IDs, students with mismatched addresses. Voter suppression disguised as protection. Call the Capitol Switchboard and demand your senator vote no.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-vote-no-save-act", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/JKnight_220923_0709%20%281%29.jpg.webp", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1293, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: No New Funding for ICE", synopsis: "Demand Congress cut ICE funding and hold agents accountable now", description: "ICE agents are killing and terrorizing communities with zero accountability. The NAACP is demanding Congress cut ICE funding, strip agent immunity, remove DHS Secretary Kristi Noem, and end federal-local law enforcement collusion. Contact your representatives now.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-no-new-funding-ice", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/Untitled-7.jpg.webp", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1294, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Report a Dirty AI Data Center Being Built Near You", synopsis: "Help expose harmful AI data centers Report locations to empower community action and advocacy", description: "AI data centers are being built in Black and low-income communities, burning fuels that emit cancer-causing chemicals. The NAACP is mapping where they're going. Report any planned or proposed data center in your area — your tip fuels national advocacy and local strategy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://forms.office.com/r/0BjBrg6TJU", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/64d27f8d3d504e5ad0833726_hdr-data-center-types.jpg.webp", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1295, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "No Healthcare, No Vote: Demand Congress Protect ACA Tax Credits", synopsis: "Email your rep to extend ACA tax credits for 24 million people", description: "Nearly 24 million Americans will lose ACA health coverage if enhanced premium tax credits expire. The NAACP is calling on Congress to extend them — because healthcare is a right, not a privilege. Email your representative before the deadline.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/no-healthcare-no-vote", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1287924870.jpg.webp?itok=Gzy0cAK2", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1296, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the NAACP Petition: Protect Black Workers", synopsis: "Petition for a moratorium on layoffs targeting Black workers and DEI cuts", description: "Black unemployment hit 7.2% in 2025 — nearly double the national rate — driven by mass federal job cuts and DEI rollbacks that targeted Black workers in healthcare, education, and public service. The NAACP demands a moratorium on targeted layoffs and an immediate pause on DEI dismantling. Sign now.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/protect-black-workers", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1196015209.jpg.webp", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1297, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Stop Elon Musk's xAI from Poisoning Black Communities", synopsis: "Demand Congress act against environmental racism Hold Musk’s xAI accountable for harmful pollution in Boxtown", description: "Musk's xAI installed unpermitted gas turbines in Boxtown, Tennessee — a predominantly Black neighborhood — generating cancer-causing pollution equal to a full power plant. Email Congress directly to demand accountability and protect communities from Big Tech's AI expansion.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://support.naacp.org/a/tell-congress-to-protect-our-communities-from-ai-data-center-operations", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/environmental-justice.jpg.webp?itok=a8N4Y7-k", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1298, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass the John R. Lewis Voting Rights Advancement Act", synopsis: "Contact Congress to advance the John R. Lewis Voting Rights Act", description: "The JLVRAA restores federal oversight of states with discriminatory voting histories, protects ballot access for communities of color, and guarantees equal voting rights for every citizen. Reject the SAVE Act. Advance the JLVRAA. Voting rights are American rights — contact Congress now.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-protect-our-voting-rights", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1202146507.jpg.webp?itok=57dCxKlE", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1299, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Share Your Story: How Federal Budget Cuts Are Hurting Your Family", synopsis: "Share your experience with Medicaid cuts in a quick two-minute form", description: "Congress is slashing Medicaid and SNAP while handing tax breaks to billionaires. The NAACP needs your story — how would losing healthcare, food assistance, or housing support affect you or someone you love? Personal testimonies shift congressional votes. Two minutes to submit.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://support.naacp.org/a/budget-and-tax-stories", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/GettyImages-844235780-cropped.jpg.webp", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 0 }, firstTimerFriendly: true, adminApproved: false },
  { id: 1301, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Your Senator: Kill the 'Kill Nonprofits' Bill (H.R. 9495)", synopsis: "Email your senator to oppose H.R. 9495 and protect nonprofits", description: "H.R. 9495 lets the government strip tax-exempt status from any nonprofit it labels 'terrorist supporting' — meaning the NAACP, ACLU, Planned Parenthood, any org that criticizes the administration. This is the infrastructure for silencing civil society. Email your senator to stop it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/oppose-hr-9495-protect-nonprofit-organizations", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/pexels-life-matters-4613879-%281%29.jpg.webp?itok=G50qUJOv", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },

  // ── Dissent Pins resistance merch ─────────────────────────────────────────────
  { id: 1302, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Slap a 'No War Is Holy' Sticker on Your Car (or Laptop)", synopsis: "Show your stance against holy wars Spread the message with a bold sticker", description: "Tired of hearing Trump claim divine favor for his wars? This UV-laminated bumper sticker (5.25″ × 3″) pushes back on the gospel of holy wars. Weather-resistant for indoor or outdoor use — sticker or car magnet. From Dissent Pins.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/no-war-is-holy-bumper-sticker", topImageUrl: "https://dissentpins.com/cdn/shop/files/NoWarIsHolyStickerMock-up_2000x2000.jpg?v=1776273173", toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1303, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Buy a Fifth Amendment Sticker — 50% to Immigrant Rights Orgs", synopsis: "Fifth Amendment stickers supporting immigrant rights organizations, 50% profit", description: "The Fifth Amendment protects everyone in the U.S. — citizens and non-citizens alike. Show it. 50% of profits go directly to immigrant rights organizations doing legal defense and community education, including Hands Off NYC, Illinois Coalition for Immigrant Rights, and Portland Immigrant Rights Coalition. 8.3″ wide, UV-laminated.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/fifth-amendment-bumper-sticker", topImageUrl: "https://dissentpins.com/cdn/shop/files/FifthAmendmentBumperSticker_1500x1500.png?v=1752677646", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1304, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Buy an Abolish ICE Liberty Sticker — 50% to Immigrant Rights Orgs", synopsis: "UV-laminated stickers and magnets, funding five immigrant rights groups", description: "Show solidarity with neighbors under threat from ICE enforcement. 50% of profits fund five immigrant rights organizations doing legal defense and community education. UV-laminated sticker (6.5″ × 4.4″) or car magnet.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/abolish-ice-liberty-bumper-sticker-or-car-magnet", topImageUrl: "https://dissentpins.com/cdn/shop/files/AbolishICELibertycarmagnetonblue2000x2000_2000x2000.jpg?v=1766517162", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1305, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Buy a FCK ICE Tee — 100% to Immigrant Defense Funds", synopsis: "Light blue tees supporting immigrant defense, sizes XS to 4XL available", description: "Wear your resistance and fund it. 100% of profits go directly to Minnesota Immigrant Rapid Response Fund, Immigrant Law Center of Minnesota, and UNIDOSMN. Light blue, 100% cotton, sizes XS–4XL. Made with Vermont-based New Duds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/fckice-tshirt", topImageUrl: "https://dissentpins.com/cdn/shop/files/FCKICEHoodieUGCJoinbrandsDanTinklerMar202612000x2000_1024x.jpg?v=1773673949", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },

  // ── Religious Action Center of Reform Judaism — Legislative Action Center ───
  { id: 1306, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass the Environmental Justice for All Act", synopsis: "Email your representatives to support the Environmental Justice for All Act", description: "Reform Jewish constituent email backing the A. Donald McEachin Environmental Justice for All Act (S. 919 / H.R. 1705). Forces federal agencies to weigh environmental and health impacts on Black, brown, low-income, and Indigenous communities before approving permits — the people Trump's deregulation hits first. One click sends to your delegation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/97971/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Hands%20cradling%20Earth.png?itok=6LiFeyEf", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1307, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass the FAMILY Act for Paid Family + Medical Leave", synopsis: "Email your Reps and Senators to support paid family leave for all", description: "Reform Jewish constituent email backing the FAMILY Act — paid family and medical leave for every worker in America. The U.S. is the only wealthy country without it. One click sends to your Reps and Senators.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/97797/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Coins%20stack%20with%20balance%20scale.png?itok=LoJBbP7S", toneOverride: { anger: 1, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1308, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Close Loopholes, Ban Assault Weapons, Fund Violence Intervention", synopsis: "Send a one-click email to Congress demanding gun violence reforms", description: "Reform Jewish action backing eight gun-violence-prevention measures — universal background checks, an assault weapons ban, safe storage, community violence intervention funding, and more. Faith voices move members who tune out everyone else. One-click email.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/Campaigns/97975/Respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/keep%20our%20schools%20safe%20sign.png?itok=V9BPpWTZ", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1309, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Mandate Hate Crime Reporting (IRPHA)", synopsis: "Email your representatives to support the Improving Reporting to Prevent Hate Act", description: "Reform Jewish ask to pass the bipartisan Improving Reporting to Prevent Hate Act — requires local law enforcement to actually report hate crimes to the FBI. Reporting is voluntary right now, which is why federal hate-crime data is unusable. One-click constituent email.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/115231/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/memorial%20candle.png?itok=F95veFJk", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1310, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Urge Congress: Pass the West Bank Violence Prevention Act", synopsis: "Email your Congress members to sanction Israeli settlers now", description: "Reform Jewish-led ask for U.S. sanctions on Israeli settlers and entities driving violence against Palestinians in the West Bank. Jewish constituents pushing this carries weight Trump and Netanyahu can't deflect. One-click email to your full delegation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/131611/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Jerusalem%20Day%20celebrations.png?itok=2n1dkw_y", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1311, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Your State Legislators: Protect LGBTQ+ People in Your State", synopsis: "Email your state legislators to oppose over 500 anti-LGBTQ+ bills", description: "Reform Jewish state-level email pushing back on the 500+ anti-LGBTQ+ bills introduced in 2024. Targets your Governor and state legislators with a faith-rooted framing on equal protection — the message that lands in red and purple statehouses when nothing else does.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/98070/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Young%20woman%20waving%20LGBTQ%2Bflag.png?itok=DIxOv-AP", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, amplifiesGroups: ["lgbtq"], adminApproved: false },
  { id: 1312, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass H.R. 40 — Commission to Study Reparations", synopsis: "Email your representatives to support H.R. 40 for reparations study", description: "Reform Jewish constituent email urging passage of H.R. 40 / S. 40 — establishes a federal Commission to Study and Develop Reparation Proposals for African Americans. Doesn't pay reparations; it produces the official record that makes them possible. Jewish memory in service of Black liberation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/97892/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-11/RAC%20header%20-%20Reparations.png?itok=gCQMs0dl", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },

  // ── Etsy anti-Trump merch (indie makers) ──────────────────────────────────
  // og:image URLs scraped from each listing's product page. Etsy CDN images
  // are stable but the listings themselves can be pulled by sellers — if a
  // card 404s the link, the admin panel can swap the targetUrl without
  // touching the image.
  { id: 1313, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Buy the \"Waiting for the Big Beautiful Obituary\" Anti-Trump Tee", synopsis: "Support local artisans while making a statement Wear your resistance with pride in every neighborhood", description: "Subtle FDT tee that flips Trump's \"big, beautiful\" branding into the obituary nobody's writing yet. Anti-MAGA, V-neck option, the kind of shirt that gets a knowing nod at the protest and a long stare in the suburbs. Indie maker (TeeTaniumCo) ships from Raleigh, NC.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "TeeTaniumCo (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/TeeTaniumCo", targetUrl: "https://www.etsy.com/listing/4484525481/anti-trump-tee-waiting-for-big-beautiful", topImageUrl: "https://i.etsystatic.com/46711686/r/il/38bf26/7886752294/il_1080xN.7886752294_gy8z.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1314, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Slap a \"When It Happens\" Anti-Trump Wine Label on the Bottle", synopsis: "Prepare for celebration Label your bottle and mark the moment when Trump is out", description: "Custom champagne / wine label sticker for the bottle you're saving for the day Trump is finally out. Subtle FDT, Democrat-gift-grade, makes any cabinet shelf into a countdown clock. Stick it now, pop it later — UncorkedLabels ships from Ocoee, FL.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "UncorkedLabels (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/UncorkedLabels", targetUrl: "https://www.etsy.com/listing/4357310155/anti-trump-custom-wine-label-funny", topImageUrl: "https://i.etsystatic.com/45057606/r/il/171012/7696003810/il_1080xN.7696003810_4ugp.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1315, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Buy the \"President and Dumb Should Be Different People\" Tee", synopsis: "Make a statement with this bold tee Show your resistance and spark conversations", description: "Anti-Trump slogan tee that says the quiet part out loud. Wearable irreverence for anyone tired of pretending we're still doing the diplomatic-disagreement thing about this presidency. TeeGeekBoutique ships from San Jose, CA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "TeeGeekBoutique (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/TeeGeekBoutique", targetUrl: "https://www.etsy.com/listing/4469069065/anti-trump-tee-president-and-dumb-should", topImageUrl: "https://i.etsystatic.com/46736936/r/il/c5a9ce/7834235639/il_1080xN.7834235639_6k7m.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1316, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Buy the \"Go Back, We Screwed Up\" Trump Evolution Tee", synopsis: "Wear your resistance. Support progressive values with this bold statement tee", description: "The evolution-of-man cartoon, except the last frame is an apology. \"Go back, we screwed up.\" Vote-blue, Kamala-friendly, pure billboard energy on a t-shirt. PrintfulApparelUS ships from Stafford, TX.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PrintfulApparelUS (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/PrintfulApparelUS", targetUrl: "https://www.etsy.com/listing/1797660855/anti-trump-tshirt-go-back-we-screwed-up", topImageUrl: "https://i.etsystatic.com/53712756/r/il/57fd0e/6288678088/il_1080xN.6288678088_ll21.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },

  // ── Spreadsheet batch (May 17): 19 new cards from anti-ICE / detention /
  // anti-Iran-war / Tesla-divest sources. 7 of the original 26 rows were
  // skipped as exact-URL or generic-URL duplicates of existing cards.
  // All start as adminApproved:false so the admin can eyeball before publish.
  { id: 1317, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Divest your portfolio (and your funds) from Tesla", synopsis: "Take control of your investments Shift your money away from Tesla and challenge Musk's influence", description: "Tesla Takedown's divestment guide walks you through identifying which of your index funds, ETFs, and retirement accounts hold TSLA — and how to move them. Close the financial faucet on Musk and DOGE.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", authorLink: "https://www.teslatakedown.com/", targetUrl: "https://www.teslatakedown.com/divest", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1318, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "In Person Group", title: "Adopt-A-School: deter ICE raids at your neighborhood school", synopsis: "Volunteer at local schools to protect students from ICE raids", description: "NDLON's Adopt-A-School program assigns volunteers to be physically present at school drop-off and pick-up to deter ICE agents from snatching kids and parents. Sign up by zip — Seattle pilot is live; program expanding.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Multi-State", authorName: "National Day Laborer Organizing Network", authorRole: "Movement Organization", authorLink: "https://ndlon.org/", targetUrl: "https://www.mobilize.us/mobilize/event/942116/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization/signal-2026-01-21-45558%E2%80%AFPM_20260123222132428157.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1319, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "In Person Group", title: "Adopt-A-Corner: stand watch at a known ICE pickup spot", synopsis: "Monitor ICE activity at Home Depots and transit stops in your area", description: "NDLON's Adopt-A-Corner rapid-response program assigns volunteers to monitor and disrupt ICE pickup locations (Home Depots, day-laborer corners, transit stops). Long-running commitment — open through Jan 2029.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Multi-State", authorName: "National Day Laborer Organizing Network", authorRole: "Movement Organization", authorLink: "https://ndlon.org/", targetUrl: "https://www.mobilize.us/mobilize/event/856822/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization/Adopt%20a%20Corner%20Mobilize%20Group%20Graphic_20250807185842207845.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1320, category: "TRAINING", categoryColor: "#126d89", actionType: "In Person Group", title: "Volunteer Training: Rapid Response to ICE Actions (Fremont CA)", synopsis: "Three-hour training to verify ICE actions and document violations", description: "Three-hour training to join the Bay Area rapid-response phone tree — verify ICE sightings, deploy verifiers, document violations. Wed May 20, 6pm, Fremont CA.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "California", authorName: "Indivisible Fremont", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/943590/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/ACELIP%20training%20image%20A_20251031044153435196.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1321, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Federal Building Fridays: weekly anti-Trump regime protest (Seattle)", synopsis: "Weekly lunchtime protests at the Henry M. Jackson Federal Building", description: "Weekly Friday lunchtime protest at the Henry M. Jackson Federal Building in downtown Seattle targeting the Trump regime broadly — ICE, DOGE cuts, Iran war, RIFs. Hosted by Southend Indivisible.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Washington", authorName: "Southend Indivisible", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/944909/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/IMG_4009%20%281%29_20251222215412756888.JPG?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 1, subversion: 1, hope: 2, energy: 3 }, adminApproved: false },
  { id: 1322, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "NO ICE Expansion: tell Sabey Corp to cancel new ICE lease (Tukwila WA)", synopsis: "Picket Sabey Corp in Tukwila to end their new ICE lease deal", description: "Picket Sabey Corp's Tukwila campus to demand they cancel the lease they just signed with ICE for a new processing office. Recurring Wednesdays — May 20, Jun 3, and on.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Washington", authorName: "Southend Indivisible", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/933915/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/All%20Sabey%20protests_20260406081542745590.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1323, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Honk-and-Wave rallies to protest Trump regime corruption", synopsis: "Join local activists for drive-by protests against corruption. Wave your signs and amplify our message!", description: "Virtual + IRL drive-by honk-and-wave rallies coordinated by Indivisible Highlands and Beyond targeting Trump regime corruption. Distributed format — join from anywhere with a sign and a road.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Multi-State", authorName: "Indivisible Highlands and Beyond", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/950956/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/photo-3623_singular_display_fullPicture_20260506164538825158.jpeg?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 2, energy: 3 }, adminApproved: false },
  { id: 1324, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "In Person Group", title: "De-ICE Citizens Bank: National Day of Action (Jun 6)", synopsis: "Boycott Citizens Bank branches for funding ICE detention contracts nationwide", description: "Boycott + picket Citizens Bank branches nationwide for financing GEO Group and CoreCivic ICE detention contracts. National Day of Action coordinated by the De-ICE Citizens Bank Coalition — Sat Jun 6, 11am locally.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Multi-State", authorName: "De-ICE Citizens Bank Coalition", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/953075/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization/RSVP%20now_20260505235325939806.jpeg?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1325, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "In Person Group", title: "Hands Off NYC: small-business canvass for immigrant safety (NYC)", synopsis: "Canvass small businesses in Harlem with rights materials for immigrants", description: "Indivisible Harlem canvass of Harlem and uptown small businesses, distributing Know Your Rights materials and ICE-watch info to immigrant-employee-heavy storefronts. Wed May 20, 10am, plus more dates.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "New York", authorName: "Indivisible Harlem", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/838849/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/welcome%20us%20image_20251011175816920835.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1326, category: "TRAINING", categoryColor: "#126d89", actionType: "In Person Group", title: "ICE Out for Good: Know-Your-Rights canvass in Greenwich Village", synopsis: "Distribute Know-Your-Rights cards to immigrants in Greenwich Village", description: "Volunteers distribute Know-Your-Rights cards to ICE-targeted immigrants and the lawyers who serve them around Greenwich Village. Fri May 29, 3pm, NYC.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "New York", authorName: "ICE Out For Good", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/956018/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization/ICE%20out%20for%20GOOD%20wordmark_16x9_20260108201816461490.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1327, category: "MEETING", categoryColor: "#5a3e9e", actionType: "In Person Group", title: "NELA Alliance for Democracy: monthly meeting (Northeast LA)", synopsis: "Monthly organizing meeting for rapid response and voter education", description: "Northeast Los Angeles Alliance for Democracy monthly anti-Trump organizing meeting — coordination on rapid response, voter ed, ICE watch. Thu May 28, 7pm, recurring.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "California", authorName: "Indivisible NELA", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/771218/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/NELAAforD%20mobilize%20program%20MONTHLY%20NELA%20Meeting%20in-person_20250818155924620096.jpg?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1328, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "In Person Group", title: "Boycott Home Depot for cooperating with ICE raids (LA)", synopsis: "Stand against ICE raids Join local activists to boycott Home Depot and protect workers' rights", description: "LA Indivisible community-support + Home Depot boycott action targeting Home Depot's pattern of allowing ICE raids on day-laborer corners outside its stores. Sun Jun 28, 12pm, recurring.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "California", authorName: "Indivisible Los Angeles", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/881851/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization/Mobilize%20Generalized%20Indivisible%20Event%20Campaign%20Image%201_20231214173802957298.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1329, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "NO WARS! Take Back Our Streets: Venice + Santa Monica weekly", synopsis: "Weekly anti-war protests in Venice and Santa Monica, Thursdays at 4pm", description: "Indivisible Westside LA weekly anti-Trump-Iran-war street protest in Venice and Santa Monica. Thu May 21, 4pm, recurring weekly.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "California", authorName: "Indivisible Westside LA", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/", targetUrl: "https://www.mobilize.us/mobilize/event/893106/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/Screenshot%202026-03-18%20at%207.45.45%E2%80%AFPM_20260319040316650650.PNG?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 3 }, adminApproved: false },
  { id: 1330, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Visit and accompany detained immigrants at Stewart Detention Center", synopsis: "Support families separated by detention Join El Refugio to provide companionship and advocacy in Lumpkin, GA", description: "El Refugio runs hospitality, visitation, and advocacy for immigrants detained at Stewart Detention Center in Lumpkin GA — the largest ICE detention site in the U.S. Drive down, sit with someone whose family is hours away.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "Georgia", authorName: "El Refugio", authorRole: "Movement Organization", authorLink: "https://elrefugiostewart.org/", targetUrl: "https://elrefugiostewart.org/en/volunteers", topImageUrl: "http://static1.squarespace.com/static/5dedd42f60df274331bcd16b/t/63c0b458f5504e510924fa38/1673573464429/El+Refugio+logo+png+version_updated.png?format=1500w", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1331, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Volunteer for visitation at Elizabeth Detention Center (NJ)", synopsis: "Support the detained with visits and letters Join First Friends in advocating for justice", description: "First Friends of NJ & NY runs an ongoing visitation program at Elizabeth Detention Center (NJ) and Orange County Correctional (NY) — apply to visit, write letters, or run the hotline.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "New Jersey", authorName: "First Friends of NJ and NY", authorRole: "Movement Organization", authorLink: "https://firstfriendsnjny.org/", targetUrl: "https://firstfriendsnjny.org/volunteer/", topImageUrl: "http://jonaswebsitedesign.com/firstfriends/wp-content/uploads/2020/09/ff-web-logo.png", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1332, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to RAICES — free legal defense for ICE detainees (TX)", synopsis: "Free legal help for ICE detainees in Texas fighting deportation cases", description: "RAICES Texas provides free or low-cost legal representation for immigrants in detention (Karnes, Dilley, Pearsall) and just filed a habeas/class-action against ICE for unlawful detention. Most ICE-detained people face deportation court without a lawyer.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", location: "Texas", authorName: "RAICES Texas", authorRole: "Movement Organization", authorLink: "https://raicestexas.org/", targetUrl: "https://raicestexas.org/?form=unite-against-hate", topImageUrl: "http://static1.squarespace.com/static/63b4656c9f96340195a2ff05/t/66c434381f80aa0d1a602193/1724134456615/raices_social.png?format=1500w", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1333, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to the NBFN Immigration Bond Freedom Fund", synopsis: "Support immigrant rights with a single donation Help free those targeted by unjust deportation efforts", description: "One donation, distributed by the National Bail Fund Network to community-led immigration bail funds nationwide — buys release for immigrants caught in Trump's deportation surge.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "National Bail Fund Network", authorRole: "Movement Organization", authorLink: "https://www.communityjusticeexchange.org/en/nbfn-directory", targetUrl: "https://secure.actblue.com/donate/immbondfreedom", topImageUrl: "https://images.squarespace-cdn.com/content/v1/60db97fe88031352b829d032/1625004042861-LZNYQYNOB9ZPQ817266J/NBFNlogo_3x2.7.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1334, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to the NBFN Pretrial Bail Freedom Fund", synopsis: "Support local bail funds to free those unjustly held pretrial. Your contribution fights systemic inequality and injustice", description: "NBFN's pretrial freedom fund pools donations across 90+ local bail funds to free people held pretrial — disproportionately Black, Brown, poor, and increasingly people swept up at Trump-era protests.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "National Bail Fund Network", authorRole: "Movement Organization", authorLink: "https://www.communityjusticeexchange.org/en/nbfn-directory", targetUrl: "https://secure.actblue.com/donate/pretrialfreedom", topImageUrl: "https://images.squarespace-cdn.com/content/v1/60db97fe88031352b829d032/1625004042861-LZNYQYNOB9ZPQ817266J/NBFNlogo_3x2.7.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1335, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to NDLON's Immigrant Defense Fund", synopsis: "Support legal efforts for immigrant workers facing raids Join NDLON in defending rights and building resilience", description: "NDLON's Immigrant Defense Fund underwrites legal defense, organizing, and rapid-response infrastructure for day-laborer and immigrant-worker communities under Trump-administration raids.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "National Day Laborer Organizing Network", authorRole: "Movement Organization", authorLink: "https://ndlon.org/", targetUrl: "https://ndlon.org/donate/", topImageUrl: "https://ndlon.org/wp-content/uploads/2018/04/Facebook-OG-Image.png", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },

  // ── Grassroots-Fun spreadsheet batch (May 17): 21 irreverent / crafty
  // protest objects + content-creator boost cards. 1 row (UncorkedLabels wine
  // label) skipped as duplicate of 1314. Etsy product images scraped via
  // Chrome; TikTok cards reuse the local org_tiktok asset; the 3 Instagram
  // cards land image-less (the no-image-review guard keeps them off the
  // public feed until an admin uploads a header).
  { id: 1336, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Burn a \"Smells Like F*ck Trump\" Soy Candle", synopsis: "Light up your space with a bold statement Perfect for sparking conversations and challenging complacency", description: "A scented soy candle whose label is a cathartic anti-Trump joke — light it, sniff it, dare guests not to ask. Great gateway for liberal-leaning fence-sitters who want a subtle protest object at home.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Luminva (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/Luminva", targetUrl: "https://www.etsy.com/listing/1822852555/smells-like-fck-trump-candle-not-my", topImageUrl: "https://i.etsystatic.com/24115390/r/il/afc632/6462657815/il_1080xN.6462657815_dk11.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1337, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Light the \"Light Me When He's Dead\" No Kings Candle", synopsis: "Support the No Kings movement with a darkly humorous candle for a brighter future", description: "A pitch-dark soy candle satire built around the No Kings movement — buy it now, light it… eventually. Bestseller-level demand suggests strong cohort signal.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/", targetUrl: "https://www.etsy.com/listing/4435012382/light-me-when-hes-dead-candle-o-no-kings", topImageUrl: "https://i.etsystatic.com/62168565/r/il/2b42c2/7563999026/il_1080xN.7563999026_2vho.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1338, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Wear the \"Waiting for the Big Beautiful Obituary\" Shirt (MeloraTShirts)", synopsis: "Spark discussions with this satirical tee Challenge the narrative while keeping it subtle", description: "Subtle anti-MAGA dark-satire tee referencing Trump's \"big beautiful bill\" rhetoric. Conversation-starter without being explicit; reads as a soft FDT to people who get it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MeloraTShirts (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/MeloraTShirts", targetUrl: "https://www.etsy.com/listing/4438139548/anti-trump-t-shirt-waiting-for-big", topImageUrl: "https://i.etsystatic.com/54455758/r/il/1c1a6e/7630931827/il_1080xN.7630931827_t1zw.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1339, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Stick a \"Let's Go Blood Clot\" Anti-Dictator Sticker Anywhere", synopsis: "Spread the word with bold stickers Challenge the narrative and resist the regime", description: "Set of 5 vinyl glossy stickers leaning into the dictator-health-rumor news cycle. Water-resistant, ready for laptops, car bumpers, gas pumps.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "YaBoiHatesTikTok (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/YaBoiHatesTikTok", targetUrl: "https://www.etsy.com/listing/4361557773/lets-go-blood-clot-set-of-5-vinyl-glossy", topImageUrl: "https://i.etsystatic.com/25456288/r/il/aa26ef/7206475637/il_1080xN.7206475637_dge1.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1340, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Wear a 3D-Printed \"FUCK TRUMP\" Lapel Pin from a Maker Shop", synopsis: "Show your resistance with this bold statement piece. Support independent makers while spreading the message", description: "Tiny 3D-printed handmade pin — wear it everywhere. Independent maker, recyclable PLA plastic, unmistakable to anyone who reads it up close.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "WokeandBespokeShop (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/WokeandBespokeShop", targetUrl: "https://www.etsy.com/listing/1822887706/fuck-trump-small-lapel-pin-3d-printed-in", topImageUrl: "https://i.etsystatic.com/14701224/r/il/0b4fd9/6531386599/il_1080xN.6531386599_p1lz.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1341, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Pin the Decode-the-Numbers \"86 47\" Anti-Trump Button", synopsis: "Wear your resistance. Spread the message discreetly with this coded pin. Let the numbers speak for change", description: "Numeric subversive code pin — 86 47 means \"get rid of #47.\" Plausibly deniable in mixed company, decodable by the in-group. Subversion-by-cipher.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ButtonRepublic (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/ButtonRepublic", targetUrl: "https://www.etsy.com/listing/4484781251/anti-trump-protest-buttons-impeach-trump", topImageUrl: "https://i.etsystatic.com/21374020/r/il/046821/7998550050/il_1080xN.7998550050_g7up.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1342, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Pin: Grumpy Cat with Mug Says \"First Of All, Fuck Trump\"", synopsis: "Cat pin for jackets and bags that nails your anti-Trump vibe", description: "A cat-holding-coffee-mug pin that opens any conversation with the right energy. Independent maker, sized for jackets and tote bags.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "AntiTrumpResistance (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/AntiTrumpResistance", targetUrl: "https://www.etsy.com/listing/4343898613/first-of-all-fuck-trump-pins-buttons", topImageUrl: "https://i.etsystatic.com/57506905/r/il/65b55e/7066739838/il_1080xN.7066739838_e6ji.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1343, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Wear an \"Epstein Files Protest\" Pin", synopsis: "Show your stance against corruption Join the movement for transparency with this bold statement pin", description: "Pin specifically calling out the Trump–Epstein files coverup; pairs with the broader Epstein-truth subway-poster and walk campaigns.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "KindSpeech (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/KindSpeech", targetUrl: "https://www.etsy.com/listing/4495679448/anti-trump-epstein-button-anti-trump", topImageUrl: "https://i.etsystatic.com/51124327/r/il/b53f82/7958667724/il_1080xN.7958667724_rk6i.jpg", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1344, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Stick the \"RESIST\" Decal Built from the Tesla T Badge", synopsis: "Transform Tesla's brand into a bold statement Show your resistance with this eye-catching decal", description: "Decal that hijacks the Tesla \"T\" badge to spell RESIST — most punishing on the cars Elon expects to be brand ambassadors. Great for Tesla Takedown rally signage and laptop stickers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/", targetUrl: "https://www.etsy.com/listing/4298432541/resist-decal-using-tesla-t-badge-resis", topImageUrl: "https://i.etsystatic.com/56118203/r/il/056da6/6827047560/il_1080xN.6827047560_ax1w.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1345, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Magnet: \"I Bought This Before We Knew Elon Was Crazy\"", synopsis: "Car magnets that show you’re not with Musk, even if you drive Tesla", description: "A car magnet that lets reluctant Tesla owners distance themselves from Musk without giving up the car. Funny, self-deprecating, and immediately legible at a parking lot.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/", targetUrl: "https://www.etsy.com/listing/1848107294/i-bought-this-before-we-knew-elon-was", topImageUrl: "https://i.etsystatic.com/56939346/r/il/b5204b/6585705442/il_1080xN.6585705442_57j5.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1346, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Burn the \"Peace President, My Ass!\" Soy Candle", synopsis: "Light up resistance with a bold statement Fuel the fight against false narratives", description: "Blood-orange-scented soy candle directly mocking Trump's self-styled \"peace president\" branding over the Iran strikes. The label IS the protest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/", targetUrl: "https://www.etsy.com/listing/4481440997/the-peace-president-my-ass-exclusive", topImageUrl: "https://i.etsystatic.com/14878984/r/il/9fbd21/7915610157/il_1080xN.7915610157_kfcd.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1347, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Pin: \"Trump Is The Worst President Since Trump\"", synopsis: "Independent button maker's joke design, a delightfully absurd buy", description: "A perfectly recursive button that does its own joke. Independent button maker, low-stakes purchase, very rewardingly absurd.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ShopImpressiveThings (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/ShopImpressiveThings", targetUrl: "https://www.etsy.com/listing/4319736881/trump-is-the-worst-president-since-trump", topImageUrl: "https://i.etsystatic.com/57450745/r/il/e1c078/6935784130/il_1080xN.6935784130_18ir.jpg", toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1348, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Sticker Set: \"Hold Trump Accountable — Tired Democrat Activist\"", synopsis: "Self-aware stickers for those still fighting the good fight against Trump", description: "Self-aware sticker/pin for the exhausted-but-still-showing-up cohort. Independent button shop, taps the \"this is hard but I'm doing it\" energy that drives sustained engagement.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "OneHorseShyHandmade (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/OneHorseShyHandmade", targetUrl: "https://www.etsy.com/listing/1181078926/hold-trump-accountable-pin-button-tired", topImageUrl: "https://i.etsystatic.com/7045127/r/il/4449b9/7588514985/il_1080xN.7588514985_jy7k.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1349, category: "Act of Kindness", categoryColor: "#d97706", actionType: "Online", title: "Boost Randy Rainbow's Anti-Trump Musical Parodies on TikTok", synopsis: "Share Randy's latest parody and spread the laughter while challenging Trump's agenda. Join the movement on TikTok", description: "Randy Rainbow's weekly Trump-skewering musical parodies (Rent, Sound of Music) translate political fury into shareable joyful satire. Pick the freshest one and share to your story.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Randy Rainbow", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@randyrainbowofficial", targetUrl: "https://www.tiktok.com/@randyrainbowofficial", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1350, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Play \"Secret Handshake\" — the satirical browser game mocking Trump's Iran war", synopsis: "Engage in satire against Trump’s Iran policies Play, share your high score, and spread the message", description: "Activist group \"Secret Handshake\" released a satirical browser-style video game lampooning Trump's handling of the Iran strikes — featured on Rachel Maddow. Share it, play it, post your high score.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Secret Handshake", authorRole: "Movement Organization", authorLink: "https://www.tiktok.com/@msnow", targetUrl: "https://www.tiktok.com/@msnow", topImageKey: "org_tiktok", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1351, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "In Person Group", title: "Sing With \"Songs for Liberation\" Outside an ICE Facility", synopsis: "Join faith leaders and artists in soulful protests. Unite voices to challenge ICE and uplift communities", description: "Coalition of ministers and singers running coordinated protest-hymn flash mobs at ICE facilities (Chicago, Twin Cities). Find a local chapter via #SongsForLiberation or join a sing-along where you live.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "National", authorName: "Songs for Liberation", authorRole: "Movement Organization", authorLink: "https://www.tiktok.com/tag/protestsong", targetUrl: "https://www.tiktok.com/tag/protestsong", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1352, category: "Act of Kindness", categoryColor: "#d97706", actionType: "Online", title: "Spread the \"TACO\" Meme — Trump Always Chickens Out", synopsis: "Join the meme movement to expose Trump's retreat tactics Create and share stickers, emojis, and social media posts", description: "FT's Robert Armstrong coined \"TACO\" (Trump Always Chickens Out) for the tariff-threaten-then-retreat pattern. Make stickers, post taco emojis under tariff threats, mock the pattern publicly so it sticks.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", authorLink: "https://www.tiktok.com/tag/trumpparody", targetUrl: "https://www.tiktok.com/tag/trumpparody", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1353, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Stage or Boost the \"Trump Parody Opera\" — Hamburg Premiere", synopsis: "Engage with a satirical opera to challenge Trump’s narrative Host a watch party or create buzz through social media", description: "An actual Trump-parody opera premiering in Hamburg, Germany. Boost the trailer, organize a watch party, or write a reaction post — turn an opera into resistance content.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Really American", authorRole: "Movement Organization", authorLink: "https://www.tiktok.com/@reallyamerican", targetUrl: "https://www.tiktok.com/@reallyamerican", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1354, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Cross-Stitch a Resistance Slogan with Subversive Cross Stitch", synopsis: "Stitch your message into fabric Join the resistance with Subversive Cross Stitch patterns", description: "Use Subversive Cross Stitch's pattern catalog (Julie Jackson's shop has been doing this since the 2010s) to make a Trump-era cross-stitch — frame it, gift it, post the WIP. Distinct from the existing TikTok stitch/duet card — this is literal needlework, not video stitching.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Subversive Cross Stitch", authorRole: "Independent Creator", authorLink: "https://www.instagram.com/subversivecrossstitch/", targetUrl: "https://www.instagram.com/subversivecrossstitch/", topImageUrl: "https://scontent.cdninstagram.com/v/t51.2885-19/199306322_514541513021942_7756897236030600423_n.jpg?stp=dst-jpg_s100x100_tt6&_nc_cat=103&ccb=7-5&_nc_sid=bf7eb4&_nc_ohc=LqyEUHic0_gQ7kNvwHUIZNi&_nc_oc=Adpod_8XEKCikLOFo89IHj5IC2tTzXfMHQA0HiBGP5zknuB9GWDEnyd2ADBOc-D3Qsk&_nc_zt=24&_nc_ht=scontent.cdninstagram.com&_nc_ss=73689&oh=00_Af7KBs3ih9nt1fcALCR84OacWLaLeL8sWJ6VtjZDa0st6g&oe=6A0FBB20", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1355, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Stitch Along with Badass Cross Stitch's Anti-Trump Patterns", synopsis: "Join a community of crafters tackling Trump-era issues Download patterns, stitch, and share your resistance art", description: "Shannon Downey's @badasscrossstitch runs free-pattern drops + group stitch-ins targeting MAGA-era issues. Download a current pattern, finish a piece, and post it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Badass Cross Stitch", authorRole: "Independent Creator", authorLink: "https://www.instagram.com/badasscrossstitch/", targetUrl: "https://www.instagram.com/badasscrossstitch/", topImageUrl: "https://scontent.cdninstagram.com/v/t51.2885-19/15043801_336957816688365_8365540907474223104_a.jpg?stp=dst-jpg_s100x100_tt6&_nc_cat=109&ccb=7-5&_nc_sid=bf7eb4&_nc_ohc=34iJMqqlsSgQ7kNvwFsZ_Ck&_nc_oc=AdouHfIFvB626TQQU_h-VIKMfXIo9UqAB3Z0NdDZXIO8DaEgrCy5mpsi2Mm7TpzW33c&_nc_zt=24&_nc_ht=scontent.cdninstagram.com&_nc_ss=70689&oh=00_Af6myQ9P9IwK-3HEmui9QiOoNAHzR7wnTmhdBfRoI9XDsQ&oe=6A0F92ED", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1356, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Make a Craftivist Collective \"Gentle Protest\" Mini-Banner", synopsis: "Create mini-banners to express your resistance Leave your message in public spaces with Craftivist Collective tutorials", description: "The Craftivist Collective publishes \"gentle protest\" mini-banner tutorials — small, embroidered statements you leave in public space. Pick a Trump-era theme and leave one.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Craftivist Collective", authorRole: "Movement Organization", authorLink: "https://www.instagram.com/craftivist_collective/", targetUrl: "https://www.instagram.com/craftivist_collective/", topImageUrl: "https://static.cdninstagram.com/rsrc.php/v4/yD/r/R0fBIMurK8v.png", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },

  // ── Grassroots-Fun batch addendum (May 17, second paste): 5 net-new cards.
  // The other 19 rows in the second paste were already in the database from
  // the previous batch (1336–1356) — silently skipped as exact dupes.
  { id: 1357, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Browse Dissent Pins — Including the \"Swastikar\" Tesla Pin", synopsis: "Full catalog of dissent pins, including the infamous \"Swastikar\" design", description: "Independent pin maker with a full catalog of Trump/MAGA-era dissent pins, including the now-famous \"Swastikar\" pin riffing on the Tesla logo. Wholesale and ACLU collabs available — browse the full collection.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/", topImageUrl: "https://cdn.shopify.com/s/files/1/1746/4337/files/Stand_With_Ukraine_Pin_on_denim_1200x628_2e311cf1-9d19-432d-85f8-cafbd9866161.jpg?v=1738503135", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1358, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Join the Resistance Knitters Bluesky Group", synopsis: "Unite with fellow crafters to knit for change and share impactful projects", description: "Active craftivist knitting group that fought during Trump 1.0 on FB and is now organizing on Bluesky — knits hats and protest objects, shares patterns, surfaces fact-based news. Plug into the community and pick a project.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistance Knitters", authorRole: "Independent Creator", authorLink: "https://bsky.app/profile/resistanceknitters.bsky.social", targetUrl: "https://bsky.app/profile/resistanceknitters.bsky.social", topImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:fldpue6iblblysw6tk4eptvz/bafkreidr2rhwv7nanxglbw3fxf76l37rwopjqixbue5nuivbnzsfe4wqkq", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1359, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Stitch Feline and Floss's Free Anti-ICE Cross Stitch Pattern", synopsis: "Create art that resists oppression Download this free pattern and make your voice heard", description: "Feline and Floss publishes free cross-stitch patterns on Ko-fi — current drop is explicitly anti-ICE/Fuck ICE. Download, stitch, frame, gift, repeat.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Feline and Floss", authorRole: "Independent Creator", authorLink: "https://ko-fi.com/felineandfloss", targetUrl: "https://ko-fi.com/felineandfloss", topImageUrl: "https://storage.ko-fi.com/cdn/generated/lyflmrusgjymi/2026-05-11_rest-973b09129414d2335f7e561b753bf0ee-v4e73jqn.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1360, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Color Your Way Through Trump 2.0 with Fresh Prints' Anti-Trump Resistance Coloring Book", synopsis: "Unwind and resist with every stroke Grab your coloring tools and get creative", description: "Indie coloring book full of anti-Trump pages — calming, shareable craft for tense news days. Pages are also sold as standalone prints.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "FreshPrintsHandmade (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/FreshPrintsHandmade", targetUrl: "https://freshprintshandmade.etsy.com", topImageUrl: "https://i.etsystatic.com/56615728/r/isla/b30f8f/74796492/isla_500x500.74796492_b2qer1xw.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1361, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "In Person Group", title: "Join a \"Honk to Dump Trump\" + \"Trump ❤️ Epstein\" Banner Drop", synopsis: "Take action with your local Indivisible chapter Join the banner drop to expose Trump’s ties", description: "Indivisible chapters are running overpass banner drops with the \"Honk to Dump Trump\" and \"Trump ❤️ Epstein\" twin-banner format. Search your local Indivisible chapter for the next slot.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", location: "National", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://www.mobilize.us/indivisible/", topImageUrl: "https://mobilizeamerica.imgix.net/uploads/organization_social/Indivisible%20Protest_20220613182827829964.png?w=1200&h=628&fit=crop&bg=FFF", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 3 }, adminApproved: false },

  // ── Grassroots-Fun batch 3 (May 17): 12 net-new cards. 9 rows from the
  // user's paste were exact-URL duplicates of cards already in the database
  // and were silently skipped.
  { id: 1362, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Pin: \"Unpaid Protester, Hating For Free\"", synopsis: "2.25\" pin to show your love for protesting without a paycheck", description: "A 2.25\" pin for tired-but-still-fighting Democrats: \"Unpaid Protester, Hating For Free.\" Wear it to the next No Kings rally or pin it on a tote.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "HUGRco (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/HUGRco", targetUrl: "https://www.etsy.com/listing/4463726967/not-paid-hate-for-free-anti-trump-pin", topImageUrl: "https://i.etsystatic.com/36342593/r/il/f41707/7817044311/il_1080xN.7817044311_smdg.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1363, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Pin: \"Crows Against Kings\" — Corvid Solidarity for No Kings Era", synopsis: "Hand-illustrated pin featuring crows taking on a royal crown design", description: "Hand-illustrated pinback button of a flock of crows ganging up on a tossed crown — corvid solidarity for the No Kings era. Wear it loud or tuck it on a denim jacket.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PencilIsland (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/PencilIsland", targetUrl: "https://www.etsy.com/listing/4366381414/crows-against-kings-pinback-button-no", topImageUrl: "https://i.etsystatic.com/14793879/r/il/198027/7703767710/il_1080xN.7703767710_siqr.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1364, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Retro \"Suburban Housewives Against Trump\" Buttons", synopsis: "Join the movement with retro buttons Spark conversations in your community and challenge Trump's narrative", description: "A 1950s-inspired button reclaiming the \"suburban housewife\" trope Trump kept campaigning to — wear it to a knit-in, pin it on a tote, or hand them out at PTA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CafeChaCha (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/CafeChaCha", targetUrl: "https://www.etsy.com/listing/855158042/retro-suburban-housewives-against-trump", topImageUrl: "https://i.etsystatic.com/8327952/r/il/e051fb/2520953040/il_1080xN.2520953040_rqb8.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 2 }, amplifiesGroups: ["woman"], adminApproved: false },
  { id: 1365, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Pin: \"86 47\" Botanical (Subtle Anti-Trump)", synopsis: "Botanical pin featuring the \"86 47\" code for discreet resistance", description: "Botanical-illustrated take on the \"86 47\" anti-Trump number code — subtle enough for the office, sharp enough to be unmistakable to anyone who knows.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "BlueWaveInk (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/BlueWaveInk", targetUrl: "https://www.etsy.com/listing/4306542331/8647-floral-button-subtle-anti-trump-pin", topImageUrl: "https://i.etsystatic.com/22550025/r/il/fd0b03/6915660471/il_1080xN.6915660471_ken4.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1366, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Stitch the \"Abolish ICE\" Pin (Shannon Downey Tutorial)", synopsis: "Transform your outrage into art Learn to craft a statement pin with Shannon Downey", description: "Free DIY needlepoint tutorial from craftivist Shannon Downey for stitching your own Abolish ICE pin — turn rage at the deportation raids into something you can pin on a denim jacket.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Badass Cross Stitch (Shannon Downey)", authorRole: "Independent Creator", authorLink: "https://linktr.ee/BadassCrossStitch", targetUrl: "https://linktr.ee/BadassCrossStitch", topImageUrl: "https://linktr.ee/og/image/BadassCrossStitch.jpg", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1367, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Stitch Your Own Anti-Trump Voodoo Doll (Free Pattern)", synopsis: "Channel your frustration into creativity Craft a voodoo doll to express resistance", description: "Cathartic free needlepoint pattern from Shannon Downey — stitch a tiny effigy and stick the pins yourself. Therapy plus craftivism.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Badass Cross Stitch (Shannon Downey)", authorRole: "Independent Creator", authorLink: "https://linktr.ee/BadassCrossStitch", targetUrl: "https://linktr.ee/BadassCrossStitch", topImageUrl: "https://linktr.ee/og/image/BadassCrossStitch.jpg", toneOverride: { anger: 3, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1368, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join the Joyful Menace Society", synopsis: "Craft for change with a community of resistance. Monthly projects to disrupt and create together", description: "Shannon Downey's monthly craftivist community: stitch-along assignments, harm-reduction zines, and a low-key plan for menacing the regime with fabric.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Badass Cross Stitch (Shannon Downey)", authorRole: "Independent Creator", authorLink: "https://linktr.ee/BadassCrossStitch", targetUrl: "https://linktr.ee/BadassCrossStitch", topImageUrl: "https://linktr.ee/og/image/BadassCrossStitch.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1369, category: "Act of Kindness", categoryColor: "#d97706", actionType: "Online", title: "Make a \"Yay!\" Flag for Your Window", synopsis: "Show your resistance with handmade flags Create visible joy in your community today", description: "Sew or paper-craft a Yay! flag to celebrate every protest, court win, or canceled deportation — tiny visible joy in the windows of a fascist-curious neighborhood.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Badass Cross Stitch (Shannon Downey)", authorRole: "Independent Creator", authorLink: "https://linktr.ee/BadassCrossStitch", targetUrl: "https://linktr.ee/BadassCrossStitch", topImageUrl: "https://linktr.ee/og/image/BadassCrossStitch.jpg", toneOverride: { anger: 0, comedy: 2, subversion: 1, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1370, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Free \"No Kings\" Cross-Stitch PDF", synopsis: "Download a snarky pattern to craft resistance art Perfect for your kitchen wall, stitch it before No Kings Day", description: "Free instant-download No Kings cross-stitch pattern from the OG snarky-sampler shop — stitch one for your kitchen wall before the next No Kings Day.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Subversive Cross Stitch (Julie Jackson)", authorRole: "Independent Creator", authorLink: "https://linktr.ee/subversivecrossstitch", targetUrl: "https://linktr.ee/subversivecrossstitch", topImageUrl: "https://linktr.ee/og/image/subversivecrossstitch.jpg", toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1371, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Watch & Share: Tom Morello Sings \"This Land Is Your Land\" at NYC Anti-ICE Protest", synopsis: "Tom Morello's powerful rendition at the Hands Off NYC rally—share it", description: "Tom Morello broke out the Woody Guthrie at a Hands Off NYC rally against ICE raids — share the clip to keep this protest's song alive in the algorithm.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Consequence Sound (via Tom Morello)", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@consequence", targetUrl: "https://www.tiktok.com/@consequence/video/7639124680695106829", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1372, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Boost This Hour Has 22 Minutes' Trump Book Sketch", synopsis: "Share hilarious sketches from 22 Minutes Amplify Canadian satire to challenge Trump’s narrative", description: "Canadian sketch show 22 Minutes is gleefully roasting Trump from across the border — re-post their parody bits so more people hear the laugh-from-Canada take on MAGA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "This Hour Has 22 Minutes", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@thishourhas22minutes", targetUrl: "https://www.tiktok.com/@thishourhas22minutes/video/7576736715587472660", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1373, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Re-Share the Iranian Embassy AI Memes Mocking Trump", synopsis: "Amplify the absurdity Share these AI memes to highlight global mockery of Trump's war rhetoric", description: "Iranian embassies are flooding social with AI-generated memes ridiculing Trump's war posture — a strange-bedfellows trolling moment worth reposting for the absurdity alone.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CNN (reporting on Iranian embassies)", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@cnn", targetUrl: "https://www.tiktok.com/@cnn/video/7628912004643753230", topImageKey: "org_tiktok", toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 0, energy: 2 }, adminApproved: false },
  { id: 1375, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Wear a \"Cleanup on Aisle 47\" Anti-Trump Pin", synopsis: "Show your resistance with a bold statement Wear this pin to spark conversations and unite allies", description: "A punchy pinback button that calls out the disaster Trump's making — perfect for grocery runs, town halls, or anywhere you want to make strangers smile and nod knowingly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "JennXStuff (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/JennXStuff", targetUrl: "https://www.etsy.com/shop/JennXStuff", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1376, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Wear a \"TACO TACO Man\" Anti-Trump Button / Keychain", synopsis: "Show your resistance with humor Spread the message every time you wear it", description: "Trump ranted about \"tacos\" at a rally and the internet turned it into resistance merch. Clip the keychain to your bag or wear the button — every time someone asks, you get to explain.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "EpicWaresGifts (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/EpicWaresGifts", targetUrl: "https://www.etsy.com/shop/EpicWaresGifts", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1377, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Wear an \"Impeach Noem\" 2.25\" Pin", synopsis: "Show your resistance with this bold statement. Perfect for rallies, meetings, or everyday wear", description: "Kristi Noem bragged about shooting her dog. This pin keeps the pressure on — wear it to anything where her future political ambitions might come up.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "IntoTheEyeMerch (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/IntoTheEyeMerch", targetUrl: "https://www.etsy.com/shop/IntoTheEyeMerch", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1378, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Slap an Anti-Trump Champagne Label on the Bottle for \"When He Drops\"", synopsis: "Celebrate the moment with a custom label Bring your own bubbly to the next resistance gathering", description: "A custom champagne label designed for the future celebration — bring a bottle to your next resistance gathering and save it for the toast. Subversive, bubbly, and completely legal.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "UncorkedLabels (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/UncorkedLabels", targetUrl: "https://www.etsy.com/shop/UncorkedLabels", toneOverride: { anger: 0, comedy: 3, subversion: 3, hope: 3, energy: 1 }, adminApproved: false },
  { id: 1379, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Wear an \"It's Like a Coup With Morons\" Pin", synopsis: "Show your resistance in style Spark conversations and spread awareness", description: "Five words that perfectly summarize the whole situation. Slap it on your lapel and let strangers do a double-take before they start nodding in agreement.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "AntiTrumpResistance (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/AntiTrumpResistance", targetUrl: "https://www.etsy.com/shop/AntiTrumpResistance", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1380, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Stick a \"Mars Can Keep Him\" Anti-Elon Bumper Sticker on Your Car", synopsis: "Join the movement against corporate greed Make your stance clear at the next protest", description: "Elon bought himself a rocket ship and a government department. This sticker offers one suggestion for what to do with both. Slap it on your bumper before the next Tesla protest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "TacoDogDesign (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/TacoDogDesign", targetUrl: "https://www.etsy.com/shop/TacoDogDesign", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1381, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Stitch the Free #FuckICE Cross-Stitch Pattern from Feline & Floss", synopsis: "Craft a statement against ICE Download the pattern and start stitching now", description: "Free cross-stitch pattern from Feline & Floss — stitch it into a jacket patch, a protest banner, or your own wall. Download it on Ko-fi and start stitching.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Feline & Floss (Ko-fi)", authorRole: "Independent Creator", authorLink: "https://ko-fi.com/felineandfloss", targetUrl: "https://ko-fi.com/felineandfloss", topImageUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:v2hwso5qpqpdftob6yy6raqp/bafkreifjzru5aul65nfqbsaj3bowcj3jwkwudd5obyqbewcn3tghg2vjvq", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1382, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Color Through Trump 2.0 with Fresh Prints' Anti-Trump Resistance Coloring Book", synopsis: "Unleash creativity while processing the impact of Trump’s presidency Join others in a mindful coloring experience", description: "A full coloring book for working through your feelings about the MAGA era with colored pencils. Great for kids and adults who need a break from their phones.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Fresh Prints Design (Etsy)", authorRole: "Independent Creator", authorLink: "https://www.etsy.com/shop/FreshPrintsDesign", targetUrl: "https://www.etsy.com/shop/FreshPrintsDesign", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 3, energy: 1 }, adminApproved: false },
  { id: 1383, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Build (and Whack) a Trumpiñata with Carlyn Yandle's Collaborative How-To", synopsis: "Create a symbol of resistance with this DIY guide from artist Carlyn Yandle", description: "Artist Carlyn Yandle's step-by-step guide to building a Trump piñata — perfect for a protest prep party, a neighborhood block gathering, or just your living room ceiling.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Carlyn Yandle (Substack)", authorRole: "Independent Creator", authorLink: "https://carlynyandle.substack.com", targetUrl: "https://carlynyandle.substack.com", topImageUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:isenjin5dqu44uf5wtwar7ao/bafkreicgdbk6l6xbl2ixks2iyixv2yj3jh6rewwdurjuvvlxobg7776eoi", toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1384, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Follow BAD Stitch on Bluesky for Subversive Anti-Trump Cross-Stitch", synopsis: "Join Amanda DeLong's BAD Stitch community for unique anti-Trump patterns and craftivism tips", description: "Amanda DeLong's BAD Stitch account drops regular anti-Trump cross-stitch patterns and finished pieces — follow for pattern releases, technique tips, and craftivism community.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "BAD Stitch / Amanda DeLong (Bluesky)", authorRole: "Independent Creator", authorLink: "https://bsky.app/profile/badstitch.bsky.social", targetUrl: "https://bsky.app/profile/badstitch.bsky.social", topImageUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:exbra7bwy7faa2fzlwoum6f7/bafkreiattgw5eh3xx6x2yiojeq4lh724ixzy7ancwkozzj5vlp6zbpvmaq", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1385, category: "Act of Kindness", categoryColor: "#d97706", actionType: "Online", title: "Boost \"Pardon Me, Mr. Trump!\" — mockpolitrick's Parody Song About Trump's Pardon Spree", synopsis: "Share this viral parody on TikTok Expose the absurdity of Trump's pardon spree", description: "A pitch-perfect parody of Trump's pardon party — mockpolitrick nails the absurdity and the tune is genuinely catchy. Share the TikTok to get it into someone else's algorithm today.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "mockpolitrick (TikTok)", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@mockpolitrick", targetUrl: "https://www.tiktok.com/@mockpolitrick", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1386, category: "CRAFTING", categoryColor: "#c34e00", actionType: "Online", title: "Download Free Craftivism Patterns from The Morning Crafter", synopsis: "Stitch your resistance with free patterns Join The Morning Crafter's movement for change", description: "The Morning Crafter drops free downloadable cross-stitch and embroidery patterns with a resistance bent — follow the TikTok and grab the pattern packs to stitch something political.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Morning Crafter (TikTok)", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@themorningcrafter", targetUrl: "https://www.tiktok.com/@themorningcrafter", topImageUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:qxnyueeraquon7hdvjfhcbn3/bafkreiaze4uc4smf6hfzgbskhb5xnoxedbgplvz2ic7nxmldp3ctos4bmu", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 1 }, adminApproved: false },
  { id: 1387, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Stick a \"Swasticar\" Sticker Sheet on Your Laptop, Water Bottle, and Car", synopsis: "Make a statement with bold stickers Highlight the troubling connections at Tesla events", description: "FedUpStudio's \"Swasticar\" sticker sheet calls out the visual parallel people keep spotting at Tesla lots and Musk events. Cover your gear in it and let it do the talking.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "FedUpStudio (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/FedUpStudio", targetUrl: "https://www.etsy.com/shop/FedUpStudio", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1388, category: "Represent", categoryColor: "#b45309", actionType: "Online", title: "Hang a \"Things I Trust More Than Donald Trump\" Banner from Your Porch", synopsis: "Make your stance visible Spark conversations in your community", description: "A porch banner for the long game — hang it outside and let the whole neighborhood know exactly where you stand. Ships via PrintingUSA on Etsy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PrintingUSA (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/PrintingUSA", targetUrl: "https://www.etsy.com/shop/PrintingUSA", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1389, category: "ART/PERFORMANCE ART", categoryColor: "#896312", actionType: "Online", title: "Drop a \"Nikola Protests Tesla\" Banner Alongside the Tesla T Party", synopsis: "Join artists and activists to create powerful visuals Coordinate a banner drop at your local Tesla dealership", description: "Independent artist Bruce S. is making protest banners for Tesla T Party demonstrations — follow on Bluesky to coordinate a drop at a Tesla dealership near you and add some visual flair to the picket line.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bruce S. (Bluesky)", authorRole: "Independent Creator", authorLink: "https://bsky.app/search?q=nikola+protests+tesla", targetUrl: "https://bsky.app/search?q=nikola+protests+tesla", topImageKey: "org_tesla-takedown", imageContain: true, toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },

  // ── Inbox import batch 2026-05-26 — Etsy/Bluesky/TikTok craftivism + flash mobs ──
  // All adminApproved: false per inbox-import rules. Tier=Grassroots-Fun unless noted.
  { id: 1390, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Wear an \"If You're Not Outraged You're Not Paying Attention\" Anti-Trump Button", synopsis: "Classic 1.25\"/2.25\" pinback from PlushBot, a 5-star Etsy favorite", description: "Beloved Etsy maker PlushBot (11.6k 5-star reviews) makes the classic 1.25\"/2.25\" pinback — pin it on a jacket, backpack, or tote as a daily quiet-loud reminder that complacency is not an option.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PlushBot (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/PlushBot", targetUrl: "https://www.etsy.com/listing/554981533/", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1391, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Rock the \"He's On The List, He Didn't Win, He Wasn't Shot\" Anti-Trump Pin Set", synopsis: "1.25\" anti-Trump pin from TheTwistedTrinkets — starts tough conversations", description: "Etsy maker TheTwistedTrinkets stamps out a brutally layered 1.25\" pin ($1.95) — the Epstein-files reference, the popular-vote loss, and the assassination myth on one wearable. Subtle, savage, conversation-starting.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "TheTwistedTrinkets (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/TheTwistedTrinkets", targetUrl: "https://www.etsy.com/listing/4362300191/", toneOverride: { anger: 3, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1392, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Wear a \"Hold Trump Accountable — Tired Democrat Activist\" Pin", synopsis: "Pinback button from OneHorseShyHandmade to spark conversations everywhere", description: "OneHorseShyHandmade's Hold Trump Accountable pinback button ($3.85) is built for the exhausted-but-still-furious. A tiny, repeated visual statement to wear on bags and lapels.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "OneHorseShyHandmade (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/OneHorseShyHandmade", targetUrl: "https://www.etsy.com/listing/1181078926/", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1393, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Pin On a BadKittyButtons \"Trump Prison / No Kings / Hands Off\" Resistance Button", synopsis: "Choose from four bold messages on a button or magnet for your gear", description: "BadKittyButtons (9.8k 5-star reviews) makes a multi-text anti-Trump button or magnet — pick your message (\"Trump Prison,\" \"No Kings,\" \"Hands Off,\" \"Protect Our Rights\") and slap it on a fridge, car, or backpack.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "BadKittyButtons (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/BadKittyButtons", targetUrl: "https://www.etsy.com/listing/4380069664/", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1394, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Wear the \"86 47 Save the World\" Impeach Trump Pin", synopsis: "ButtonRepublic's pin blends restaurant slang with a message for change", description: "ButtonRepublic's '86 47' impeach-Trump pinback (8.1k reviews) uses restaurant-industry slang ('86' = get rid of) plus '47' for the 47th president. A coded message that lets you spread the word in plain sight.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ButtonRepublic (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/ButtonRepublic", targetUrl: "https://www.etsy.com/listing/4484781251/", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1395, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Personalize a \"Springsteen No Kings Tour\" Button For Your Show Stop", synopsis: "Order custom \"No Kings Tour\" buttons to rock at your concert", description: "An Etsy maker offers personalized Bruce Springsteen \"No Kings Tour\" buttons and magnets — pair Boss-fandom with anti-authoritarian protest as Springsteen calls out the Trump admin from his stadium stages. Bring one to your tour date.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent Etsy seller", authorRole: "Resistance Merch", targetUrl: "https://www.etsy.com/listing/4471130357/", toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 3, energy: 3 }, adminApproved: false },
  { id: 1396, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Slap a \"Flaming Cybertruck\" Satirical Sticker On Your Stuff", synopsis: "Vinyl sticker of a flaming Cybertruck, perfect for any surface", description: "An Etsy seller's funny anti-techbro decal shows the Cybertruck going up in flames — a wearable statement on Musk and DOGE without saying a word. Vinyl waterproof for water bottles, laptops, and bumpers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent Etsy seller", authorRole: "Resistance Merch", targetUrl: "https://www.etsy.com/listing/4413062086/", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1397, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Stitch a \"No Kings\" Anti-Trump Resistance Cross-Stitch Pattern", synopsis: "Download a PDF to create your own anti-Trump cross-stitch art", description: "Downloadable PDF cross-stitch chart from an Etsy crafter — pick up the needle and embroider a No Kings panel for your wall, bag, or tote. Slow craft, sharp message.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent Etsy seller", authorRole: "Resistance Merch", targetUrl: "https://www.etsy.com/listing/4321570742/", toneOverride: { anger: 2, comedy: 1, subversion: 3, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1398, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Stitch the \"Welcome Unless You Voted For Trump\" Subversive Cross Stitch Kit", synopsis: "Floral cross stitch kit with all the supplies for your front door", description: "Julie Jackson's iconic Subversive Cross Stitch brand sells the floral \"Welcome Unless You Voted For Trump\" kit — needle, floss, pattern, and that's-going-on-the-front-door energy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Subversive Cross Stitch (Julie Jackson)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/subversivecrossstitchUS", targetUrl: "https://www.etsy.com/listing/4356352000/", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1399, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Pin a \"No Kings, No ICE\" Peace Sign Flower Button", synopsis: "Etsy flower button with a peace sign, targeting Trump and ICE directly", description: "An Etsy maker's anti-authoritarian flower-peace button hits Trump and ICE in one wearable design. Hippie aesthetic, modern target.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent Etsy seller", authorRole: "Resistance Merch", targetUrl: "https://www.etsy.com/listing/4471500419/", toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1400, category: "Join a Group", categoryColor: "#4a7d8a", actionType: "Online", title: "Join the Resistance Knitters Bluesky Community", synopsis: "Patterns and action plans shared on Bluesky by fellow knitters", description: "Resistance Knitters started in Trump 1.0 fighting fascism with craftivism — they're back on Bluesky sharing patterns, journalism, and knitted-into-action plans against the Trump 2.0 era. Knit a hat, share the cause.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistance Knitters", authorRole: "Movement Organization", authorLink: "https://bsky.app/profile/resistanceknitters.bsky.social", targetUrl: "https://bsky.app/profile/resistanceknitters.bsky.social", toneOverride: { anger: 1, comedy: 1, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1401, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Color Your Way Through Resistance With Fresh Prints's Anti-Trump Coloring Book", synopsis: "No-Kings-themed coloring book from @freshprintsdesign on Etsy", description: "Bluesky's @freshprintsdesign sells a No-Kings-themed anti-Trump resistance coloring book on Etsy — protest art, calm-the-nerves coloring, and gift-able resistance you can spread at any meeting or march.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Fresh Prints Handmade", authorRole: "Resistance Merch", authorLink: "https://bsky.app/profile/freshprintsdesign.bsky.social", targetUrl: "https://freshprintshandmade.etsy.com/", toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 1 }, adminApproved: false },
  { id: 1402, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Download Feline And Floss's Free \"F*ck ICE\" Cross Stitch Pattern", synopsis: "Free anti-ICE cross-stitch pattern from indie creator Feline And Floss", description: "Indie cross-stitcher Feline And Floss put a free 'F*ck ICE' pattern up on Ko-fi — anti-ICE craftivism with no paywall. Stitch it on a hoop, frame it, gift it to a friend.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Feline And Floss", authorRole: "Independent Creator", authorLink: "https://bsky.app/profile/felineandfloss.bsky.social", targetUrl: "https://ko-fi.com/felineandfloss", toneOverride: { anger: 3, comedy: 2, subversion: 3, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1403, category: "Flash Mob", categoryColor: "#d4516a", actionType: "In Person Group", title: "Flash Mob \"Do You Hear the People Sing\" at Every Trump Protest", synopsis: "Join theater lovers nationwide to flash mob at every Trump protest", description: "After the Army Chorus sang Les Mis at Trump's White House Governors Ball, Bluesky user @melungdoc called on theatre people everywhere to flash-mob \"Do You Hear the People Sing\" (a song of rising up against tyranny) at every rally, protest, and Trump-adjacent event.", isOnline: false, location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "@melungdoc (Bluesky)", authorRole: "Citizen Activist", authorLink: "https://bsky.app/profile/melungdoc.bsky.social", targetUrl: "https://bsky.app/profile/melungdoc.bsky.social", toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 3, energy: 3 }, adminApproved: false },
  { id: 1404, category: "Flash Mob", categoryColor: "#d4516a", actionType: "Online", title: "Coordinate a Global \"I Fought the Law\" Cellphone Flash Mob", synopsis: "Set a time to blast 'I Fought the Law' and shout 'Impeach Trump", description: "Bluesky user @ardenbarden proposed a worldwide anti-Trump flash mob: at a set date/time everyone blasts 'I Fought the Law' from their phones, then screams 'Impeach Trump Now' at the end. Pick a time, spread the word, set off the alarm.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "@ardenbarden (Bluesky)", authorRole: "Citizen Activist", authorLink: "https://bsky.app/profile/ardenbarden.bsky.social", targetUrl: "https://bsky.app/profile/ardenbarden.bsky.social", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 2, energy: 3 }, adminApproved: false },
  { id: 1405, category: "Art/Performance Art", categoryColor: "#8b6f47", actionType: "In Person Group", title: "Make a \"Tesla T Party\" Anti-Musk Activist Art Sign", synopsis: "Download templates for eye-catching protest signs against Tesla's impact", description: "Bluesky artist @bmschech turns Tesla-takedown signage into reusable activist art — the 'Tesla T Party' and 'Nikola Protests Tesla' visuals are perfect templates for your own banner, sign, or projection at a Tesla showroom protest.", isOnline: false, location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "@bmschech (Bluesky)", authorRole: "Independent Creator", authorLink: "https://bsky.app/profile/bmschech.bsky.social", targetUrl: "https://bsky.app/profile/bmschech.bsky.social", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1406, category: "Art/Performance Art", categoryColor: "#8b6f47", actionType: "Online", title: "Submit a Handmade Trump Portrait to Michael Moore's Open Call", synopsis: "Submit your artwork to Michael Moore's crowdsourced Trump portrait project", description: "Michael Moore put out a public call on Substack for handmade Trump portraits — weaving, embroidery, painting, mixed media, you choose. Crowdsourced presidential portraiture as protest. Make one, send it in.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Michael Moore", authorRole: "Independent Creator", authorLink: "https://open.substack.com/pub/michaelmoore", targetUrl: "https://open.substack.com/pub/michaelmoore", toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1407, category: "Crafting", categoryColor: "#c34e00", actionType: "In Person Group", title: "Attend Indivisible NEO's \"Tricks, Treats & Craftivism\" No Kings Sign-Making Party", synopsis: "Make signs for the November protests while enjoying snacks and fun", description: "Indivisible Northeast Ohio is throwing a Halloween-themed No Kings sign-making party at West Shore Unitarian Universalist Church on Oct 11 — costume optional, snacks provided, signs made for the November protest cycle. Sweet community + sharp craftivism.", isOnline: false, location: "Ohio", boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible NEO", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/indivisibleneo/", targetUrl: "https://www.mobilize.us/indivisibleneo/", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 3, energy: 3 }, adminApproved: false },
  { id: 1408, category: "Social Media", categoryColor: "#b84545", actionType: "Online", title: "Boost @mockpolitrick's \"Pardon Me, Mr. Trump\" 2025 Pardon Spree Parody Song", synopsis: "Savage parody of Trump's 2025 pardon spree — share and duet widely", description: "TikTok creator @mockpolitrick wrote a savage parody song about Trump's 2025 pardon spree — the Proud Boys, Ross Ulbricht, the Silk Road crew, the whole list. Share, duet, post the link in your group chats.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "@mockpolitrick (TikTok)", authorRole: "Independent Creator", authorLink: "https://www.tiktok.com/@mockpolitrick", targetUrl: "https://www.tiktok.com/@mockpolitrick", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1409, category: "Art/Performance Art", categoryColor: "#8b6f47", actionType: "Online", title: "Play & Spread Secret Handshake's Anti-Trump Iran War Satirical Video Game", synopsis: "Satirical video game from Secret Handshake pokes fun at Trump’s Iran war", description: "Activist group Secret Handshake released a satirical video game mocking the Trump administration's handling of the Iran war — covered by the Rachel Maddow Show. Play it, share it, use it as group-hangout material.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Secret Handshake", authorRole: "Movement Organization", authorLink: "https://www.tiktok.com/@msnow", targetUrl: "https://www.msnbc.com/rachel-maddow-show", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 }, adminApproved: false },
  { id: 1410, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Make a Morse-Code \"Fuck Trump\" Handknit", synopsis: "Stitch a secret message with Morse code in cozy, wearable art", description: "Bluesky knitter @so-called-panda is teaching the trick of stitching coded anti-Trump messages into garments using Morse code patterns — wear the message in plain sight, only the in-group decodes it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "@so-called-panda (Bluesky)", authorRole: "Independent Creator", authorLink: "https://bsky.app/profile/so-called-panda.bsky.social", targetUrl: "https://bsky.app/profile/so-called-panda.bsky.social", toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1411, category: "Crafting", categoryColor: "#c34e00", actionType: "Online", title: "Wear Clip-On Earrings From @rollinrockabilly's Anti-Trump Earring Line", synopsis: "Handmade clip-on earrings from Etsy that say \"no\" to Trump", description: "Bluesky/Etsy craftivist @rollinrockabilly handmakes anti-Trump-themed clip-on earrings and ear weights — wearable craftivism for ears, easy to swap depending on the audience and venue.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "@rollinrockabilly (Bluesky/Etsy)", authorRole: "Resistance Merch", authorLink: "https://bsky.app/profile/rollinrockabilly.bsky.social", targetUrl: "https://bsky.app/profile/rollinrockabilly.bsky.social", toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 2 }, adminApproved: false },
];

// ─── Seed receipts (The Smacks) ───────────────────────────────────────────────
// IDs start at 5001 to avoid collisions with admin-created receipts.
// Bump seed:receipts version key whenever you add/edit entries here.
// SEED_RECEIPTS is only needed for smacks that require KV-side metadata
// (e.g. server-controlled hiding, boost counts seeded at a specific value).
// Static smacks that are always visible live in STATIC_SMACKS in SmacksPage.tsx.
// IDs must not overlap with STATIC_SMACKS (5001–5031); use 5500+ here.
const SEED_RECEIPTS: Array<{
  id: number; title: string; tags: string[];
  imageUrl: string; caption?: string; adminApproved: boolean;
}> = [];

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/make-server-9eb1ae04/health", (c) => c.json({ status: "ok" }));

// ─── AUTH: Status — verify JWT & return/create approval record ────────────────
app.get("/make-server-9eb1ae04/auth/status", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "No token provided" }, 401);

    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    // First /auth/status call after deploy reconciles all existing records
    // against the admin allowlist. Cheap on subsequent calls (just a flag read).
    await sweepAdminAllowlistOnce();

    const approval = await ensureApprovalRecord(user);

    // Update visit streak server-side so it persists across devices/browsers.
    const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    const streakKv = await kv.get(`streak:${user.id}`) as { count: number; lastVisit: string } | null;
    let streakCount = 1;
    if (!streakKv) {
      await kv.set(`streak:${user.id}`, { count: 1, lastVisit: todayKey });
    } else if (streakKv.lastVisit === todayKey) {
      streakCount = streakKv.count;
    } else {
      const [ay, am, ad] = streakKv.lastVisit.split("-").map(Number);
      const [by, bm, bd] = todayKey.split("-").map(Number);
      const gap = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
      streakCount = gap === 1 ? streakKv.count + 1 : 1;
      await kv.set(`streak:${user.id}`, { count: streakCount, lastVisit: todayKey });
    }

    return c.json({ approval, streak: streakCount });
  } catch (err) {
    console.log("Auth status error:", err);
    return c.json({ error: `Status check failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Manually re-run the allowlist sweep ───────────────────────────────
app.post("/make-server-9eb1ae04/admin/sweep", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const result = await sweepAdminAllowlist();
    console.log(
      `Admin ${admin.record.name} ran allowlist sweep: ` +
      `${result.demoted.length} demoted, ${result.promoted.length} promoted`
    );
    return c.json(result);
  } catch (err) {
    return c.json({ error: `Sweep failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Sync Supabase auth users → KV approval records ───────────────────
// Lists every Supabase auth user and seeds a pending KV record for anyone who
// signed up but whose /auth/status call never completed (network blip, cold
// start, etc.). Safe to run repeatedly — skips users who already have a record.
app.post("/make-server-9eb1ae04/admin/sync-auth-users", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const sb = adminClient();

    // Fetch all Supabase auth users (up to 1000)
    const { data: authData, error: authErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
    if (authErr) return c.json({ error: `Failed to list auth users: ${authErr.message}` }, 500);
    const authUsers = authData?.users ?? [];

    // Fetch existing KV records
    const existing = await kv.getByPrefix("user:approval:") as any[];
    const knownIds = new Set(existing.filter(Boolean).map((r: any) => r.userId));

    const seeded: { email: string; name: string }[] = [];
    const alreadyHad: number = knownIds.size;

    for (const u of authUsers) {
      if (knownIds.has(u.id)) continue;
      const record = {
        userId: u.id,
        email: u.email ?? "",
        name:
          u.user_metadata?.full_name ??
          u.user_metadata?.name ??
          u.email?.split("@")[0] ??
          "Resistor",
        avatar: u.user_metadata?.avatar_url ?? null,
        status: isAdminEmail(u.email) ? "approved" : "pending",
        isAdmin: isAdminEmail(u.email),
        provider: u.app_metadata?.provider ?? "email",
        createdAt: u.created_at ?? new Date().toISOString(),
      };
      await kv.set(`user:approval:${u.id}`, record);
      seeded.push({ email: record.email, name: record.name });
    }

    console.log(`Auth sync by ${admin.record.name}: ${authUsers.length} auth users, ${alreadyHad} already in KV, ${seeded.length} seeded`);
    return c.json({ authTotal: authUsers.length, alreadyHad, seeded });
  } catch (err) {
    return c.json({ error: `Sync failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Scan all KV cards for truncated descriptions ─────────────────────
app.get("/make-server-9eb1ae04/admin/scan-truncated", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const truncated: { id: number; store: string; title: string; description: string; targetUrl?: string }[] = [];

    // Scan action: (seed) cards
    const actionEntries = await kv.getByPrefix("action:");
    for (const card of actionEntries as any[]) {
      if (card && typeof card.description === "string" && card.description.trimEnd().endsWith("...")) {
        truncated.push({ id: card.id, store: "action", title: card.title, description: card.description, targetUrl: card.targetUrl });
      }
    }

    // Scan user-action: (submitted) cards
    const userActionEntries = await kv.getByPrefix("user-action:");
    for (const card of userActionEntries as any[]) {
      if (card && typeof card.description === "string" && card.description.trimEnd().endsWith("...")) {
        truncated.push({ id: card.id, store: "user-action", title: card.title, description: card.description, targetUrl: card.targetUrl });
      }
    }

    truncated.sort((a, b) => a.id - b.id);
    return c.json({ count: truncated.length, cards: truncated });
  } catch (err) {
    return c.json({ error: `Scan failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Patch a card's description in KV (for fixing truncated descriptions) ──
app.post("/make-server-9eb1ae04/admin/fix-description", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json().catch(() => null);
    if (!body || !body.id || !body.description) {
      return c.json({ error: "Required: id (number) and description (string)" }, 400);
    }

    const id = Number(body.id);
    let key = `action:${id}`;
    let existing: any = await kv.get(key);
    if (!existing) {
      key = `user-action:${id}`;
      existing = await kv.get(key);
    }
    if (!existing) return c.json({ error: `Card ${id} not found in KV` }, 404);

    await kv.set(key, { ...existing, description: String(body.description) });
    console.log(`Admin ${admin.record.name} fixed description for card ${id}`);
    return c.json({ ok: true, id, key });
  } catch (err) {
    return c.json({ error: `Fix failed: ${err}` }, 500);
  }
});

// ─── ADMIN: Approved cards missing a targetUrl ───────────────────────────────
// ─── ADMIN: User-submitted cards missing a targetUrl ─────────────────────────
// Returns user-action cards that have no targetUrl so the admin can find and
// add the correct action link. authorLink (author homepage) is shown for
// context but is a separate field.
app.get("/make-server-9eb1ae04/admin/actions/missing-url", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const results: any[] = [];
    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      const card = await kv.get(`user-action:${id}`) as any;
      if (card && typeof card === "object" && !card.targetUrl && !card.pinToTop) {
        results.push({
          id: card.id,
          title: card.title,
          category: card.category,
          authorName: card.authorName,
          authorLink: card.authorLink ?? null,
          adminApproved: card.adminApproved,
        });
      }
    }
    results.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    return c.json({ count: results.length, cards: results });
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

app.get("/make-server-9eb1ae04/admin/actions/no-url", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    // ?filter=url   → only cards missing targetUrl
    // ?filter=image → only cards missing all image fields
    // (default)     → both (legacy behaviour, kept for backwards compat)
    const filter = c.req.query("filter") ?? "all"; // "url" | "image" | "all"

    // A card has an image if any image field is set. cartoonImageUrl may still
    // carry the pre-CDN local path (/cartoon-banners/card-N.webp) in KV, but
    // the client resolves it through the cartoon manifest to the CDN URL, so
    // any non-null value means the card has a cartoon and is visually complete.
    const hasImage = (card: any) =>
      !!(card.topImageUrl || card.topImageKey || card.cartoonImageUrl);

    const matches = (card: any) => {
      if (!card || typeof card !== "object") return false;
      if (card.adminApproved !== true) return false;
      const noUrl   = !card.targetUrl;
      const noImage = !hasImage(card);
      if (filter === "url")   return noUrl;
      if (filter === "image") return noImage;
      return noUrl || noImage; // "all"
    };

    const missing: any[] = [];

    for (const card of (await kv.getByPrefix("action:")) as any[]) {
      if (matches(card) && !card.pinToTop) {
        missing.push({ ...card, _store: "action" });
      }
    }

    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      const card = await kv.get(`user-action:${id}`) as any;
      if (matches(card)) {
        missing.push({ ...card, _store: "user-action" });
      }
    }

    missing.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return c.json({ cards: missing });
  } catch (err) {
    return c.json({ error: `Failed to fetch no-url cards: ${err}` }, 500);
  }
});

// ─── ADMIN: List all users ─────────────────────────────────────────────────────
app.get("/make-server-9eb1ae04/admin/users", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const users = await kv.getByPrefix("user:approval:");
    const list = (users as any[]).filter((u) => u && typeof u === "object" && u.userId);

    // One direct table scan over the complete:* prefix avoids N round-trips
    // and exposes the key (the kv helper hides it). Build per-user totals
    // and the most-recent completedAt so the admin list can show a tier chip
    // + "active 3 days ago" inline without a follow-up request.
    const sb = adminClient();
    const { data: completionRows } = await sb
      .from("kv_store_9eb1ae04")
      .select("key, value")
      .like("key", "complete:%");

    const totalByUser:      Record<string, number> = {};
    const lastActiveByUser: Record<string, string> = {};
    for (const row of completionRows ?? []) {
      // Key format: `complete:{userId}:{actionId}`
      const parts = String(row.key).split(":");
      if (parts.length < 3) continue;
      const uid = parts[1];
      totalByUser[uid] = (totalByUser[uid] ?? 0) + 1;
      const t = row.value?.completedAt;
      if (t && (!lastActiveByUser[uid] || String(t).localeCompare(lastActiveByUser[uid]) > 0)) {
        lastActiveByUser[uid] = String(t);
      }
    }

    // Fetch email consent from auth user metadata (stored at sign-up).
    const consentByUser: Record<string, boolean | null> = {};
    try {
      const { data: authUsers } = await sb.auth.admin.listUsers({ perPage: 1000 });
      for (const u of authUsers?.users ?? []) {
        consentByUser[u.id] = u.user_metadata?.emailConsent ?? null;
      }
    } catch { /* non-fatal — consent column stays null */ }

    const enriched = list.map((u) => ({
      ...u,
      totalActions: totalByUser[u.userId] ?? 0,
      lastActiveAt: lastActiveByUser[u.userId] ?? null,
      emailConsent: consentByUser[u.userId] ?? null,
    }));

    // Sort by last-active DESC by default; users with no activity fall to the
    // bottom but stay in original signup order.
    enriched.sort((a, b) => {
      if (a.lastActiveAt && b.lastActiveAt) return b.lastActiveAt.localeCompare(a.lastActiveAt);
      if (a.lastActiveAt) return -1;
      if (b.lastActiveAt) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return c.json({ users: enriched });
  } catch (err) {
    console.log("Admin users error:", err);
    return c.json({ error: `Failed to list users: ${err}` }, 500);
  }
});

// ─── ADMIN: Who's online right now ────────────────────────────────────────────
// Reads `user:last-seen:*` (written by `getUser` on every authenticated
// request) and joins with `user:approval:{userId}` for display fields.
// "Online" = last-seen within `windowMinutes` (default 1440 = 24h). Cap is
// 1 week (10 080 min) so an admin can scan recent-but-not-current activity.
app.get("/make-server-9eb1ae04/admin/online-users", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const windowMinutes = Math.max(1, Math.min(10_080, parseInt(c.req.query("windowMinutes") ?? "1440", 10) || 1440));
    const cutoffMs = Date.now() - windowMinutes * 60_000;

    const sb = adminClient();
    const { data: rows } = await sb
      .from("kv_store_9eb1ae04")
      .select("key, value")
      .like("key", "user:last-seen:%");

    const online: Array<{ userId: string; lastSeenAt: string }> = [];
    for (const row of rows ?? []) {
      const userId = String(row.key).slice("user:last-seen:".length);
      const iso = typeof row.value === "string" ? row.value : row.value?.at;
      if (!iso) continue;
      const ms = Date.parse(iso);
      if (isNaN(ms) || ms < cutoffMs) continue;
      online.push({ userId, lastSeenAt: iso });
    }

    // Hydrate with display fields from the approval record.
    const enriched = await Promise.all(online.map(async (entry) => {
      const record = await kv.get(`user:approval:${entry.userId}`) as any;
      return {
        userId: entry.userId,
        lastSeenAt: entry.lastSeenAt,
        name: record?.name ?? "Resistor",
        email: record?.email ?? "",
        avatar: record?.avatar ?? null,
        isAdmin: !!record?.isAdmin,
        status: record?.status ?? "pending",
      };
    }));

    enriched.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return c.json({ users: enriched, windowMinutes, count: enriched.length });
  } catch (err) {
    console.log("Admin online-users error:", err);
    return c.json({ error: `Failed to list online users: ${err}` }, 500);
  }
});

// ─── ADMIN: Anonymous activity feed ──────────────────────────────────────────
// Returns a reverse-chronological list of anonymous "I did this" completions
// from the `anon:complete:{ts}:{actionId}` audit log within `windowMinutes`
// (default 1440 = 24h, cap 1 week = 10 080). Powers the Online tab's
// "Not-logged-in activity" section so admins can see what unsigned visitors
// are actually doing — totals from card.completions don't tell that story.
app.get("/make-server-9eb1ae04/admin/anon-online", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const windowMinutes = Math.max(1, Math.min(10_080, parseInt(c.req.query("windowMinutes") ?? "1440", 10) || 1440));
    const cutoffMs = Date.now() - windowMinutes * 60_000;

    const sb = adminClient();
    const { data: rows } = await sb
      .from("kv_store_9eb1ae04")
      .select("key, value")
      .like("key", "anon:complete:%");

    const events: Array<{ completedAt: string; actionId: number; title: string | null; category: string }> = [];
    for (const row of rows ?? []) {
      const v = row.value as any;
      const iso = v?.completedAt;
      if (!iso) continue;
      const ms = Date.parse(iso);
      if (isNaN(ms) || ms < cutoffMs) continue;
      events.push({
        completedAt: iso,
        actionId: Number(v.actionId),
        title: v.title ?? null,
        category: v.category ?? "OTHER",
      });
    }
    events.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    return c.json({ events, windowMinutes, count: events.length });
  } catch (err) {
    console.log("Admin anon-online error:", err);
    return c.json({ error: `Failed to list anon activity: ${err}` }, 500);
  }
});

// ─── ADMIN: Approve user ──────────────────────────────────────────────────────
app.post("/make-server-9eb1ae04/admin/approve/:userId", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const targetId = c.req.param("userId");
    const record = await kv.get(`user:approval:${targetId}`) as any;
    if (!record) return c.json({ error: "User not found" }, 404);

    record.status = "approved";
    record.approvedBy = admin.user.id;
    record.approvedAt = new Date().toISOString();
    await kv.set(`user:approval:${targetId}`, record);
    console.log(`Admin approved user ${record.email}`);

    // Awaited (not fire-and-forget) so the Supabase Edge worker doesn't
    // get reaped mid-send. The Resend POST is ~200KB with the inline
    // banner, and reaping was killing the send before it completed,
    // leaving users without their welcome email. Try/catch ensures a
    // Resend hiccup never blocks the approval flow.
    try {
      await sendApprovalEmail(record);
    } catch (err) {
      console.log(`Approval email failed for ${record.email}:`, err);
    }

    return c.json({ user: record });
  } catch (err) {
    return c.json({ error: `Approval failed: ${err}` }, 500);
  }
});

// ─── Transactional email rendering ───────────────────────────────────────────
// Shared branded template used by both the "you're approved" and the
// "we got your application" emails. Email rendering is intentionally
// table-based with inline styles — that's what works across the messy
// reality of email clients (Gmail strips <style>, Outlook ignores most
// modern CSS, mobile clients vary). Width-capped at 600px, system fonts,
// brand orange (#ed6624) on the CTA, brand navy (#23297e) on the headline.
//
// The banner ships embedded as a base64 constant rather than fetched
// from a remote URL. Earlier attempts (1) used <img src="https://..."> —
// Apple Mail's privacy proxy refused to load it; (2) had the edge
// function fetch from www.resistact.org at runtime and attach inline —
// works once the JPEG is deployed to the prod frontend, but breaks when
// the file lives only on develop. Embedding the bytes here makes the
// email self-contained: no external dependencies, no deploy ordering,
// image always renders. ~206 KB of base64 — bigger source file, smaller
// surface for bugs.
const BANNER_BASE64 = "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";

const bannerAttachment = {
  content: BANNER_BASE64,
  filename: "resistact-banner.jpg",
  content_id: "banner",
  content_type: "image/jpeg",
};

function getBannerAttachment() {
  return bannerAttachment;
}

interface EmailTemplate {
  preheader: string;       // hidden, used as inbox preview text
  headline: string;        // big navy headline under the logo
  greeting: string;        // "Hi name,"
  bodyParagraphs: string[];
  cta: { label: string; url: string };
  tip?: { eyebrow: string; body: string };
}

function renderEmailHtml(t: EmailTemplate): string {
  const paragraphsHtml = t.bodyParagraphs
    .map((p) => `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:#3a3a3a;">${p}</p>`)
    .join("\n");
  const tipHtml = t.tip
    ? `<tr><td style="padding:0 32px 28px 32px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f7f7f7;border-radius:10px;">
        <tr><td style="padding:16px 18px;">
          <p style="margin:0 0 6px 0;font-size:11px;line-height:1.4;color:#8a8a8a;text-transform:uppercase;letter-spacing:1.2px;font-weight:700;">${t.tip.eyebrow}</p>
          <p style="margin:0;font-size:14px;line-height:1.5;color:#3a3a3a;">${t.tip.body}</p>
        </td></tr>
      </table>
    </td></tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>${escapeHtml(t.headline)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,'Helvetica Neue',sans-serif;color:#3a3a3a;">
<!-- preheader: hidden, shows as inbox preview text -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(t.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f7f7f7;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
        <tr>
          <td align="center" style="padding:24px 24px 8px 24px;">
            <a href="${SITE_URL}" style="text-decoration:none;border:0;">
              <img src="cid:banner" alt="ResistAct — Citizen Action — Every Action Counts" width="320" style="display:block;width:320px;max-width:80%;height:auto;border:0;outline:none;border-radius:10px;">
            </a>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:12px 32px 8px 32px;">
            <h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:800;color:#23297e;letter-spacing:-0.01em;">${escapeHtml(t.headline)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 8px 32px;">
            <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:#3a3a3a;">${escapeHtml(t.greeting)}</p>
            ${paragraphsHtml}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:12px 32px 32px 32px;">
            <a href="${t.cta.url}" style="display:inline-block;padding:14px 32px;background-color:#ed6624;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;border-radius:10px;mso-padding-alt:0;">
              <!--[if mso]>&nbsp;&nbsp;&nbsp;<![endif]-->${escapeHtml(t.cta.label)}<!--[if mso]>&nbsp;&nbsp;&nbsp;<![endif]-->
            </a>
          </td>
        </tr>
        ${tipHtml}
      </table>
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
        <tr>
          <td align="center" style="padding:16px 24px 6px 24px;">
            <p style="margin:0;font-size:12px;line-height:1.4;color:#8a8a8a;">ResistAct · <a href="${SITE_URL}" style="color:#8a8a8a;text-decoration:underline;">resistact.org</a></p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 24px 28px 24px;">
            <p style="margin:0;font-size:11px;line-height:1.5;color:#a0a0a0;">You're receiving this because you signed up at resistact.org. No tracking, no donation asks, no list you can't escape.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function renderEmailText(t: EmailTemplate): string {
  const paragraphs = t.bodyParagraphs.map((p) => stripHtml(p)).join("\n\n");
  const tipBlock = t.tip
    ? `\n\n${t.tip.eyebrow.toUpperCase()}\n${stripHtml(t.tip.body)}`
    : "";
  return `${t.greeting}

${paragraphs}

${t.cta.label}
${t.cta.url}${tipBlock}

— The ResistAct team
${SITE_URL}`;
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function sendResendEmail(args: {
  to: string;
  subject: string;
  template: EmailTemplate;
}): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.log(`Skipping email to ${args.to}: RESEND_API_KEY not set`);
    return;
  }
  if (!args.to) return;

  // Inline the banner so the image renders without the recipient's mail
  // client having to fetch it externally. The image bytes live in
  // BANNER_BASE64 above, so this is a synchronous lookup that always
  // succeeds — no deploy-ordering or proxy-fetch failure modes.
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "ResistAct <noreply@resistact.org>",
      to: args.to,
      subject: args.subject,
      html: renderEmailHtml(args.template),
      text: renderEmailText(args.template),
      attachments: [getBannerAttachment()],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

// "You're approved — welcome" — fired on auto-approval (admin allowlist)
// AND on manual /admin/approve.
async function sendApprovalEmail(record: { email: string; name?: string }): Promise<void> {
  const safeName = escapeHtml((record.name ?? "").trim() || "there");
  await sendResendEmail({
    to: record.email,
    subject: "You're approved — welcome to ResistAct",
    template: {
      preheader: "Your account is approved. Pick your first act.",
      headline: "You're in. Welcome to the resistance.",
      greeting: `Hi ${safeName},`,
      bodyParagraphs: [
        "Your ResistAct account is approved — welcome.",
        "ResistAct matches you with small, doable acts based on what you've got today: time, energy, tone, location. Five minutes of phone calls. A protest down the street. A weekend of postcard writing. You pick.",
        "<strong>Pick one. Do it. Share it. <em>Come back tomorrow.</em></strong>",
      ],
      cta: { label: "Find your first Act →", url: SITE_URL },
      tip: {
        eyebrow: "First time here?",
        body: 'Browse with the <strong>Category</strong> pills and set your <strong>Location</strong> at the top of the feed to see what fits. Then tap <strong>Refine Your Matches</strong> to dial it in by time, energy, and tone.',
      },
    },
  });
  console.log(`Approval email sent to ${record.email}`);
}

// "We got your application" — fired on new signup with status: "pending".
async function sendWaitlistEmail(record: { email: string; name?: string }): Promise<void> {
  const safeName = escapeHtml((record.name ?? "").trim() || "there");
  await sendResendEmail({
    to: record.email,
    subject: "We got your ResistAct application",
    template: {
      preheader: "Your application is in. Browse acts while we approve you.",
      headline: "We got your application.",
      greeting: `Hi ${safeName},`,
      bodyParagraphs: [
        "Thanks for signing up. We review every founding member personally and will approve you shortly — usually within a day.",
        "While you wait, you can already browse the full action catalog. Anyone can take an act on ResistAct, signed in or not.",
      ],
      cta: { label: "Browse acts →", url: SITE_URL },
      tip: {
        eyebrow: "Why we review",
        body: "We're building this slowly with a founding cohort. No tracking, no donation asks, no list you can't escape. The review is one human reading your sign-up — that's it.",
      },
    },
  });
  console.log(`Waitlist email sent to ${record.email}`);
}

// Minimal HTML-escape for interpolating user-controlled strings (e.g. names)
// into the welcome email body. Resend renders the html field as-is, so any
// user can't be allowed to inject markup into a mail their own future self
// receives.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── ADMIN: Reject user ───────────────────────────────────────────────────────
app.post("/make-server-9eb1ae04/admin/reject/:userId", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const targetId = c.req.param("userId");
    const record = await kv.get(`user:approval:${targetId}`) as any;
    if (!record) return c.json({ error: "User not found" }, 404);

    record.status = "rejected";
    record.rejectedBy = admin.user.id;
    record.rejectedAt = new Date().toISOString();
    await kv.set(`user:approval:${targetId}`, record);
    console.log(`Admin rejected user ${record.email}`);
    return c.json({ user: record });
  } catch (err) {
    return c.json({ error: `Rejection failed: ${err}` }, 500);
  }
});

// ─── GET /matcher-config — public read of admin-tuned matcher knobs ──────────
// Public so the matcher on every client can pick up the latest tuning without
// each user having to be an admin. Returns null when no admin override exists.
app.get("/make-server-9eb1ae04/matcher-config", async (c) => {
  try {
    const config = await kv.get("matcher-config:v1");
    return c.json({ config: config ?? null });
  } catch (err) {
    console.log("matcher-config read error:", err);
    return c.json({ config: null });
  }
});

// ─── PUT /admin/matcher-config — write tuned config ──────────────────────────
app.put("/make-server-9eb1ae04/admin/matcher-config", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{ categoryTone?: Record<string, Record<string, number>> }>();
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid body" }, 400);
    }
    const config = {
      categoryTone: body.categoryTone ?? {},
      updatedAt: new Date().toISOString(),
      updatedBy: admin.email ?? admin.id,
    };
    await kv.set("matcher-config:v1", config);
    console.log(`Admin ${admin.email} updated matcher-config`);
    return c.json({ config });
  } catch (err) {
    console.log("matcher-config write error:", err);
    return c.json({ error: `Failed to save: ${err}` }, 500);
  }
});

// ─── DELETE /admin/matcher-config — reset to defaults ────────────────────────
app.delete("/make-server-9eb1ae04/admin/matcher-config", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);
    await kv.del("matcher-config:v1");
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: `Reset failed: ${err}` }, 500);
  }
});

// ─── GET /actions ─────────────────────────────────────────────────────────────
app.get("/make-server-9eb1ae04/actions", async (c) => {
  try {
    // Cap raised from 100 → 2000 so the client can drain the whole catalog
    // (~600 cards as of May 2026, with room to grow) in a single request.
    // The server already loads ALL cards into `allCards` before slicing
    // (see further down), so paginating buys us nothing on the server side
    // — it only adds 5+ round-trip latencies on the client's initial sync.
    // 2000 keeps a hard ceiling so a malformed client can't ask for
    // millions and OOM the function.
    const limit  = Math.min(Number(c.req.query("limit")  ?? 20), 2000);
    const offset = Math.max(Number(c.req.query("offset") ?? 0),   0);

    // PERF: warm the migration-flag cache in a single batch read so the
    // ~41 individual getMigrationFlag() calls in the migration blocks
    // below are all Set lookups (instant) instead of separate KV
    // round-trips (~100ms each = ~4 seconds total on cold isolates).
    await warmMigrationFlagCache();

    // Seed Ellen user if not done yet
    await seedEllenUser();

    // One-time: remove fake placeholder seed cards (IDs 1–18) from the DB
    const fakePurged = await getMigrationFlag("cleanup:fake-seeds:v1");
    if (!fakePurged) {
      const fakeIds = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18];
      for (const id of fakeIds) await kv.del(`action:${id}`);
      await setMigrationFlag("cleanup:fake-seeds:v1");
      console.log("Purged fake seed cards 1–18.");
    }

    // One-time: re-purge the placeholder seed cards (ids 2–17 minus 11) that
    // were re-seeded after the v1 cleanup ran. SEED_CARDS no longer references
    // them, so deleting their KV records is final — they won't reappear.
    const fakePurgedV2 = await getMigrationFlag("cleanup:purge-fake-seeds:v2");
    if (!fakePurgedV2) {
      const ids = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17];
      for (const id of ids) await kv.del(`action:${id}`);
      await setMigrationFlag("cleanup:purge-fake-seeds:v2");
      console.log(`Purged ${ids.length} fake seed cards (v2): ${ids.join(", ")}`);
    }

    // One-time: remove dropped seed cards. Add new IDs to the array and bump
    // the version key whenever you delete cards from SEED_CARDS.
    const droppedPurged = await getMigrationFlag("cleanup:dropped-seeds:v1");
    if (!droppedPurged) {
      const droppedIds = [1136, 1185]; // Apiary repro-pledge duplicates
      for (const id of droppedIds) await kv.del(`action:${id}`);
      await setMigrationFlag("cleanup:dropped-seeds:v1");
      console.log(`Purged ${droppedIds.length} dropped seed cards.`);
    }

    // One-time: zero out boosts on the early seed cards that started with
    // `boosts: 5` placeholder values. These were carry-over from the original
    // Figma demo data. Live data writes get preserved on re-seed via the
    // merge logic below, so the seed file alone can't clear them.
    const boostsResetDone = await getMigrationFlag("cleanup:reset-boosts-5:v1");
    if (!boostsResetDone) {
      const resetIds = [8, 9, 10, 13];
      for (const id of resetIds) {
        const existing = (await kv.get(`action:${id}`)) as any;
        if (existing && typeof existing === "object") {
          await kv.set(`action:${id}`, { ...existing, boosts: 0 });
        }
      }
      await setMigrationFlag("cleanup:reset-boosts-5:v1");
      console.log(`Reset boosts to 0 on ${resetIds.length} demo cards.`);
    }

    // One-time: rewrite Blaire Erskine Substack description (id 1278). The
    // CSV-imported version was vague about why users would subscribe; the
    // updated copy makes the anti-MAGA satire connection explicit so admins
    // and users can immediately see why it's on-topic.
    const blaireUpdated = await getMigrationFlag("cleanup:blaire-substack-desc:v1");
    if (!blaireUpdated) {
      const newDesc = "The newsletter version of Blaire Erskine's deadpan-news-anchor MAGA satire — bonus fake interviews skewering Trump talking points, behind-the-scenes on her viral TikTok reels, no algorithm gating. Direct to your inbox.";
      for (const prefix of ["action:", "user-action:"]) {
        const existing = (await kv.get(`${prefix}1278`)) as any;
        if (existing && typeof existing === "object") {
          await kv.set(`${prefix}1278`, { ...existing, description: newDesc });
        }
      }
      await setMigrationFlag("cleanup:blaire-substack-desc:v1");
      console.log("Updated Blaire Erskine Substack description (id 1278).");
    }

    // One-time: clear stray `notOnTopic` flags on cards 265/266/267 (Apple/
    // Google subscription cancellations). These were flagged by a stray
    // human click in a past admin session — the rest of the cancel-subs
    // cluster (Amazon/Microsoft/Xbox/etc.) was approved cleanly. Going
    // forward the off-topic badge is AI-set only.
    const strayFlagsCleared = await getMigrationFlag("cleanup:clear-stray-offtopic:v1");
    if (!strayFlagsCleared) {
      const ids = [265, 266, 267];
      for (const id of ids) {
        for (const prefix of ["user-action:", "action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object" && existing.notOnTopic === true) {
            const cleared = { ...existing };
            delete cleared.notOnTopic;
            await kv.set(`${prefix}${id}`, cleared);
          }
        }
      }
      await setMigrationFlag("cleanup:clear-stray-offtopic:v1");
      console.log(`Cleared stray notOnTopic flags on ${ids.length} cards.`);
    }

    // One-time: strip imageContain from cards that now have cartoon banners.
    // These cards (Apple/Google/YouTube cancel-sub cluster + Baby Trump blimp)
    // had imageContain:true set when their original images were small logos.
    // They've since been cartoonized — cartoon banners are composed to fill
    // the frame, so imageContain should be false.
    const imageContainCartoonCleared = await getMigrationFlag("cleanup:clear-imagecontain-cartoon:v1");
    if (!imageContainCartoonCleared) {
      const cartoonIds = [266, 267, 268, 269, 270, 276];
      for (const id of cartoonIds) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object" && existing.imageContain === true) {
            const cleared = { ...existing };
            delete cleared.imageContain;
            await kv.set(`${prefix}${id}`, cleared);
          }
        }
      }
      await setMigrationFlag("cleanup:clear-imagecontain-cartoon:v1");
      console.log(`Cleared imageContain from ${cartoonIds.length} cartoon-banner cards.`);
    }

    // One-time: backfill `cartoonImageUrl` on the 137 bulk-imported cards that
    // have cartoon webp files on disk (confirmed via CARTOON_IDS manifest) but
    // were never written back to KV by generate-card-art.mjs.  Without this
    // field the server approval check rejects them as "no image".
    const cartoonUrlBackfillDone = await getMigrationFlag("cleanup:backfill-cartoon-url:v1");
    if (!cartoonUrlBackfillDone) {
      const idsToBackfill = [
        1375, 1379, 1380, 1388,
        1390, 1391, 1392, 1393, 1394, 1395, 1396, 1397, 1398, 1399,
        1400, 1401, 1402, 1403, 1404, 1405, 1406, 1407, 1408, 1409, 1410, 1411,
        2136, 2137,
        2145, 2146, 2147, 2148, 2149, 2150,
        2190, 2191, 2192, 2193, 2194, 2195, 2197, 2198, 2199,
        2200, 2201, 2202, 2203, 2205, 2206, 2207, 2208,
        2210, 2211, 2212, 2213, 2214, 2215, 2216, 2218, 2219,
        2220, 2221, 2222, 2223,
        2260, 2261, 2262, 2263,
        2266, 2267, 2268,
        2272, 2273, 2274, 2275, 2276, 2277,
        2281, 2282, 2283, 2284, 2285, 2286, 2287, 2288, 2289,
        2290, 2291, 2292, 2293, 2294, 2295, 2296,
        2299, 2300,
        2304, 2305, 2306, 2308, 2309, 2310, 2311,
        2314, 2315, 2316, 2317, 2318, 2319, 2320, 2321,
        2323, 2324,
        2326, 2327, 2328, 2329, 2330,
        2332, 2333, 2335, 2337,
        2339, 2340, 2341, 2342,
        2345, 2347, 2348, 2349, 2350, 2351, 2352,
        2378, 2379, 2380, 2381, 2382,
      ];
      let cartoonBackfillCount = 0;
      for (const id of idsToBackfill) {
        for (const prefix of ["user-action:", "action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object" && !existing.cartoonImageUrl) {
            await kv.set(`${prefix}${id}`, {
              ...existing,
              cartoonImageUrl: `/cartoon-banners/card-${id}.webp`,
            });
            cartoonBackfillCount++;
            break; // found it under this prefix — no need to try the other
          }
        }
      }
      await setMigrationFlag("cleanup:backfill-cartoon-url:v1");
      console.log(`Backfilled cartoonImageUrl on ${cartoonBackfillCount} pending cards.`);
    }

    // One-time: rewrite stale LOCAL cartoonImageUrl paths to absolute CDN URLs.
    // The backfill above (and some older rows) stored cartoonImageUrl as a
    // local path "/cartoon-banners/card-N.webp". Those files were never
    // deployed — cartoons live in Supabase Storage — so the path 404s anywhere
    // the raw value is used (e.g. the post-edit feed merge, which surfaced as
    // "editing an Act dropped its banner"). The frontend masks this for cards
    // in its manifest via cartoonUrlFor() (CDN), but we don't want a poisoned
    // value sitting in KV. We REWRITE (not strip) so the field stays populated
    // and the approval image-presence check keeps passing. Idempotent: only
    // touches values that still start with the local prefix.
    const cartoonCdnFixDone = await getMigrationFlag("cleanup:cartoon-cdn-urls:v1");
    if (!cartoonCdnFixDone) {
      const LOCAL_PREFIX = "/cartoon-banners";
      const CARTOON_CDN =
        "https://zkihnylrvdofdbnhmmoq.supabase.co/storage/v1/object/public/cartoon-banners";
      let cartoonCdnFixCount = 0;
      for (const prefix of ["action:", "user-action:"]) {
        const cards = (await kv.getByPrefix(prefix)) as any[];
        for (const card of cards) {
          if (
            card && typeof card === "object" && typeof card.id === "number" &&
            typeof card.cartoonImageUrl === "string" &&
            card.cartoonImageUrl.startsWith(LOCAL_PREFIX + "/")
          ) {
            await kv.set(`${prefix}${card.id}`, {
              ...card,
              cartoonImageUrl: CARTOON_CDN + card.cartoonImageUrl.slice(LOCAL_PREFIX.length),
            });
            cartoonCdnFixCount++;
          }
        }
      }
      await setMigrationFlag("cleanup:cartoon-cdn-urls:v1");
      console.log(`Rewrote ${cartoonCdnFixCount} stale local cartoonImageUrl paths to CDN URLs.`);
    }

    // One-time: deep-link upgrade for 121 seed cards whose targetUrl was a bare
    // homepage (e.g. codepink.org/) rather than the specific action page (e.g.
    // codepink.org/get_involved). URLs sourced from the amorphous deep-link
    // audit (reports/amorphous-deeplinks-all.json, high-confidence only).
    const deepLinksDone = await getMigrationFlag("cleanup:deep-links-high-confidence:v1");
    if (!deepLinksDone) {
      const deepLinks: Record<number, string> = {
        1002: "https://docs.google.com/spreadsheets/d/1vu0Y0HvadMgG_LN7dF8W7M66oPCcx_nmSARQWirV7iY/edit",
        1003: "https://thepeoplesunionusa.com/boycotts",
        1006: "https://www.buyfromablackwoman.org/online-directory",
        1008: "http://www.beyondbuckskin.com/p/buy-native.html",
        1009: "https://actionnetwork.org/event_campaigns/teslatakedown",
        1011: "https://www.veteransforpeace.org/take-action/join",
        1012: "https://aboutfaceveterans.org/become-a-member/",
        1013: "https://adapt.org/adapt-groups/",
        1014: "https://www.dragstoryhour.org/chaptermap",
        1015: "https://refusefascism.org/signup/",
        1018: "https://welcome.us/get-involved",
        1020: "https://www.themarshallproject.org/how-to-contact-us",
        1021: "https://theintercept.com/source/",
        1025: "https://boltsmag.org/pitch-us/",
        1026: "https://www.typeinvestigations.org/about/how-to-pitch/",
        1029: "https://www.levernews.com/got-a-news-tip/",
        1030: "https://readsludge.com/contact/",
        1032: "https://www.dsausa.org/chapters/",
        1033: "https://act.surj.org/a/member-orientation",
        1034: "https://www.sunrisemovement.org/welcome-call/",
        1038: "https://mothersoutfront.org/local-teams/",
        1039: "https://www.bendthearc.us/act_locally",
        1041: "https://www.federalunionists.net/join-us",
        1048: "https://www.welcomeblanket.org/getinvolved",
        1049: "https://www.pussyhatproject.com/knit",
        1052: "https://www.movetoamend.org/motion",
        1053: "https://www.citizen.org/act/",
        1055: "https://demandjustice.org/action-center/",
        1056: "https://www.freepress.net/get-involved/sign-petition",
        1058: "https://colorofchange.org/issues/",
        1059: "https://demandprogress.org/get-involved/",
        1061: "https://www.faithfulamerica.org/campaigns/resist-christian-nationalism",
        1062: "https://winwithoutwar.org/take-action/",
        1063: "https://www.detentionwatchnetwork.org/take-action/campaigns",
        1067: "https://www.childrensdefense.org/get-involved/take-action/",
        1068: "https://surj.org/join/",
        1069: "https://act.dsausa.org/donate/membership/",
        1070: "https://www.sunrisemovement.org/join/",
        1071: "https://mijente.net/join/",
        1072: "https://unitedwedream.org/join-united-we-dream/",
        1074: "https://www.jewishvoiceforpeace.org/join-us/",
        1076: "https://act.fcnl.org/signup/signup-action-alerts",
        1077: "https://paxchristiusa.org/join/",
        1080: "https://www.sikhcoalition.org/get-involved/take-action/",
        1084: "https://mothersoutfront.org/get-involved/",
        1085: "https://adapt.org/getting-involved/",
        1086: "https://blackvotersmatterfund.org/action-hub/",
        1087: "https://mifamiliavota.org/volunteer",
        1091: "https://welcome.us/become-a-sponsor/intro-to-sponsorship",
        1092: "https://welcomingamerica.org/the-welcoming-standard/",
        1094: "https://www.homesnotborders.org/volunteer/",
        1096: "https://www.federalunionists.net/join-us",
        1097: "https://labornotes.org/email-signup",
        1098: "https://home.coworker.org/campaign-support/",
        1099: "https://www.ueunion.org/campaigns/international-solidarity",
        1100: "https://redcard.iww.org/",
        1101: "https://www.domesticworkers.org/programs-and-campaigns/developing-policy-solutions/take-action/",
        1102: "https://sbworkersunited.org/take-action/",
        1104: "https://www.abetterbalance.org/get-help/",
        1107: "https://act.sojo.net/page/74900/subscribe/1?locale=en-US",
        1108: "https://www.faithfulamerica.org/campaigns/resist-christian-nationalism",
        1110: "https://truah.org/actions/",
        1112: "https://act.fcnl.org/signup/signup-action-alerts",
        1116: "https://www.sikhcoalition.org/get-involved/take-action/",
        1117: "https://wetheaction.org/join_us",
        1118: "https://www.lawyersforgoodgovernment.org/volunteer",
        1119: "https://scalejustice.org/get-involved",
        1121: "https://www.democracylab.org/projects",
        1122: "https://www.catchafire.org/volunteers",
        1123: "https://respondcrisistranslation.org/en/get-involved",
        1125: "https://www.doctorsforamerica.org/become-member",
        1126: "https://phr.org/get-involved/participate/health-professionals/",
        1127: "https://314action.org/run-for-office/",
        1130: "https://immigrationjustice.us/volunteer-application-form/",
        1131: "https://choosedemocracy.us/pledge/",
        1135: "https://www.immigrantdefenseproject.org/know-your-rights-with-ice/",
        1141: "https://www.citizen.org/act/",
        1142: "https://winwithoutwar.org/take-action/",
        1143: "https://act.faithfulamerica.org/",
        1144: "https://www.fcnl.org/act",
        1145: "https://www.detentionwatchnetwork.org/take-action",
        1147: "https://www.trainingforchange.org/public-workshops/",
        1148: "https://ruckus.org/trainings/",
        1150: "https://www.peopleshub.org/individuals",
        1151: "https://righttobe.org/upcoming-free-trainings/",
        1152: "https://choosedemocracy.us/trainings/",
        1157: "https://www.powerthepolls.org/",
        1158: "https://www.immigrantdefenseproject.org/community-education-workshops-and-trainings/",
        1160: "https://postcardstovoters.org/volunteer/",
        1161: "https://www.freedomforimmigrants.org/volunteer",
        1162: "https://www.thetrevorproject.org/volunteer/",
        1165: "https://www.mutualaidhub.org/",
        1167: "https://capitalbnews.org/newsletters/",
        1168: "https://19thnews.org/newsletters/daily/",
        1169: "https://documentedny.com/newsletter/",
        1171: "https://www.levernews.com/subscribe/",
        1174: "https://amplifier.org/free-downloads/",
        1175: "https://justseeds.org/graphics/",
        1176: "https://beehivecollective.org/graphics-projects/use-our-graphics/",
        1177: "https://www.tinypricksproject.com/participate/",
        1178: "https://www.tonyc.nyc/public_workshops",
        1179: "https://theyesmen.org/learn/bookoftricks",
        1186: "https://respondcrisistranslation.org/en/get-involved",
        1192: "https://readsludge.com/membership/",
        1193: "https://boltsmag.org/newsletter/",
        1194: "https://www.dropsitenews.com/subscribe",
        1202: "https://inkstickmedia.com/newsletters/",
        1204: "https://www.theopedproject.org/workshops",
        1206: "https://www.aauw.org/act/two-minute-activist/",
        1207: "https://www.sierraclub.org/write-your-letter-editor",
        1215: "https://translifeline.org/",
        1216: "https://www.thetrevorproject.org/get-help/",
        1217: "https://lgbthotline.org/chat/",
        1218: "https://www.crisistextline.org/",
        1220: "https://activeminds.org/programs/chapters/",
        1221: "https://www.nami.org/support-groups/",
        1223: "https://runforsomething.net/run/",
        1225: "https://emergeamerica.org/candidate-training/",
        1233: "https://www.cliniclegal.org/training/accreditation",
        1253: "https://actionnetwork.org/event_campaigns/teslatakedown",
        1278: "https://blaireerskine.substack.com/",
      };
      let deepLinkCount = 0;
      for (const [idStr, newUrl] of Object.entries(deepLinks)) {
        const id = Number(idStr);
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, { ...existing, targetUrl: newUrl });
            deepLinkCount++;
            break;
          }
        }
      }
      await setMigrationFlag("cleanup:deep-links-high-confidence:v1");
      console.log(`Applied ${deepLinkCount} deep-link URL upgrades.`);
    }

    // One-time: upgrade targetUrl on user-submitted cards (IDs 2000+) whose
    // current targetUrl is a bare social-media profile (Instagram, TikTok,
    // Bluesky, etc.) or org homepage. Replaces with the specific action page
    // found via web research — join pages, event finders, how-tos, toolkits.
    // All 40 IDs live under the user-action: prefix.
    const socialDeepLinksDone = await getMigrationFlag("cleanup:social-profile-deeplinks:v1");
    if (!socialDeepLinksDone) {
      const socialDeepLinks: Record<number, string> = {
        // United We Dream
        2237: "https://icewatch.app/",
        2268: "http://overpasslightbrigade.org/how-to/",
        2269: "https://www.climatedefiance.org/volunteer",
        2270: "https://actionnetwork.org/event_campaigns/virtual-summer-trainings-for-climate-defiance",
        2271: "https://www.climatedefiance.org/volunteer",
        2275: "https://actionnetwork.org/event_campaigns/teslatakedown",
        2279: "https://indivisible.org/events/postcard-writing/",
        2280: "https://indivisible.org/get-involved/take-action/",
        2281: "https://unitedwedream.org/our-work/deportation-defense/know-your-rights/",
        2282: "https://unitedwedream.org/here-to-stay-network/",
        2283: "https://unitedwedream.org/our-work/deportation-defense/migrawatch-hotline/",
        2284: "https://www.mobilize.us/unitedwedream/",
        2288: "https://www.gaysagainstguns.org/",
        2289: "https://www.fiftyfifty.one/events",
        2290: "https://www.fiftyfifty.one/organizer-resources",
        2291: "https://www.sunrisemovement.org/hubs/",
        2292: "https://marchforourlives.org/take-action/",
        2293: "https://blackvotersmatterfund.org/votingtoolbox/",
        2294: "https://action.womensmarch.com/home",
        2295: "http://overpasslightbrigade.org/how-to/",
        2297: "https://act.indivisible.org/lte/local-endorsements-lte/",
        2298: "https://indivisible.org/resource-library/hosting-virtual-events",
        2299: "https://unitedwedream.org/our-work/the-national-undocufund/",
        2300: "https://www.communityjusticeexchange.org/en/nbfn-directory",
        2301: "https://www.regulations.gov/",
        2302: "https://www.powerthepolls.org/",
        2303: "https://indivisible.org/resources/",
        2304: "https://www.womensmarch.com/initiatives",
        2309: "https://www.fiftyfifty.one/organizer-resources",
        2310: "https://www.fiftyfifty.one/guide",
        2312: "https://indivisible.org/get-involved/take-action/",
        2313: "https://indivisible.org/town-hall-resources",
        2314: "https://www.fiftyfifty.one/events",
        2316: "https://www.mobilize.us/unitedwedream/",
        2318: "https://www.communityjusticeexchange.org/en/nbfn-directory",
        2319: "https://www.ala.org/bbooks",
        2321: "https://unitedwedream.org/our-work/deportation-defense/migrawatch-hotline/",
        2324: "https://greenamerica.org/find-better-bank-or-credit-union",
        2325: "https://act.indivisible.org/signup/newsletter-signup-2025/",
        2327: "https://www.mobilize.us/unitedwedream/",
      };
      let socialLinkCount = 0;
      for (const [idStr, url] of Object.entries(socialDeepLinks)) {
        const id = Number(idStr);
        // These cards all live under user-action: — try that first, then
        // fall back to action: in case any were moved during admin edits.
        for (const prefix of ["user-action:", "action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, { ...existing, targetUrl: url });
            socialLinkCount++;
            break; // only update the first matching prefix
          }
        }
      }
      await setMigrationFlag("cleanup:social-profile-deeplinks:v1");
      console.log(`Applied ${socialLinkCount} social-profile → specific-action URL upgrades.`);
    }

    // One-time: backfill `topImageUrl` on the 37 CSV-imported cards (IDs
    // 1245–1281) using og:image URLs scraped from each card's targetUrl host.
    // Tesla cards are skipped — they already use the local `org_tesla-takedown`
    // asset. TikTok / Twitch / Pol-Rev pages don't expose og:image, so they
    // borrow the 50501 / brand-equivalent image as a sensible fallback.
    const imagesBackfillDone = await getMigrationFlag("cleanup:backfill-images-1245:v1");
    if (!imagesBackfillDone) {
      const FIFTY = "https://linktr.ee/og/image/fiftyfiftyonemovement.jpg";
      const INDIV = "https://indivisible.org/wp-content/uploads/2026/01/indivisible_logo_dark_fill.png";
      const MEIDAS = "https://yt3.googleusercontent.com/7N7yfRN_fPIuDvW2MxnaD3kHDZqxun0_owwvdr06EsFC-6sV3XIA36ChpolKIFzCbkmh97KJuLM=s900-c-k-c0x00ffffff-no-rj";
      const TLP = "https://lincolnproject.us/wp-content/uploads/2021/09/TLP-Social-Share-1.png";
      const AAF1 = "https://www.aafront.org/wp-content/uploads/2019/07/AAF.jpg";
      const AAF2 = "https://www.aafront.org/wp-content/uploads/2023/05/OpSave-fun-Group-1-e1684764862613.jpg";
      const BLAIRE = "https://substackcdn.com/image/fetch/$s_!mBb4!,f_auto,q_auto:best,fl_progressive:steep/https%3A%2F%2Fblaireerskine.substack.com%2Ftwitter%2Fsubscribe-card.jpg";
      const imageMap: Record<number, string> = {
        1245: FIFTY, 1246: FIFTY, 1247: FIFTY, 1248: FIFTY, 1249: FIFTY, 1250: FIFTY,
        // 1251–1256: Tesla cards already use org_tesla-takedown — skip.
        1257: INDIV, 1258: INDIV, 1259: INDIV, 1260: INDIV,
        1261: INDIV, 1262: INDIV, 1263: INDIV, 1264: INDIV,
        1265: FIFTY, 1266: FIFTY, 1267: FIFTY,
        // 1268: Tesla IG — already on org_tesla-takedown — skip.
        1269: FIFTY,
        1270: FIFTY, 1271: FIFTY, 1272: FIFTY,
        1273: MEIDAS, 1274: MEIDAS,
        1275: AAF1, 1276: AAF2,
        1277: BLAIRE, 1278: BLAIRE,
        1279: TLP,
        1280: FIFTY, 1281: FIFTY,
      };
      let imageBackfillCount = 0;
      for (const [idStr, url] of Object.entries(imageMap)) {
        const id = Number(idStr);
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, { ...existing, topImageUrl: url });
            imageBackfillCount++;
          }
        }
      }
      await setMigrationFlag("cleanup:backfill-images-1245:v1");
      console.log(`Backfilled topImageUrl on ${imageBackfillCount} new cards.`);
    }

    // One-time: clear the previously-backfilled topImageUrl on TikTok/YouTube
    // cards so the new local SVG logos (org_tiktok / org_youtube, with
    // imageContain) take over. The resolver prefers topImageUrl over
    // topImageKey, so we must null it explicitly.
    const tiktokYoutubeRekeyDone = await getMigrationFlag("cleanup:tiktok-youtube-rekey:v1");
    if (!tiktokYoutubeRekeyDone) {
      const idsToRekey = [1266, 1267, 1273, 1274, 1279, 1280, 1281];
      let cleared = 0;
      for (const id of idsToRekey) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object" && existing.topImageUrl) {
            const { topImageUrl: _, ...rest } = existing;
            await kv.set(`${prefix}${id}`, rest);
            cleared++;
          }
        }
      }
      await setMigrationFlag("cleanup:tiktok-youtube-rekey:v1");
      console.log(`Cleared topImageUrl on ${cleared} TikTok/YouTube cards (rekeyed to local SVGs).`);
    }

    // One-time: zero out placeholder `boosts: 5` on the second batch — admin-
    // added cards (IDs 2000+) that shipped with a default-5 value. These live
    // under `user-action:` (not `action:`) since they came through the user-
    // submission flow. v3 since v2 wrote to the wrong prefix.
    const boostsResetV3Done = await getMigrationFlag("cleanup:reset-boosts-5:v3");
    if (!boostsResetV3Done) {
      const resetIds = [2002, 2003, 2004, 2005, 2006];
      for (const id of resetIds) {
        // Try both prefixes so this works regardless of where the card lives.
        for (const prefix of ["user-action:", "action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, { ...existing, boosts: 0 });
          }
        }
      }
      await setMigrationFlag("cleanup:reset-boosts-5:v3");
      console.log(`Reset boosts to 0 on ${resetIds.length} admin-added cards.`);
    }

    // Seed/refresh the org-action library (IDs 1000+) into KV. Bump the version
    // key (e.g. v4 → v5) whenever you've edited SEED_CARDS and want the live
    // feed to pick up the new title/url/image. Existing user activity (`boosts`)
    // and admin curation flags (`quickAction`) are preserved across re-seeds —
    // only seed-managed metadata (title/desc/url/image) is overwritten.
    // One-time: set boosts = 950 on the pinned Spread the Word card.
    const boostsFixed1 = await getMigrationFlag("cleanup:set-boosts-1-950:v1");
    if (!boostsFixed1) {
      const card1 = await kv.get("action:1") as any;
      if (card1 && typeof card1 === "object") {
        await kv.set("action:1", { ...card1, boosts: 950 });
      }
      await setMigrationFlag("cleanup:set-boosts-1-950:v1");
      console.log("Set boosts = 950 on action:1 (Spread the Word).");
    }

    const orgsSeeded = await getMigrationFlag("seed:org-actions:v27");
    if (!orgsSeeded) {
      // Mark the seed as done UP FRONT — if the request times out partway
      // through the 260-card loop, the next request still skips the loop
      // instead of dying again. The cards already written stay; missing ones
      // get filled in on the next version bump.
      await setMigrationFlag("seed:org-actions:v27");
      let count = 0;
      for (const card of SEED_CARDS) {
        // Seed every card in SEED_CARDS (no longer skipping ids <1000).
        // The pre-1000 design placeholders were purged via the fake-seeds
        // cleanups; the only pre-1000 IDs left in SEED_CARDS are real
        // (id 1 = pinned ResistAct intro, id 19 = Smolotov merch).
        const existing = (await kv.get(`action:${card.id}`)) as any;
        // Default to approved, but let the card itself override (e.g. CSV
        // imports can ship with `adminApproved: false` so they land in the
        // admin review queue instead of going live unreviewed).
        const merged: any = { adminApproved: true, ...card };
        if (existing && typeof existing === "object") {
          // Preserve live engagement counters that users have moved.
          if (typeof existing.boosts === "number")        merged.boosts = existing.boosts;
          else if (typeof existing.spotsUsed === "number") merged.boosts = existing.spotsUsed;
          if (typeof existing.completions === "number")   merged.completions = existing.completions;
          // Preserve admin-curation flags that aren't owned by the seed.
          if (existing.quickAction === true) merged.quickAction = true;
          // Preserve eventDate if admin has set one manually.
          if (existing.eventDate) merged.eventDate = existing.eventDate;
          // Preserve custom topImageUrl so admin-uploaded images survive re-seeds.
          if (existing.topImageUrl && !card.topImageUrl) merged.topImageUrl = existing.topImageUrl;
          // Never demote a card the admin has already approved — re-seeding
          // should never send an approved card back to the pending queue.
          if (existing.adminApproved === true) merged.adminApproved = true;
        }
        await kv.set(`action:${card.id}`, merged);
        count++;
      }
      console.log(`Re-seeded ${count} org-action cards (v25).`);
    }

    // One-time migration: any pre-rename card still using `spotsUsed` gets a
    // matching `boosts` field copied in (without removing spotsUsed, so an
    // older client deploy keeps working).
    const migratedBoosts = await getMigrationFlag("migrate:spotsused-to-boosts:v1");
    if (!migratedBoosts) {
      let migrated = 0;
      for (const c of (await kv.getByPrefix("action:")) as any[]) {
        if (!c || typeof c !== "object") continue;
        if (typeof c.boosts === "number") continue;
        if (typeof c.spotsUsed === "number") {
          c.boosts = c.spotsUsed;
          await kv.set(`action:${c.id}`, c);
          migrated++;
        }
      }
      for (const c of (await kv.getByPrefix("user-action:")) as any[]) {
        if (!c || typeof c !== "object") continue;
        if (typeof c.boosts === "number") continue;
        if (typeof c.spotsUsed === "number") {
          c.boosts = c.spotsUsed;
          await kv.set(`user-action:${c.id}`, c);
          migrated++;
        }
      }
      await setMigrationFlag("migrate:spotsused-to-boosts:v1");
      console.log(`Migrated ${migrated} cards from spotsUsed → boosts.`);
    }

    // One-time migration: zero out boosts on all org seed cards (id >= 1000)
    // that were incorrectly seeded with boosts: 4.
    const boostsZeroed = await getMigrationFlag("migration:reset-boosts:v1");
    if (!boostsZeroed) {
      let zeroed = 0;
      for (const card of (await kv.getByPrefix("action:")) as any[]) {
        if (card && typeof card === "object" && typeof card.id === "number" && card.id >= 1000) {
          card.boosts = 0;
          await kv.set(`action:${card.id}`, card);
          zeroed++;
        }
      }
      await setMigrationFlag("migration:reset-boosts:v1");
      console.log(`Reset boosts to 0 on ${zeroed} org seed cards.`);
    }

    // One-time migration: set adminApproved on all action cards.
    // Cards with images (topImageKey or topImageUrl) get adminApproved: true,
    // EXCEPT for the batch added in action:1251–1271 which need admin review.
    // All user-created cards without adminApproved also get flagged as false.
    const adminApprovedMigrated = await getMigrationFlag("migration:admin-approved:v1");
    if (!adminApprovedMigrated) {
      let approved = 0, flagged = 0;
      for (const card of (await kv.getByPrefix("action:")) as any[]) {
        if (!card || typeof card !== "object" || typeof card.id !== "number") continue;
        const id = card.id as number;
        if (id >= 1251 && id <= 1271) {
          card.adminApproved = false;
          await kv.set(`action:${id}`, card);
          flagged++;
        } else if (card.topImageKey || (card.topImageUrl && card.topImageUrl.length > 0)) {
          card.adminApproved = true;
          await kv.set(`action:${id}`, card);
          approved++;
        }
      }
      // Also flag existing user-created cards as pending if not yet approved
      const userCardIds2 = (await kv.get("user-action:ids") ?? []) as number[];
      for (const uid of userCardIds2) {
        const ucard = await kv.get(`user-action:${uid}`) as any;
        if (ucard && typeof ucard === "object" && ucard.adminApproved === undefined) {
          ucard.adminApproved = false;
          await kv.set(`user-action:${uid}`, ucard);
          flagged++;
        }
      }
      await setMigrationFlag("migration:admin-approved:v1");
      console.log(`Admin-approved migration: ${approved} approved, ${flagged} flagged pending.`);
    }

    // One-time migration: set eventDate on the pol-rev event cards.
    const eventDatesMigrated = await getMigrationFlag("migration:event-dates:v1");
    if (!eventDatesMigrated) {
      const dates: Record<number, string> = {
        1252: "2026-07-04",
        1253: "2026-06-13",
        1254: "2026-06-10",
        1255: "2026-05-25",
        1256: "2026-05-20",
        1257: "2026-05-17",
        1258: "2026-05-17",
        1259: "2026-05-13",
        1260: "2026-05-12",
        1261: "2026-05-09",
      };
      for (const [idStr, date] of Object.entries(dates)) {
        const evCard = await kv.get(`action:${idStr}`) as any;
        if (evCard && typeof evCard === "object") {
          evCard.eventDate = date;
          await kv.set(`action:${idStr}`, evCard);
        }
      }
      await setMigrationFlag("migration:event-dates:v1");
      console.log("Event-dates migration complete.");
    }

    // One-time migrations for user-created cards (from origin/develop)
    const migrationV1 = await getMigrationFlag("migration:user-cards:v1");
    if (!migrationV1) {
      console.log("Running user-card migration v1...");
      const card30 = await kv.get("user-action:30") as any;
      if (card30 && typeof card30 === "object") {
        card30.title = "Baby Trump Balloon";
        card30.targetUrl = "https://www.amazon.com/Jumbo-Orange-Baby-Blimp-Inflatable/dp/B07FQ7TFMH/";
        card30.description = "Show your resistance with this giant 47.2-inch inflatable orange Baby Trump balloon! Perfect for protests, marches, and rooftop displays. Makes a powerful visual statement — buy one and fly it high to show Trump the resistance won't be silenced.";
        await kv.set("user-action:30", card30);
        console.log("Migrated card 30: Baby Trump Balloon");
      }
      await setMigrationFlag("migration:user-cards:v1");
      console.log("User-card migration v1 complete.");
    }

    // One-time: mark user-submitted cards (user-action:*) that have NO
    // targetUrl as unapproved so the admin can review and add the correct
    // action link. authorLink (author homepage) is a separate field and is
    // intentionally NOT used as a substitute here.
    const noUrlReviewDone = await getMigrationFlag("migration:nourl-review:v1");
    if (!noUrlReviewDone) {
      let marked = 0;
      const userCardIds3 = (await kv.get("user-action:ids") ?? []) as number[];
      for (const id of userCardIds3) {
        const card = await kv.get(`user-action:${id}`) as any;
        if (card && typeof card === "object" && !card.targetUrl && !card.pinToTop) {
          await kv.set(`user-action:${id}`, { ...card, adminApproved: false });
          marked++;
        }
      }
      await setMigrationFlag("migration:nourl-review:v1");
      console.log(`nourl-review: marked ${marked} user-submitted cards without a targetUrl as unapproved.`);
    }

    // One-time: re-approve the "Be Pretti Good" memorial beanie card.
    // The nourl-review migration flagged it because it has no targetUrl
    // (it's a crafting card with no external link), but it was previously
    // approved and should stay live.
    const beanieReapproved = await getMigrationFlag("cleanup:reapprove-beanie:v1");
    if (!beanieReapproved) {
      let reapproved = 0;
      for (const c of (await kv.getByPrefix("user-action:")) as any[]) {
        if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
        if (typeof c.title === "string" && c.title.toLowerCase().includes("pretti good")) {
          await kv.set(`user-action:${c.id}`, { ...c, adminApproved: true });
          reapproved++;
          console.log(`Re-approved beanie card user-action:${c.id}: "${c.title}"`);
        }
      }
      await setMigrationFlag("cleanup:reapprove-beanie:v1");
      console.log(`Beanie re-approval migration: ${reapproved} cards updated.`);
    }

    // One-time: backfill `targetUrl` on user-submitted cards that were saved
    // with a `link` field instead. The create endpoint previously stored the
    // AskFlow URL as `link`; everything else (admin panel, nourl-review,
    // EditCardModal) reads `targetUrl`. Rename the field in place.
    const linkToTargetUrlDone = await getMigrationFlag("cleanup:link-to-targeturl:v1");
    if (!linkToTargetUrlDone) {
      let fixed = 0;
      for (const c of (await kv.getByPrefix("user-action:")) as any[]) {
        if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
        if (c.link && !c.targetUrl) {
          const { link: linkVal, ...rest } = c;
          await kv.set(`user-action:${c.id}`, { ...rest, targetUrl: linkVal });
          fixed++;
        }
      }
      await setMigrationFlag("cleanup:link-to-targeturl:v1");
      console.log(`link→targetUrl migration: fixed ${fixed} user-submitted cards.`);
    }

    // One-time: any card with no image (no topImageUrl, no topImageKey, no
    // topImage) gets adminApproved:false so it lands in the admin review queue
    // instead of leaking to anon users. The create endpoint requires an image
    // up front; this migration cleans up cards admitted before that rule.
    const noImageReviewDone = await getMigrationFlag("migration:no-image-review:v1");
    if (!noImageReviewDone) {
      let demoted = 0;
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          // A cartoon banner counts — it's what the feed renders for the card.
          const hasImage = Boolean(c.topImageUrl) || Boolean(c.topImageKey) || Boolean(c.topImage) || Boolean(c.cartoonImageUrl);
          if (hasImage) continue;
          if (c.adminApproved === false) continue; // already in the review queue
          await kv.set(`${prefix}${c.id}`, { ...c, adminApproved: false });
          demoted++;
        }
      }
      await setMigrationFlag("migration:no-image-review:v1");
      console.log(`No-image review migration: demoted ${demoted} cards to adminApproved=false.`);
    }

    // One-time: bulk-mark PETITION cards as "5–10 minutes" and strip any
    // `quickAction: true` so the matcher classifies them as the new `10min`
    // bucket (not `5min` via the quickAction shortcut). Touches both `action:*`
    // (org seeds) and `user-action:*` (admin-added / user-submitted).
    const petitions10minDone = await getMigrationFlag("migration:petitions-10min:v1");
    if (!petitions10minDone) {
      let updated = 0;
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          const cat = String(c.category ?? "").toUpperCase();
          if (cat !== "PETITION") continue;
          const next: any = { ...c, timeCommitment: "5–10 minutes" };
          if (next.quickAction === true) delete next.quickAction;
          await kv.set(`${prefix}${c.id}`, next);
          updated++;
        }
      }
      await setMigrationFlag("migration:petitions-10min:v1");
      console.log(`Petitions 10-min migration: updated ${updated} cards.`);
    }

    // One-time: canonicalize free-form `location` strings to the standard
    // dropdown vocabulary (a state name / Remote / National / Multi-State) so
    // location-based search works. Bulk imports left "City, ST" values (e.g.
    // "Beverly, MA") and venue/setting descriptions ("In person — your home")
    // that matched no state filter, so those cards were unsearchable by
    // location. The exact id→{from,to} map below was generated AND reviewed
    // against live data on 2026-05-30. Safety: a card is only rewritten if its
    // CURRENT location still equals `from`, so any manual edit made since the
    // audit is never clobbered. Prior values are saved to
    // `migration:location-canonicalize:v1:backup` so the change is reversible.
    const locCanonDone = await getMigrationFlag("migration:location-canonicalize:v1");
    if (!locCanonDone) {
      const LOCATION_FIXES: Record<number, { from: string; to: string }> = {
        58: { from: "Multi-state", to: "Multi-State" },
        208: { from: "Beaver County, PA", to: "Pennsylvania" },
        216: { from: "Roxbury, NJ", to: "New Jersey" },
        292: { from: "Multi-state", to: "Multi-State" },
        1254: { from: "Multi-state", to: "Multi-State" },
        1255: { from: "Multi-state", to: "Multi-State" },
        2028: { from: "District of Columbia", to: "Washington DC" },
        2034: { from: "Multi-state", to: "Multi-State" },
        2042: { from: "Beverly, MA", to: "Massachusetts" },
        2043: { from: "Joplin, MO", to: "Missouri" },
        2044: { from: "Fort Myers, FL", to: "Florida" },
        2045: { from: "Seattle, WA", to: "Washington" },
        2046: { from: "Tukwila, WA", to: "Washington" },
        2048: { from: "New York, NY", to: "New York" },
        2049: { from: "Yonkers, NY", to: "New York" },
        2050: { from: "Bronx, NY", to: "New York" },
        2051: { from: "New York, NY", to: "New York" },
        2052: { from: "Los Angeles, CA", to: "California" },
        2053: { from: "Los Angeles, CA", to: "California" },
        2054: { from: "Portland, OR", to: "Oregon" },
        2055: { from: "Portland, OR", to: "Oregon" },
        2056: { from: "Vancouver, WA", to: "Washington" },
        2057: { from: "Fremont, CA", to: "California" },
        2059: { from: "Seattle, WA", to: "Washington" },
        2061: { from: "Palo Alto, CA", to: "California" },
        2062: { from: "Seattle, WA", to: "Washington" },
        2063: { from: "Washington, DC", to: "Washington DC" },
        2064: { from: "Lumpkin, GA", to: "Georgia" },
        2066: { from: "Tacoma, WA", to: "Washington" },
        2086: { from: "Washington, DC", to: "Washington DC" },
        2234: { from: "In person — Tesla dealer", to: "National" },
        2235: { from: "In person — your printer", to: "National" },
        2239: { from: "In person — federal courthouse hosting the trial", to: "National" },
        2241: { from: "Online + In person follow-ups", to: "National" },
        2242: { from: "In person — NY State Capitol, Albany", to: "New York" },
        2243: { from: "In person — Manhattan or Brooklyn", to: "New York" },
        2244: { from: "In person — Chicago Loop", to: "Illinois" },
        2245: { from: "In person — Collier County, FL", to: "Florida" },
        2247: { from: "In person — Tesla Portland location", to: "Oregon" },
        2248: { from: "In person — Eden Prairie or Maplewood Tesla locations", to: "Minnesota" },
        2249: { from: "In person — Owings Mills, MD", to: "Maryland" },
        2250: { from: "In person — MN State Capitol, St. Paul", to: "Minnesota" },
        2251: { from: "In person — Times Square, NYC", to: "New York" },
        2253: { from: "In person — Seattle Tesla showroom", to: "Washington" },
        2257: { from: "Online to get ask; in person to mail", to: "National" },
        2267: { from: "In person — your local highway overpass, federal building wall, or large blank facade after dark", to: "National" },
        2268: { from: "In person — workshop at home, then deploy on a highway overpass at dusk", to: "National" },
        2269: { from: "In person — your House representative's next town hall or public event", to: "National" },
        2271: { from: "In person — hotel ballroom, university auditorium, or industry gala where a cabinet member is speaking", to: "National" },
        2272: { from: "In person — your nearest big-city plaza on a Saturday afternoon", to: "National" },
        2274: { from: "In person — the public sidewalk outside an Amazon fulfillment center near you", to: "National" },
        2275: { from: "In person — your local Tesla showroom or service center", to: "National" },
        2276: { from: "In person — any non-Tesla EV dealership", to: "National" },
        2277: { from: "In person — a public Tesla Supercharger station", to: "National" },
        2278: { from: "In person or hybrid — Seattle (Capitol Hill rotating venues)", to: "Washington" },
        2279: { from: "In person — your home", to: "National" },
        2283: { from: "In person — any public street", to: "National" },
        2284: { from: "In person — your nearest federal immigration court", to: "National" },
        2285: { from: "In person — your state capitol building", to: "National" },
        2286: { from: "In person — your home or local church basement", to: "National" },
        2287: { from: "Anywhere", to: "National" },
        2288: { from: "In person — a public plaza, parade route, or steps of a legislator's office", to: "National" },
        2289: { from: "In person — your state capitol", to: "National" },
        2290: { from: "In person + online training", to: "National" },
        2291: { from: "In person or online — 200+ Sunrise hubs across the US", to: "National" },
        2292: { from: "In person — your high school or college", to: "National" },
        2293: { from: "In person — your home", to: "National" },
        2294: { from: "In person — your front porch, a public park, or church steps", to: "National" },
        2295: { from: "In person — a pedestrian-safe highway overpass", to: "National" },
        2296: { from: "In person — sidewalks outside city hall, federal courthouse, or major plaza", to: "National" },
        2298: { from: "In person — your home", to: "National" },
        2299: { from: "In person — a household in your city", to: "National" },
        2302: { from: "In person — your county polling place", to: "National" },
        2303: { from: "In person — your local school district board room", to: "National" },
        2304: { from: "In person — your front yard, porch, or window", to: "National" },
        2305: { from: "In person — sidewalk outside your county or city jail", to: "National" },
        2306: { from: "In person — your living room", to: "National" },
        2307: { from: "In person — your local farmers market or community fair", to: "National" },
        2308: { from: "In person — your local Pride parade route", to: "National" },
        2309: { from: "In person — community bulletin boards", to: "National" },
        2310: { from: "In person — your living room or backyard", to: "National" },
        2311: { from: "Online or in person", to: "National" },
        2312: { from: "Online to find address, then a postcard", to: "Remote" },
        2313: { from: "In person — anywhere your rep appears that week", to: "National" },
        2314: { from: "In person — the protest staging area", to: "National" },
        2315: { from: "In person — a concert, sports game, parade, or college campus", to: "National" },
        2317: { from: "In person — a target neighborhood in your city", to: "National" },
        2319: { from: "In person — your local Little Free Library or community center", to: "National" },
        2320: { from: "In person — utility poles and construction barriers downtown", to: "National" },
        2321: { from: "In person — publicly visible federal-lot or hotel parking lots", to: "National" },
        2324: { from: "In person + online", to: "National" },
        2328: { from: "In person — your neighborhood", to: "National" },
        2329: { from: "In person — the airport when you happen to be flying", to: "National" },
        2330: { from: "In person — the union outpost near a unionized Amazon facility (JFK8 in Staten Island; LDJ5 in NJ; ALB1 in Albany)", to: "National" },
        2338: { from: "In person + online coordination", to: "National" },
        2355: { from: "In person — your local Tesla dealership", to: "National" },
        2359: { from: "In person + posted online", to: "National" },
        2360: { from: "In person + posted online", to: "National" },
        2361: { from: "Online (filmed at home)", to: "Remote" },
        2367: { from: "Online (filmed at home)", to: "Remote" },
        2369: { from: "In person — your block", to: "National" },
        2370: { from: "In person — your city", to: "National" },
        2371: { from: "In person + posted online", to: "National" },
        2372: { from: "In person + posted online", to: "National" },
        2380: { from: "In person + Online", to: "National" },
      };
      const backup: Record<string, string> = {};
      let updated = 0;
      let skipped = 0;
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          const fix = LOCATION_FIXES[c.id];
          if (!fix) continue;
          // Only rewrite if the card still holds the value we audited — never
          // clobber an edit made between the audit and this migration running.
          if ((c.location ?? "") !== fix.from) { skipped++; continue; }
          backup[`${prefix}${c.id}`] = c.location ?? "";
          await kv.set(`${prefix}${c.id}`, { ...c, location: fix.to });
          updated++;
        }
      }
      await kv.set("migration:location-canonicalize:v1:backup", backup);
      await setMigrationFlag("migration:location-canonicalize:v1");
      console.log(`Location canonicalize migration: updated ${updated}, skipped ${skipped} (changed since audit).`);
    }

    // ── Self-heal user-action:ids ──────────────────────────────────────────────
    // Scans every `user-action:*` KV record and ensures its id is in
    // `user-action:ids`. Runs once per warm process (not once globally) —
    // cold-starts coincide with deploys, which is the race window for the
    // migration block below, so this catches any drift the previous
    // deploy's migrations may have introduced. Idempotent (set union).
    if (!healUserActionIdsRunInProcess) {
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const idSet = new Set<number>(currentIds);
      let restored = 0;
      for (const c of (await kv.getByPrefix("user-action:")) as any[]) {
        if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
        if (idSet.has(c.id)) continue;
        idSet.add(c.id);
        currentIds.push(c.id);
        restored++;
      }
      if (restored > 0) {
        currentIds.sort((a, b) => a - b);
        await kv.set("user-action:ids", currentIds);
      }
      healUserActionIdsRunInProcess = true;
      if (restored > 0) {
        console.log(`Heal user-action:ids: restored ${restored} orphaned card refs.`);
      }
    }

    // Dedup the restore-lost-batch1 race: two function instances both ran the
    // restore migration before either set the gate, so 2150/2151 are duplicates
    // of 2148/2149 (same title/authorName/url). Delete the higher ids and
    // remove from user-action:ids. Idempotent — deleting a non-existent record
    // is a no-op and filter on a missing id is a no-op.
    const dedupBatchRepairDone = await getMigrationFlag("migration:dedup-restore-race:v1");
    if (!dedupBatchRepairDone) {
      const idsToRemove = [2150, 2151];
      for (const id of idsToRemove) {
        await kv.del(`user-action:${id}`);
      }
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      await kv.set("user-action:ids", currentIds.filter((id) => !idsToRemove.includes(id)));
      await setMigrationFlag("migration:dedup-restore-race:v1");
      console.log(`Dedup restore-race: removed ${idsToRemove.length} duplicate cards.`);
    }

    // Restore Hartford Yarn Works + Morning Crafter — batch-1 migration logged
    // them in user-action:ids but the actual KV records never persisted (the
    // first repair pass's getByPrefix scan found 0 of them). Re-create at new
    // ids and append to user-action:ids.
    const restoreLostBatch1Done = await getMigrationFlag("migration:restore-lost-batch1:v1");
    if (!restoreLostBatch1Done) {
      const baseIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const startId = Math.max(...baseIds, 1305) + 1;
      const now = new Date().toISOString();
      const lost = [
        {
          category: "CRAFTING", categoryColor: "#c34e00",
          title: `Order a Subversive Cross-Stitch Kit from Hartford Yarn Works`,
          description: `Hartford Yarn Works just restocked their subversive cross-stitch kits (plus their book and new styles) — turn rage at Trump/MAGA into hours of meditative stabby thread-work.`,
          authorName: "Hartford Yarn Works", authorRole: "Independent shop",
          authorLink: "https://bsky.app/profile/hartfordyarnworks.bsky.social",
          targetUrl: "https://hartfordyarnworks.com/",
          toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 },
        },
        {
          category: "CRAFTING", categoryColor: "#c34e00",
          title: `Stitch along with The Morning Crafter's free anti-Trump-era craftivism patterns`,
          description: `@the_morningcrafter releases free craftivism patterns on TikTok (kept off Etsy, free on her site) for people compelled to make things while resisting Trump.`,
          authorName: "The Morning Crafter", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@the_morningcrafter",
          targetUrl: "https://www.tiktok.com/@the_morningcrafter",
          toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 },
        },
      ];
      const cards = lost.map((c, i) => ({
        id: startId + i,
        category: c.category,
        categoryColor: c.categoryColor,
        actionType: "Online",
        isOnline: true,
        timeCommitment: "5–10 minutes",
        title: c.title,
        description: c.description,
        spotsTotal: "Unlimited",
        boosts: 0,
        authorName: c.authorName,
        authorRole: c.authorRole,
        authorLink: c.authorLink,
        targetUrl: c.targetUrl,
        toneOverride: c.toneOverride,
        adminApproved: true,
        createdAt: now,
      }));
      const placed = await appendUserActionCards(cards);
      await setMigrationFlag("migration:restore-lost-batch1:v1");
      console.log(`Restored ${placed.length} lost batch-1 cards (ids ${placed.join(", ")}).`);
    }

    // Restore Tom Morello — overwritten at id 2132 by batch-2 migration when
    // it read a stale (already-corrupted) user-action:ids and computed
    // base = 2131. Re-create at the next free id.
    const restoreTomMorelloDone = await getMigrationFlag("migration:restore-tom-morello:v1");
    if (!restoreTomMorelloDone) {
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const card: any = {
        id: Math.max(...currentIds, 1305) + 1,
        category: "Act of Kindness",
        categoryColor: "#d97706",
        actionType: "Online",
        isOnline: true,
        timeCommitment: "5–10 minutes",
        title: `Reshare Tom Morello's "This Land is Your Land" at Hands Off NYC anti-ICE protest`,
        description: `Tom Morello covered Woody Guthrie's "This Land is Your Land" at a Hands Off NYC protest against Trump-era ICE abuses targeting immigrant New Yorkers — share the clip as a singalong for your own local action.`,
        spotsTotal: "Unlimited",
        boosts: 0,
        authorName: "Consequence / Tom Morello",
        authorRole: "TikTok creator",
        authorLink: "https://www.tiktok.com/@consequence",
        targetUrl: "https://www.tiktok.com/@consequence",
        toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 3 },
        adminApproved: true,
        createdAt: new Date().toISOString(),
      };
      const [placedId] = await appendUserActionCards([card]);
      await setMigrationFlag("migration:restore-tom-morello:v1");
      console.log(`Restored Tom Morello card at id ${placedId}.`);
    }

    // One-time (batch 2): 15 more creator-shop / regional-brigade / parody-song
    // imports. 6 images auto-fetched (3 Bluesky brigade banners + 3 YouTube
    // thumbnails); the 7 Etsy + 2 TikTok cards land image-less and need images
    // attached via Admin → Edit.
    const creatorsBatch2Done = await getMigrationFlag("migration:creators-import-2026-05-batch2:v1");
    if (!creatorsBatch2Done) {
      type NewCard2 = {
        category: string;
        categoryColor: string;
        title: string;
        description: string;
        authorName: string;
        authorRole: string;
        authorLink: string;
        targetUrl: string;
        toneOverride: { anger: number; comedy: number; subversion: number; hope: number; energy: number };
        sourceImageUrl?: string;
        // In-person fields — only set for the 3 banner brigades.
        location?: string;
        isOnline?: boolean;
        actionType?: string;
      };
      const incoming2: NewCard2[] = [
        // ── Etsy (7) — image-less; auto-blocked by Etsy 429 ──
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Pin the "Cuts May Be Necessary" French Revolution Guillotine Anti-Trump Button`,
          description: `A 1.25" guillotine pinback button captioned "Cuts May Be Necessary" — Eat-the-Rich Reign-of-Terror cosplay aimed straight at Trump's oligarch class. Wear it to rallies for maximum scowl-from-MAGA-uncles.`,
          authorName: "CherryRevolutionary", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/CherryRevolutionary",
          targetUrl: "https://www.etsy.com/listing/4324513102/french-revolution-guillotine-pin-button",
          toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 1, energy: 2 } },
        { category: "ART PIECE", categoryColor: "#896312",
          title: `Wave the "NOPE to Fascism" Big-Face Trump Cutout Protest Sign`,
          description: `A pre-printed jumbo Trump-face cutout on a stick captioned "NOPE TO FASCISM." Holds itself above the crowd at any anti-Trump rally — instant photo-op gold and zero arts-and-crafts night required.`,
          authorName: "CaliSunshineInk", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/CaliSunshineInk",
          targetUrl: "https://www.etsy.com/listing/1886630209/anti-trump-protest-sign-nope-to-fascism",
          toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 3 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Pin the "Resist Bear — Only You Can Prevent Fascism Park" Smokey Pin`,
          description: `Smokey Bear gets a glow-up: this pin/magnet swaps "Forest Fires" for "Fascism Park," with Smokey holding a RESIST shovel. Quiet-but-direct lapel flair against the Trump regime for backpacks, jackets, and tote bags.`,
          authorName: "FracturedLullabies", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/FracturedLullabies",
          targetUrl: "https://www.etsy.com/listing/4399942126/resist-bear-button-protest-pin-magnet",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Wear the Latin "Praeses Noster Stultus Est" Subtle Anti-Trump Tee`,
          description: `A Roman-eagle classical satire shirt that reads "Praeses Noster Stultus Est" — Latin for "Our President Is Stupid." Office-safe until anyone Googles it; then it's a brutal Trump-is-an-idiot tee.`,
          authorName: "CageyDesignsShop", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/CageyDesignsShop",
          targetUrl: "https://www.etsy.com/listing/1882733793/latin-subtle-anti-trump-shirt-trump-is",
          toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 1, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Plant the "Sorry for Being Weird Through Our First Dictatorship" Yard Sign`,
          description: `Apologetic lawn sign with metal H-stake reading "Sorry For Being Weird Through Our First Dictatorship" — passive-aggressive welcome to your MAGA neighbors and a daily Trump-era reminder for the cul-de-sac.`,
          authorName: "MojoSticker", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/MojoSticker",
          targetUrl: "https://www.etsy.com/listing/4372513055/sorry-being-weird-first-dictatorship",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Slap the "Leopards Eating People's Faces Party" Anti-Trump Bumper Sticker`,
          description: `The Twitter meme made physical — show every Trump-voter-regret driver behind you the slogan that named them. "Leopards Ate My Face" lore on the freeway, sized for car/laptop/dumpster.`,
          authorName: "SpatulaCityShirts", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/SpatulaCityShirts",
          targetUrl: "https://www.etsy.com/listing/1822104455/i-support-the-leopards-eating-peoples",
          toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 0, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Hang the "Things I Trust More Than Donald Trump" Outdoor Banner`,
          description: `A hemmed, grommeted, weatherproof full-size protest banner listing (the very long list of) things more trustworthy than Trump. Built to drop over highways, hang at rallies, or hoist above your fence.`,
          authorName: "PrintingUSA", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/PrintingUSA",
          targetUrl: "https://www.etsy.com/listing/1765811950/things-i-trust-more-than-donald-trump",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 3 } },

        // ── Bluesky banner brigades (3) — regional / in-person ──
        { category: "FLASH MOB", categoryColor: "#ff00d5",
          title: `Join the Indivisible Memphis Banner Brigade — Weekly Anti-Trump Highway Visibility Drops`,
          description: `Indivisible Memphis Banner Brigade meets on the Shady Grove Rd. overpass above I-240 (parking on Ransom Lane) for No Kings / anti-Trump banner drops over rush-hour commuters. Bring a sign — your presence is your power.`,
          authorName: "Indivisible Memphis Banner Brigade", authorRole: "Volunteer brigade",
          authorLink: "https://bsky.app/profile/indivisiblememphis.bsky.social",
          targetUrl: "https://bsky.app/profile/indivisiblememphis.bsky.social",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 },
          sourceImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:iiuocx5en26ntjbkmnoqhxpm/bafkreidruinb5m2sdonj7btamou6nkfq24rwrjpoyvkpaorpssjxlnzboa",
          location: "Tennessee", isOnline: false, actionType: "In Person Group" },
        { category: "FLASH MOB", categoryColor: "#ff00d5",
          title: `Volunteer with the Hartford Visibility Brigade (CT 50501) — Banner-Drop Brigade`,
          description: `Hartford-area CT 50501 volunteers run weekly banner-drop ops with No War / Release the Files / ICE OUT / Trump Must Go boards. Email HartfordVB@proton.me to get the schedule — more volunteers means longer messages over more bridges.`,
          authorName: "CT 50501 Hartford Visibility Brigade", authorRole: "Volunteer brigade",
          authorLink: "https://bsky.app/profile/byrneout44.bsky.social",
          targetUrl: "https://bsky.app/profile/byrneout44.bsky.social",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 },
          sourceImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:5yxegpvvhahv5bai3lx7fkon/bafkreicqgdqhnqjhwcneha5uxh7zfkniw2yfvyu6uzlevvom4nksxp5zwm",
          location: "Connecticut", isOnline: false, actionType: "In Person Group" },
        { category: "FLASH MOB", categoryColor: "#ff00d5",
          title: `Join the SoCal #BridgeBrigade #8647 Banner-Drop Crew (Alhambra, Greater LA)`,
          description: `Greater-LA banner-drop network organizing recurring "86 47" Trump-themed overpass actions in and around Alhambra. Follow @victormswmsg for the next bridge call — bring fabric paint, zip ties, and a friend with a camera.`,
          authorName: "SoCal Bridge Brigade", authorRole: "Volunteer brigade",
          authorLink: "https://bsky.app/profile/victormswmsg.bsky.social",
          targetUrl: "https://bsky.app/profile/victormswmsg.bsky.social",
          toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 2, energy: 3 },
          sourceImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:co3do5kd5o4veaw46x3dnuno/bafkreieek2rig6gazr2qlkoiro7yvwswxwyvi5m6bxpyz5uxycmthcs35u",
          location: "California", isOnline: false, actionType: "In Person Group" },

        // ── YouTube parody songs (3) — og:image thumbnail available ──
        { category: "Act of Kindness", categoryColor: "#d97706",
          title: `Boost the Marsh Family's "Bohemian Trumpsody" — Anti-Trump Queen Parody`,
          description: `The viral British family that recut Les Mis in lockdown is back, this time turning "Bohemian Rhapsody" into a full-throated anti-Trump anthem. Share with the MAGA uncle who blocks every news article — he'll watch a Queen parody.`,
          authorName: "Marsh Family", authorRole: "Independent creator",
          authorLink: "https://www.youtube.com/watch?v=YY_8WzcHqMQ",
          targetUrl: "https://www.youtube.com/watch?v=YY_8WzcHqMQ",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 3 },
          sourceImageUrl: "https://i.ytimg.com/vi/YY_8WzcHqMQ/maxresdefault.jpg" },
        { category: "Act of Kindness", categoryColor: "#d97706",
          title: `Share Parody Project's "Springtime for Elon" — Mel Brooks-Style Musk Salute Takedown`,
          description: `A pitch-perfect "Springtime for Hitler" rewrite about Elon's inauguration arm-salute and the Trump-Musk era. Mel Brooks energy aimed at DOGE — send to anyone still pretending the salute meant nothing.`,
          authorName: "Parody Project (Don Caron / Patrick Fitzgerald)", authorRole: "Independent creator",
          authorLink: "https://www.youtube.com/watch?v=OvfIneIoAWw",
          targetUrl: "https://www.youtube.com/watch?v=OvfIneIoAWw",
          toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 1, energy: 3 },
          sourceImageUrl: "https://i.ytimg.com/vi/OvfIneIoAWw/maxresdefault.jpg" },
        { category: "Act of Kindness", categoryColor: "#d97706",
          title: `Share "Take Me Home, Epstein Files" — John Denver Country-Roads Trump Parody`,
          description: `Patrick Fitzgerald's wistful Country-Roads recut about the Epstein Files Trump refuses to release. Less screaming, more wholesome Appalachian guilt — engineered to stick in MAGA brains for days.`,
          authorName: "Patrick Fitzgerald (Parody Project)", authorRole: "Independent creator",
          authorLink: "https://youtu.be/i9us52Edntw",
          targetUrl: "https://youtu.be/i9us52Edntw",
          toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 },
          sourceImageUrl: "https://i.ytimg.com/vi/i9us52Edntw/maxresdefault.jpg" },

        // ── TikTok creators (2) — image-less; JS-rendered ──
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Follow @justtryingtohackett on TikTok — Resistance Craftivism Community`,
          description: `TikTok's most active anti-Trump craftivism account: she runs book-club picks, raffles tied to community-org donations, and weekly "John Lewis necessary trouble" stitching prompts for the resistance.`,
          authorName: "Just Trying to Hackett (Independent)", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@justtryingtohackett",
          targetUrl: "https://www.tiktok.com/@justtryingtohackett",
          toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Take Action with Spellbound Stitchery's Donate-to-Enter Craftivism Raffles`,
          description: `Cross-stitch and needlepoint creator running raffles where entries are earned via donations to anti-Trump and immigrant-defense community orgs. Slow stitches, fast subversion — and your money goes to the front lines.`,
          authorName: "Spellbound Stitchery (Independent)", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@spellboundstitchery",
          targetUrl: "https://www.tiktok.com/@spellboundstitchery",
          toneOverride: { anger: 0, comedy: 1, subversion: 2, hope: 3, energy: 1 } },
      ];

      async function importImage2(srcUrl: string): Promise<string> {
        try {
          const res = await fetch(srcUrl, { headers: { "User-Agent": "Mozilla/5.0 ResistActMigration" } });
          if (!res.ok) { console.log(`Image fetch ${res.status} for ${srcUrl}`); return srcUrl; }
          const contentType = res.headers.get("content-type") ?? "image/jpeg";
          const buf = await res.arrayBuffer();
          const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "jpg";
          const key = `creators-batch2-${crypto.randomUUID()}.${ext}`;
          const supabase = adminClient();
          const BUCKET = "action-images";
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, buf, { contentType, upsert: false });
          if (upErr) { console.log(`Image upload failed for ${srcUrl}:`, upErr.message); return srcUrl; }
          const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(key);
          return urlData.publicUrl;
        } catch (err) {
          console.log(`Image error for ${srcUrl}:`, err);
          return srcUrl;
        }
      }

      const currentIds2 = ((await kv.get("user-action:ids")) ?? []) as number[];
      const base2 = Math.max(...(currentIds2.length ? currentIds2 : [1305]), 1305);
      const now2 = new Date().toISOString();
      const cards2: any[] = [];
      for (let i = 0; i < incoming2.length; i++) {
        const c = incoming2[i];
        const topImageUrl = c.sourceImageUrl ? await importImage2(c.sourceImageUrl) : undefined;
        cards2.push({
          id: base2 + 1 + i,
          category: c.category,
          categoryColor: c.categoryColor,
          actionType: c.actionType ?? "Online",
          isOnline: c.isOnline ?? true,
          timeCommitment: "5–10 minutes",
          title: c.title,
          description: c.description,
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: c.authorName,
          authorRole: c.authorRole,
          authorLink: c.authorLink,
          targetUrl: c.targetUrl,
          ...(c.location ? { location: c.location } : {}),
          ...(topImageUrl ? { topImageUrl } : {}),
          toneOverride: c.toneOverride,
          adminApproved: true,
          createdAt: now2,
        });
      }
      const placed2 = await appendUserActionCards(cards2);
      await setMigrationFlag("migration:creators-import-2026-05-batch2:v1");
      console.log(`Creators batch 2 import: added ${placed2.length} cards (ids ${placed2.join(", ")}).`);
    }

    // Fix search-style targetUrls on 4 regional event cards. Originally
    // imported with mobilize.us search-results URLs (effectively useless as
    // an action link); update to each org's actual Mobilize organizer page.
    const fixRegionalUrlsDone = await getMigrationFlag("migration:fix-regional-search-urls:v1");
    if (!fixRegionalUrlsDone) {
      const updates: Record<number, string> = {
        2150: "https://www.mobilize.us/commoncause/",
        2151: "https://www.mobilize.us/swindivisibleresistance/",
        2152: "https://www.mobilize.us/southsnohomishcountyindivisible/",
        2156: "https://www.mobilize.us/indivisibleyolo/",
      };
      let updated = 0;
      for (const [idStr, url] of Object.entries(updates)) {
        const id = Number(idStr);
        const existing = await kv.get(`user-action:${id}`) as any;
        if (existing && typeof existing === "object") {
          await kv.set(`user-action:${id}`, { ...existing, targetUrl: url, authorLink: url });
          updated++;
        }
      }
      await setMigrationFlag("migration:fix-regional-search-urls:v1");
      console.log(`Fixed regional search URLs: updated ${updated} cards.`);
    }

    // Fix Yarn Sisters card (2130) — Facebook search URL replaced with the
    // Guardian's craft topic page (where the "Weapons of Mass Construction"
    // craftivism feature lives).
    const fixYarnSistersDone = await getMigrationFlag("migration:fix-yarn-sisters-url:v1");
    if (!fixYarnSistersDone) {
      const url = "https://www.theguardian.com/lifeandstyle/craft";
      const existing = await kv.get("user-action:2130") as any;
      if (existing && typeof existing === "object") {
        await kv.set("user-action:2130", { ...existing, targetUrl: url, authorLink: url });
      }
      await setMigrationFlag("migration:fix-yarn-sisters-url:v1");
      console.log(`Fixed Yarn Sisters URL on card 2130.`);
    }

    // MoveOn cards listed a generic "Movement Organization" role. The actual
    // entity behind these petitions is "MoveOn.org Political Action" — use it
    // as the role so the attribution is accurate. Scans seed + user cards and
    // only touches ones authored by plain "MoveOn" (not multi-org combos).
    const moveonOrgNameDone = await getMigrationFlag("migration:moveon-org-name:v1");
    if (!moveonOrgNameDone) {
      const NEW_ROLE = "MoveOn.org Political Action";
      let updated = 0;
      const fixIfMoveOn = async (key: string) => {
        const c = await kv.get(key) as any;
        if (c && typeof c === "object" && c.authorName === "MoveOn" && c.authorRole === "Movement Organization") {
          await kv.set(key, { ...c, authorRole: NEW_ROLE });
          updated++;
        }
      };
      for (const c of (await kv.getByPrefix("action:")) as any[]) {
        if (c && typeof c === "object" && typeof c.id === "number") await fixIfMoveOn(`action:${c.id}`);
      }
      const moUserIds = (await kv.get("user-action:ids") ?? []) as number[];
      for (const id of moUserIds) await fixIfMoveOn(`user-action:${id}`);
      await setMigrationFlag("migration:moveon-org-name:v1");
      invalidateActionsCache();
      console.log(`MoveOn org-name migration: updated ${updated} cards to "${NEW_ROLE}".`);
    }

    // Point every MoveOn card's author link at moveon.org. Several were
    // bulk-imported with unrelated authorLinks (a random org's Facebook/IG/site
    // that happened to be the source), so this overwrites them for the org.
    const moveonLinkDone = await getMigrationFlag("migration:moveon-author-link:v1");
    if (!moveonLinkDone) {
      const MOVEON_URL = "https://www.moveon.org/";
      let updated = 0;
      const setLink = async (key: string) => {
        const c = await kv.get(key) as any;
        if (c && typeof c === "object" && c.authorName === "MoveOn" && c.authorLink !== MOVEON_URL) {
          await kv.set(key, { ...c, authorLink: MOVEON_URL });
          updated++;
        }
      };
      for (const c of (await kv.getByPrefix("action:")) as any[]) {
        if (c && typeof c === "object" && typeof c.id === "number") await setLink(`action:${c.id}`);
      }
      const molUserIds = (await kv.get("user-action:ids") ?? []) as number[];
      for (const id of molUserIds) await setLink(`user-action:${id}`);
      await setMigrationFlag("migration:moveon-author-link:v1");
      invalidateActionsCache();
      console.log(`MoveOn author-link migration: updated ${updated} cards to ${MOVEON_URL}.`);
    }

    // Normalize ALL MoveOn cards to the same role. The earlier org-name pass
    // only caught "Movement Organization"; this catches stragglers like the
    // "No Iran War" fundraiser (was "Independent creator") and any blank role.
    const moveonRoleNormDone = await getMigrationFlag("migration:moveon-role-normalize:v1");
    if (!moveonRoleNormDone) {
      const ROLE = "MoveOn.org Political Action";
      let updated = 0;
      const normRole = async (key: string) => {
        const c = await kv.get(key) as any;
        if (c && typeof c === "object" && c.authorName === "MoveOn" && c.authorRole !== ROLE) {
          await kv.set(key, { ...c, authorRole: ROLE });
          updated++;
        }
      };
      for (const c of (await kv.getByPrefix("action:")) as any[]) {
        if (c && typeof c === "object" && typeof c.id === "number") await normRole(`action:${c.id}`);
      }
      const mrnUserIds = (await kv.get("user-action:ids") ?? []) as number[];
      for (const id of mrnUserIds) await normRole(`user-action:${id}`);
      await setMigrationFlag("migration:moveon-role-normalize:v1");
      invalidateActionsCache();
      console.log(`MoveOn role-normalize migration: updated ${updated} cards to "${ROLE}".`);
    }

    // Dedup the portland-seattle-yolo race: ids 2153/2154/2155 are duplicates
    // of 2150/2151/2152 (Knit/STARVE/Singing) — two function instances both
    // ran the import before either set the gate. Delete the higher ids.
    const dedupPSYDone = await getMigrationFlag("migration:dedup-psy-race:v1");
    if (!dedupPSYDone) {
      const idsToRemove = [2153, 2154, 2155];
      for (const id of idsToRemove) {
        await kv.del(`user-action:${id}`);
      }
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      await kv.set("user-action:ids", currentIds.filter((id) => !idsToRemove.includes(id)));
      await setMigrationFlag("migration:dedup-psy-race:v1");
      console.log(`Dedup PSY race: removed ${idsToRemove.length} duplicate cards.`);
    }

    // Portland/Seattle/Yolo regional event import — 4 cards. All in-person
    // events at mobilize.us search URLs (no stable og:image), so they land
    // adminApproved=false for the admin queue. Race-safer pattern: dedup
    // against existing user-action records by lowercase title + targetUrl,
    // per-card kv.get existence check before insert, and a re-read-then-union
    // write to user-action:ids so concurrent runs can't drop or duplicate ids.
    const portlandSeattleYoloDone = await getMigrationFlag("migration:portland-seattle-yolo-import-2026-05:v1");
    if (!portlandSeattleYoloDone) {
      type RegionalCard = {
        category: string;
        categoryColor: string;
        title: string;
        description: string;
        location: string;
        authorName: string;
        authorRole: string;
        targetUrl: string;
        toneOverride: { anger: number; comedy: number; subversion: number; hope: number; energy: number };
        amplifiesGroups?: string[];
      };
      const incomingRegional: RegionalCard[] = [
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Knit in Protest of ICE — Portland`,
          description: `Bring your needles and your fury to Common Cause Oregon's Knitting in Protest of ICE — a quiet, weekly visibility action outside the Portland federal building where knitters glare at Trump's deportation machine while making hats for detained families. Funny, hands-busy, low-confrontation, high-photo-op.`,
          location: "Oregon",
          authorName: "Common Cause Oregon", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/?q=ICE+raid",
          toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
        },
        { category: "PROTEST", categoryColor: "#23297e",
          title: `STARVE FASCISM — Portland`,
          description: `SW Indivisible Resistance's blunt-named Saturday rally (May 30, Portland) targeting Trump-administration funding flows: divest, boycott Trump-friendly corporates, cut off Project 2025 donors. Big sign-painting party an hour before kickoff.`,
          location: "Oregon",
          authorName: "SW Indivisible Resistance", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/?q=ICE+raid",
          toneOverride: { anger: 3, comedy: 2, subversion: 3, hope: 2, energy: 3 },
        },
        { category: "ART PIECE", categoryColor: "#896312",
          title: `Singing Resistance in Edmonds (WA)`,
          description: `South Snohomish County Indivisible hosts a monthly Singing Resistance — anti-Trump protest songs on a downtown sidewalk, Mon Jun 8 at 4pm. Bring kazoos, bring lyric sheets, bring grandma. Local, joyful, irritating to the right people.`,
          location: "Washington",
          authorName: "South Snohomish County Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/?q=ICE",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 3, energy: 2 },
        },
        { category: "PROTEST", categoryColor: "#23297e",
          title: `Disappeared in America Visibility Event — Yolo CA`,
          description: `Indivisible Yolo's first-Wednesday-of-the-month silent vigil naming and showing photos of people the Trump-Biden ICE pipeline has disappeared into detention. Woodland and West Sacramento locations. Bring a printed name card from the linked spreadsheet.`,
          location: "California",
          authorName: "Indivisible Yolo", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/?q=deportation",
          toneOverride: { anger: 2, comedy: 0, subversion: 3, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
        },
      ];

      // Dedup against existing user-action:* records by (lowercase trimmed title) and targetUrl.
      const existingPS = (await kv.getByPrefix("user-action:")) as any[];
      const seenTitlesPS = new Set<string>();
      const seenUrlsPS = new Set<string>();
      for (const c of existingPS) {
        if (!c || typeof c !== "object") continue;
        if (typeof c.title === "string") seenTitlesPS.add(c.title.toLowerCase().trim());
        if (typeof c.targetUrl === "string") seenUrlsPS.add(c.targetUrl);
      }
      const freshPS = incomingRegional.filter((c) =>
        !seenTitlesPS.has(c.title.toLowerCase().trim())
      );

      const currentIdsPS = ((await kv.get("user-action:ids")) ?? []) as number[];
      const startIdPS = Math.max(...currentIdsPS, 1305) + 1;
      const nowPS = new Date().toISOString();
      const cardsPS = freshPS.map((c, i) => ({
        id: startIdPS + i,
        category: c.category,
        categoryColor: c.categoryColor,
        actionType: "In Person Group",
        isOnline: false,
        timeCommitment: "1–3 hours",
        title: c.title,
        description: c.description,
        location: c.location,
        spotsTotal: "Unlimited",
        boosts: 0,
        authorName: c.authorName,
        authorRole: c.authorRole,
        authorLink: c.targetUrl,
        targetUrl: c.targetUrl,
        toneOverride: c.toneOverride,
        ...(c.amplifiesGroups ? { amplifiesGroups: c.amplifiesGroups } : {}),
        adminApproved: false,
        createdAt: nowPS,
      }));
      const placedPS = await appendUserActionCards(cardsPS);
      await setMigrationFlag("migration:portland-seattle-yolo-import-2026-05:v1");
      console.log(`Portland/Seattle/Yolo regional import: added ${placedPS.length} cards (ids ${placedPS.join(", ")}).`);
    }

    // Retroactive sweep: demote any approved card missing a targetUrl OR an
    // image (no topImageUrl + no topImageKey + no topImage). Skips pinToTop
    // cards so the Spread-the-Word pin can't be accidentally demoted. Cards
    // already adminApproved=false are left alone (they're already in the queue).
    const demoteMissingDone = await getMigrationFlag("migration:demote-missing-url-or-image:v1");
    if (!demoteMissingDone) {
      let demoted = 0;
      const sample: string[] = [];
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          if (c.adminApproved === false) continue;
          if (c.pinToTop) continue;
          const hasUrl = Boolean(c.targetUrl);
          // A cartoon banner counts — it's what the feed renders for the card.
          const hasImage = Boolean(c.topImageUrl) || Boolean(c.topImageKey) || Boolean(c.topImage) || Boolean(c.cartoonImageUrl);
          if (hasUrl && hasImage) continue;
          await kv.set(`${prefix}${c.id}`, { ...c, adminApproved: false });
          demoted++;
          if (sample.length < 20) sample.push(`${prefix}${c.id} (url:${hasUrl},img:${hasImage})`);
        }
      }
      await setMigrationFlag("migration:demote-missing-url-or-image:v1");
      console.log(`Demote missing url/image: demoted ${demoted} cards. Sample: ${sample.join("; ")}`);
    }

    // One-time: import 16 Etsy/Bluesky/TikTok creator-shop cards. 4 have
    // source images we can fetch (Bluesky public API + CrimethInc CDN); the
    // other 12 land without a header image (Etsy 429s scrapers, TikTok needs
    // JS, Facebook search URL has no stable asset) and need images attached
    // via Admin → Edit. All inserted with adminApproved=true.
    const etsyCreatorsImportDone = await getMigrationFlag("migration:etsy-creators-import-2026-05:v1");
    if (!etsyCreatorsImportDone) {
      type NewCard = {
        category: string;
        categoryColor: string;
        title: string;
        description: string;
        authorName: string;
        authorRole: string;
        authorLink: string;
        targetUrl: string;
        toneOverride: { anger: number; comedy: number; subversion: number; hope: number; energy: number };
        sourceImageUrl?: string;
      };
      const incoming: NewCard[] = [
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Wear the "No Kings" Anti-Trump Protest Pin Button Set`,
          description: `Pack of anti-fascism "No Kings" pin buttons from indie Etsy shop CraftedVibeStudioCo — wear them stacked on a jacket or hand them out at the next visibility brigade.`,
          authorName: "CraftedVibeStudioCo", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/CraftedVibeStudioCo",
          targetUrl: "https://www.etsy.com/listing/4505083806/anti-trump-protest-pin-button-set",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Slap FendywitchDesigns' witchy "MAGA Parody" anti-Trump vinyl sticker on everything`,
          description: `Hand-drawn parody sticker mocking MAGA from a witchy/pagan/environmentalist angle — sticks on laptops, water bottles, lamp posts, your neighbor's mailbox.`,
          authorName: "FendywitchDesigns", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/FendywitchDesigns",
          targetUrl: "https://www.etsy.com/listing/742494439/maga-parody-vinyl-sticker-anti-trump",
          toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Sport the "Is He Dead Yet?" Black Cat Dad Hat (subtle FDT)`,
          description: `Deadpan grumpy-cat dad hat reading "Is He Dead Yet?" — a sotto-voce FDT statement disguised as a cat hat, wearable at family dinners and PTA meetings alike.`,
          authorName: "ElifGiftsUs", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/ElifGiftsUs",
          targetUrl: "https://www.etsy.com/listing/4506217910/is-he-dead-yet-black-cat-hat-anti-trump",
          toneOverride: { anger: 3, comedy: 3, subversion: 3, hope: 1, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Pin a "Stop Project 2025" 1.25" Button or Magnet`,
          description: `Tiny but mighty 1.25-inch button or magnet calling out Project 2025 — pin it on your tote, stick it on your fridge, hand them out at neighborhood meetings.`,
          authorName: "ButtonRepublic", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/ButtonRepublic",
          targetUrl: "https://www.etsy.com/listing/1856171148/stop-project-2025-pin-anti-trump",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 2, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Stick an "ICE OUT" Magnet or Bumper Decal on your car`,
          description: `Bold "ICE OUT" car magnet / bumper sticker calling for ICE abolition under Trump — turns every traffic jam into a visibility action.`,
          authorName: "DaisyBlueDesignsCo", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/DaisyBlueDesignsCo",
          targetUrl: "https://www.etsy.com/listing/4442526838/ice-out-magnet-or-decal-anti-ice-protest",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 1, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Wear the "No Kings — Republican Oligarchy" Anti-MAGA Pin`,
          description: `Bold "No Kings / Republican Oligarchy" resist button — a conversation-starter at school pickup, the office, or the next protest line.`,
          authorName: "BewitchingBetties", authorRole: "Etsy shop",
          authorLink: "https://www.etsy.com/shop/BewitchingBetties",
          targetUrl: "https://www.etsy.com/listing/4329164263/no-kings-button-pin-anti-trump-pin",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Order a Subversive Cross-Stitch Kit from Hartford Yarn Works`,
          description: `Hartford Yarn Works just restocked their subversive cross-stitch kits (plus their book and new styles) — turn rage at Trump/MAGA into hours of meditative stabby thread-work.`,
          authorName: "Hartford Yarn Works", authorRole: "Independent shop",
          authorLink: "https://bsky.app/profile/hartfordyarnworks.bsky.social",
          targetUrl: "https://hartfordyarnworks.com/",
          toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 } },
        { category: "SOCIAL MEDIA", categoryColor: "#e44b4b",
          title: `Boost Eric Champnella's "Donny / 8647 Ain't a Crime" Trump parody song`,
          description: `Eric Champnella's parody of Tommy Tutone's "Jenny/867-5309" recasts it as "Donny / 8647 Ain't a Crime" — a singable response to Trump DOJ's bogus seashell charges against Comey. Reshare widely.`,
          authorName: "Eric Champnella", authorRole: "Bluesky creator",
          authorLink: "https://bsky.app/profile/echamp.bsky.social",
          targetUrl: "https://bsky.app/profile/echamp.bsky.social",
          toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 2 },
          sourceImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:aixsk56es7lwhmva54ghdqdi/bafkreihjgwu6jssrvn6zvjvb5baphrgofnzjoz2hm3aduxsjfl5getozcq" },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Print + share Emily K's "One Simple Act" anti-fascism zine`,
          description: `Artist Emily K's printable zine "One Simple Act" gives concrete small steps for resisting fascism — print at home, fold, leave stacks in coffee shops, laundromats, and libraries.`,
          authorName: "Art by Emily K", authorRole: "Bluesky creator",
          authorLink: "https://bsky.app/profile/museum.of.emilyk.art",
          targetUrl: "https://bsky.app/profile/museum.of.emilyk.art",
          toneOverride: { anger: 1, comedy: 1, subversion: 3, hope: 3, energy: 2 },
          sourceImageUrl: "https://cdn.bsky.app/img/banner/plain/did:plc:l2bvlovg53aahtytp32r7mqe/bafkreih2ijenpyxetgtwo6z6zzagw5tqjedegymcqlelpjkbkkgilgr63i" },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Print + distribute CrimethInc's Security Culture zine for the Trump era`,
          description: `CrimethInc's printable zine on security culture for activists organizing under Trump's pledged federal-agency attacks on anti-fascists — print, staple, leave in spaces where organizers gather.`,
          authorName: "CrimethInc. Ex-Workers' Collective", authorRole: "Bluesky creator",
          authorLink: "https://bsky.app/profile/crimethinc.com",
          targetUrl: "https://crimethinc.com/zines",
          toneOverride: { anger: 2, comedy: 1, subversion: 3, hope: 2, energy: 2 },
          sourceImageUrl: "https://cdn.crimethinc.com/assets/share/crimethinc-site-share.png" },
        { category: "ART/PERFORMANCE ART", categoryColor: "#896312",
          title: `Boost First Amendment Troop's "ResistDance" Lincoln Memorial / Kennedy Center protest dance`,
          description: `Twelve teen dancers staged "ResistDance" / "Resistadance vs Redaction" at the Lincoln Memorial and Kennedy Center — leotards displayed Jane Doe 4's Epstein-file testimony as protest against Trump-era redactions. Share the TikTok.`,
          authorName: "First Amendment Troop", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@firstamendmenttroop",
          targetUrl: "https://www.tiktok.com/@firstamendmenttroop",
          toneOverride: { anger: 3, comedy: 1, subversion: 3, hope: 3, energy: 3 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Stitch along with The Morning Crafter's free anti-Trump-era craftivism patterns`,
          description: `@the_morningcrafter releases free craftivism patterns on TikTok (kept off Etsy, free on her site) for people compelled to make things while resisting Trump.`,
          authorName: "The Morning Crafter", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@the_morningcrafter",
          targetUrl: "https://www.tiktok.com/@the_morningcrafter",
          toneOverride: { anger: 1, comedy: 2, subversion: 2, hope: 3, energy: 2 } },
        { category: "Act of Kindness", categoryColor: "#d97706",
          title: `Share This Hour Has 22 Minutes' "A New Book by Donald Trump" sketch`,
          description: `CBC's This Hour Has 22 Minutes dropped a deadpan sketch-comedy parody of "A New Book by Donald Trump." Reshare to fill a feed with something that lands a laugh AND a punchline.`,
          authorName: "This Hour Has 22 Minutes (CBC)", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@thishourhas22minutes",
          targetUrl: "https://www.tiktok.com/@thishourhas22minutes",
          toneOverride: { anger: 0, comedy: 3, subversion: 2, hope: 2, energy: 2 } },
        { category: "CRAFTING", categoryColor: "#c34e00",
          title: `Boost Yarn Sisters / Guardian "Weapons of Mass Construction" anti-Trump craftivism feature`,
          description: `Yarn Sisters' FB community is amplifying the Guardian feature on US craftivists fighting Trump with yarn — embroidered pistols, slogan quilts, knitted protest banners. Share, then pick up a needle.`,
          authorName: "Yarn Sisters (Facebook community)", authorRole: "Facebook community",
          authorLink: "https://www.facebook.com/search/top/?q=craftivism%20trump",
          targetUrl: "https://www.facebook.com/search/top/?q=craftivism%20trump",
          toneOverride: { anger: 1, comedy: 2, subversion: 3, hope: 3, energy: 2 } },
        { category: "ART/PERFORMANCE ART", categoryColor: "#896312",
          title: `Drop a "Tesla T Party" Anti-Musk Protest Banner (Bruce S.'s craftivist template)`,
          description: `Bruce S. (@bmschech.bsky.social) is circulating "Tesla T Party" protest-art and banner-drop visuals tying Musk-DOGE to anti-Trump street action — DIY-replicable for your own bridge or overpass.`,
          authorName: "Bruce S. / ActivistArt", authorRole: "Bluesky creator",
          authorLink: "https://bsky.app/profile/bmschech.bsky.social",
          targetUrl: "https://bsky.app/profile/bmschech.bsky.social",
          toneOverride: { anger: 2, comedy: 2, subversion: 3, hope: 2, energy: 2 },
          sourceImageUrl: "https://cdn.bsky.app/img/avatar/plain/did:plc:ptzl2hqpetxgk2xnudzsbiim/bafkreibqplcarfena2hbirjlrh47jeiav3gj3ws5cc6cmojh27xnrq2isu" },
        { category: "Act of Kindness", categoryColor: "#d97706",
          title: `Reshare Tom Morello's "This Land is Your Land" at Hands Off NYC anti-ICE protest`,
          description: `Tom Morello covered Woody Guthrie's "This Land is Your Land" at a Hands Off NYC protest against Trump-era ICE abuses targeting immigrant New Yorkers — share the clip as a singalong for your own local action.`,
          authorName: "Consequence / Tom Morello", authorRole: "TikTok creator",
          authorLink: "https://www.tiktok.com/@consequence",
          targetUrl: "https://www.tiktok.com/@consequence",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 3 } },
      ];

      // Helper: fetch external image, upload to the action-images bucket, return
      // the stable Supabase public URL. Falls back to the external URL on error
      // so the card still shows *something* — admin can re-upload via Edit.
      async function importImage(srcUrl: string): Promise<string> {
        try {
          const res = await fetch(srcUrl, { headers: { "User-Agent": "Mozilla/5.0 ResistActMigration" } });
          if (!res.ok) { console.log(`Image fetch ${res.status} for ${srcUrl}`); return srcUrl; }
          const contentType = res.headers.get("content-type") ?? "image/jpeg";
          const buf = await res.arrayBuffer();
          const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "jpg";
          const key = `etsy-creators-import-${crypto.randomUUID()}.${ext}`;
          const supabase = adminClient();
          const BUCKET = "action-images";
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, buf, { contentType, upsert: false });
          if (upErr) { console.log(`Image upload failed for ${srcUrl}:`, upErr.message); return srcUrl; }
          const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(key);
          return urlData.publicUrl;
        } catch (err) {
          console.log(`Image error for ${srcUrl}:`, err);
          return srcUrl;
        }
      }

      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const base = Math.max(...(currentIds.length ? currentIds : [1305]), 1305);
      const nowIso = new Date().toISOString();
      const cardsEtsy: any[] = [];
      for (let i = 0; i < incoming.length; i++) {
        const c = incoming[i];
        const topImageUrl = c.sourceImageUrl ? await importImage(c.sourceImageUrl) : undefined;
        cardsEtsy.push({
          id: base + 1 + i,
          category: c.category,
          categoryColor: c.categoryColor,
          actionType: "Online",
          isOnline: true,
          timeCommitment: "5–10 minutes",
          title: c.title,
          description: c.description,
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: c.authorName,
          authorRole: c.authorRole,
          authorLink: c.authorLink,
          targetUrl: c.targetUrl,
          ...(topImageUrl ? { topImageUrl } : {}),
          toneOverride: c.toneOverride,
          // Only auto-approve if we actually resolved an image. Image-less
          // cards must go through the manual Admin → Edit → upload-image →
          // Approve flow, same as any other pending card. This makes the
          // migration safe to re-run on a fresh KV without recreating the
          // approved-without-image situation.
          adminApproved: !!topImageUrl,
          createdAt: nowIso,
        });
      }
      const placedEtsy = await appendUserActionCards(cardsEtsy);
      await setMigrationFlag("migration:etsy-creators-import-2026-05:v1");
      console.log(`Etsy creators import: added ${placedEtsy.length} cards (ids ${placedEtsy.join(", ")}).`);
    }

    // One-time: defensive cleanup for approved-without-image cards.
    //
    // The etsy-creators import on 2026-05 hard-coded adminApproved=true for
    // all 25 cards, including 12 that landed without a header image (Etsy
    // 429s scrapers, TikTok needs JS, etc). The approval-time image gate in
    // /admin/approve-action/:id was bypassed because those cards were
    // written directly to KV from inside the migration.
    //
    // This migration walks every action:* and user-action:* record and, for
    // any record with adminApproved=true but no topImage* field, flips
    // adminApproved back to false so the card re-appears in Admin → Pending.
    // From there an admin can upload an image and approve through the proper
    // gate, or delete the card.
    //
    // The PUT-leak and migration source-code holes are closed in this same
    // release, so this cleanup is one-shot — bad state can't recur.
    const approvedNoImageCleanupDone = await getMigrationFlag("migration:approved-without-image-cleanup:v1");
    if (!approvedNoImageCleanupDone) {
      let flipped = 0;
      const flippedIds: number[] = [];
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          if (c.adminApproved !== true) continue;
          // A cartoon banner counts — it's what the feed renders for the card.
          const hasImage = Boolean(c.topImageUrl) || Boolean(c.topImageKey) || Boolean(c.topImage) || Boolean(c.cartoonImageUrl);
          if (hasImage) continue;
          await kv.set(`${prefix}${c.id}`, { ...c, adminApproved: false });
          flipped++;
          flippedIds.push(c.id);
        }
      }
      await setMigrationFlag("migration:approved-without-image-cleanup:v1");
      console.log(`Approved-without-image cleanup: flipped ${flipped} cards back to pending. IDs: ${flippedIds.join(", ")}`);
    }

    // One-time: import a curated batch from the 2026-05-17 TSV scout output.
    //
    // Source: 27-row spreadsheet of Indivisible / Mobilize / Pol-Rev / Etsy
    // candidates. Manually filtered against existing seed-card URLs and
    // the rules "direct campaign link, harvestable og:image, authorLink ≠
    // targetUrl, no dupes." 20 of the 27 rows were rejected at this stage
    // (existing-card URL collision, homepage-only links, or source_url
    // identical to targetUrl). The surviving 7 rows had their og:image
    // harvested on 2026-05-17 via raw HTML scrape — links below are the
    // live og:image URLs at that scrape time.
    //
    // Cards land with adminApproved=false so they surface in Admin → Pending
    // for one-click approval (which will pass the image gate because we set
    // topImageUrl). The existingUrls pre-check is belt-and-suspenders against
    // URL collision even though we hand-verified.
    const tsvBatch2026May17Done = await getMigrationFlag("migration:tsv-batch-2026-05-17:v1");
    if (!tsvBatch2026May17Done) {
      type TsvCard = {
        category: string;
        categoryColor: string;
        title: string;
        description: string;
        targetUrl: string;
        topImageUrl: string;
        authorName: string;
        authorRole: string;
        authorLink: string;
        isOnline: boolean;
        actionType: string;
        location?: string;
        eventDate?: string;
        toneOverride: { anger: number; comedy: number; subversion: number; hope: number; energy: number };
        amplifiesGroups?: string[];
        timeCommitment?: string;
      };
      const tsvIncoming: TsvCard[] = [
        // Row 2 — Indivisible call to block insurrection slush fund
        { category: "PETITION", categoryColor: "#05737f",
          title: "Tell Senators to Block Trump's $1.8B Insurrection Slush Fund",
          description: "Indivisible call-tool: tell your senator to block Trump's $1.8 billion proposal to pay out the Jan 6 insurrectionists. 5-minute call script with your reps' direct lines.",
          targetUrl: "https://indivisible.org/actions/senate-no-payouts-for-insurrectionists/",
          topImageUrl: "https://indivisible.org/wp-content/uploads/2026/05/260522_No-Payouts-for-Insurrectionists_1.jpg",
          authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/",
          isOnline: true, actionType: "Online", timeCommitment: "5–10 minutes",
          toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 2, energy: 2 } },
        // Row 6 — Indivisible petition to end Trump's Cuba blockade
        { category: "PETITION", categoryColor: "#05737f",
          title: "Demand Your Senator End Trump's Blockade on Cuba",
          description: "Indivisible call script targeting Trump's tightened Cuba blockade — humanitarian crisis Trump created by reversing Biden-era easements. 4-minute action.",
          targetUrl: "https://indivisible.org/actions/demand-your-senator-end-trumps-blockade-on-cuba/",
          topImageUrl: "https://indivisible.org/wp-content/uploads/2026/05/250519_End-Trump-s-Blockade-on-Cuba_3.png",
          authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/",
          isOnline: true, actionType: "Online", timeCommitment: "5–10 minutes",
          toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 2 } },
        // Row 8 — Seattle Indivisible NO WAR. NO KINGS rally
        { category: "PROTEST", categoryColor: "#23297e",
          title: "NO WAR. NO KINGS: U Village — Seattle (May 30)",
          description: "Seattle Indivisible's Saturday anti-Trump / anti-Iran-war visibility action at University Village. Recurring NO KINGS protest series targeting Trump's executive overreach.",
          targetUrl: "https://www.mobilize.us/mobilize/event/822442/",
          topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/Image_20260304193116846523.jpeg?w=1200&h=628&fit=crop&bg=FFF",
          authorName: "Seattle Indivisible", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/",
          isOnline: false, actionType: "In Person Group", location: "Washington", eventDate: "2026-05-30",
          toneOverride: { anger: 2, comedy: 1, subversion: 1, hope: 3, energy: 3 } },
        // Row 9 — Southend Indivisible ICE HQ Tukwila visibility action
        { category: "PROTEST", categoryColor: "#23297e",
          title: "Protest ICE Terror at ICE HQ — Tukwila WA (May 29)",
          description: "Southend Indivisible's Friday-morning visibility action outside ICE Seattle HQ in Tukwila, targeting Trump's deportation surge and the ICE office expansion in WA.",
          targetUrl: "https://www.mobilize.us/mobilize/event/944899/",
          topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/IMG_5533%20%281%29_20260203035337181451.jpeg?w=1200&h=628&fit=crop&bg=FFF",
          authorName: "Southend Indivisible", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/",
          isOnline: false, actionType: "In Person Group", location: "Washington", eventDate: "2026-05-29",
          toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"] },
        // Row 14 — Tesla Takedown Boston combined rally
        { category: "PROTEST", categoryColor: "#23297e",
          title: "Trump Takedown — Boston (Jun 13)",
          description: "Tesla Takedown Boston's June 13 in-person action combining Tesla Takedown, Trump Takedown, and No Kings messaging into a single anti-Musk/anti-Trump rally.",
          targetUrl: "https://events.pol-rev.com/events/7fa8eece-013c-4d77-a25f-3f2a87f27e99",
          topImageUrl: "https://events.pol-rev.com/media/d6798d55fcaf4dcebc496f7a3bdd0ddca7450d85c00c6852ae31942e9b8e9975.png?name=boycott%20tmobile.png",
          authorName: "Tesla Takedown Boston", authorRole: "Movement Organization", authorLink: "https://events.pol-rev.com/",
          isOnline: false, actionType: "In Person Group", location: "Massachusetts", eventDate: "2026-06-13",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 3 } },
        // Row 15 — She Is Me Epstein Files protest walk interest meeting
        { category: "MEETING", categoryColor: "#5a3e9e",
          title: "Interest Meeting for Epstein Protest Walk DC (Jun 10)",
          description: "She Is Me's interest meeting for a planned Epstein Files protest walk in DC, targeting Trump's refusal to release the Epstein client list. Camden County NJ for the meeting.",
          targetUrl: "https://events.pol-rev.com/events/308acc70-547b-4c1b-a606-0584dee69852",
          topImageUrl: "https://events.pol-rev.com/media/16de76e41e2952aca18f20568acba37d294065efaa514b9e7e4357b4b8c18183.jpg?name=1000002421.jpg",
          authorName: "She Is Me", authorRole: "Movement Organization", authorLink: "https://events.pol-rev.com/",
          isOnline: false, actionType: "In Person Group", location: "New Jersey", eventDate: "2026-06-10",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 } },
        // Row 21 — Resist And Defend banner drop Corte Madera
        { category: "PROTEST", categoryColor: "#23297e",
          title: "Protect Immigrants Banner Drop — Corte Madera CA (May 28)",
          description: "Resist And Defend's Thursday-afternoon banner-drop action over a Corte Madera overpass — fast, high-visibility anti-Trump-deportation signage for commuter eyes.",
          targetUrl: "https://www.mobilize.us/mobilize/event/933855/",
          topImageUrl: "https://mobilizeamerica.imgix.net/uploads/event/tamalpais_20260406004508465116.jpg?w=1200&h=628&fit=crop&bg=FFF",
          authorName: "Resist And Defend", authorRole: "Movement Organization", authorLink: "https://www.mobilize.us/mobilize/",
          isOnline: false, actionType: "In Person Group", location: "California", eventDate: "2026-05-28",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 2, energy: 3 }, amplifiesGroups: ["immigrant"] },
      ];

      // Build a set of every existing card URL across both stores so we can
      // skip any TSV row whose targetUrl already lives in the catalog. This
      // is belt-and-suspenders — we hand-checked when assembling the list.
      const existingUrls = new Set<string>();
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (c && typeof c === "object" && typeof c.targetUrl === "string") {
            existingUrls.add(normalizeBulkImportUrl(c.targetUrl));
          }
        }
      }

      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const baseId = Math.max(...(currentIds.length ? currentIds : [1335]), 1335);
      const nowIso = new Date().toISOString();
      const newIds = [...currentIds];
      let added = 0;
      const skippedDupes: string[] = [];

      for (let i = 0; i < tsvIncoming.length; i++) {
        const c = tsvIncoming[i];
        if (existingUrls.has(normalizeBulkImportUrl(c.targetUrl))) {
          skippedDupes.push(c.title);
          continue;
        }
        const id = baseId + 1 + added;
        const card: any = {
          id,
          category: c.category,
          categoryColor: c.categoryColor,
          actionType: c.actionType,
          isOnline: c.isOnline,
          title: c.title,
          description: c.description,
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: c.authorName,
          authorRole: c.authorRole,
          authorLink: c.authorLink,
          targetUrl: c.targetUrl,
          topImageUrl: c.topImageUrl,
          toneOverride: c.toneOverride,
          ...(c.location ? { location: c.location } : {}),
          ...(c.eventDate ? { eventDate: c.eventDate } : {}),
          ...(c.amplifiesGroups ? { amplifiesGroups: c.amplifiesGroups } : {}),
          ...(c.timeCommitment ? { timeCommitment: c.timeCommitment } : {}),
          // Land as pending so the admin reviews each before going live —
          // the rule we hardened earlier ("bulk-write paths must not auto-
          // approve") applies here too. The approve endpoint's image gate
          // will pass because we set topImageUrl, so this is a one-click
          // approval from Admin → Pending.
          adminApproved: false,
          createdAt: nowIso,
          createdBy: "tsv-batch-2026-05-17",
        };
        await kv.set(`user-action:${id}`, card);
        newIds.push(id);
        added++;
      }

      if (added > 0) {
        await kv.set("user-action:ids", newIds);
      }
      await setMigrationFlag("migration:tsv-batch-2026-05-17:v1");
      console.log(`TSV batch 2026-05-17 import: added ${added} cards.${skippedDupes.length ? ` Skipped (URL dupes): ${skippedDupes.join("; ")}` : ""}`);
    }

    // One-time: bulk-mark "Cancel your …" boycott cards as "5–10 minutes".
    // They were stored as "Ongoing" but the actual cancel step is a few clicks.
    const cancelYour10minDone = await getMigrationFlag("migration:cancel-your-10min:v1");
    if (!cancelYour10minDone) {
      let updated = 0;
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          if (typeof c.title !== "string") continue;
          if (!/^cancel your/i.test(c.title)) continue;
          await kv.set(`${prefix}${c.id}`, { ...c, timeCommitment: "5–10 minutes" });
          updated++;
        }
      }
      await setMigrationFlag("migration:cancel-your-10min:v1");
      console.log(`Cancel-your 10-min migration: updated ${updated} cards.`);
    }

    // Seed The Smacks receipts. Bump the version key whenever SEED_RECEIPTS changes.
    const receiptsSeeded = await getMigrationFlag("seed:receipts:v2");
    if (!receiptsSeeded) {
      await setMigrationFlag("seed:receipts:v2");
      const existingIds = ((await kv.get("receipt:ids")) ?? []) as number[];
      const idSet = new Set(existingIds);
      const newIds = [...existingIds];
      for (const r of SEED_RECEIPTS) {
        const existing = (await kv.get(`receipt:${r.id}`)) as any;
        const merged: any = { boosts: 0, createdAt: new Date().toISOString(), ...r };
        if (existing && typeof existing === "object") {
          if (typeof existing.boosts === "number") merged.boosts = existing.boosts;
        }
        await kv.set(`receipt:${r.id}`, merged);
        if (!idSet.has(r.id)) { idSet.add(r.id); newIds.push(r.id); }
      }
      await kv.set("receipt:ids", newIds);
      console.log(`Seeded ${SEED_RECEIPTS.length} receipts into The Smacks.`);
    }

    // One-time: add three Common Cause actions as approved user-action cards.
    const commonCauseDone = await getMigrationFlag("migration:common-cause-actions:v1");
    if (!commonCauseDone) {
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const base = Math.max(...(currentIds.length ? currentIds : [1305]), 1305);
      const now = new Date().toISOString();
      const newCards = [
        {
          id: base + 1,
          category: "PETITION",
          categoryColor: "#05737f",
          actionType: "Online",
          isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Reject Trump’s “War First, People Last” budget",
          description: "Trump’s $1.5 trillion budget slashes food assistance, healthcare, and education while boosting Pentagon spending. Tell Congress to reject it.",
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: "Common Cause",
          authorRole: "Movement Organization",
          targetUrl: "https://www.commoncause.org/actions/reject-trumps-1-5-trillion-war-first-people-last-budget/",
          topImageKey: "org_common-cause",
          adminApproved: true,
          createdAt: now,
        },
        {
          id: base + 2,
          category: "PETITION",
          categoryColor: "#05737f",
          actionType: "Online",
          isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Reject funding for ICE and Trump’s ballroom",
          description: "Congress is being asked to fund mass deportations and Trump’s private ballroom in the same bill. Tell your reps to vote no.",
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: "Common Cause",
          authorRole: "Movement Organization",
          targetUrl: "https://www.commoncause.org/actions/reject-funding-for-ice-and-trumps-ballroom/",
          topImageKey: "org_common-cause",
          adminApproved: true,
          createdAt: now,
        },
        {
          id: base + 3,
          category: "PETITION",
          categoryColor: "#05737f",
          actionType: "Online",
          isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Tell Congress: block Trump’s mail voting executive order",
          description: "Trump’s executive order targets mail voting — a cornerstone of election access. Urge Congress to push back before this takes effect.",
          spotsTotal: "Unlimited",
          boosts: 0,
          authorName: "Common Cause",
          authorRole: "Movement Organization",
          targetUrl: "https://www.commoncause.org/actions/tell-congress-block-trumps-mail-voting-eo/",
          topImageKey: "org_common-cause",
          adminApproved: true,
          createdAt: now,
          amplifiesGroups: ["voter"],
        },
      ];
      const placedCC = await appendUserActionCards(newCards);
      await setMigrationFlag("migration:common-cause-actions:v1");
      console.log(`Added ${placedCC.length} Common Cause action cards (ids ${placedCC.join(", ")}).`);
    }

    // One-time migration: add local/Mobilize action cards sourced from spreadsheet
    const mobilizeLocalDone = await getMigrationFlag("migration:mobilize-local-actions:v1");
    if (!mobilizeLocalDone) {
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const base = Math.max(...(currentIds.length ? currentIds : [1400]), 1400);
      const now = new Date().toISOString();
      const newCards = [
        {
          id: base + 1,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Sabey Corp: Cancel Your New ICE Office Lease",
          description: "Trump's $45B ICE expansion requires private landlords to take the contracts — Sabey Corp signed a new Tukwila WA lease. Indivisible Southend rallies outside the property every other Wednesday, 4pm PDT. Show up, make the lease politically toxic.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Southend Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/952561/",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 2,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Eastside Bucket Drum for Democracy",
          description: "Indivisible Bellevue's weekly Saturday bucket drum protest — bring a 5-gallon bucket and sticks, make noise outside the Bellevue federal-office corridor against Trump regime corruption and ICE escalation.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Bellevue", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/954905/",
          eventDate: "2026-05-23",
          toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 3,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Federal Building Fridays — Protest Trump Regime",
          description: "Recurring Friday 11:30am PDT protest at the Seattle Federal Building organized by Southend Indivisible. Visibility against Trump-administration corruption, ICE raids, and rule-of-law violations.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Southend Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/944909/",
          toneOverride: { anger: 3, comedy: 1, subversion: 1, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 4,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Good Trouble — John Lewis Bridge #TeslaTakedownTuesday Northgate",
          description: "Tuesday morning 9am PDT Tesla Takedown overpass action at the John Lewis Memorial Bridge in Seattle's Northgate. Anti-Musk-DOGE signage. Pairs Lewis legacy with anti-Trump-administration messaging.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Seattle Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/810382/",
          toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 5,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Delaware",
          timeCommitment: "1–3 hours",
          title: "Honk and Wave Rallies vs. Trump Regime Corruption — Wilmington DE",
          description: "Indivisible Highlands and Beyond runs a Thursday 4:30pm EDT honk-and-wave rally in Wilmington DE specifically calling out Trump administration corruption, ICE expansion, and authoritarian creep. Low-barrier visibility action.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Highlands and Beyond", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/950956/",
          toneOverride: { anger: 3, comedy: 1, subversion: 1, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 6,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "1–3 hours",
          title: "Citrus Heights Resists ICE!",
          description: "Sunrise Solidarity + Coalition Against Project 2025 host a Saturday 10am PDT visibility rally in Citrus Heights CA explicitly opposing ICE raids and Project 2025 implementation. Every Saturday.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Sunrise Solidarity / Coalition Against Project 2025", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/892133/",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 7,
          category: "EMAIL CAMPAIGN", categoryColor: "#c2185b",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Sign up for Washington for All's ICE Mobilization Alerts",
          description: "Washington Indivisible Network's text/email alert list — 12,000+ supporters get pinged when ICE moves in Washington State so volunteers can deploy as legal observers and family-notification callers against Trump's mass deportation operation.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Washington Indivisible Network", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/868208/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 8,
          category: "MEETING", categoryColor: "#5a3e9e",
          actionType: "In Person Group", isOnline: false, location: "Illinois",
          timeCommitment: "1–3 hours",
          title: "BloNo IL — Shut the Flock Off In-Person Meeting",
          description: "Bloomington-Normal organizing meeting to campaign against Flock ALPR camera-surveillance network that Trump-administration ICE uses for warrantless tracking. Anti-surveillance organizing as direct counter-infrastructure to deportation raids.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Shut The Flock Off BLoNo/MC", authorRole: "Movement Organization",
          targetUrl: "https://events.pol-rev.com/",
          eventDate: "2026-05-20",
          toneOverride: { anger: 3, comedy: 1, subversion: 3, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 9,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "New York",
          timeCommitment: "1–3 hours",
          title: "ICE Out For Good — Know Your Rights Canvass, Greenwich Village NYC",
          description: "Friday canvass in Greenwich Village to hand Know Your Rights red cards to immigrant workers and document ICE lawyers' walking routes. Trump-era ICE buildout meets street-level legal-education counter-pressure. Volunteer-organized via Indivisible.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible NY", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/956018/",
          eventDate: "2026-05-29",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 10,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "New York",
          timeCommitment: "1–3 hours",
          title: "Know Your Rights Canvass — South Bronx",
          description: "Saturday canvass in the South Bronx with Target Majority NYC and Swing Left — direct neighborhood outreach to protect immigrants and workers from Trump-era ICE raids. Recurring Saturday action.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Swing Left / Target Majority NYC", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/859108/",
          eventDate: "2026-05-23",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 11,
          category: "MENTAL HEALTH", categoryColor: "#6b5b95",
          actionType: "Online", isOnline: true,
          timeCommitment: "1–3 hours",
          title: "Cat-Lady-Palooza Twooza: Revenge of the Cat Ladies",
          description: "Free live virtual event from Cat Ladies for America — reclaiming Vance's slur, weaponizing it into an anti-MAGA fundraising spectacle. Comedy, music, organizing announcements. RSVP now.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Cat Ladies for America", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/945793/",
          eventDate: "2026-09-13",
          toneOverride: { anger: 1, comedy: 3, subversion: 3, hope: 3, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 12,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "New York",
          timeCommitment: "1–3 hours",
          title: "Hands Off NYC Small Business Canvass for Immigrant Safety",
          description: "Canvass with Indivisible Harlem + Neighbors United for Immigrant Safety. Visit small businesses in immigrant-heavy NYC neighborhoods with sanctuary-policy materials and Know Your Rights packets. Direct counter-organizing against Trump deportation raids.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Harlem", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/838849/",
          eventDate: "2026-05-20",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 13,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "1–3 hours",
          title: "Venice & Santa Monica NO WARS! Weekly Protest",
          description: "Indivisible Westside LA's weekly Thursday 4pm PDT visibility action in Venice/Santa Monica targeting Trump's Iran escalation and broader Middle East military buildup.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Westside Los Angeles", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/893106/",
          toneOverride: { anger: 3, comedy: 1, subversion: 1, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 14,
          category: "CRAFTING", categoryColor: "#c34e00",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Whistle Kit Making Party — Indivisible Eastside Redmond",
          description: "Crafting party in Redmond WA to assemble emergency whistle kits for neighbors to use when ICE is spotted. Practical mutual-aid prep dressed up as a party.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Eastside", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/877951/",
          eventDate: "2026-05-19",
          toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 15,
          category: "Act of Kindness", categoryColor: "#d97706",
          actionType: "In Person Group", isOnline: false, location: "Illinois",
          timeCommitment: "1–3 hours",
          title: "We The People: Popsicle & Ice Cream Social — Chicago",
          description: "Indivisible Greater West Loop's block party: free popsicles + ice cream + voter-protection sign-ups + Know Your Rights info against Trump-era ICE raids. Pun-titled summer recruitment event.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Greater West Loop", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/952624/",
          eventDate: "2026-06-06",
          toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 3, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 16,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington, DC",
          timeCommitment: "1–3 hours",
          title: "Petworth ICE Out: No Cooperation With the Occupation",
          description: "DC visibility action in Petworth — explicit anti-ICE messaging framing Trump's deportation campaign as occupation. Indivisible DC volunteer-organized. Recurring monthly.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible DC", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/955498/",
          eventDate: "2026-06-07",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 17,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Maryland",
          timeCommitment: "1–3 hours",
          title: "Bad Ass Bridge Brigade Overpass Wave — Gaithersburg MD",
          description: "DC-metro overpass wave with Indivisible Gaithersburg. Anti-Trump-corruption signage on commuter bridges. Visibility builds across MD/DC commuters.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Gaithersburg", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/853172/",
          eventDate: "2026-05-19",
          toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 18,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Florida",
          timeCommitment: "Ongoing",
          title: "Krome Vigil with Chinga La Migra — Miami",
          description: "Chinga La Migra crew runs ongoing demonstrations and candlelight vigils at Krome Service Processing Center — the Miami ICE detention site where Trump-era overcrowding has produced documented medical neglect. Show up; in-person presence shifts press coverage.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Chinga La Migra Crew", authorRole: "Movement Organization",
          targetUrl: "https://www.instagram.com/chingalamigracrew/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 19,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "Ongoing",
          title: "Join La Resistencia Evening Vigils at Northwest ICE Processing Center",
          description: "La Resistencia runs frequent evening vigils outside the GEO-Group-run Tacoma facility — especially during hunger strikes and deportation-flight observations. Bring candles, witness names of people detained under Trump's expanded enforcement.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "La Resistencia", authorRole: "Movement Organization",
          targetUrl: "https://laresistencianw.org/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 20,
          category: "EMAIL CAMPAIGN", categoryColor: "#c2185b",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Tell Tacoma City Council: Revoke NWDC's Business License",
          description: "La Resistencia's pressure campaign — Washington State health inspectors are still being denied entry to NWDC. Email Tacoma councilmembers to revoke the facility's business license.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "La Resistencia", authorRole: "Movement Organization",
          targetUrl: "https://laresistencianw.org/",
          toneOverride: { anger: 3, comedy: 0, subversion: 3, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 21,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "Ongoing",
          title: "Volunteer for LA Rapid Response Network ICE Hotline",
          description: "CHIRLA's LA Rapid Response Network needs more dispatchers and verifiers — when neighbors call the hotline reporting ICE activity, RRN volunteers verify, document, and notify families. Direct counter-infrastructure to Trump's deportation surge.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "CHIRLA / LA Rapid Response Network", authorRole: "Movement Organization",
          targetUrl: "https://www.chirla.org/",
          toneOverride: { anger: 2, comedy: 0, subversion: 3, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 22,
          category: "FUNDING", categoryColor: "#127f05",
          actionType: "Online", isOnline: true, location: "Multi-State",
          timeCommitment: "5–10 minutes",
          title: "Donate to CASA — Frontline Defense for MD/VA/PA Immigrants",
          description: "CASA defends immigrants across Maryland, Virginia, and Pennsylvania with deportation defense legal teams, member organizing, and Know Your Rights clinics. Recurring donations fund the lawyers who fight Trump-era ICE detentions case-by-case.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "CASA", authorRole: "Movement Organization",
          targetUrl: "https://wearecasa.org/",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
      ];
      const placedML = await appendUserActionCards(newCards);
      await setMigrationFlag("migration:mobilize-local-actions:v1");
      console.log(`Added ${placedML.length} local/Mobilize action cards (ids ${placedML.join(", ")}).`);
    }

    // One-time migration: add second batch of Mobilize/50501 action cards
    const mobilizeV2Done = await getMigrationFlag("migration:mobilize-actions-v2:v1");
    if (!mobilizeV2Done) {
      const currentIds = ((await kv.get("user-action:ids")) ?? []) as number[];
      const base = Math.max(...(currentIds.length ? currentIds : [1500]), 1500);
      const now = new Date().toISOString();
      const newCards = [
        {
          id: base + 1,
          category: "EMAIL CAMPAIGN", categoryColor: "#c2185b",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Vote YES on War Powers Resolution to Stop Trump's Iran War",
          description: "50501 letter campaign urging your member of Congress to vote YES on the War Powers Resolution blocking Trump's unauthorized military escalation against Iran. Targets the actual upcoming roll-call vote.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "50501 Movement", authorRole: "Movement Organization",
          targetUrl: "https://actionnetwork.org/letters/e8187bd3c13d6812ad7e41897d096f8d3ae76f60",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 2,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Plug into 50501's Virtual Actions Hub",
          description: "50501's central page for digital direct actions you can do from home — signal-boost campaigns, virtual call days, and online resistance against the Trump administration. One-stop entry point that updates weekly.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "50501 Movement", authorRole: "Movement Organization",
          targetUrl: "https://www.fiftyfifty.one/virtual-actions",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 3,
          category: "PETITION", categoryColor: "#7b3f00",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Tell Republicans: Not One Penny More for ICE Brutality",
          description: "Indivisible petition to GOP Members of Congress demanding they stop funding Trump's ICE brutality — targeted at GOP votes on the upcoming appropriations bill.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://act.indivisible.org/sign/tell-your-republican-members-of-congress-not-one-penny-more-for-ice/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 4,
          category: "EMAIL CAMPAIGN", categoryColor: "#c2185b",
          actionType: "Online", isOnline: true,
          timeCommitment: "5–10 minutes",
          title: "Urge Democrats to Oppose Shoveling Billions More to ICE",
          description: "Indivisible action urging Democratic members of Congress to fiercely oppose the new GOP push to dump billions more into ICE and Border Patrol expansion under Trump's deportation surge.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://act.indivisible.org/sign/urge-democrats-fiercely-oppose-new-gop-effort-shovel-billions-more-dollars-ice-and-border-patrol/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 5,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Massachusetts",
          timeCommitment: "1–3 hours",
          title: "NO KINGS, STOP WAR WITH IRAN — 4th of July Standout, Beverly MA",
          description: "July 4 Beverly MA standout combining No Kings anti-Trump messaging with anti-Iran-war demand. Held by local 50501-aligned organizers on Independence Day for maximum visibility.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "50501 Affiliate", authorRole: "Movement Organization",
          targetUrl: "https://events.pol-rev.com/events/6d4fbb73-d6b4-44d5-8379-37338fece86d",
          eventDate: "2026-07-04",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 6,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Missouri",
          timeCommitment: "1–3 hours",
          title: "TOGETHER ACROSS JOPLIN — Hands Across America 2.0",
          description: "50501 Joplin MO chapter organizing a Hands-Across-America-style human chain action themed around mutual aid and standing together against the Trump administration. Bring a friend, bring snacks.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Joplin 50501", authorRole: "Movement Organization",
          targetUrl: "https://events.pol-rev.com/events/2e05238c-3a49-4c94-b91e-53255de8c71e",
          eventDate: "2026-05-25",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 7,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Florida",
          timeCommitment: "1–3 hours",
          title: "All of U.S. 250 — Fort Myers Visibility Brigade Standout",
          description: "Fort Myers Visibility Brigade standout at U.S. 250 — visibility action against the Trump administration with handmade signs, banners and honk-and-wave. Recurring brigade format.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Fort Myers Visibility Brigade", authorRole: "Movement Organization",
          targetUrl: "https://events.pol-rev.com/events/787666e6-592e-43e5-85f9-0cf0131663d2",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 8,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "NO KINGS. NO OLIGARCHS: Seattle Yesler Overpass Banner Drop",
          description: "Seattle Indivisible Tuesday-morning overpass banner action at the Yesler Way overpass denouncing Trump and the oligarchy he leads. Recurring slot, drop in any week.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Seattle Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/791326/",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 9,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "NO ICE EXPANSION: Rally at Sabey Corp HQ (Tukwila WA)",
          description: "Southend Indivisible rally at Sabey Corp HQ demanding they cancel the new office lease they signed with ICE. Direct corporate pressure to deny ICE the physical space to expand operations.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Southend Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/933915/",
          toneOverride: { anger: 3, comedy: 1, subversion: 3, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 10,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Protest ICE Terror at ICE HQ — Tukwila WA Friday Morning Rally",
          description: "Recurring Friday-morning protest outside the Seattle-area ICE HQ in Tukwila, organized by Southend Indivisible. Direct sustained pressure on the agency carrying out Trump's mass deportation surge.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Southend Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/944898/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 11,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "New York",
          timeCommitment: "1–3 hours",
          title: "De-ICE Citizens Bank Yonkers — National Day of Action",
          description: "National Day of Action targeting Citizens Bank in Yonkers for its banking relationship with ICE detention contractors. Boycott + on-site rally combo at 2195 Central Park Ave.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "De-ICE Citizens Bank", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/954480/",
          eventDate: "2026-06-06",
          toneOverride: { anger: 3, comedy: 1, subversion: 3, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 12,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "1–3 hours",
          title: "Aida4LA Canvassing — LA Immigrant Defense Brigade",
          description: "Daily morning canvass with Aida4LA in Los Angeles, signing up residents for ICE-watch deployment alerts and door-knocking on Trump's deportation policies. Multiple shifts per week.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Aida 4 LA", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/932835/",
          toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 13,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Oregon",
          timeCommitment: "1–3 hours",
          title: "PDX Car Caravan Protest: Flag Day / DJT's Unhappy Birthday Party",
          description: "Portland car-caravan protest framed as Trump's unhappy-birthday party — rolling visibility action with decorated cars, satirical signage, and a parade route through the city.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "PDX Car Caravan Protest", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/916101/",
          eventDate: "2026-06-14",
          toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 14,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Oregon",
          timeCommitment: "1–3 hours",
          title: "Stand Together — Boycott Bezos, ICE Out, No War, NO KINGS! (Portland)",
          description: "Portland District 2 Neighbors Indivisible recurring Sunday rally combining four targets: boycott Bezos, ICE out, no war on Iran, no kings. Multi-issue intersectional anti-Trump action.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Portland District 2 Neighbors Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/950119/",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 15,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Banners Over I-5: No War In Iran (Vancouver WA)",
          description: "Indivisible Greater Vancouver freeway-overpass banner drop on I-5 demanding no war with Iran. High-visibility weekday rush-hour action against Trump's military escalation.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Greater Vancouver", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/823132/",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 16,
          category: "TRAINING", categoryColor: "#1a6b3c",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "1–3 hours",
          title: "Volunteer Training: Rapid Response to ICE Actions (Fremont CA)",
          description: "Indivisible Fremont's volunteer training on how to respond when ICE shows up — legal observer protocols, recording, hotline workflow, and de-escalation. Mandatory for new rapid-response volunteers.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Fremont CA", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/943590/",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 17,
          category: "TRAINING", categoryColor: "#1a6b3c",
          actionType: "Online", isOnline: true,
          timeCommitment: "1–3 hours",
          title: "BLAG: \"CommUNITY Melts ICE\" — Panel with Twin Cities Organizers",
          description: "Biggest Little Action Group hosts a virtual panel with Wes Burdine and Twin Cities organizers on how communities can \"melt ICE\" — practical chapter-organizing strategies, mass mobilization, and direct action against Trump's deportation infrastructure.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Biggest Little Action Group", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/951961/",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 18,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "Online", isOnline: true, location: "Multi-State",
          timeCommitment: "Ongoing",
          title: "NDLON Adopt-A-School: ICE Watch at K-12 Schools",
          description: "National Day Laborer Organizing Network's program assigning volunteer 'adopters' to specific schools to maintain ICE-presence watch at student arrival/dismissal. Direct response to Trump-administration ICE raids at K-12 schools.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "National Day Laborer Organizing Network", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/942116/",
          toneOverride: { anger: 2, comedy: 0, subversion: 3, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 19,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "California",
          timeCommitment: "1–3 hours",
          title: "Tesla Takedown — Stanford Mall, Palo Alto",
          description: "The Wolves' recurring Saturday Tesla Takedown action at the Stanford Shopping Center Tesla showroom — Bay Area location targeting Musk-DOGE and the Trump administration's tech-billionaire alliance.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "The Wolves", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/879712/",
          toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 2, energy: 3 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 20,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington, DC",
          timeCommitment: "1–3 hours",
          title: "Let's Get Free! March & Concert — Washington DC",
          description: "Popular Democracy's July 9 march and concert in Washington DC demanding freedom from Trump's deportation, detention, and policing surge. Mass mobilization with cultural programming.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Popular Democracy", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/942279/",
          eventDate: "2026-07-09",
          toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 3, energy: 3 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 21,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "In Person Group", isOnline: false, location: "Georgia",
          timeCommitment: "Ongoing",
          title: "Volunteer with El Refugio at Stewart Detention Center (Lumpkin GA)",
          description: "El Refugio provides hospitality and visitation to immigrants detained at Stewart Detention Center — one of the largest ICE facilities in Trump's expanded detention system. Shifts include visiting detained people, hosting families, and accompaniment.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "El Refugio", authorRole: "Movement Organization",
          targetUrl: "https://elrefugiostewart.org/en/volunteers",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 3, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 22,
          category: "JOIN A GROUP", categoryColor: "#9c2779",
          actionType: "Online", isOnline: true,
          timeCommitment: "Ongoing",
          title: "#NoTechForIce: Join Mijente's Tech-Worker Campaign",
          description: "Mijente's flagship campaign pressuring tech companies (Palantir, Amazon, Microsoft) to stop building surveillance and ICE tooling that powers Trump's deportation machine. Sign on as a tech worker, student, or ally.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Mijente", authorRole: "Movement Organization",
          targetUrl: "https://mijente.net/notechforice/",
          toneOverride: { anger: 3, comedy: 0, subversion: 3, hope: 2, energy: 2 },
          amplifiesGroups: ["immigrant"],
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 23,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "NO WAR. NO KINGS: Tacoma Rally",
          description: "Seattle Indivisible regional rally in Tacoma combining No-Kings anti-Trump messaging with anti-Iran-war demands. Covers the Pierce County / South Sound corridor.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Seattle Indivisible", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/795854/",
          eventDate: "2026-05-23",
          toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
        {
          id: base + 24,
          category: "PROTEST", categoryColor: "#23297e",
          actionType: "In Person Group", isOnline: false, location: "Washington",
          timeCommitment: "1–3 hours",
          title: "Spot Protests — Seattle Wedgwood (Recurring)",
          description: "Volunteer-organized recurring Saturday corner-protest in the Seattle Wedgwood neighborhood targeting the Trump administration. Drop-in slot every weekend, low barrier to entry.",
          spotsTotal: "Unlimited", boosts: 0,
          authorName: "Indivisible Volunteer", authorRole: "Movement Organization",
          targetUrl: "https://www.mobilize.us/mobilize/event/939498/",
          toneOverride: { anger: 2, comedy: 0, subversion: 2, hope: 2, energy: 2 },
          adminApproved: false, createdAt: now,
        },
      ];
      const placedMv2 = await appendUserActionCards(newCards);
      await setMigrationFlag("migration:mobilize-actions-v2:v1");
      console.log(`Added ${placedMv2.length} Mobilize/50501 action cards (v2) (ids ${placedMv2.join(", ")}).`);
    }

    // One-time migration: add Resistbot "Empower States to Undo Citizens United" petition card
    const resistbotCitizensDone = await getMigrationFlag("migration:resistbot-citizens-united:v1");
    if (!resistbotCitizensDone) {
      const card = {
        id: 1374,
        category: "EMAIL CAMPAIGN",
        categoryColor: "#c2185b",
        actionType: "Online",
        title: "Sign: Empower States to Undo Citizens United",
        description: "States don't need the Supreme Court or Congress to fight Citizens United — they can limit corporate spending in elections right now by amending state constitutions and corporate charter laws. Montana's Transparent Elections Initiative shows how. Text SIGN PKFEPT to 50409 or sign via Resistbot to urge your governor and legislature to follow.",
        isOnline: true,
        boosts: 8,
        spotsTotal: "Unlimited",
        authorName: "Resistbot",
        authorRole: "Civic Action Platform",
        authorLink: "https://resist.bot/",
        targetUrl: "https://resist.bot/petitions/PKFEPT",
        timeCommitment: "< 5 minutes",
        quickAction: true,
        firstTimerFriendly: true,
        adminApproved: true,
        createdAt: new Date().toISOString(),
      };
      await kv.set(`action:${card.id}`, card);
      await setMigrationFlag("migration:resistbot-citizens-united:v1");
      console.log("Added Resistbot Citizens United petition card (id 1374).");
    }

    // v2: update description to mention Hawaii's success
    const resistbotCitizensV2Done = await getMigrationFlag("migration:resistbot-citizens-united:v2");
    if (!resistbotCitizensV2Done) {
      const existing: any = await kv.get("action:1374");
      if (existing) {
        existing.description = "Hawaii just did it — became the first state to pass legislation rolling back Citizens United. Now we need every state to follow. Text SIGN PKFEPT to 50409 or sign via Resistbot to urge your governor and legislature to use state authority to limit corporate spending in elections. Montana's Transparent Elections Initiative showed the way. Hawaii proved it works. Let's go.";
        await kv.set("action:1374", existing);
      }
      await setMigrationFlag("migration:resistbot-citizens-united:v2");
      console.log("Updated Resistbot Citizens United card with Hawaii success (id 1374).");
    }

    // One-time cleanup: retire cards whose described date has already passed
    // (audit run 2026-05-22). Sierra Club South Coast and Adopt-A-Corner are
    // intentionally kept — Sierra Club is still actively campaigning on the same
    // URL, and Adopt-A-Corner runs through Jan 2029 (the "Jan 20" in the
    // description was a program kickoff, not a deadline).
    // ── Fix mis-tagged quickAction flags (audit 2026-05-24) ────────────────
    // These 15 cards had quickAction: true but their actions aren't actually
    // 5-min (CRAFTING / joining a federation / in-person social events / etc).
    // Clearing the flag drops them out of the "5 Minutes Max" filter; their
    // timeCommitment falls back to the category default in timeBucketFor().
    // PURCHASE cards (1304, 1313, 1337) are intentionally NOT in this list —
    // buying a sticker / shirt / candle is genuinely a 5-min checkout flow.
    // Audit source: reports/audit-2026-05-24.md
    // One-time: recategorize 11 phone-call cards from their mixed homes
    // (EMAIL CAMPAIGN / MENTAL HEALTH / TRAINING / Petition) into the
    // unified "Call" bucket (renamed from "Call/Write" — the bucket only
    // ever held phone-call actions) with the pink #c2185b swatch. The 9
    // seed-card entries are also updated in SEED_CARDS — this migration
    // covers live KV writes (boosts, approvals, edits) that would
    // otherwise win the merge and keep the old category.
    const recatCallDone = await getMigrationFlag("cleanup:recategorize-call-cards:v1");
    if (!recatCallDone) {
      const ids = [125, 133, 1215, 1217, 1259, 1261, 1262, 1264, 1283, 1288, 1290];
      let updated = 0;
      for (const id of ids) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, {
              ...existing,
              category: "Call",
              categoryColor: "#c2185b",
            });
            updated++;
            break;
          }
        }
      }
      await setMigrationFlag("cleanup:recategorize-call-cards:v1");
      console.log(`Recategorized ${updated} of ${ids.length} call cards to Call.`);
    }

    // One-time: redistribute the 19 catch-all gray CALL/WRITE cards into
    // their proper buckets. Most were social-media posts / TikTok films /
    // quote-tweets that got mis-bucketed. See changelog 1.2.50 for details.
    const cwRedistributeDone = await getMigrationFlag("cleanup:cw-redistribute:v1");
    if (!cwRedistributeDone) {
      const moves: Array<[number, string, string]> = [
        // [id, new category, new color]
        // → Social Media (#e44b4b): posts, threads, tweets, films, stitches
        [2331, "Social Media",    "#e44b4b"],
        [2334, "Social Media",    "#e44b4b"],
        [2336, "Social Media",    "#e44b4b"],
        [2343, "Social Media",    "#e44b4b"],
        [2353, "Social Media",    "#e44b4b"],
        [2354, "Social Media",    "#e44b4b"],
        [2360, "Social Media",    "#e44b4b"],
        [2362, "Social Media",    "#e44b4b"],
        [2373, "Social Media",    "#e44b4b"],
        [2377, "Social Media",    "#e44b4b"],
        [2383, "Social Media",    "#e44b4b"],
        // → Letter Writing (#2d7a6b): postcards + formal public comments
        [2255, "Letter Writing",  "#2d7a6b"],
        [2257, "Letter Writing",  "#2d7a6b"],
        [2301, "Letter Writing",  "#2d7a6b"],
        [2312, "Letter Writing",  "#2d7a6b"],
        // → Letter to Editor (#3f5c8c)
        [2297, "Letter to Editor","#3f5c8c"],
        // → Call (#c2185b): the actual call actions + text-bank shift
        // (Category renamed from "Call/Write" — the bucket only ever held
        // phone-call actions; letter-writing has its own category.)
        [2240, "Call",            "#c2185b"],
        [2280, "Call",            "#c2185b"],
        [2316, "Call",            "#c2185b"],
      ];
      let updated = 0;
      for (const [id, category, categoryColor] of moves) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, { ...existing, category, categoryColor });
            updated++;
            break;
          }
        }
      }
      await setMigrationFlag("cleanup:cw-redistribute:v1");
      console.log(`Redistributed ${updated} of ${moves.length} gray CALL/WRITE cards.`);
    }

    // One-time: merge the BOOST color split. 72 bulk-imported Bluesky
    // "Follow & boost @handle" cards landed with #3f3f3f (gray) instead of
    // #8a00e6 (purple) used by the original BOOST newsroom-amplification
    // cards. Same concept, just import drift. Scans all action/user-action
    // records since the affected IDs aren't in SEED_CARDS.
    const boostColorMergeDone = await getMigrationFlag("cleanup:boost-color-merge:v1");
    if (!boostColorMergeDone) {
      let updated = 0;
      for (const prefix of ["action:", "user-action:"]) {
        const all = (await kv.getByPrefix(prefix)) as any[];
        for (const card of all) {
          if (
            card && typeof card === "object" &&
            typeof card.id === "number" &&
            (card.category === "BOOST" || card.category === "Boost") &&
            card.categoryColor === "#3f3f3f"
          ) {
            await kv.set(`${prefix}${card.id}`, { ...card, categoryColor: "#8a00e6" });
            updated++;
          }
        }
      }
      await setMigrationFlag("cleanup:boost-color-merge:v1");
      console.log(`Merged ${updated} gray BOOST cards to purple #8a00e6.`);
    }

    // One-time: reconcile the PERSONAL COMMITMENT color drift. 4 cards
    // landed with #23297e (Protest blue) instead of the canonical #5e1f7a
    // (per BULK_IMPORT_CATEGORY_COLORS). Source SEED_CARDS already updated.
    const pcColorDone = await getMigrationFlag("cleanup:personal-commitment-color:v1");
    if (!pcColorDone) {
      let updated = 0;
      for (const prefix of ["action:", "user-action:"]) {
        const all = (await kv.getByPrefix(prefix)) as any[];
        for (const card of all) {
          if (
            card && typeof card === "object" &&
            typeof card.id === "number" &&
            (card.category === "PERSONAL COMMITMENT" || card.category === "Personal Commitment") &&
            card.categoryColor === "#23297e"
          ) {
            await kv.set(`${prefix}${card.id}`, { ...card, categoryColor: "#5e1f7a" });
            updated++;
          }
        }
      }
      await setMigrationFlag("cleanup:personal-commitment-color:v1");
      console.log(`Reconciled ${updated} Personal Commitment cards to #5e1f7a.`);
    }

    // One-time: fix 8 singleton category-color outliers and mis-categorizations
    // discovered during the 2026-05-25 color audit. Each is a one-off drift
    // from import or a mis-bucketed card.
    const outliersDone = await getMigrationFlag("cleanup:category-outliers-2026-05:v1");
    if (!outliersDone) {
      const fixes: Array<[number, string, string]> = [
        // [id, category, categoryColor]
        [ 230, "Meeting",             "#5a3e9e"], // was MEETING/#23297e (Protest blue) — color drift
        [ 237, "Join a Group",        "#9c2779"], // was JOIN A GROUP/#0891b2 — color drift
        [ 238, "Email Campaign",      "#c2185b"], // was EMAIL CAMPAIGN/#e44b4b (Social red) — color drift
        [1233, "Professional Skills", "#1f635c"], // was PROFESSIONAL SKILLS/#126d89 — color drift (canonical color in SEED_CARDS already fixed)
        [2033, "Join a Group",        "#9c2779"], // was PRAYER/#8a00e6 — Faith in Action federation is a group, not a prayer act
        [2034, "Join a Group",        "#9c2779"], // was LETTER WRITING/#3f3f3f — leading a divestment resolution campaign
        [2109, "Training",            "#126d89"], // was TRAINING/#1a6b3c — color drift
        [2365, "Social Media",        "#e44b4b"], // was Video/#e44b4b — lone "Video" category folded into Social Media
      ];
      let updated = 0;
      for (const [id, category, categoryColor] of fixes) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object") {
            await kv.set(`${prefix}${id}`, { ...existing, category, categoryColor });
            updated++;
            break;
          }
        }
      }
      await setMigrationFlag("cleanup:category-outliers-2026-05:v1");
      console.log(`Fixed ${updated} of ${fixes.length} category/color outliers.`);
    }

    const fixQuickActionMistagsDone = await getMigrationFlag("cleanup:fix-quickaction-mistags:v1");
    if (!fixQuickActionMistagsDone) {
      const idsToFix = [31, 55, 128, 285, 315, 1010, 1076, 1097, 1265, 1269, 1302, 1334, 2033, 2035, 2085];
      let fixed = 0;
      for (const id of idsToFix) {
        for (const prefix of ["action:", "user-action:"]) {
          const existing = (await kv.get(`${prefix}${id}`)) as any;
          if (existing && typeof existing === "object" && existing.quickAction === true) {
            await kv.set(`${prefix}${id}`, { ...existing, quickAction: false });
            fixed++;
            break; // a given id lives in exactly one of the two stores
          }
        }
      }
      await setMigrationFlag("cleanup:fix-quickaction-mistags:v1");
      console.log(`Cleared mis-tagged quickAction on ${fixed} of ${idsToFix.length} cards: ${idsToFix.join(", ")}`);
    }

    // ── Unify all "remote-ish" location values into a single "Remote" ──────
    // Product decision: "Online", "At Home", and "From Home" all collapse to
    // "Remote". A Remote act carries BOTH location:"Remote" AND isOnline:true
    // so every filter path agrees. Also fixes acts created before the form
    // bug fix that had location:"Remote" but isOnline:false. Idempotent.
    const unifyRemoteDone = await getMigrationFlag("cleanup:unify-remote-location:v1");
    if (!unifyRemoteDone) {
      const REMOTE_ALIASES = new Set(["Online", "At Home", "From Home", "Remote"]);
      let unified = 0;
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          const loc = (c.location ?? "").trim();
          const isRemoteish = REMOTE_ALIASES.has(loc) || c.isOnline === true || c.atHome === true;
          if (!isRemoteish) continue;
          // Already fully canonical? skip to avoid a needless write.
          if (loc === "Remote" && c.isOnline === true) continue;
          await kv.set(`${prefix}${c.id}`, { ...c, location: "Remote", isOnline: true });
          unified++;
        }
      }
      await setMigrationFlag("cleanup:unify-remote-location:v1");
      console.log(`Unified ${unified} cards to location:"Remote" + isOnline:true.`);
    }

    const retirePastDatedDone = await getMigrationFlag("cleanup:retire-past-dated-2026-05:v1");
    if (!retirePastDatedDone) {
      const retireTitles = new Set([
        "Trans Peoria Community Potluck",
        "Use Ethical Consumer's Trump-boycott guide",
        "Sign the NAACP 25th Amendment petition",
        "Citrus Heights Resists ICE!",
        "Citrus Heights Resists ICE! (Coalition Against Project 2025)",
        "Pretrial Fairness Under Threat — Teach-In",
        "Sign MoveOn's No Unauthorized War with Iran petition",
      ]);

      const removed: { key: string; id: number; title: string }[] = [];

      for (const card of (await kv.getByPrefix("action:")) as any[]) {
        if (card && typeof card === "object" && retireTitles.has(card.title) && typeof card.id === "number") {
          await kv.del(`action:${card.id}`);
          removed.push({ key: `action:${card.id}`, id: card.id, title: card.title });
        }
      }

      const removedUserIds: number[] = [];
      for (const card of (await kv.getByPrefix("user-action:")) as any[]) {
        if (card && typeof card === "object" && retireTitles.has(card.title) && typeof card.id === "number") {
          await kv.del(`user-action:${card.id}`);
          removed.push({ key: `user-action:${card.id}`, id: card.id, title: card.title });
          removedUserIds.push(card.id);
        }
      }
      if (removedUserIds.length > 0) {
        const userIds = ((await kv.get("user-action:ids")) ?? []) as number[];
        await kv.set("user-action:ids", userIds.filter((x) => !removedUserIds.includes(x)));
      }

      await setMigrationFlag("cleanup:retire-past-dated-2026-05:v1");
      console.log(`Retired ${removed.length} past-dated cards:`, removed);
    }

    // One-time: rename the "Call/Write" category to "Call". The bucket only
    // ever contained phone-call actions (letter-writing has its own
    // Letter Writing / Letter to Editor categories), so the slash label was
    // misleading. Scans every action: and user-action: record and updates
    // category in place; color stays #c2185b. SEED_CARDS were already
    // updated in the same commit, and the client-side normaliseCategory()
    // alias folds any leftover "Call/Write" strings forward at render time.
    const renameCallWriteDone = await getMigrationFlag("cleanup:rename-call-write-to-call:v1");
    if (!renameCallWriteDone) {
      let updated = 0;
      for (const prefix of ["action:", "user-action:"]) {
        const all = (await kv.getByPrefix(prefix)) as any[];
        for (const card of all) {
          if (
            card && typeof card === "object" &&
            typeof card.id === "number" &&
            card.category === "Call/Write"
          ) {
            await kv.set(`${prefix}${card.id}`, { ...card, category: "Call" });
            updated++;
          }
        }
      }
      await setMigrationFlag("cleanup:rename-call-write-to-call:v1");
      console.log(`Renamed ${updated} cards: Call/Write → Call.`);
    }

    // One-time: un-approve every card whose authorLink points to the same
    // place as targetUrl. These are "go follow / boost the author" cards
    // where the action is just visiting the author's own profile — a soft
    // boost-only pattern that crept past approval. Flipping adminApproved
    // back to false pulls them out of the public feed and back into
    // admin review so the team can decide which ones earn their slot
    // (per the 10% boost-only cap in docs/INBOX_IMPORT.md).
    //
    // URL match is normalized: trim, lowercase, strip a single trailing
    // slash, and ignore http vs https. This catches near-duplicates like
    // https://x.com vs https://x.com/ or HTTP vs HTTPS variants without
    // false-positiving on different paths or query strings.
    const unapproveSelfLinkDone = await getMigrationFlag("cleanup:unapprove-self-link-cards:v1");
    if (!unapproveSelfLinkDone) {
      const normalizeUrl = (u: unknown): string => {
        if (typeof u !== "string") return "";
        let s = u.trim().toLowerCase();
        if (!s) return "";
        s = s.replace(/^https?:\/\//, "");
        if (s.endsWith("/")) s = s.slice(0, -1);
        return s;
      };
      let unapproved = 0;
      const flippedIds: number[] = [];
      for (const prefix of ["action:", "user-action:"]) {
        const all = (await kv.getByPrefix(prefix)) as any[];
        for (const card of all) {
          if (!card || typeof card !== "object" || typeof card.id !== "number") continue;
          if (card.adminApproved === false) continue; // already pending — skip
          const a = normalizeUrl(card.authorLink);
          const t = normalizeUrl(card.targetUrl);
          if (!a || !t) continue;
          if (a !== t) continue;
          await kv.set(`${prefix}${card.id}`, {
            ...card,
            adminApproved: false,
            updatedAt: new Date().toISOString(),
            updatedBy: "cleanup:unapprove-self-link",
          });
          flippedIds.push(card.id);
          unapproved++;
        }
      }
      await setMigrationFlag("cleanup:unapprove-self-link-cards:v1");
      console.log(`Un-approved ${unapproved} self-link cards (authorLink ≈ targetUrl). IDs: ${flippedIds.join(", ")}`);
    }

    // One-time: collapse four deprecated category buckets into surviving
    // siblings, plus rename a fifth (Purchase → Represent).
    //   Learn             → Training
    //   Letter to Editor  → Letter Writing
    //   Bird-Dog          → Show Up
    //   Spread Positivity → Act of Kindness
    //   Purchase          → Represent (rename, same color)
    // The on-card category pill, the Navbar filter chip, and the
    // EditCardModal dropdown already drop the deprecated names. The
    // client-side normaliseCategory() alias map folds any leftover stored
    // values forward at render time, so the feed never visually breaks
    // during the rollout. This migration tidies KV so the data matches.
    const categoryMerge1Done = await getMigrationFlag("cleanup:category-merge-2026-05:v1");
    if (!categoryMerge1Done) {
      // case-insensitive match on the source category, with the canonical
      // target (and the target's color) overriding both.
      const moves: Array<{ from: RegExp; target: string; color: string }> = [
        { from: /^(?:learn)$/i,              target: "Training",        color: "#3a6d80" },
        { from: /^(?:letter to editor)$/i,   target: "Letter Writing",  color: "#c34e00" },
        { from: /^(?:bird[-\s]?dog)$/i,      target: "Show Up",         color: "#23297e" },
        { from: /^(?:spread positivity)$/i,  target: "Act of Kindness", color: "#4a7c59" },
        { from: /^(?:purchase)$/i,           target: "Represent",       color: "#b45309" },
      ];
      let renamed = 0;
      const counts: Record<string, number> = {};
      for (const prefix of ["action:", "user-action:"]) {
        const all = (await kv.getByPrefix(prefix)) as any[];
        for (const card of all) {
          if (!card || typeof card !== "object" || typeof card.id !== "number") continue;
          const cat = typeof card.category === "string" ? card.category : "";
          const move = moves.find((m) => m.from.test(cat));
          if (!move) continue;
          await kv.set(`${prefix}${card.id}`, {
            ...card,
            category: move.target,
            categoryColor: move.color,
            updatedAt: new Date().toISOString(),
            updatedBy: "cleanup:category-merge-2026-05",
          });
          counts[move.target] = (counts[move.target] || 0) + 1;
          renamed++;
        }
      }
      await setMigrationFlag("cleanup:category-merge-2026-05:v1");
      console.log(`Category merge: renamed ${renamed} cards`, counts);
    }

    // PERF: in-process cache + parallel KV reads. The catalog (~600 cards)
    // changes infrequently relative to read traffic (admins approve cards
    // every few minutes; boosts trickle; user submissions are sparse), so
    // a short TTL (15s) cache eliminates almost all KV round-trips on warm
    // requests. Cache is explicitly invalidated by mutation endpoints below.
    const now = Date.now();
    let assembled: any[];
    let cacheStatus: "hit" | "miss" = "miss";
    const tStart = Date.now();
    if (actionsCache && (now - actionsCache.ts) < ACTIONS_CACHE_TTL_MS) {
      assembled = actionsCache.cards;
      cacheStatus = "hit";
      console.log(`/actions cache hit (age ${now - actionsCache.ts}ms)`);
    } else {
      // PERF: parallelize the three independent KV reads (was sequential).
      const tKvStart = Date.now();
      const [allActionCardsRaw, userCardIdsRaw, userActionRecordsRaw] = await Promise.all([
        kv.getByPrefix("action:"),
        kv.get("user-action:ids"),
        kv.getByPrefix("user-action:"),
      ]);
      console.log(`/actions KV fetch took ${Date.now() - tKvStart}ms`);

      const seenIds = new Set<number>();
      assembled = [];
      for (const card of allActionCardsRaw as any[]) {
        if (card && typeof card === "object" && typeof card.id === "number" && !seenIds.has(card.id)) {
          seenIds.add(card.id);
          assembled.push(card);
        }
      }

      const userCardIds = (userCardIdsRaw ?? []) as number[];
      const userCardIdSet = new Set(userCardIds);
      for (const card of userActionRecordsRaw as any[]) {
        if (!card || typeof card !== "object" || typeof card.id !== "number") continue;
        if (!userCardIdSet.has(card.id)) continue;
        if (seenIds.has(card.id)) continue;
        seenIds.add(card.id);
        assembled.push(card);
      }

      assembled.sort((a, b) => a.id - b.id);
      actionsCache = { cards: assembled, ts: now };
    }

    const total = assembled.length;
    const cards = assembled.slice(offset, offset + limit);

    console.log(`Returning ${cards.length} of ${total} action cards (offset=${offset}, limit=${limit}, cache=${cacheStatus}, total handler ${Date.now() - tStart}ms).`);
    c.header("X-Cache", cacheStatus);
    c.header("X-Handler-Ms", String(Date.now() - tStart));
    return c.json({ cards, total });
  } catch (err) {
    console.log("Error in GET /actions:", err);
    return c.json({ error: `Failed to fetch actions: ${err}` }, 500);
  }
});

// ─── GET /stats — live city count + user count ────────────────────────────────
app.get("/make-server-9eb1ae04/stats", async (c) => {
  try {
    // Gather all cards
    const seenIds = new Set<number>();
    const allCards: any[] = [];
    for (const card of await kv.getByPrefix("action:")) {
      if (card && typeof card === "object" && typeof card.id === "number" && !seenIds.has(card.id)) {
        seenIds.add(card.id); allCards.push(card);
      }
    }
    // PERF: single batch fetch (was a per-id loop with ~450 sequential round-trips)
    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    const userCardIdSet = new Set(userCardIds);
    const userActionRecords = (await kv.getByPrefix("user-action:")) as any[];
    for (const card of userActionRecords) {
      if (!card || typeof card !== "object" || typeof card.id !== "number") continue;
      if (!userCardIdSet.has(card.id)) continue;
      if (seenIds.has(card.id)) continue;
      seenIds.add(card.id);
      allCards.push(card);
    }

    // Distinct non-empty locations = cities
    const cities = new Set<string>();
    for (const card of allCards) {
      if (card.location && typeof card.location === "string" && card.location.trim()) {
        cities.add(card.location.trim());
      }
    }
    const citiesCount = cities.size;

    // Count approved/pending/all users
    const users = await kv.getByPrefix("user:approval:");
    const validUsers = (users as any[]).filter((u) => u && typeof u === "object" && u.userId);
    const usersCount = validUsers.length;
    const pendingUsersCount = validUsers.filter((u) => u.status === "pending").length;

    const pendingActsCount = allCards.filter((c: any) => c.adminApproved === false).length;

    // Active user-submitted flags awaiting admin review. Cheap — just a
    // prefix scan since dismissed flags are deleted, not flagged.
    const flagsCount = ((await kv.getByPrefix("flag:")) as any[])
      .filter((f) => f && typeof f === "object" && f.id).length;

    const siteUpdating = (await kv.get("system:site-updating")) === true;

    console.log(`Stats: ${allCards.length} acts (${pendingActsCount} pending), ${citiesCount} cities, ${usersCount} users (${pendingUsersCount} pending), ${flagsCount} flags`);
    return c.json({ citiesCount, usersCount, pendingUsersCount, pendingActsCount, flagsCount, actsCount: allCards.length, siteUpdating });
  } catch (err) {
    console.log("Stats error:", err);
    return c.json({ error: `Failed to fetch stats: ${err}` }, 500);
  }
});

// ─── GET /me/preferences ──────────────────────────────────────────────────────
// Returns the signed-in user's stored match-me preferences (or null if none).
app.get("/make-server-9eb1ae04/me/preferences", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);
    const prefs = await kv.get(`user:preferences:${user.id}`);
    return c.json({ preferences: prefs ?? null });
  } catch (err) {
    console.log("Get preferences error:", err);
    return c.json({ error: `Failed to load preferences: ${err}` }, 500);
  }
});

// ─── PUT /me/preferences ──────────────────────────────────────────────────────
// Stores the user's match-me prefs as-is. Shape validation happens client-side
// when the prefs are read back via loadPreferences(); duplicating it here would
// just couple the schema to the server.
app.put("/make-server-9eb1ae04/me/preferences", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);
    const body = await c.req.json();
    if (!body || typeof body !== "object") {
      return c.json({ error: "Body must be an object" }, 400);
    }
    await kv.set(`user:preferences:${user.id}`, {
      ...body,
      userId: user.id,
      updatedAt: new Date().toISOString(),
    });
    return c.json({ success: true });
  } catch (err) {
    console.log("Save preferences error:", err);
    return c.json({ error: `Failed to save preferences: ${err}` }, 500);
  }
});

// ─── GET /me/bookmarks ────────────────────────────────────────────────────────
app.get("/make-server-9eb1ae04/me/bookmarks", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);
    const bookmarks = (await kv.get(`user-bookmarks:${user.id}`)) ?? [];
    return c.json({ bookmarks });
  } catch (err) {
    return c.json({ error: `Failed to load bookmarks: ${err}` }, 500);
  }
});

// ─── PUT /me/bookmarks — bulk replace ────────────────────────────────────────
app.put("/make-server-9eb1ae04/me/bookmarks", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);
    const body = await c.req.json().catch(() => null);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: any) => typeof id === "number") : [];
    await kv.set(`user-bookmarks:${user.id}`, ids);
    return c.json({ ok: true, count: ids.length });
  } catch (err) {
    return c.json({ error: `Failed to save bookmarks: ${err}` }, 500);
  }
});

// ─── POST /share-invite — send email invites to friends ──────────────────────
app.post("/make-server-9eb1ae04/share-invite", async (c) => {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return c.json({ error: "Email service not configured" }, 503);

  try {
    const { emails, note } = await c.req.json<{ emails: string[]; note?: string }>();
    if (!Array.isArray(emails) || emails.length === 0) {
      return c.json({ error: "No email addresses provided" }, 400);
    }

    const siteUrl = "https://resistact.us";
    const defaultMsg = `I've been using ResistAct to find small, doable actions every day to push back on what's happening in America. Check it out — new actions every day, pick what fits your schedule and mood!\n\n${siteUrl}`;
    const body = note ? `${note}` : defaultMsg;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "ResistAct <noreply@resistact.org>",
        to: emails,
        subject: "Actions you can take today — ResistAct",
        text: body,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.log("Resend error:", err);
      return c.json({ error: "Failed to send" }, 500);
    }

    return c.json({ ok: true });
  } catch (err) {
    console.log("Share invite error:", err);
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── POST /notifications — save ACTer notification preferences ─────────────────
app.post("/make-server-9eb1ae04/notifications", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);

    const prefs = await c.req.json();
    await kv.set(`user:notifications:${user.id}`, {
      ...prefs,
      userId: user.id,
      updatedAt: new Date().toISOString(),
    });
    console.log(`Saved notification prefs for ${user.email}`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Notifications error:", err);
    return c.json({ error: `Failed to save preferences: ${err}` }, 500);
  }
});

// ─── Relevance checker ────────────────────────────────────────────────────────
// Heuristic scan of a submitted card's text. Returns true if the content looks
// clearly off-topic for an anti-Trump / MAGA-resistance site.
// Logic: award points for resistance signals, penalise for red-flag signals.
// If red flags outweigh resistance signals by enough, flag as not-on-topic.
// ─── URL safety validator ────────────────────────────────────────────────────
// Public-feed cards expose targetUrl / authorLink / topImageUrl through
// <a href> and <img src>. React auto-escapes text content, but it CANNOT
// neutralize an `href="javascript:..."` — clicking the link would run the
// payload as the victim's browser. We reject any non-http(s)/mailto scheme
// on submission, edit, AND admin approval so dirty data can't slip through
// any path.
//
// Returns { ok: true } for empty / null / undefined (URLs are optional);
// returns { ok: false, reason } for any URL with a disallowed scheme.
function validateSubmittedUrl(value: unknown, field: string): { ok: true } | { ok: false; reason: string } {
  if (value == null) return { ok: true };
  const raw = String(value).trim();
  if (raw === "") return { ok: true };

  // Allow protocol-relative (//host/path) — browsers infer http(s) at runtime.
  if (raw.startsWith("//")) return { ok: true };
  // Allow site-relative paths.
  if (raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../")) return { ok: true };

  // Anything with a scheme prefix must match the allowlist. Note: scheme
  // matching is case-insensitive AND tolerates whitespace + tab control
  // chars between letters ("java\tscript:") because some browsers do too.
  const schemeMatch = raw.match(/^\s*([a-zA-Z][a-zA-Z0-9+.\-]*)\s*:/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    const ALLOWED = new Set(["http", "https", "mailto", "sms", "tel"]);
    if (!ALLOWED.has(scheme)) {
      return { ok: false, reason: `${field}: \"${scheme}:\" URLs are not allowed.` };
    }
    return { ok: true };
  }

  // No scheme + not a relative path → treat as bare host (e.g. "example.com").
  // Browsers will follow it as http://example.com, which is safe.
  return { ok: true };
}

function looksOffTopic(title: string, description: string, category: string): boolean {
  const text = `${title} ${description} ${category}`.toLowerCase();

  // Categories that are inherently resistance-adjacent — never flag these.
  const onTopicCategories = [
    "protest", "boycott", "petition", "letter", "email campaign",
    "phone calling", "social media", "flash mob", "funding", "training", "meeting",
    "join a group", "news story", "labor", "legal", "professional skills",
    "mental health", "prayer", "amplify", "boost", "spread positivity", "crafting",
    "transportation", "housing", "other", "irreverence", "personal commitment",
  ];
  if (onTopicCategories.some((c) => category.toLowerCase().includes(c))) return false;

  // Resistance / political relevance signals — each adds 1 point.
  const resistanceTerms = [
    "trump", "maga", "resist", "resistance", "protest", "boycott",
    "fascis", "authoritar", "democrat", "republican", "congress", "senate",
    "legislat", "vote", "election", "policy", "civil rights", "immigrant",
    "deportat", "abortion", "repro", "lgbtq", "trans", "climate", "union",
    "labor rights", "worker", "petition", "rally", "march", "activist",
    "organiz", "campaign", "movement", "solidarity", "justice", "equity",
    "inequality", "discrimination", "rights", "freedom", "constitution",
    "executive order", "white house", "administration", "government",
    "federal", "supreme court", "aclu", "indivisible", "50501",
  ];

  // Strong off-topic red flags — each adds 2 penalty points.
  const redFlagTerms = [
    "crypto", "bitcoin", "nft", "forex", "trading", "stock tip",
    "weight loss", "diet pill", "supplement", "mlm", "multi-level",
    "make money", "earn money", "passive income", "side hustle",
    "adult content", "casino", "gambling", "lottery",
    "buy now", "limited time offer", "discount code", "promo code",
    "follow me", "subscribe to my", "check out my channel",
  ];

  const resistanceScore = resistanceTerms.filter((t) => text.includes(t)).length;
  const redFlagScore = redFlagTerms.filter((t) => text.includes(t)).length * 2;

  // Flag as off-topic only if red flags dominate AND there are no resistance signals.
  return redFlagScore > 0 && resistanceScore === 0;
}

// ─── POST /actions/create — submit a new user-created ASK ─────────────────────
app.post("/make-server-9eb1ae04/actions/create", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid token" }, 401);

    const approval = await kv.get(`user:approval:${user.id}`) as any;
    if (!approval || approval.status !== "approved") {
      return c.json({ error: "Your account must be approved before posting." }, 403);
    }

    const { title, synopsis, description, category, categoryColor, location, isOnline, spotsTotal, sponsor, link, targetUrl: targetUrlField, authorName: reqAuthorName, authorRole: reqAuthorRole, authorLink, vettingInfo, actionType, timeCommitment, quickAction, topImageUrl, imageContain, toneOverride, amplifiesGroups } =
      await c.req.json<{
        title: string; synopsis?: string; description: string; category: string; categoryColor: string;
        location?: string; isOnline?: boolean; spotsTotal: number | "Unlimited";
        sponsor?: string; link?: string; targetUrl?: string;
        authorName?: string; authorRole?: string; authorLink?: string;
        vettingInfo?: string; actionType?: string;
        timeCommitment?: string; quickAction?: boolean;
        topImageUrl?: string | null; imageContain?: boolean;
        toneOverride?: { anger?: number; comedy?: number; subversion?: number; care?: number; hope?: number; energy?: number };
        amplifiesGroups?: string[];
      }>();

    if (!title || !description || !category) {
      return c.json({ error: "title, description and category are required" }, 400);
    }

    // URL safety — block javascript:/data:/file:/vbscript: schemes on any
    // user-facing link or image. React doesn't escape `href=` or `src=`, so
    // these are the only XSS vector once admins approve a card.
    for (const [field, value] of [
      ["targetUrl", targetUrlField ?? link],
      ["authorLink", authorLink],
      ["topImageUrl", topImageUrl],
    ] as Array<[string, unknown]>) {
      const check = validateSubmittedUrl(value, field);
      if (!check.ok) return c.json({ error: check.reason }, 400);
    }

    // Auto-increment ID, always staying above the max seed card ID (1301)
    // to avoid collisions between user-submitted cards and seed cards
    const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
    const nextId = Math.max(...currentIds, 1305) + 1;

    const offTopic = looksOffTopic(title, description, category);

    const card = {
      id: nextId,
      category: category.toUpperCase(),
      categoryColor,
      title,
      synopsis: synopsis?.trim() || undefined,
      description,
      location: location || undefined,
      isOnline: isOnline ?? false,
      actionType: actionType ?? (isOnline ? "Online" : "In Person Group"),
      timeCommitment: timeCommitment || undefined,
      quickAction: quickAction === true ? true : undefined,
      sponsor: sponsor || undefined,
      targetUrl: targetUrlField || link || undefined,
      authorLink: authorLink || undefined,
      vettingInfo: vettingInfo || undefined,
      boosts: 0,
      spotsTotal,
      authorName: reqAuthorName || approval.name,
      authorRole: reqAuthorRole || "Citizen Activist",
      authorAvatarKey: null,
      topImageKey: null,
      topImageUrl: topImageUrl || null,
      imageContain: imageContain === true ? true : undefined,
      adminApproved: false,
      ...(offTopic ? { notOnTopic: true } : {}),
      createdAt: new Date().toISOString(),
      createdBy: user.id,
      toneOverride: toneOverride && Object.keys(toneOverride).length > 0 ? toneOverride : undefined,
      amplifiesGroups: Array.isArray(amplifiesGroups) && amplifiesGroups.length > 0 ? amplifiesGroups : undefined,
    };

    await kv.set(`user-action:${nextId}`, card);
    await kv.set("user-action:ids", [...currentIds, nextId]);
    invalidateActionsCache();
    console.log(`User ${approval.name} created ASK #${nextId}: "${title}"${offTopic ? " [AUTO-FLAGGED: off-topic]" : ""}`);
    return c.json({ card });
  } catch (err) {
    console.log("Create action error:", err);
    return c.json({ error: `Failed to create ASK: ${err}` }, 500);
  }
});

// ─── POST /actions/:id/complete — increment completions counter ───────────
// Self-reported "I did this" — anonymous (deduped client-side via localStorage)
// or authenticated (also writes a per-user record for the scoreboard).
app.post("/make-server-9eb1ae04/actions/:id/complete", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    const { delta } = await c.req.json<{ delta: number }>();

    let card = await kv.get(`action:${id}`) as any;

    if (!card) {
      const seedCard = SEED_CARDS.find((s) => s.id === id);
      if (!seedCard) return c.json({ error: `Unknown card id ${id}` }, 404);
      card = { ...seedCard };
      await kv.set(`action:${id}`, card);
    }

    const current = typeof card.completions === "number" ? card.completions : 0;
    card.completions = Math.max(0, current + (delta ?? 1));
    await kv.set(`action:${id}`, card);

    // If a real user is signed in (anon-key tokens won't resolve to a user),
    // persist a per-user record so the scoreboard can aggregate by category.
    // Anonymous (no token / anon-key token) completions get their own
    // bare-bones record under `anon:complete:{ts}:{actionId}` so the admin
    // panel can show a recent-activity feed for not-signed-in visitors —
    // the card-level `completions` counter alone tells us totals but not
    // when or which acts the unsigned-in folks are actually doing.
    const token = c.req.header("Authorization")?.split(" ")[1];
    let attributedToUser = false;
    if (token) {
      const user = await getUser(token);
      if (user) {
        attributedToUser = true;
        const userKey = `complete:${user.id}:${id}`;
        if ((delta ?? 1) > 0) {
          await kv.set(userKey, {
            actionId: id,
            category: card.category ?? "OTHER",
            completedAt: new Date().toISOString(),
          });
        } else {
          await kv.del(userKey);
        }
      }
    }
    if (!attributedToUser && (delta ?? 1) > 0) {
      // Timestamp-prefixed key so we can `like('anon:complete:%')` and
      // sort lexicographically (ISO-8601 sorts the same as chronological).
      // No userId — anon by definition. Decrement (delta < 0) is a no-op
      // on the anon log: we can't tell which of the N anon completions
      // the unticker was reversing, so we leave the audit log immutable.
      const completedAt = new Date().toISOString();
      const anonKey = `anon:complete:${completedAt}:${id}`;
      await kv.set(anonKey, {
        actionId: id,
        title: card.title ?? null,
        category: card.category ?? "OTHER",
        completedAt,
      });
    }

    return c.json({ card });
  } catch (err) {
    console.log("Error updating completion count:", err);
    return c.json({ error: `Failed to update completion: ${err}` }, 500);
  }
});

// ─── GET /me/completions — scoreboard for the signed-in user ──────────────
app.get("/make-server-9eb1ae04/me/completions", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    const records = (await kv.getByPrefix(`complete:${user.id}:`)) as any[];
    const byCategory: Record<string, number> = {};
    const completedIds: number[] = [];
    for (const r of records ?? []) {
      if (!r) continue;
      const cat = (r.category ?? "OTHER").toString().toUpperCase();
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      if (typeof r.actionId === "number") completedIds.push(r.actionId);
    }
    return c.json({
      total: records?.length ?? 0,
      byCategory,
      completedIds,
    });
  } catch (err) {
    console.log("Error fetching completions:", err);
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── ADMIN: GET /admin/users/:id/activity — full activity dashboard ────────
// Returns the same shape as /me/completions (total, byCategory, completedIds)
// plus the user's approval record AND a reverse-chronological list of their
// last N completions enriched with the action title. The client computes the
// tier from `total` via getUserTier() — keeps the math in one place.
app.get("/make-server-9eb1ae04/admin/users/:id/activity", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const targetId = c.req.param("id");
    const approval = await kv.get(`user:approval:${targetId}`) as any;
    if (!approval) return c.json({ error: "User not found" }, 404);

    const records = ((await kv.getByPrefix(`complete:${targetId}:`)) ?? []) as any[];

    // Aggregate the counts.
    const byCategory: Record<string, number> = {};
    const completedIds: number[] = [];
    for (const r of records) {
      if (!r) continue;
      const cat = (r.category ?? "OTHER").toString().toUpperCase();
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      if (typeof r.actionId === "number") completedIds.push(r.actionId);
    }

    // Build the recent-activity timeline (last 50). Resolve action titles by
    // doing a single batch fetch — most cards live under `action:*` but a
    // handful are user-submitted under `user-action:*`, so try both.
    const sorted = [...records]
      .filter((r) => r?.completedAt)
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, 50);

    const timeline = await Promise.all(sorted.map(async (r) => {
      let card = await kv.get(`action:${r.actionId}`) as any;
      if (!card) card = await kv.get(`user-action:${r.actionId}`) as any;
      return {
        actionId: r.actionId,
        category: r.category ?? "OTHER",
        completedAt: r.completedAt,
        title: card?.title ?? `Action #${r.actionId}`,
        targetUrl: card?.targetUrl ?? null,
      };
    }));

    const lastActiveAt = sorted[0]?.completedAt ?? null;

    return c.json({
      user: approval,
      total: records.length,
      byCategory,
      completedIds,
      lastActiveAt,
      timeline,
    });
  } catch (err) {
    console.log("Admin user activity error:", err);
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── ADMIN: POST /admin/impersonate/:id — start a view-as session ─────────────
// Returns everything the client needs to render the target user's view:
// approval record (name + status), Match Me preferences, bookmarks,
// completions (so completed cards drop to the bottom), boosted IDs, and
// streak count. The client overlays these on top of its normal state for
// the duration of the impersonation. NO writes — this is read-only.
//
// Every call writes an audit row at
//   audit:impersonation:{adminId}:{targetId}:{iso-timestamp}
// with action="start" so we have a trail for the kind of "did anyone look
// at my account?" question that pops up after the fact.
app.post("/make-server-9eb1ae04/admin/impersonate/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const targetId = c.req.param("id");
    const approval = await kv.get(`user:approval:${targetId}`) as any;
    if (!approval) return c.json({ error: "User not found" }, 404);

    // Block impersonating yourself — pointless and clutters the audit log.
    if (admin.user.id === targetId) {
      return c.json({ error: "Cannot impersonate yourself" }, 400);
    }

    // Pull everything per-user in parallel. None of these is huge; doing
    // them serially would add ~5 round-trips of latency for no reason.
    const [prefs, bookmarks, completionRecords, boostRecords, streakKv] = await Promise.all([
      kv.get(`user:preferences:${targetId}`),
      kv.get(`user-bookmarks:${targetId}`),
      kv.getByPrefix(`complete:${targetId}:`),
      kv.getByPrefix(`boost:${targetId}:`),
      kv.get(`streak:${targetId}`),
    ]) as [any, any, any[], any[], any];

    // Same aggregation shape /me/completions returns so the client can
    // drop this in without conditional logic on which slot to read.
    const byCategory: Record<string, number> = {};
    const completedIds: number[] = [];
    for (const r of (completionRecords ?? [])) {
      if (!r) continue;
      const cat = (r.category ?? "OTHER").toString().toUpperCase();
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      if (typeof r.actionId === "number") completedIds.push(r.actionId);
    }
    const boostedIds: number[] = ((boostRecords ?? []) as any[])
      .filter(Boolean)
      .map((r: any) => r.actionId)
      .filter((id: unknown) => typeof id === "number");

    // Write the audit row. Best-effort: if this fails we still return the
    // snapshot, but log loudly so it's visible in function logs.
    const startedAt = new Date().toISOString();
    try {
      await kv.set(`audit:impersonation:${admin.user.id}:${targetId}:${startedAt}`, {
        action: "start",
        adminId: admin.user.id,
        adminName: admin.record?.name ?? null,
        targetId,
        targetName: approval.name ?? null,
        startedAt,
      });
    } catch (err) {
      console.log("audit:impersonation write failed (continuing):", err);
    }

    console.log(`Admin ${admin.record?.name ?? admin.user.id} started impersonating ${approval.name ?? targetId}`);
    return c.json({
      approval,
      preferences: prefs ?? null,
      bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
      completions: {
        total: (completionRecords ?? []).length,
        byCategory,
        completedIds,
      },
      boostedIds,
      streak: streakKv ? (streakKv as any).count ?? 1 : 1,
      startedAt,
    });
  } catch (err) {
    console.log("Impersonate error:", err);
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── ADMIN: POST /admin/impersonate/:id/exit — end a view-as session ──────────
// Writes the closing audit row. Client calls this on Exit-banner click.
// Idempotent — multiple exit calls just write extra audit rows; not a problem.
app.post("/make-server-9eb1ae04/admin/impersonate/:id/exit", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const targetId = c.req.param("id");
    const endedAt = new Date().toISOString();
    try {
      await kv.set(`audit:impersonation:${admin.user.id}:${targetId}:${endedAt}`, {
        action: "end",
        adminId: admin.user.id,
        adminName: admin.record?.name ?? null,
        targetId,
        endedAt,
      });
    } catch (err) {
      console.log("audit:impersonation exit write failed (continuing):", err);
    }
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── GET /me/boosts — card IDs this user has boosted ─────────────────────────
app.get("/make-server-9eb1ae04/me/boosts", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    const records = (await kv.getByPrefix(`boost:${user.id}:`)) as any[];
    const boostedIds: number[] = (records ?? [])
      .filter(Boolean)
      .map((r: any) => r.actionId)
      .filter((id: unknown) => typeof id === "number");

    return c.json({ boostedIds });
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── POST /actions/:id/act — increment boosts, return updated card ─────────
app.post("/make-server-9eb1ae04/actions/:id/act", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    const { delta } = await c.req.json<{ delta: number }>();

    let card = await kv.get(`action:${id}`) as any;

    // Card missing (e.g. Act clicked before GET /actions seeded) — seed it now
    if (!card) {
      const seedCard = SEED_CARDS.find((s) => s.id === id);
      if (!seedCard) return c.json({ error: `Unknown card id ${id}` }, 404);
      card = { ...seedCard };
      await kv.set(`action:${id}`, card);
      console.log(`Lazily seeded card ${id} from Act handler.`);
    }

    const current = (typeof card.boosts === "number" ? card.boosts
                   : typeof card.spotsUsed === "number" ? card.spotsUsed
                   : 0);
    card.boosts = Math.max(0, current + (delta ?? 1));
    delete card.spotsUsed;
    await kv.set(`action:${id}`, card);

    // Track per-user boost so the matcher can personalise results.
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (token) {
      const user = await getUser(token);
      if (user) {
        const boostKey = `boost:${user.id}:${id}`;
        if ((delta ?? 1) > 0) {
          await kv.set(boostKey, { actionId: id, boostedAt: new Date().toISOString() });
        } else {
          await kv.del(boostKey);
        }
      }
    }

    return c.json({ card });
  } catch (err) {
    console.log("Error updating act count:", err);
    return c.json({ error: `Failed to update act: ${err}` }, 500);
  }
});

// ─── PUT /actions/:id — edit a card (admin or original author) ────────────────
app.put("/make-server-9eb1ae04/actions/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    const approval = await kv.get(`user:approval:${user.id}`) as any;
    if (!approval || approval.status !== "approved") {
      return c.json({ error: "Your account must be approved to edit acts." }, 403);
    }

    const id = Number(c.req.param("id"));

    // Try seed card first, then user-created card
    let cardKey = `action:${id}`;
    let card = await kv.get(cardKey) as any;
    if (!card) {
      cardKey = `user-action:${id}`;
      card = await kv.get(cardKey) as any;
    }
    if (!card) return c.json({ error: `Card ${id} not found` }, 404);

    // Permission: admin can edit any card; others can only edit cards they created
    const isAdmin = approval.isAdmin === true;
    const isAuthor = card.createdBy && card.createdBy === user.id;
    if (!isAdmin && !isAuthor) {
      return c.json({ error: "You can only edit acts you created." }, 403);
    }

    const body = await c.req.json();

    // URL safety on edit too — admins are usually trustworthy but the QA
    // probe showed this is exactly the kind of field a careless paste could
    // poison. Validate every URL-bearing field present in the body.
    for (const field of ["targetUrl", "authorLink", "topImageUrl"]) {
      if (body[field] !== undefined) {
        const check = validateSubmittedUrl(body[field], field);
        if (!check.ok) return c.json({ error: check.reason }, 400);
      }
    }

    // Strip immutable fields. Admins can additionally set `boosts` directly
    // (used for moderation / corrections); non-admins cannot.
    //
    // SECURITY: `adminApproved` is also stripped here. Approval has a hard
    // image-presence requirement (enforced in /admin/approve-action/:id), and
    // the PUT endpoint has no such check — so accepting `adminApproved: true`
    // in a free-form edit body was a bypass for the image rule. Approval
    // must go through /admin/approve-action/:id only.
    const { id: _id, createdBy: _createdBy, createdAt: _createdAt,
            authorAvatarKey: _avatarKey, topImageKey: _topImageKey,
            adminApproved: _adminApproved,
            boosts: bodyBoosts, ...safeUpdates } = body;

    const updated: any = {
      ...card,
      ...safeUpdates,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
    };
    if (isAdmin && typeof bodyBoosts === "number") {
      updated.boosts = Math.max(0, Math.floor(bodyBoosts));
      delete updated.spotsUsed;
    }

    await kv.set(cardKey, updated);
    invalidateActionsCache();
    console.log(`${approval.name} edited card #${id}: "${updated.title}"`);
    return c.json({ card: updated });
  } catch (err) {
    console.log("Edit card error:", err);
    return c.json({ error: `Failed to edit card: ${err}` }, 500);
  }
});

// ─── GET /admin/actions/pending — cards awaiting approval ────────────────────
app.get("/make-server-9eb1ae04/admin/actions/pending", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const pending: any[] = [];

    // Check all action: cards
    for (const card of (await kv.getByPrefix("action:")) as any[]) {
      if (card && typeof card === "object" && card.adminApproved !== true) {
        pending.push({ ...card, _store: "action" });
      }
    }

    // Check all user-created cards
    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      const card = await kv.get(`user-action:${id}`) as any;
      if (card && typeof card === "object" && card.adminApproved !== true) {
        pending.push({ ...card, _store: "user-action" });
      }
    }

    pending.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    console.log(`Admin ${admin.record.name} fetched ${pending.length} pending cards.`);
    return c.json({ cards: pending });
  } catch (err) {
    console.log("Pending actions error:", err);
    return c.json({ error: `Failed to fetch pending cards: ${err}` }, 500);
  }
});

// ─── POST /admin/approve-action/:id — approve a card ─────────────────────────
app.post("/make-server-9eb1ae04/admin/approve-action/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));

    // Try seed card first, then user-created card
    let cardKey = `action:${id}`;
    let card = await kv.get(cardKey) as any;
    if (!card) {
      cardKey = `user-action:${id}`;
      card = await kv.get(cardKey) as any;
    }
    if (!card) return c.json({ error: `Card ${id} not found` }, 404);

    // Hard rule: a card cannot be approved without an image. Imageless cards
    // render as half-blank tiles in the public feed and look broken — admins
    // must upload one before they can flip approval on.
    const hasImage = Boolean(card.topImageUrl) || Boolean(card.topImageKey) || Boolean(card.topImage) || Boolean(card.cartoonImageUrl);
    if (!hasImage) {
      return c.json({ error: "Card has no image. Upload a header image before approving." }, 400);
    }

    // Defense-in-depth: even if dirty URLs slipped past create-time validation
    // (older records pre-dating that guard), block them here at the last gate
    // before the card goes public.
    for (const field of ["targetUrl", "authorLink", "topImageUrl"]) {
      const check = validateSubmittedUrl(card[field], field);
      if (!check.ok) return c.json({ error: `${check.reason} Edit the card to fix it before approving.` }, 400);
    }

    card.adminApproved = true;
    card.approvedBy = admin.user.id;
    card.approvedAt = new Date().toISOString();
    // Approval implies the admin disagrees with any off-topic signal — clear
    // it so the card doesn't carry a stale "NOT ON TOPIC" badge into live.
    if (card.notOnTopic) delete card.notOnTopic;
    await kv.set(cardKey, card);
    invalidateActionsCache();
    console.log(`Admin ${admin.record.name} approved card #${id}: "${card.title}"`);
    return c.json({ card });
  } catch (err) {
    return c.json({ error: `Approval failed: ${err}` }, 500);
  }
});

// ─── POST /admin/bulk-import — cron-driven import from co-work scout output ──
// Auth: shared static token in Deno env `ADMIN_IMPORT_TOKEN` (not a user JWT)
// so a scheduled remote agent can post without impersonating a user.
// Cards land in user-action storage with `adminApproved: false`, surfacing
// in the AdminPanel "Pending" tab for manual one-click approval.
const BULK_IMPORT_CATEGORY_COLORS: Record<string, string> = {
  "ACT OF KINDNESS": "#0d8c6e",
  "AMPLIFY": "#8a00e6",
  "ART PIECE": "#896312",
  "BIRD-DOG": "#3f3f3f",
  // "BOOST" renamed to "AMPLIFY" (June 2026); kept as a legacy alias so any
  // import still sending the old label resolves to the same color.
  "BOOST": "#8a00e6",
  "BOYCOTT": "#7a1f7a",
  // "CALL" / "CALL/WRITE" renamed to "PHONE CALLING" (June 2026); kept as
  // legacy aliases so any import still sending the old label resolves to the
  // same color.
  "CALL": "#c2185b",
  "CALL/WRITE": "#c2185b",
  "PHONE CALLING": "#c2185b",
  "CRAFTING": "#c34e00",
  "EMAIL CAMPAIGN": "#c2185b",
  "FLASH MOB": "#ff00d5",
  "FUNDING": "#127f05",
  "HOST": "#3f3f3f",
  "HOUSING": "#0a5b89",
  "IRREVERENCE": "#9333ea",
  "JOIN A GROUP": "#9c2779",
  "LABOR": "#a83f1c",
  "LEARN": "#3f3f3f",
  "LETTER TO EDITOR": "#3f5c8c",
  "LETTER WRITING": "#2d7a6b",
  "MEETING": "#5a3e9e",
  "MENTAL HEALTH": "#6b5b95",
  "NEWS STORY": "#3b4a73",
  "OTHER": "#3f3f3f",
  "PERSONAL COMMITMENT": "#5e1f7a",
  "PETITION": "#05737f",
  "PRAYER": "#7d6321",
  "PROFESSIONAL SKILLS": "#1f635c",
  "PROTEST": "#23297e",
  "PURCHASE": "#b45309",
  "SHOW UP": "#3f3f3f",
  "SOCIAL MEDIA": "#e44b4b",
  "SPREAD POSITIVITY": "#d97706",
  "TRAINING": "#126d89",
  "TRANSPORTATION": "#0a6e3f",
  "WITNESS": "#3f3f3f",
};

function normalizeBulkImportUrl(u: string): string {
  if (!u) return "";
  try {
    const p = new URL(u);
    return (p.hostname + p.pathname).toLowerCase().replace(/\/+$/, "");
  } catch {
    return u.toLowerCase().trim();
  }
}

// Fingerprint on (normalized URL + lowercased title) so a batch with many
// distinct events linking to the same aggregator hub (e.g. 13 rallies all
// pointing at mobilize.us/?q=tesla+takedown) doesn't dedupe-collide. Same
// URL + same title = real dupe; same URL + different titles = different
// events that share a hub page.
async function bulkImportFingerprint(targetUrl: string, title: string): Promise<string> {
  const key = `${normalizeBulkImportUrl(targetUrl)}::${title.toLowerCase().trim()}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

app.post("/make-server-9eb1ae04/admin/bulk-import", async (c) => {
  try {
    // Static admin token in a custom header, NOT Authorization — the Edge
    // Function gateway validates the Authorization header as a Supabase JWT
    // (anon key) before our handler runs, so we can't use it for our token.
    const token = c.req.header("X-Admin-Import-Token");
    const expected = Deno.env.get("ADMIN_IMPORT_TOKEN");
    if (!expected) return c.json({ error: "ADMIN_IMPORT_TOKEN not configured on server" }, 500);
    if (!token || token !== expected) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{ cards?: any[]; sourceBatch?: string }>();
    const cards = Array.isArray(body.cards) ? body.cards : [];
    if (cards.length === 0) return c.json({ error: "cards array required" }, 400);

    const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
    let nextId = Math.max(...currentIds, 1271) + 1;
    const updatedIds = [...currentIds];

    const created: { id: number; title: string }[] = [];
    const skipped: { title: string; reason: string; existingId?: number }[] = [];
    const errors: { title: string; error: string }[] = [];

    for (const raw of cards) {
      try {
        const title = String(raw.title ?? "").trim();
        const description = String(raw.description ?? "").trim();
        const rawCategory = String(raw.category ?? "").trim().toUpperCase();
        const targetUrl = String(raw.targetUrl ?? "").trim();

        if (!title || !description || !rawCategory) {
          errors.push({ title: title || "(no title)", error: "title, description, category required" });
          continue;
        }
        const categoryColor = BULK_IMPORT_CATEGORY_COLORS[rawCategory] ?? BULK_IMPORT_CATEGORY_COLORS.OTHER;

        if (targetUrl) {
          const fp = await bulkImportFingerprint(targetUrl, title);
          const existing = await kv.get(`bulk-import:fp:${fp}`) as any;
          if (existing?.id) {
            skipped.push({ title, reason: "duplicate (url+title)", existingId: existing.id });
            continue;
          }
        }

        const isOnline = raw.isOnline === true ||
          (typeof raw.location === "string" && raw.location.toLowerCase() === "online");
        const location = isOnline ? undefined : (raw.location ? String(raw.location).trim() : undefined);

        const id = nextId++;
        const card: any = {
          id,
          category: rawCategory,
          categoryColor,
          title,
          description,
          location,
          isOnline,
          actionType: isOnline ? "Online" : "In Person Group",
          boosts: 0,
          spotsTotal: raw.spotsTotal ?? "Unlimited",
          authorName: String(raw.authorName ?? "Unknown").trim(),
          authorRole: String(raw.authorRole ?? "Movement Organization").trim(),
          synopsis: raw.synopsis ? String(raw.synopsis).trim() : undefined,
          targetUrl: targetUrl || undefined,
          topImageKey: null,
          topImageUrl: raw.topImageUrl ?? null,
          adminApproved: false,
          createdAt: new Date().toISOString(),
          createdBy: "bulk-import",
          importSource: body.sourceBatch ?? "co-work",
          sourceUrl: raw.sourceUrl ?? undefined,
          eventDate: raw.eventDate ?? undefined,
          vettingInfo: raw.vettingInfo ?? undefined,
          toneOverride: (raw.toneOverride && typeof raw.toneOverride === "object" && Object.keys(raw.toneOverride).length > 0)
            ? raw.toneOverride : undefined,
          amplifiesGroups: Array.isArray(raw.amplifiesGroups) && raw.amplifiesGroups.length > 0
            ? raw.amplifiesGroups : undefined,
        };

        await kv.set(`user-action:${id}`, card);
        updatedIds.push(id);
        if (targetUrl) {
          const fp = await bulkImportFingerprint(targetUrl, title);
          await kv.set(`bulk-import:fp:${fp}`, { id, importedAt: card.createdAt, targetUrl: normalizeBulkImportUrl(targetUrl), title });
        }
        created.push({ id, title });
      } catch (rowErr) {
        errors.push({ title: String(raw.title ?? "(unknown)"), error: String(rowErr) });
      }
    }

    if (created.length > 0) {
      await kv.set("user-action:ids", updatedIds);
    }

    console.log(`bulk-import: created=${created.length} skipped=${skipped.length} errors=${errors.length} (source: ${body.sourceBatch ?? "co-work"})`);
    return c.json({ created, skipped, errors });
  } catch (err) {
    console.log("Bulk import error:", err);
    return c.json({ error: `Bulk import failed: ${err}` }, 500);
  }
});

// ─── Admin "Create Card from URL" — AI-assisted card builder ─────────────────
// Three admin-only (JWT) endpoints powering the AdminPanel "Create from URL"
// mode: draft fields from a URL (gpt-4o-mini), generate a cartoon banner
// (gpt-image-1), and create the reviewed card as adminApproved:false.

// Brand cartoon style — kept in sync with scripts/generate-card-art.mjs
// (STYLE_PROMPT, lines ~78-89). If you change one, change the other.
const CARTOON_STYLE_PROMPT =
  "Create a clean modern comic-book illustration inspired by the reference image, adapted for a wide horizontal banner. " +
  "Use the reference for INSPIRATION — capture the subject, mood, and spirit — but feel free to reinvent the composition so it fills a wide banner format well. The reference may be a square photo, a logo, or a portrait; reframe it as a horizontal scene. Keep the same general subject matter (e.g. if the reference shows a protest sign, paint a protest scene; if a phone, paint someone using a phone; if a product, paint someone using or holding it). " +
  "Apply: clean black ink linework (refined, not heavy or grainy), flat colors with light gradient shading, subtle Ben-Day dot accents used sparingly only on skin tones or sky — not all over the image. " +
  "Palette: cream/off-white background as the foundation, warm orange (#ed6624) and soft red as accents, deep navy (#23297e) and rich purple (#5a3e9e) for structure, sky blue for openness, occasional muted teal or green. Optimistic, hopeful, vibrant feeling — not dark or overwhelming. " +
  "COMPOSITION — wide horizontal banner. CRITICAL: place the main subject (especially any face or head) in the UPPER portion of the frame so it stays visible when the banner is cropped to a narrow strip. Heads near the top, weight near the top. Background, hands, props, lower body, or ground can fill the bottom. " +
  "TEXT RULES — short real-word slogans on signs are FINE and on-style (STOP, NO ICE, RESIST, ABOLISH ICE, VOTE NO, NO WAR, etc.). " +
  "BUT NEVER: " +
  "(a) invent fake/nonsense words or gibberish letter combinations. " +
  "(b) render the card's own title as text painted into the image — the title appears separately above the banner in the UI. " +
  "(c) invent logos or fake brand wordmarks. " +
  "If you can't think of a real, accurate word to put on a sign, leave the sign blank or off-frame.";

// Canonical card categories the drafting model may choose from (title case;
// mirrors the AdminPanel/EditCardModal CATEGORY_OPTIONS list).
const CURATED_CATEGORIES = [
  "Act of Kindness", "Amplify", "Art/Performance Art", "Boycott", "Crafting",
  "Email Campaign", "Flash Mob", "Funding", "Host", "Housing", "Irreverence",
  "Join a Group", "Labor", "Letter Writing", "Meeting", "Mental Health", "News Story",
  "Personal Commitment", "Petition", "Phone Calling", "Prayer", "Professional Skills", "Protest",
  "Represent", "Show Up", "Social Media", "Training", "Transportation", "Video",
  "Witness", "Other",
];
const CURATED_LOCATIONS = [
  "Remote", "National", "Multi-State", "Alabama", "Alaska", "Arizona", "Arkansas",
  "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii",
  "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri",
  "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico",
  "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee",
  "Texas", "Utah", "Vermont", "Virginia", "Washington", "Washington DC",
  "West Virginia", "Wisconsin", "Wyoming",
];

const _BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Strip a fetched HTML page down to the few signals the drafting model needs:
 * <title>, og:title/og:description/meta description, og:image, and the visible
 * body text (tags removed, capped). Pure regex — no DOM dep in Deno. */
function extractPageSignals(html: string): { title: string; description: string; ogImage: string; text: string } {
  const meta = (prop: string): string => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
    return (html.match(re)?.[1] ?? html.match(re2)?.[1] ?? "").trim();
  };
  const titleTag = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "").trim();
  const title = meta("og:title") || titleTag;
  const description = meta("og:description") || meta("description");
  const ogImage = meta("og:image");
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { title, description, ogImage, text: body.slice(0, 4000) };
}

async function openaiChatJSON(system: string, user: string): Promise<any> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured on server");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.5,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI chat ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j = await r.json();
  return JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─── POST /admin/cards/from-url — draft a card's fields from a web page ───────
app.post("/make-server-9eb1ae04/admin/cards/from-url", async (c) => {
  try {
    const admin = await requireAdmin(c.req.header("Authorization")?.split(" ")[1]);
    if (!admin) return c.json({ error: "Forbidden" }, 403);
    const { url } = await c.req.json<{ url?: string }>();
    const target = (url ?? "").trim();
    if (!/^https?:\/\//i.test(target)) return c.json({ error: "A valid http(s) URL is required." }, 400);

    let html = "";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(target, { headers: { "User-Agent": _BROWSER_UA }, signal: ctrl.signal });
      clearTimeout(t);
      html = await r.text();
    } catch (e) {
      return c.json({ error: `Couldn't fetch that URL: ${e}. You can still fill the fields in manually.` }, 502);
    }
    const sig = extractPageSignals(html);

    const system =
      "You write civic-action cards for ResistAct, an anti-Trump / pro-democracy resistance platform. " +
      "Given a web page, produce ONE concrete action a user can take themselves. Return STRICT JSON only. " +
      "Fields: title (<=80 chars, verb-led, e.g. 'Call your senators…', 'Show up to…'), " +
      "synopsis (<=100 chars, one plain-language subtitle line — what it is, simply), " +
      "description (1-3 sentences: what to do and why it matters; paraphrase, never copy the page), " +
      `category (EXACTLY one of: ${CURATED_CATEGORIES.join(", ")}), ` +
      `location (EXACTLY one of: ${CURATED_LOCATIONS.join(", ")} — use 'Remote' for online/from-anywhere actions, a US state for place-specific ones), ` +
      "isOnline (boolean — true if it can be done from anywhere/online), " +
      "targetUrl (the best link for taking the action; default to the page URL), " +
      "authorName (the org or group behind it), authorRole (short, e.g. 'Movement Organization'), " +
      "toneOverride (object with integer 0-3 values for anger, comedy, subversion, hope, energy), " +
      "eventDate (YYYY-MM-DD if it's a specific dated event, else null). " +
      "If the page isn't a real action, still produce the best-effort card from what's there.";
    const userMsg =
      `URL: ${target}\nPage title: ${sig.title}\nPage description: ${sig.description}\n\nPage text excerpt:\n${sig.text}`;

    let draft: any;
    try {
      draft = await openaiChatJSON(system, userMsg);
    } catch (e) {
      return c.json({ error: `Drafting failed: ${e}` }, 502);
    }
    // Validate/normalize the few constrained fields.
    if (!CURATED_CATEGORIES.includes(draft.category)) draft.category = "Other";
    if (draft.location && !CURATED_LOCATIONS.includes(draft.location)) draft.location = draft.isOnline ? "Remote" : "National";
    if (!draft.targetUrl) draft.targetUrl = target;

    console.log(`Admin ${admin.record.name} drafted a card from ${target}`);
    return c.json({ draft, refImageUrl: sig.ogImage || null });
  } catch (err) {
    console.log("from-url error:", err);
    return c.json({ error: `from-url failed: ${err}` }, 500);
  }
});

// ─── POST /admin/cards/generate-subtitle — draft a one-line subtitle ──────────
// Focused sibling of /from-url: takes the title + description already in the
// editor (no source URL needed) and returns just a punchy subtitle line. Used
// by the "Generate" button next to the Subtitle field in EditCardModal.
app.post("/make-server-9eb1ae04/admin/cards/generate-subtitle", async (c) => {
  try {
    const admin = await requireAdmin(c.req.header("Authorization")?.split(" ")[1]);
    if (!admin) return c.json({ error: "Forbidden" }, 403);
    const { title, description } = await c.req.json<{ title?: string; description?: string }>();
    if (!title?.trim() && !description?.trim()) {
      return c.json({ error: "A title or description is required." }, 400);
    }

    const system =
      "You write civic-action cards for ResistAct, an anti-Trump / pro-democracy resistance platform. " +
      "Given a card's title and description, write ONE subtitle line that shows directly under the title on the card. " +
      "Rules: <=100 characters, plain everyday language, says simply what the action is or why it matters, " +
      "sentence case, no surrounding quotes, no trailing period, never just repeat the title verbatim. " +
      'Return STRICT JSON only: { "synopsis": "..." }.';
    const userMsg = `Title: ${(title ?? "").trim()}\nDescription: ${(description ?? "").trim()}`;

    let out: any;
    try {
      out = await openaiChatJSON(system, userMsg);
    } catch (e) {
      return c.json({ error: `Subtitle drafting failed: ${e}` }, 502);
    }
    let synopsis = String(out.synopsis ?? "").trim().replace(/^["']|["']$/g, "").trim();
    if (synopsis.length > 100) synopsis = synopsis.slice(0, 100).trim();
    if (!synopsis) return c.json({ error: "No subtitle returned by the model. Try again." }, 502);

    console.log(`Admin ${admin.record.name} generated a subtitle for "${(title ?? "").trim()}"`);
    return c.json({ synopsis });
  } catch (err) {
    console.log("generate-subtitle error:", err);
    return c.json({ error: `generate-subtitle failed: ${err}` }, 500);
  }
});

// ─── POST /admin/cards/generate-image — make a cartoon banner ─────────────────
app.post("/make-server-9eb1ae04/admin/cards/generate-image", async (c) => {
  try {
    const admin = await requireAdmin(c.req.header("Authorization")?.split(" ")[1]);
    if (!admin) return c.json({ error: "Forbidden" }, 403);
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) return c.json({ error: "OPENAI_API_KEY not configured on server" }, 500);

    const { title, description, refImageUrl } = await c.req.json<{ title?: string; description?: string; refImageUrl?: string }>();
    if (!title?.trim()) return c.json({ error: "title required" }, 400);

    // Try image-to-image when we have a usable reference the Deno decoder can
    // read (PNG/JPEG); otherwise fall back to text-to-image. Either way the
    // brand STYLE_PROMPT drives the look.
    let refPng: Uint8Array | null = null;
    if (refImageUrl && /^https?:\/\//i.test(refImageUrl)) {
      try {
        const ir = await fetch(refImageUrl, { headers: { "User-Agent": _BROWSER_UA } });
        const ct = ir.headers.get("content-type") ?? "";
        if (ir.ok && (ct.includes("png") || ct.includes("jpeg") || ct.includes("jpg"))) {
          const img = await Image.decode(new Uint8Array(await ir.arrayBuffer()));
          refPng = await img.encode(); // PNG
        }
      } catch (_e) { /* fall through to text-to-image */ }
    }

    let b64: string | undefined;
    if (refPng) {
      const form = new FormData();
      form.append("model", "gpt-image-1");
      form.append("prompt", CARTOON_STYLE_PROMPT);
      form.append("size", "1536x1024");
      form.append("quality", "medium");
      form.append("n", "1");
      form.append("image", new Blob([refPng], { type: "image/png" }), "ref.png");
      const r = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
      });
      if (!r.ok) return c.json({ error: `Image edit failed: ${(await r.text()).slice(0, 300)}` }, 502);
      b64 = (await r.json())?.data?.[0]?.b64_json;
    } else {
      const prompt = `${CARTOON_STYLE_PROMPT}\n\nThe banner illustrates an action titled "${title.trim()}". ${(description ?? "").trim()} Depict a relevant, on-topic scene. No text painted into the image.`;
      const r = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", quality: "medium", n: 1 }),
      });
      if (!r.ok) return c.json({ error: `Image generation failed: ${(await r.text()).slice(0, 300)}` }, 502);
      b64 = (await r.json())?.data?.[0]?.b64_json;
    }
    if (!b64) return c.json({ error: "No image returned by the model. Try again or tweak the text." }, 502);

    // Downscale the 1536px PNG before storing (render endpoint resizes again at
    // serve time). Reuse the upload pattern from /actions/upload-image.
    let bytes: Uint8Array = b64ToBytes(b64);
    try {
      const img = await Image.decode(bytes);
      if (img.width > RECOMPRESS_MAX_WIDTH) bytes = await img.resize(RECOMPRESS_MAX_WIDTH, Image.RESIZE_AUTO).encode();
    } catch (_e) { /* store as-is */ }

    const supabase = adminClient();
    const BUCKET = "action-images";
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b) => b.name === BUCKET)) {
      await supabase.storage.createBucket(BUCKET, { public: true });
    }
    const objKey = `cartoon-${crypto.randomUUID()}.png`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(objKey, bytes, { contentType: "image/png", upsert: false });
    if (upErr) return c.json({ error: `Upload failed: ${upErr.message}` }, 500);
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(objKey);
    console.log(`Admin ${admin.record.name} generated a cartoon (${refPng ? "edits" : "generations"})`);
    return c.json({ url: urlData.publicUrl });
  } catch (err) {
    console.log("generate-image error:", err);
    return c.json({ error: `generate-image failed: ${err}` }, 500);
  }
});

// ─── POST /admin/cards/create — create a reviewed card (adminApproved:false) ──
app.post("/make-server-9eb1ae04/admin/cards/create", async (c) => {
  try {
    const admin = await requireAdmin(c.req.header("Authorization")?.split(" ")[1]);
    if (!admin) return c.json({ error: "Forbidden" }, 403);
    const raw = await c.req.json<any>();

    const title = String(raw.title ?? "").trim();
    const description = String(raw.description ?? "").trim();
    const rawCategory = String(raw.category ?? "").trim().toUpperCase();
    const targetUrl = String(raw.targetUrl ?? "").trim();
    if (!title || !description || !rawCategory) {
      return c.json({ error: "title, description and category are required" }, 400);
    }
    // URL safety on any user-facing link/image.
    for (const [field, value] of [["targetUrl", targetUrl], ["cartoonImageUrl", raw.cartoonImageUrl], ["topImageUrl", raw.topImageUrl]] as Array<[string, unknown]>) {
      if (value) {
        const check = validateSubmittedUrl(value, field);
        if (!check.ok) return c.json({ error: check.reason }, 400);
      }
    }
    if (targetUrl) {
      const existing = await kv.get(`bulk-import:fp:${await bulkImportFingerprint(targetUrl, title)}`) as any;
      if (existing?.id) return c.json({ error: `A card with this URL + title already exists (#${existing.id}).` }, 409);
    }

    const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
    const id = Math.max(...currentIds, 1271) + 1;
    const isOnline = raw.isOnline === true || (typeof raw.location === "string" && raw.location.toLowerCase() === "remote");
    const categoryColor = String(raw.categoryColor ?? "").trim() || BULK_IMPORT_CATEGORY_COLORS[rawCategory] || BULK_IMPORT_CATEGORY_COLORS.OTHER;

    const card: any = {
      id,
      category: rawCategory,
      categoryColor,
      title,
      synopsis: raw.synopsis ? String(raw.synopsis).trim() : undefined,
      description,
      location: isOnline ? undefined : (raw.location ? String(raw.location).trim() : undefined),
      isOnline,
      actionType: isOnline ? "Online" : "In Person Group",
      boosts: 0,
      spotsTotal: "Unlimited",
      authorName: String(raw.authorName ?? "Unknown").trim(),
      authorRole: String(raw.authorRole ?? "Movement Organization").trim(),
      authorLink: raw.authorLink ? String(raw.authorLink).trim() : undefined,
      targetUrl: targetUrl || undefined,
      topImageKey: null,
      topImageUrl: raw.topImageUrl ?? null,
      cartoonImageUrl: raw.cartoonImageUrl ? String(raw.cartoonImageUrl).trim() : undefined,
      // Created by an admin through the review form — publish live immediately
      // (no pending queue). The admin has already vetted every field here.
      adminApproved: true,
      createdAt: new Date().toISOString(),
      createdBy: "admin-url-tool",
      importSource: "admin-url-tool",
      sourceUrl: raw.sourceUrl ? String(raw.sourceUrl).trim() : (targetUrl || undefined),
      eventDate: raw.eventDate ? String(raw.eventDate).trim() : undefined,
      toneOverride: (raw.toneOverride && typeof raw.toneOverride === "object" && Object.keys(raw.toneOverride).length > 0) ? raw.toneOverride : undefined,
      amplifiesGroups: Array.isArray(raw.amplifiesGroups) && raw.amplifiesGroups.length > 0 ? raw.amplifiesGroups : undefined,
    };

    await kv.set(`user-action:${id}`, card);
    await kv.set("user-action:ids", [...currentIds, id]);
    if (targetUrl) {
      await kv.set(`bulk-import:fp:${await bulkImportFingerprint(targetUrl, title)}`, { id, importedAt: card.createdAt, targetUrl: normalizeBulkImportUrl(targetUrl), title });
    }
    invalidateActionsCache();
    console.log(`Admin ${admin.record.name} created card #${id} via URL tool: "${title}"`);
    return c.json({ card });
  } catch (err) {
    console.log("admin create card error:", err);
    return c.json({ error: `Create failed: ${err}` }, 500);
  }
});

// ─── POST /admin/bulk-update-time-commitment — audit-driven time fixes ───────
// Same auth pattern as bulk-import (static admin token, NOT a user JWT). Built
// for the 2026-05-17 time-commitment audit and reusable for future passes.
// Only `timeCommitment` and `quickAction` are touched; everything else on the
// card is preserved. Supports dryRun:true to preview without writing.
const VALID_TIME_COMMITMENTS = new Set([
  "< 1 hour", "5–10 minutes", "1–3 hours", "Full day", "Ongoing",
]);

app.post("/make-server-9eb1ae04/admin/bulk-update-time-commitment", async (c) => {
  try {
    const token = c.req.header("X-Admin-Import-Token");
    const expected = Deno.env.get("ADMIN_IMPORT_TOKEN");
    if (!expected) return c.json({ error: "ADMIN_IMPORT_TOKEN not configured on server" }, 500);
    if (!token || token !== expected) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{ updates?: any[]; dryRun?: boolean }>();
    const updates = Array.isArray(body.updates) ? body.updates : [];
    const dryRun = body.dryRun === true;
    if (updates.length === 0) return c.json({ error: "updates array required" }, 400);

    const updated: any[] = [];
    const notFound: any[] = [];
    const errors:   any[] = [];

    for (const u of updates) {
      try {
        const id = Number(u.id);
        const tc = String(u.timeCommitment ?? "");
        const qa = u.quickAction === true;
        if (!Number.isFinite(id)) { errors.push({ id: u.id, error: "id must be a number" }); continue; }
        if (!VALID_TIME_COMMITMENTS.has(tc)) {
          errors.push({ id, error: `invalid timeCommitment: "${tc}"` }); continue;
        }

        let cardKey = `action:${id}`;
        let card = await kv.get(cardKey) as any;
        if (!card) {
          cardKey = `user-action:${id}`;
          card = await kv.get(cardKey) as any;
        }
        if (!card) { notFound.push({ id }); continue; }

        const before = { timeCommitment: card.timeCommitment ?? null, quickAction: card.quickAction ?? null };
        const after  = { timeCommitment: tc, quickAction: qa };

        if (!dryRun) {
          await kv.set(cardKey, {
            ...card,
            timeCommitment: tc,
            quickAction: qa,
            updatedAt: new Date().toISOString(),
            updatedBy: "bulk-update-time",
          });
        }
        updated.push({ id, title: card.title, before, after });
      } catch (rowErr) {
        errors.push({ id: u?.id, error: String(rowErr) });
      }
    }

    console.log(`bulk-update-time: updated=${updated.length} notFound=${notFound.length} errors=${errors.length} dryRun=${dryRun}`);
    return c.json({ updated, notFound, errors, dryRun });
  } catch (err) {
    console.log("Bulk update time error:", err);
    return c.json({ error: `Bulk update failed: ${err}` }, 500);
  }
});

// ─── POST /admin/flag-off-topic/:id — mark a card as not-on-topic ────────────
app.post("/make-server-9eb1ae04/admin/flag-off-topic/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));

    let cardKey = `action:${id}`;
    let card = await kv.get(cardKey) as any;
    if (!card) {
      cardKey = `user-action:${id}`;
      card = await kv.get(cardKey) as any;
    }
    if (!card) return c.json({ error: `Card ${id} not found` }, 404);

    card.adminApproved = false;
    card.notOnTopic = true;
    card.flaggedBy = admin.user.id;
    card.flaggedAt = new Date().toISOString();
    await kv.set(cardKey, card);
    invalidateActionsCache();
    console.log(`Admin ${admin.record.name} flagged card #${id} as off-topic: "${card.title}"`);
    return c.json({ card });
  } catch (err) {
    return c.json({ error: `Flag failed: ${err}` }, 500);
  }
});

// ─── POST /admin/unflag-off-topic/:id — clear a not-on-topic flag ────────────
app.post("/make-server-9eb1ae04/admin/unflag-off-topic/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));

    let cardKey = `action:${id}`;
    let card = await kv.get(cardKey) as any;
    if (!card) {
      cardKey = `user-action:${id}`;
      card = await kv.get(cardKey) as any;
    }
    if (!card) return c.json({ error: `Card ${id} not found` }, 404);

    delete card.notOnTopic;
    delete card.flaggedBy;
    delete card.flaggedAt;
    await kv.set(cardKey, card);
    invalidateActionsCache();
    console.log(`Admin ${admin.record.name} cleared off-topic flag on card #${id}: "${card.title}"`);
    return c.json({ card });
  } catch (err) {
    return c.json({ error: `Unflag failed: ${err}` }, 500);
  }
});

// ─── POST /actions/upload-image — upload to Supabase Storage, return URL ─────
// Any authenticated user can upload. Approval is checked when the card is
// submitted, not at image upload time — new users need to upload a photo
// before their account is approved.
app.post("/make-server-9eb1ae04/actions/upload-image", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof file === "string") {
      return c.json({ error: "No file provided." }, 400);
    }

    // Type + size checks
    if (!file.type?.startsWith("image/")) {
      return c.json({ error: "File must be an image." }, 400);
    }
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return c.json({ error: "Image too large (max 5 MB)." }, 400);
    }

    const supabase = adminClient();
    const BUCKET = "action-images";

    // Idempotently ensure the bucket exists and is public.
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b) => b.name === BUCKET)) {
      const { error: createErr } = await supabase.storage.createBucket(BUCKET, { public: true });
      if (createErr) {
        console.log("Bucket creation error:", createErr);
        return c.json({ error: `Storage setup failed: ${createErr.message}` }, 500);
      }
    }

    const reqExt = (file.name?.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const buf = await file.arrayBuffer();

    // Resize-on-upload: cap stored originals so we never warehouse 2000px+
    // camera photos. The feed already serves an 800px render transform on top
    // of this (see storageRenderUrl in App.tsx), but capping the stored bytes
    // shrinks storage, the admin recompress workload, and the render endpoint's
    // per-request cost. PNG/JPEG only — imagescript can't decode WebP/AVIF/GIF,
    // so those (already-compressed formats) pass through untouched. Same
    // RECOMPRESS_MAX_WIDTH / quality used by the admin recompress endpoint.
    let outBuf: ArrayBuffer | Uint8Array = buf;
    let outType = file.type;
    let outExt = reqExt;
    try {
      const ct = file.type.toLowerCase();
      if (ct.includes("png") || ct.includes("jpeg") || ct.includes("jpg")) {
        const img = await Image.decode(new Uint8Array(buf));
        if (img.width > RECOMPRESS_MAX_WIDTH) {
          const isPng = ct.includes("png");
          const resized = img.resize(RECOMPRESS_MAX_WIDTH, Image.RESIZE_AUTO);
          const encoded = isPng ? await resized.encode() : await resized.encodeJPEG(85);
          // Only keep the re-encode if it actually saved bytes.
          if (encoded.length < buf.byteLength) {
            outBuf = encoded;
            outType = isPng ? "image/png" : "image/jpeg";
            outExt = isPng ? "png" : "jpg";
            console.log(`Resize-on-upload: ${img.width}px ${buf.byteLength}B → ${RECOMPRESS_MAX_WIDTH}px ${encoded.length}B`);
          }
        }
      }
    } catch (e) {
      console.log("Resize-on-upload skipped (decode failed, storing original):", e);
    }

    const key = `${crypto.randomUUID()}.${outExt}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(key, outBuf, { contentType: outType, upsert: false });
    if (upErr) {
      console.log("Upload error:", upErr);
      return c.json({ error: `Upload failed: ${upErr.message}` }, 500);
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(key);
    return c.json({ url: urlData.publicUrl });
  } catch (err) {
    console.log("upload-image error:", err);
    return c.json({ error: `Upload error: ${err}` }, 500);
  }
});

// ─── POST /admin/actions/:id/recompress-image — shrink a stored card image ───
// Admin-only. Fetches the card's current `topImageUrl` (must be a Supabase
// storage URL we host), resizes to max 1200px width if larger, re-encodes in
// the same format (PNG or JPEG), uploads the new bytes, and updates the card.
// Skips WebP/AVIF/GIF inputs (imagescript can't decode them or they're already
// optimized). Returns the size before/after.
const RECOMPRESS_MAX_WIDTH = 1200;
const STORAGE_PREFIX = "zkihnylrvdofdbnhmmoq.supabase.co/storage";
app.post("/make-server-9eb1ae04/admin/actions/:id/recompress-image", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const idStr = c.req.param("id");
    const id = Number(idStr);
    if (!Number.isFinite(id)) return c.json({ error: "Invalid id" }, 400);

    // Find the card — try user-action first (more recent), then action.
    let prefix = "user-action:";
    let card = (await kv.get(`${prefix}${id}`)) as any;
    if (!card) {
      prefix = "action:";
      card = (await kv.get(`${prefix}${id}`)) as any;
    }
    if (!card) return c.json({ error: `Card ${id} not found` }, 404);

    const url = card.topImageUrl;
    if (!url) return c.json({ error: "Card has no topImageUrl to recompress" }, 400);
    if (!url.includes(STORAGE_PREFIX)) {
      return c.json({ error: "Can only recompress images hosted in our own Supabase storage" }, 400);
    }

    // Fetch the existing image.
    const res = await fetch(url);
    if (!res.ok) return c.json({ error: `Image fetch failed (${res.status})` }, 502);
    const oldBuf = new Uint8Array(await res.arrayBuffer());
    const oldSize = oldBuf.length;
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();

    // Format filter: imagescript handles PNG + JPEG. Skip everything else.
    let format: "png" | "jpeg";
    if (contentType.includes("png")) format = "png";
    else if (contentType.includes("jpeg") || contentType.includes("jpg")) format = "jpeg";
    else {
      return c.json({
        skipped: true,
        reason: `Unsupported content type for recompression: ${contentType || "unknown"}`,
        oldSize,
      });
    }

    // Decode + optionally resize.
    const img = await Image.decode(oldBuf);
    const origWidth = img.width;
    const origHeight = img.height;
    let processed = img;
    if (origWidth > RECOMPRESS_MAX_WIDTH) {
      processed = img.resize(RECOMPRESS_MAX_WIDTH, Image.RESIZE_AUTO);
    }

    // Re-encode in the same format.
    let newBuf: Uint8Array;
    let ext: string;
    let mime: string;
    if (format === "png") {
      newBuf = await processed.encode();
      ext = "png";
      mime = "image/png";
    } else {
      newBuf = await processed.encodeJPEG(85);
      ext = "jpg";
      mime = "image/jpeg";
    }

    if (newBuf.length >= oldSize) {
      return c.json({
        skipped: true,
        reason: "Recompressed bytes not smaller than original — leaving as-is.",
        oldSize,
        newSize: newBuf.length,
        originalWidth: origWidth,
        originalHeight: origHeight,
      });
    }

    // Upload + update card.
    const supabase = adminClient();
    const BUCKET = "action-images";
    const key = `recompressed-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, newBuf, { contentType: mime, upsert: false });
    if (upErr) return c.json({ error: `Upload failed: ${upErr.message}` }, 500);
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(key);
    const newUrl = urlData.publicUrl;

    await kv.set(`${prefix}${id}`, { ...card, topImageUrl: newUrl });
    console.log(`Admin ${admin.record.name} recompressed card #${id}: ${oldSize} → ${newBuf.length} bytes (${origWidth}x${origHeight} → ${processed.width}x${processed.height})`);

    return c.json({
      success: true,
      oldSize,
      newSize: newBuf.length,
      savings: oldSize - newBuf.length,
      savingsPct: Math.round(100 * (1 - newBuf.length / oldSize)),
      originalWidth: origWidth,
      originalHeight: origHeight,
      newWidth: processed.width,
      newHeight: processed.height,
      newUrl,
    });
  } catch (err) {
    console.log("Recompress error:", err);
    return c.json({ error: `Recompress failed: ${err}` }, 500);
  }
});

// ─── GET /admin/actions/big-images — list cards whose image is oversized ─────
// Admin-only. Iterates all cards (both stores), HEADs each Supabase storage
// URL, returns those with content-length above `threshold` (default 500_000).
// Slower than a normal list because of N HEAD requests; the admin UI calls it
// on-demand when the operator opens the "Big images" tab.
app.get("/make-server-9eb1ae04/admin/actions/big-images", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const threshold = Math.max(1024, Number(c.req.query("threshold") ?? 500_000));

    // Collect every card from both stores.
    const cards: any[] = [];
    for (const c2 of (await kv.getByPrefix("action:")) as any[]) {
      if (c2 && typeof c2 === "object" && typeof c2.id === "number") cards.push({ ...c2, _store: "action" });
    }
    const userIds = ((await kv.get("user-action:ids")) ?? []) as number[];
    for (const id of userIds) {
      const cc = (await kv.get(`user-action:${id}`)) as any;
      if (cc && typeof cc === "object" && typeof cc.id === "number") cards.push({ ...cc, _store: "user-action" });
    }

    // HEAD each Supabase storage URL in parallel batches.
    const candidates = cards.filter((c2) => typeof c2.topImageUrl === "string" && c2.topImageUrl.includes(STORAGE_PREFIX));
    const big: any[] = [];
    const BATCH = 12;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      const results = await Promise.all(slice.map(async (c2) => {
        try {
          const r = await fetch(c2.topImageUrl, { method: "HEAD" });
          if (!r.ok) return null;
          const size = Number(r.headers.get("content-length") ?? "0");
          const ct = r.headers.get("content-type") ?? "?";
          return { card: c2, size, contentType: ct };
        } catch {
          return null;
        }
      }));
      for (const r of results) {
        if (r && r.size >= threshold) {
          big.push({
            id: r.card.id,
            title: r.card.title,
            authorName: r.card.authorName,
            topImageUrl: r.card.topImageUrl,
            size: r.size,
            contentType: r.contentType,
            _store: r.card._store,
          });
        }
      }
    }
    big.sort((a, b) => b.size - a.size);
    return c.json({ cards: big, threshold, total: big.length });
  } catch (err) {
    console.log("Big-images error:", err);
    return c.json({ error: `Failed to list big images: ${err}` }, 500);
  }
});

// ─── GET /admin/actions/url-equals-authorlink — same-URL audit ───────────────
// Admin-only. Lists every card where `targetUrl` and `authorLink` resolve to
// the same URL after a light normalization (lowercase, trailing slash dropped).
// Usually means the bulk-importer pointed both fields at the same source page
// and there's no distinct creator / "more from this author" link to surface.
app.get("/make-server-9eb1ae04/admin/actions/url-equals-authorlink", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const norm = (u: unknown): string => {
      if (typeof u !== "string") return "";
      const t = u.trim().toLowerCase();
      if (!t) return "";
      try {
        const p = new URL(t);
        return (p.hostname + p.pathname + p.search).replace(/\/+$/, "");
      } catch {
        return t.replace(/\/+$/, "");
      }
    };

    const matches: any[] = [];

    const consider = (cc: any, store: string) => {
      if (!cc || typeof cc !== "object" || typeof cc.id !== "number") return;
      const t = norm(cc.targetUrl);
      const a = norm(cc.authorLink);
      if (!t || !a) return;
      if (t !== a) return;
      matches.push({
        id: cc.id,
        title: cc.title,
        authorName: cc.authorName,
        targetUrl: cc.targetUrl,
        authorLink: cc.authorLink,
        adminApproved: cc.adminApproved,
        _store: store,
      });
    };

    for (const cc of (await kv.getByPrefix("action:")) as any[]) consider(cc, "action");
    const userIds = ((await kv.get("user-action:ids")) ?? []) as number[];
    for (const id of userIds) {
      const cc = (await kv.get(`user-action:${id}`)) as any;
      consider(cc, "user-action");
    }

    matches.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    return c.json({ total: matches.length, cards: matches });
  } catch (err) {
    console.log("url-equals-authorlink error:", err);
    return c.json({ error: `Audit failed: ${err}` }, 500);
  }
});

// ─── GET /admin/actions/broken-images — list cards whose topImageUrl 404s ────
// Admin-only. Walks every card from both stores, HEADs each `topImageUrl`. For
// root-relative paths (e.g. "/people-power-united.jpg") prepends `origin`
// (default https://resistact.org) so we can verify the file is actually being
// served by the frontend. Slow (N HEAD requests); the admin UI calls it
// on-demand. Returns cards whose check returned non-2xx or network error.
const DEFAULT_FRONTEND_ORIGIN = "https://resistact.org";
app.get("/make-server-9eb1ae04/admin/actions/broken-images", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const originRaw = c.req.query("origin") || DEFAULT_FRONTEND_ORIGIN;
    if (!/^https?:\/\//.test(originRaw)) return c.json({ error: "origin must start with http(s)://" }, 400);
    const origin = originRaw.replace(/\/$/, "");

    // Collect all cards.
    const cards: any[] = [];
    for (const cc of (await kv.getByPrefix("action:")) as any[]) {
      if (cc && typeof cc === "object" && typeof cc.id === "number") cards.push({ ...cc, _store: "action" });
    }
    const userIds = ((await kv.get("user-action:ids")) ?? []) as number[];
    for (const id of userIds) {
      const cc = (await kv.get(`user-action:${id}`)) as any;
      if (cc && typeof cc === "object" && typeof cc.id === "number") cards.push({ ...cc, _store: "user-action" });
    }

    // CRITICAL: a card displays its cartoon banner when one exists — the
    // frontend renders `effectiveTopImage = cartoonImageUrl ?? topImage`, and
    // cartoonImageUrl is resolved from the cartoon-banners bucket (CDN), not
    // from KV's topImageUrl. The whole catalog has been cartoonized, so for
    // almost every card the topImageUrl is a STALE FALLBACK that is never
    // shown. Checking it produced 100% false positives (e.g. #1349 reported
    // "broken" on its expired TikTok URL while the feed happily shows
    // card-1349.webp). So: pull the set of cartoon-banner card IDs once and
    // skip any card that displays a cartoon — those can never show a broken
    // topImageUrl. We only HTTP-check cards that genuinely render topImageUrl
    // (i.e. have no cartoon banner yet, e.g. a brand-new upload mid-pipeline).
    const cartoonIds = new Set<number>();
    try {
      const supabase = adminClient();
      let offset = 0;
      // Bucket has ~850+ objects; page through in 1000-chunks.
      while (true) {
        const { data: files, error } = await supabase.storage
          .from("cartoon-banners")
          .list("", { limit: 1000, offset });
        if (error || !files || files.length === 0) break;
        for (const f of files) {
          const m = /^card-(\d+)\.webp$/.exec(f.name ?? "");
          if (m) cartoonIds.add(Number(m[1]));
        }
        if (files.length < 1000) break;
        offset += files.length;
      }
    } catch (e) {
      console.log("broken-images: cartoon-banner listing failed, falling back to topImageUrl-only:", e);
    }

    const displaysViaCartoon = cards.filter((cc) => cartoonIds.has(cc.id)).length;
    const candidates = cards.filter(
      (cc) => typeof cc.topImageUrl === "string" && cc.topImageUrl.length > 0 && !cartoonIds.has(cc.id),
    );

    // We use a ranged GET with browser-like headers instead of HEAD. The old
    // HEAD scan massively over-reported (~139 when only ~40 truly fail for
    // users): many hosts reject HEAD with 405, or block this edge function's
    // datacenter IP with 403, while serving the image fine to a real browser
    // on GET. Switching to GET + UA/Referer/Accept recovers most of those
    // false positives.
    //
    // Classification — only count a card as BROKEN when the image genuinely
    // won't load for a user:
    //   • 404 / 410                         → dead
    //   • DNS / SSL / connection failure    → dead
    //   • 2xx but not an image content-type → an HTML error page, not a photo
    //   • a known-expiring social CDN (TikTok / Instagram) returning non-2xx
    //     → these are hotlink-protected and genuinely don't render
    // Ambiguous blocks from OTHER hosts (403/401/429/5xx — almost always
    // anti-bot / datacenter blocking rather than a real dead image) and
    // timeouts are reported as `inconclusive`, NOT broken, so the count
    // reflects reality.
    const EXPIRING_CDN = /tiktokcdn|cdninstagram/i;
    const broken: any[] = [];
    let inconclusive = 0;
    const BATCH = 12;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      const results = await Promise.all(slice.map(async (cc) => {
        const raw = cc.topImageUrl as string;
        const url = raw.startsWith("/") ? `${origin}${raw}` : raw;
        const knownExpiring = EXPIRING_CDN.test(url);
        try {
          const r = await fetch(url, {
            method: "GET",
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
              "Accept": "image/avif,image/webp,image/apng,image/*,*/*",
              "Referer": `${origin}/`,
              "Range": "bytes=0-2047",
            },
            signal: AbortSignal.timeout(12000),
          });
          const ct = (r.headers.get("content-type") ?? "").toLowerCase();
          // Cancel the body so the connection frees up — we only needed status.
          try { await r.body?.cancel(); } catch { /* ignore */ }
          if (r.ok) {
            if (ct && !ct.startsWith("image/")) {
              return { card: cc, status: r.status, fullUrl: url, error: null, reason: "non-image", kind: "broken" };
            }
            return null; // genuinely fine
          }
          if (r.status === 404 || r.status === 410) {
            return { card: cc, status: r.status, fullUrl: url, error: null, reason: "not-found", kind: "broken" };
          }
          if (knownExpiring) {
            return { card: cc, status: r.status, fullUrl: url, error: null, reason: "expiring-cdn", kind: "broken" };
          }
          // 403/401/429/5xx from a normal host → most likely blocking us, not dead.
          return { card: cc, status: r.status, fullUrl: url, error: null, reason: "blocked", kind: "inconclusive" };
        } catch (e) {
          const name = (e as { name?: string })?.name ?? "";
          if (name === "TimeoutError" || name === "AbortError") {
            return { card: cc, status: 0, fullUrl: url, error: "timeout", reason: "timeout", kind: "inconclusive" };
          }
          // Real DNS / SSL / connection failure → the image won't load.
          return { card: cc, status: 0, fullUrl: url, error: String(e), reason: "network", kind: "broken" };
        }
      }));
      for (const r of results) {
        if (!r) continue;
        if (r.kind === "inconclusive") { inconclusive++; continue; }
        broken.push(r);
      }
    }

    broken.sort((a, b) => (a.card.id ?? 0) - (b.card.id ?? 0));
    return c.json({
      origin,
      scanned: candidates.length,
      total: broken.length,
      inconclusive,
      displaysViaCartoon,
      cards: broken.map((b) => ({
        id: b.card.id,
        title: b.card.title,
        authorName: b.card.authorName,
        topImageUrl: b.card.topImageUrl,
        fullUrl: b.fullUrl,
        status: b.status,
        error: b.error,
        reason: b.reason,
        adminApproved: b.card.adminApproved,
        _store: b.card._store,
      })),
    });
  } catch (err) {
    console.log("Broken-images error:", err);
    return c.json({ error: `Failed to scan broken images: ${err}` }, 500);
  }
});

// ─── DELETE /actions/:id — admin-only card removal ────────────────────────────
app.delete("/make-server-9eb1ae04/actions/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));

    // Try seed card first
    const seedCard = await kv.get(`action:${id}`);
    if (seedCard) {
      await kv.del(`action:${id}`);
      invalidateActionsCache();
      console.log(`Admin ${admin.record.name} deleted seed card #${id}`);
      return c.json({ success: true });
    }

    // Try user-created card
    const userCard = await kv.get(`user-action:${id}`);
    if (userCard) {
      await kv.del(`user-action:${id}`);
      const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
      await kv.set("user-action:ids", currentIds.filter((x) => x !== id));
      invalidateActionsCache();
      console.log(`Admin ${admin.record.name} deleted user card #${id}`);
      return c.json({ success: true });
    }

    return c.json({ error: `Card ${id} not found` }, 404);
  } catch (err) {
    console.log("Delete card error:", err);
    return c.json({ error: `Failed to delete card: ${err}` }, 500);
  }
});

// ─── POST /feedback — collect beta user feedback ─────────────────────────────
app.post("/make-server-9eb1ae04/feedback", async (c) => {
  try {
    const body = await c.req.json();
    const { type, message, email, name } = body;
    if (!message?.trim()) return c.json({ error: "Message required" }, 400);

    const id = Date.now();
    const cleanType = type || "general";
    const cleanMessage = String(message).trim().slice(0, 5000);
    const cleanEmail = email ? String(email).trim().slice(0, 200) : null;
    const cleanName = name ? String(name).trim().slice(0, 200) : null;
    const createdAt = new Date().toISOString();

    const entry = {
      id,
      type: cleanType,
      message: cleanMessage,
      email: cleanEmail,
      name: cleanName,
      createdAt,
      userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
    };

    // Always store in KV
    await kv.set(`feedback:${id}`, entry);
    const ids = ((await kv.get("feedback:ids")) ?? []) as number[];
    await kv.set("feedback:ids", [...ids, id]);

    // Send email notification via Resend
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const from = cleanName || cleanEmail || "Anonymous";
      const typeLabels: Record<string, string> = {
        bug: "Bug report",
        feature: "Feature request",
        general: "General feedback",
        other: "Other",
      };
      const typeLabel = typeLabels[cleanType] ?? cleanType;
      const emailBody = [
        `Type: ${typeLabel}`,
        cleanName  ? `Name: ${cleanName}`   : null,
        cleanEmail ? `Email: ${cleanEmail}` : null,
        ``,
        cleanMessage,
        ``,
        `Submitted: ${createdAt}`,
      ].filter((l) => l !== null).join("\n");

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "ResistAct <noreply@resistact.org>",
          to: ["ellen@meserow.com"],
          subject: `ResistAct Feedback from ${from}`,
          text: emailBody,
        }),
      }).catch((err) => console.log("Feedback email error:", err));
    }

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── GET /admin/feedback — view all feedback submissions ─────────────────────
app.get("/make-server-9eb1ae04/admin/feedback", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const ids = ((await kv.get("feedback:ids")) ?? []) as number[];
    const entries = await Promise.all(ids.map((id) => kv.get(`feedback:${id}`)));
    return c.json(entries.filter(Boolean).reverse());
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── URL health: probe every card's targetUrl, flag the broken ones ──────────
// scan endpoint is cron-triggered (static token, same pattern as bulk-import);
// viewer is admin JWT. Result blob lives at kv key `url-health:last-scan` so
// follow-up calls overwrite the previous report rather than accumulating.
type UrlHealthEntry = {
  id: number;
  store: "action" | "user-action";
  title: string;
  targetUrl: string;
  status: number | null;
  ok: boolean;
  error?: string;
  checkedAt: string;
};

async function probeUrl(url: string, timeoutMs: number): Promise<{ status: number | null; ok: boolean; error?: string }> {
  const ua = "ResistActUrlHealthBot/1.0 (+https://resistact.org)";
  const tryFetch = async (method: "HEAD" | "GET"): Promise<Response> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method,
        redirect: "follow",
        signal: ctrl.signal,
        headers: method === "GET"
          ? { "User-Agent": ua, "Range": "bytes=0-0", "Accept": "*/*" }
          : { "User-Agent": ua, "Accept": "*/*" },
      });
    } finally {
      clearTimeout(t);
    }
  };

  try {
    let res = await tryFetch("HEAD");
    // Many sites (Cloudflare, Facebook) return 403/405 for HEAD — fall back to a single-byte GET.
    if (res.status === 403 || res.status === 405 || res.status === 501) {
      res = await tryFetch("GET");
    }
    return { status: res.status, ok: res.status >= 200 && res.status < 400 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: null, ok: false, error: msg.slice(0, 200) };
  }
}

app.post("/make-server-9eb1ae04/admin/url-health/scan", async (c) => {
  try {
    // Static token (same scheme as bulk-import) so a scheduled remote agent can post.
    const token = c.req.header("X-Admin-Import-Token");
    const expected = Deno.env.get("ADMIN_IMPORT_TOKEN");
    if (!expected) return c.json({ error: "ADMIN_IMPORT_TOKEN not configured on server" }, 500);
    if (!token || token !== expected) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{ offset?: number; limit?: number; timeoutMs?: number; concurrency?: number }>().catch(() => ({}));
    const offset = Math.max(0, Number(body.offset) || 0);
    const limit = Math.min(1000, Math.max(1, Number(body.limit) || 250));
    const timeoutMs = Math.min(15000, Math.max(1000, Number(body.timeoutMs) || 6000));
    const concurrency = Math.min(32, Math.max(1, Number(body.concurrency) || 16));

    // Gather every card that has a targetUrl, across both seed and user-submitted stores.
    const targets: { id: number; store: "action" | "user-action"; title: string; targetUrl: string }[] = [];
    for (const card of (await kv.getByPrefix("action:")) as any[]) {
      if (card && typeof card === "object" && typeof card.id === "number" && typeof card.targetUrl === "string" && card.targetUrl.startsWith("http")) {
        targets.push({ id: card.id, store: "action", title: card.title ?? "", targetUrl: card.targetUrl });
      }
    }
    for (const card of (await kv.getByPrefix("user-action:")) as any[]) {
      if (card && typeof card === "object" && typeof card.id === "number" && typeof card.targetUrl === "string" && card.targetUrl.startsWith("http")) {
        targets.push({ id: card.id, store: "user-action", title: card.title ?? "", targetUrl: card.targetUrl });
      }
    }
    targets.sort((a, b) => a.id - b.id);

    const slice = targets.slice(offset, offset + limit);
    const results: UrlHealthEntry[] = [];
    const checkedAt = new Date().toISOString();

    // Bounded concurrency: walk a shared queue with N workers.
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= slice.length) return;
        const t = slice[i];
        const r = await probeUrl(t.targetUrl, timeoutMs);
        results.push({ id: t.id, store: t.store, title: t.title, targetUrl: t.targetUrl, status: r.status, ok: r.ok, error: r.error, checkedAt });
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Merge with the previous run so paginated scans build up one coherent report.
    // Replace any entries with the same (store, id) — the latest check wins.
    const prev = ((await kv.get("url-health:last-scan")) as any) ?? null;
    const carryover: UrlHealthEntry[] = (offset > 0 && prev?.entries) ? prev.entries : [];
    const seen = new Set(results.map((r) => `${r.store}:${r.id}`));
    const merged = [...results, ...carryover.filter((e) => !seen.has(`${e.store}:${e.id}`))];

    const broken = merged.filter((e) => !e.ok);
    const summary = {
      scannedAt: prev?.scannedAt && offset > 0 ? prev.scannedAt : checkedAt,
      lastBatchAt: checkedAt,
      totalCards: targets.length,
      processedInBatch: slice.length,
      brokenCount: broken.length,
      okCount: merged.length - broken.length,
      nextOffset: offset + slice.length < targets.length ? offset + slice.length : null,
      entries: merged,
    };
    await kv.set("url-health:last-scan", summary);

    console.log(`url-health: batch [${offset}, ${offset + slice.length}) of ${targets.length} — ${broken.length} broken across full report`);
    return c.json({
      scannedAt: summary.scannedAt,
      lastBatchAt: summary.lastBatchAt,
      totalCards: summary.totalCards,
      processedInBatch: summary.processedInBatch,
      brokenCount: summary.brokenCount,
      okCount: summary.okCount,
      nextOffset: summary.nextOffset,
    });
  } catch (err) {
    console.log("url-health scan error:", err);
    return c.json({ error: `URL health scan failed: ${err}` }, 500);
  }
});

app.get("/make-server-9eb1ae04/admin/url-health", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const report = ((await kv.get("url-health:last-scan")) as any) ?? null;
    if (!report) return c.json({ scannedAt: null, broken: [], okCount: 0, totalCards: 0 });

    const onlyBroken = c.req.query("onlyBroken") !== "false";
    const entries: UrlHealthEntry[] = report.entries ?? [];
    const filtered = onlyBroken ? entries.filter((e) => !e.ok) : entries;
    filtered.sort((a, b) => (a.status ?? 999) - (b.status ?? 999) || a.id - b.id);

    return c.json({
      scannedAt: report.scannedAt,
      lastBatchAt: report.lastBatchAt,
      totalCards: report.totalCards,
      brokenCount: report.brokenCount,
      okCount: report.okCount,
      nextOffset: report.nextOffset,
      cards: filtered,
    });
  } catch (err) {
    return c.json({ error: `Failed: ${err}` }, 500);
  }
});

// ─── POST /actions/:id/flag ──────────────────────────────────────────────────
// Lets any visitor (anonymous or signed-in) flag an act for admin review.
// Stored under `flag:<flagId>` so kv.getByPrefix("flag:") can list them.
// reason: one of the radio choices on the modal; detail: optional free-text.
app.post("/make-server-9eb1ae04/actions/:id/flag", async (c) => {
  try {
    const cardId = Number(c.req.param("id"));
    if (!Number.isFinite(cardId)) return c.json({ error: "Invalid card id" }, 400);

    const body = await c.req.json<{ reason?: string; detail?: string }>().catch(() => ({}));
    const reason = (body.reason ?? "other").toString().slice(0, 64);
    const detail = (body.detail ?? "").toString().slice(0, 500);

    // Confirm the card exists in either the seed-card pool or the user-submitted
    // pool. Don't return 404 to the user even if it doesn't — a flag on a stale
    // card id is still useful signal — but tag it on the record.
    const seedCard = await kv.get(`action:${cardId}`);
    const userCard = seedCard ? null : await kv.get(`user-action:${cardId}`);
    const cardTitle = (seedCard as any)?.title ?? (userCard as any)?.title ?? null;

    // Optional reporter info from auth token (works for both anon-key and user JWTs).
    let reporterId: string | null = null;
    let reporterName: string | null = null;
    let reporterEmail: string | null = null;
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (token) {
      const user = await getUser(token);
      if (user) {
        reporterId = user.id;
        reporterEmail = user.email ?? null;
        const approval = (await kv.get(`user:approval:${user.id}`)) as any;
        reporterName = approval?.name ?? null;
      }
    }

    const flagId = `${Date.now()}-${Math.floor(Math.random() * 10_000).toString().padStart(4, "0")}`;
    const record = {
      id: flagId,
      cardId,
      cardTitle,
      reason,
      detail,
      reporterId,
      reporterName,
      reporterEmail,
      createdAt: new Date().toISOString(),
    };
    await kv.set(`flag:${flagId}`, record);
    console.log(`Flag filed on card ${cardId} ("${cardTitle ?? "unknown"}") by ${reporterEmail ?? "anonymous"}: ${reason}`);
    return c.json({ ok: true, flagId });
  } catch (err) {
    console.log("Flag submit error:", err);
    return c.json({ error: `Failed to submit flag: ${err}` }, 500);
  }
});

// ─── GET /admin/flags ────────────────────────────────────────────────────────
// Admin-only: returns all undismissed flags, newest first.
app.get("/make-server-9eb1ae04/admin/flags", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Admin only" }, 403);

    const flags = (await kv.getByPrefix("flag:")) as any[];
    const valid = flags.filter((f) => f && typeof f === "object" && f.id);
    valid.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return c.json({ flags: valid });
  } catch (err) {
    console.log("List flags error:", err);
    return c.json({ error: `Failed to list flags: ${err}` }, 500);
  }
});

// ─── DELETE /admin/flags/:id — dismiss a single flag ─────────────────────────
app.delete("/make-server-9eb1ae04/admin/flags/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Admin only" }, 403);

    const flagId = c.req.param("id");
    await kv.del(`flag:${flagId}`);
    return c.json({ ok: true });
  } catch (err) {
    console.log("Dismiss flag error:", err);
    return c.json({ error: `Failed to dismiss flag: ${err}` }, 500);
  }
});

// ─── POST /receipts/:id/boost — toggle-boost a receipt (no auth required) ────
app.post("/make-server-9eb1ae04/receipts/:id/boost", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    const { delta } = await c.req.json<{ delta: number }>();
    const receipt = (await kv.get(`receipt:${id}`)) as any;
    if (!receipt) return c.json({ error: `Receipt ${id} not found` }, 404);
    receipt.boosts = Math.max(0, (receipt.boosts ?? 0) + (delta ?? 1));
    await kv.set(`receipt:${id}`, receipt);
    return c.json({ boosts: receipt.boosts });
  } catch (err) {
    return c.json({ error: `Boost failed: ${err}` }, 500);
  }
});

// ─── GET /receipts — public list of approved receipts (admin sees all) ───────
app.get("/make-server-9eb1ae04/receipts", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    let isAdmin = false;
    if (token) {
      const admin = await requireAdmin(token).catch(() => null);
      isAdmin = !!admin;
    }

    const receiptIds = ((await kv.get("receipt:ids")) ?? []) as number[];
    const receipts: any[] = [];
    for (const id of receiptIds) {
      const r = (await kv.get(`receipt:${id}`)) as any;
      if (!r) continue;
      if (!isAdmin && r.adminApproved !== true) continue;
      receipts.push(r);
    }
    // Newest first
    receipts.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    // Return hidden IDs so the client can suppress static (hardcoded) smacks
    // that admins have deleted — those aren't in KV so can't be removed server-
    // side, but we can track which ones to hide.
    const hiddenIds = ((await kv.get("smacks:hidden")) ?? []) as number[];
    return c.json({ receipts, hiddenIds });
  } catch (err) {
    return c.json({ error: `Failed to fetch receipts: ${err}` }, 500);
  }
});

// ─── POST /receipts/submit — approved user submits a receipt for review ──────
app.post("/make-server-9eb1ae04/receipts/submit", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);
    const approval = await kv.get(`user:approval:${user.id}`) as any;
    if (!approval || approval.status !== "approved") {
      return c.json({ error: "Account not approved" }, 403);
    }

    const body = await c.req.json<{
      title?: string;
      caption?: string;
      imageUrl: string;
      sourceUrl?: string;
      sourceLabel?: string;
      tags?: string[];
    }>();
    if (!body.imageUrl) return c.json({ error: "imageUrl is required" }, 400);

    const ids = ((await kv.get("receipt:ids")) ?? []) as number[];
    const newId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    const receipt = {
      id: newId,
      title: body.title ?? "",
      caption: body.caption ?? "",
      imageUrl: body.imageUrl,
      sourceUrl: body.sourceUrl ?? "",
      sourceLabel: body.sourceLabel ?? "",
      tags: body.tags ?? [],
      adminApproved: false,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    await kv.set(`receipt:${newId}`, receipt);
    await kv.set("receipt:ids", [...ids, newId]);
    console.log(`User ${approval.name} submitted receipt #${newId}: "${receipt.title}" (pending review)`);
    return c.json({ receipt }, 201);
  } catch (err) {
    return c.json({ error: `Failed to submit receipt: ${err}` }, 500);
  }
});

// ─── POST /admin/receipts/create — admin adds a receipt ──────────────────────
app.post("/make-server-9eb1ae04/admin/receipts/create", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json<{
      title?: string;
      caption?: string;
      imageUrl: string;
      sourceUrl?: string;
      sourceLabel?: string;
      tags?: string[];
    }>();

    if (!body.imageUrl) return c.json({ error: "imageUrl is required" }, 400);

    // Allocate a new ID
    const ids = ((await kv.get("receipt:ids")) ?? []) as number[];
    const newId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    const receipt = {
      id: newId,
      title: body.title ?? "",
      caption: body.caption ?? "",
      imageUrl: body.imageUrl,
      sourceUrl: body.sourceUrl ?? "",
      sourceLabel: body.sourceLabel ?? "",
      tags: body.tags ?? [],
      adminApproved: true,
      createdBy: admin.user.id,
      createdAt: new Date().toISOString(),
    };
    await kv.set(`receipt:${newId}`, receipt);
    await kv.set("receipt:ids", [...ids, newId]);
    console.log(`Admin ${admin.record.name} created receipt #${newId}: "${receipt.title}"`);
    return c.json({ receipt }, 201);
  } catch (err) {
    return c.json({ error: `Failed to create receipt: ${err}` }, 500);
  }
});

// ─── PUT /admin/receipts/:id — admin edits a receipt's text fields ───────────
// Static smacks (id ≥ 5000 in src/app/components/SmacksPage.tsx) are hardcoded
// in the client and CAN'T be edited through this endpoint — they live in code,
// not KV. Only KV-stored receipts (id < 5000) are mutable. The client gates
// the pencil button accordingly.
app.put("/make-server-9eb1ae04/admin/receipts/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));
    const existing = (await kv.get(`receipt:${id}`)) as any;
    if (!existing) return c.json({ error: `Receipt ${id} not found` }, 404);

    const body = await c.req.json<{
      title?: string;
      caption?: string;
      imageUrl?: string;
      sourceUrl?: string;
      sourceLabel?: string;
      tags?: string[];
    }>();

    // Whitelist editable fields — don't let an admin overwrite id, createdAt,
    // createdBy, or the approval state through this endpoint.
    const updated = {
      ...existing,
      ...(body.title       !== undefined && { title: body.title }),
      ...(body.caption     !== undefined && { caption: body.caption }),
      ...(body.imageUrl    !== undefined && { imageUrl: body.imageUrl }),
      ...(body.sourceUrl   !== undefined && { sourceUrl: body.sourceUrl }),
      ...(body.sourceLabel !== undefined && { sourceLabel: body.sourceLabel }),
      ...(Array.isArray(body.tags) && { tags: body.tags }),
      updatedBy: admin.user.id,
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`receipt:${id}`, updated);
    console.log(`Admin ${admin.record.name} edited receipt #${id}: "${updated.title}"`);
    return c.json({ receipt: updated });
  } catch (err) {
    return c.json({ error: `Edit failed: ${err}` }, 500);
  }
});

// ─── POST /admin/approve-receipt/:id — approve a pending receipt ──────────────
app.post("/make-server-9eb1ae04/admin/approve-receipt/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));
    const receipt = (await kv.get(`receipt:${id}`)) as any;
    if (!receipt) return c.json({ error: `Receipt ${id} not found` }, 404);

    receipt.adminApproved = true;
    receipt.approvedBy = admin.user.id;
    receipt.approvedAt = new Date().toISOString();
    await kv.set(`receipt:${id}`, receipt);
    console.log(`Admin ${admin.record.name} approved receipt #${id}: "${receipt.title}"`);
    return c.json({ receipt });
  } catch (err) {
    return c.json({ error: `Approval failed: ${err}` }, 500);
  }
});

// ─── POST /admin/site-updating — toggle the "site updating" banner ────────────
app.post("/make-server-9eb1ae04/admin/site-updating", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json().catch(() => ({}));
    const enabled = body.enabled === true;
    await kv.set("system:site-updating", enabled);
    console.log(`Admin ${admin.record.name} set site-updating = ${enabled}`);
    return c.json({ siteUpdating: enabled });
  } catch (err) {
    return c.json({ error: `Toggle failed: ${err}` }, 500);
  }
});

// ─── DELETE /admin/receipts/:id — delete a receipt ───────────────────────────
app.delete("/make-server-9eb1ae04/admin/receipts/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));
    const receipt = await kv.get(`receipt:${id}`);
    if (!receipt) return c.json({ error: `Receipt ${id} not found` }, 404);

    await kv.del(`receipt:${id}`);
    const ids = ((await kv.get("receipt:ids")) ?? []) as number[];
    await kv.set("receipt:ids", ids.filter((x) => x !== id));
    // Also record in the persistent hidden set so the client suppresses it
    // across all devices (same mechanism used for static/hardcoded smacks).
    const hidden = ((await kv.get("smacks:hidden")) ?? []) as number[];
    if (!hidden.includes(id)) await kv.set("smacks:hidden", [...hidden, id]);
    console.log(`Admin ${admin.record.name} deleted receipt #${id}`);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: `Delete failed: ${err}` }, 500);
  }
});

// ─── POST /admin/receipts/hide/:id — hide a static (hardcoded) smack ─────────
// Static smacks live only in client-side code (id ≥ 5000) and can't be
// removed from KV. This endpoint records the admin's intent to hide them
// persistently so the client can suppress them on all devices.
app.post("/make-server-9eb1ae04/admin/receipts/hide/:id", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    const admin = await requireAdmin(token);
    if (!admin) return c.json({ error: "Forbidden" }, 403);

    const id = Number(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id" }, 400);
    const hidden = ((await kv.get("smacks:hidden")) ?? []) as number[];
    if (!hidden.includes(id)) await kv.set("smacks:hidden", [...hidden, id]);
    console.log(`Admin ${admin.record.name} hid static smack #${id}`);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: `Hide failed: ${err}` }, 500);
  }
});

Deno.serve(app.fetch);