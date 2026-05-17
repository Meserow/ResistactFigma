import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
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

async function getUser(token: string) {
  const { data: { user }, error } = await adminClient().auth.getUser(token);
  if (error || !user) return null;
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
  const alreadySeeded = await kv.get("seed:ellen:v1");
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
      await kv.set("seed:ellen:v1", true);
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
    await kv.set("seed:ellen:v1", true);
    console.log("Seeded Ellen Escarcega as approved user.");
  } catch (err) {
    console.log("Error seeding Ellen:", err);
  }
}

// ─── Seed data ────────────────────────────────────────────────────────────────
const SEED_CARDS = [
  { id: 1, isFeatured: true, pinToTop: true, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", timeCommitment: "Ongoing", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct so we can build a stronger resistance network together.", boosts: 950, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", authorAvatarKey: "imgImage34" },
  { id: 19, category: "IRREVERENCE", categoryColor: "#9333ea", actionType: "Online", timeCommitment: "< 1 hour", title: "SH*T Bag: Two Bags, One Movement", description: "Dog poop bags featuring Trump — made from plant-based materials (PBAT + PLA + Corn Starch), leak-proof, strong, traps odors, and 'resistant to hate.' Fair-trade and BSCI-compliant. Buy a pack and put it to good use.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Smolotov LLC", authorRole: "Resistance Merch", targetUrl: "https://www.smolotov.com/products/smolotov-unscented-leakproof-dog-poop-bags", topImageUrl: "https://www.smolotov.com/cdn/shop/files/4-Rolls_Box_Bag_2400px.jpg?v=1771553420&width=800", toneOverride: { energy: 1 } },
  { id: 1000, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Search any brand's political donations before you buy", description: "Search 7,000+ companies' political donations before you buy. Stop accidentally funding the people deporting your neighbors.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Goods Unite Us", authorRole: "Movement Organization", targetUrl: "https://www.goodsuniteus.com/", topImageKey: "org_goods-unite-us" },
  { id: 1001, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Get the browser extension that flags MAGA-aligned brands", description: "Browser extension auto-flags MAGA-aligned brands as you shop. Make every checkout a small political choice.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Progressive Shopper", authorRole: "Movement Organization", targetUrl: "https://progressiveshopper.com/", topImageKey: "org_progressive-shopper" },
  { id: 1002, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Use the Trump-tied retailers boycott list", description: "Spreadsheet of every retailer carrying Trump-family products. Pull up before you shop — names update weekly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Grab Your Wallet", authorRole: "Movement Organization", targetUrl: "https://grabyourwallet.org/", topImageKey: "org_grab-your-wallet" },
  { id: 1003, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Join coordinated 24-hour economic blackouts", description: "Coordinated 24-hour buy-nothing blackouts that hit corporate dailies. Sign up for the next date.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The People's Union USA", authorRole: "Movement Organization", targetUrl: "https://thepeoplesunionusa.com/", topImageKey: "org_the-people-s-union-usa" },
  { id: 1004, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Sign the Tesla Takedown commitment", description: "Sell Tesla stock, dump the lease, and join Saturday dealership protests. Hits Musk where it actually hurts.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/", topImageKey: "org_tesla-takedown" },
  { id: 1005, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Join the Latino-led economic blackout", description: "Latino-led campaign to freeze spending in protest of mass-deportation policies. Sign up for the calendar.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Latino Freeze Movement", authorRole: "Movement Organization", targetUrl: "https://www.latinofreeze.com/", topImageKey: "org_latino-freeze-movement", amplifiesGroups: ["immigrant"] },
  { id: 1006, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Switch your spending to a Black-women-owned biz", description: "Directory of Black-women-owned businesses to swap your usual orders into. Buy here instead of Amazon.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Buy From a Black Woman", authorRole: "Movement Organization", targetUrl: "https://www.buyfromablackwoman.org/", topImageKey: "org_buy-from-a-black-woman", amplifiesGroups: ["woman"] },
  { id: 1007, category: "IRREVERENCE", categoryColor: "#9333ea", actionType: "Online", title: "Buy Anti-Trump Merch from Individual Makers", description: "Handmade anti-Trump shirts, signs, stickers, and pins from independent Etsy sellers — your dollars go to indie creators, not corporate retailers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Etsy (Anti-Trump Market)", authorRole: "Indie Makers Marketplace", targetUrl: "https://www.etsy.com/market/anti_trump", topImageKey: "org_anti-trump-merch", toneOverride: { energy: 1 }, firstTimerFriendly: true },
  { id: 1008, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Buy from a Native-owned business instead", description: "Native-owned business directory + marketplace. Trump's land-grab and pipeline pushes hit these communities first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Beyond Buckskin", authorRole: "Movement Organization", targetUrl: "https://www.beyondbuckskin.com/", topImageKey: "org_beyond-buckskin" },
  { id: 1009, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "RSVP to the next Saturday Tesla Takedown", description: "Live map of Tesla dealership protests near you. Saturday actions only — no commitment required.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/", topImageKey: "org_tesla-takedown" },
  { id: 1010, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Subscribe to Free DC mobilization alerts", description: "DC-area mobilization alerts for protests, court days, and federal-building actions. Subscribe and show up.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Free DC", authorRole: "Movement Organization", targetUrl: "https://freedcproject.org/sign-up", topImageKey: "org_free-dc", toneOverride: { energy: 1 } },
  { id: 1011, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Become a Veterans for Peace member", description: "Vets in service insignia deter cops and counter-protesters at rallies. Be the visible spine of your local march.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Veterans for Peace", authorRole: "Movement Organization", targetUrl: "https://www.veteransforpeace.org/", topImageKey: "org_veterans-for-peace" },
  { id: 1012, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Join About Face: Veterans Against the War", description: "Post-9/11 vets organizing direct action against US wars. More aggressive than VFP — for vets ready to risk arrest.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "About Face", authorRole: "Movement Organization", targetUrl: "https://aboutfaceveterans.org/", topImageKey: "org_about-face" },
  { id: 1013, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find an ADAPT chapter (disability direct action)", description: "Disability-led direct action — sit-ins, building takeovers, hill visits. Find or start a chapter; remote roles available.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "ADAPT", authorRole: "Movement Organization", targetUrl: "https://adapt.org/", topImageKey: "org_adapt", amplifiesGroups: ["disabled"] },
  { id: 1014, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find a Drag Story Hour to attend / livestream", description: "Show up to a Drag Story Hour to protect performers from Proud Boys harassment. Adults present = events go forward.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Drag Story Hour", authorRole: "Movement Organization", targetUrl: "https://www.dragstoryhour.org/", topImageKey: "org_drag-story-hour", amplifiesGroups: ["lgbtq"] },
  { id: 1015, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Sign up for Refuse Fascism action alerts", description: "Anti-fascist protest network with simple action alerts. Stand against Trump's authoritarian playbook publicly.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Refuse Fascism", authorRole: "Movement Organization", targetUrl: "https://refusefascism.org/", topImageKey: "org_refuse-fascism", toneOverride: { energy: 1 } },
  { id: 1016, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Sign up with Code Pink", description: "Code Pink runs the disruptive bird-dog actions you see in Senate hearings. Get alerts for the next DC pop-up.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Code Pink", authorRole: "Movement Organization", targetUrl: "https://www.codepink.org/", topImageKey: "org_code-pink", toneOverride: { energy: 1 } },
  { id: 1017, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Volunteer as a Practical Support driver (repro)", description: "Drive abortion-seekers to/from clinics and overnight stays. Trump's national-ban push makes practical support life-saving.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Apiary for Practical Support", authorRole: "Movement Organization", targetUrl: "https://apiaryps.org/ps-volunteer", topImageKey: "org_apiary-for-practical-support", amplifiesGroups: ["repro", "woman"] },
  { id: 1018, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Sponsor + drive for refugees via Welcome.US", description: "Drive refugees to appointments, IKEA runs, school. Trump cut admissions but families already here need community.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us", amplifiesGroups: ["immigrant"] },
  { id: 1019, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a tip (anonymous SecureDrop)", description: "Submit a tip via SecureDrop. ProPublica turns insider docs into pressure that has fired federal officials.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ProPublica", authorRole: "Movement Organization", targetUrl: "https://www.propublica.org/tips/", topImageKey: "org_propublica" },
  { id: 1020, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a tip on criminal-justice / detention", description: "Tip line for prison conditions, ICE detention abuses, and prosecutor misconduct. Their reporting changes laws.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Marshall Project", authorRole: "Movement Organization", targetUrl: "https://www.themarshallproject.org/", topImageKey: "org_the-marshall-project" },
  { id: 1021, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a leak to The Intercept", description: "Submit national-security leaks via SecureDrop. Intercept broke Snowden — they protect sources better than most.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Intercept", authorRole: "Movement Organization", targetUrl: "https://theintercept.com/", topImageKey: "org_the-intercept" },
  { id: 1022, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Tell them about an ICE raid (NYC)", description: "NYC tip line for ICE raids and immigration enforcement. Real-time alerts go to neighborhood networks.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://www.mobilize.us/handsoffnyc/event/929506/", topImageKey: "org_handsoffnyc", amplifiesGroups: ["immigrant"] },
  { id: 1023, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a Black-community story", description: "Pitch a Black-community story to a Black-led investigative newsroom. Coverage that mainstream outlets miss.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1024, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a gender + politics story", description: "Pitch a story on abortion access, trans healthcare bans, or gender + politics. They cover what AP won't.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th", amplifiesGroups: ["woman", "repro", "lgbtq"] },
  { id: 1025, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch on local DA / sheriff / election admin", description: "Pitch on your local DA, sheriff, or election admin. MAGA's takeover happens at county level — Bolts covers it nationally.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bolts Magazine", authorRole: "Movement Organization", targetUrl: "https://boltsmag.org/", topImageKey: "org_bolts-magazine" },
  { id: 1026, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Send an investigative idea", description: "Pitch an investigative idea; they fund the reporter to chase it. Best route for a freelancer with a real lead.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Type Investigations", authorRole: "Movement Organization", targetUrl: "https://www.typeinvestigations.org/", topImageKey: "org_type-investigations" },
  { id: 1027, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a war / civil-liberties story", description: "Pitch ex-Intercept reporters on US wars and civil liberties. Fewer institutional constraints, more aggressive coverage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Drop Site News", authorRole: "Movement Organization", targetUrl: "https://www.dropsitenews.com/", topImageKey: "org_drop-site-news" },
  { id: 1028, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a labor story (video)", description: "Pitch a labor story for video — strikes, union drives, wage theft. Their content goes viral on TikTok and IG.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "More Perfect Union", authorRole: "Movement Organization", targetUrl: "https://perfectunion.us/", topImageKey: "org_more-perfect-union" },
  { id: 1029, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Send a dark-money tip", description: "Tip Sirota's team on dark money or corporate corruption. They've forced multiple federal investigations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1030, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a campaign-finance tip", description: "Tip on a campaign-finance violation or shadow donor. Sludge specializes in unmasking who's actually paying for what.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sludge", authorRole: "Movement Organization", targetUrl: "https://readsludge.com/", topImageKey: "org_sludge" },
  { id: 1031, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Report a press-freedom violation", description: "Report any arrest, equipment seizure, or assault on a journalist. Trump-era press attacks need a public record.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "U.S. Press Freedom Tracker", authorRole: "Movement Organization", targetUrl: "https://pressfreedomtracker.us/submit-incident/", topImageKey: "org_u-s-press-freedom-tracker", amplifiesGroups: ["journalist"] },
  { id: 1032, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find your nearest chapter + meeting time", description: "Find your nearest DSA chapter and meeting time. Local chapters run mutual aid, tenant work, and electoral campaigns.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "DSA (Democratic Socialists of America)", authorRole: "Movement Organization", targetUrl: "https://www.dsausa.org/", topImageKey: "org_dsa-democratic-socialists-of-america" },
  { id: 1033, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Apply to a virtual intro call", description: "White-led solidarity for Black, brown, and Indigenous-led campaigns. Apply for the virtual intro to start showing up.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "SURJ (Showing Up for Racial Justice)", authorRole: "Movement Organization", targetUrl: "https://surj.org/", topImageKey: "org_surj-showing-up-for-racial-justice" },
  { id: 1034, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Sign up for a hub welcome call", description: "Youth-led climate org with remote-friendly local hubs. Sign up for a welcome call to find your role this season.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sunrise Movement", authorRole: "Movement Organization", targetUrl: "https://www.sunrisemovement.org/", topImageKey: "org_sunrise-movement" },
  { id: 1035, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "RSVP for next event (local + virtual)", description: "RSVP to the next local + virtual event. WFP runs electoral campaigns and issue ballot fights state by state.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Working Families Party", authorRole: "Movement Organization", targetUrl: "https://workingfamilies.org/", topImageKey: "org_working-families-party" },
  { id: 1036, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join virtual monthly mass assembly", description: "Rev. Barber's monthly mass assembly fuses faith and policy. Join virtually to plug into Poor People's organizing nationally.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Poor People's Campaign (Rev. Barber)", authorRole: "Movement Organization", targetUrl: "https://www.poorpeoplescampaign.org/", topImageKey: "org_poor-people-s-campaign-rev-barber" },
  { id: 1037, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find your local circle", description: "Latinx-led organizing focused on immigration defense and abolition. Find your local circle.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mijente", authorRole: "Movement Organization", targetUrl: "https://mijente.net/", topImageKey: "org_mijente", amplifiesGroups: ["immigrant"] },
  { id: 1038, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a local team", description: "Mom-led climate org with neighborhood teams. Find a local team — work fits around school pickups and naptime.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mothers Out Front", authorRole: "Movement Organization", targetUrl: "https://mothersoutfront.org/", topImageKey: "org_mothers-out-front", amplifiesGroups: ["woman"] },
  { id: 1039, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a local group", description: "Progressive Jewish organizing against Christian nationalism and authoritarianism. Find a local group.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bend the Arc (Jewish progressive)", authorRole: "Movement Organization", targetUrl: "https://www.bendthearc.us/", topImageKey: "org_bend-the-arc-jewish-progressive" },
  { id: 1041, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join a federal-worker organizing call", description: "Federal-worker organizing call. Trump's purges and RIFs are coordinated — cross-agency response has to be too.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Federal Unionists Network", authorRole: "Movement Organization", targetUrl: "https://www.federalunionists.net/", topImageKey: "org_federal-unionists-network", amplifiesGroups: ["fedWorker"] },
  { id: 1042, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Migrate your X follows to Bluesky", description: "Free extension finds your X follows on Bluesky in one click. Bring your network when you ditch Musk's platform.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sky Follower Bridge", authorRole: "Movement Organization", targetUrl: "https://skyfollowerbridge.com/", topImageKey: "org_sky-follower-bridge", imageContain: true },
  { id: 1043, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Bluesky account", description: "Make a Bluesky account. No algorithm tilt, no Musk, no Meta — where activist Twitter rebuilt itself.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bluesky", authorRole: "Movement Organization", targetUrl: "https://bsky.app/", topImageKey: "org_bluesky" },
  { id: 1044, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Mastodon account on a movement-aligned server", description: "Mastodon account on an anti-fascist server. Federated, no corporate owner, harder to deplatform leftists.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Kolektiva (Mastodon)", authorRole: "Movement Organization", targetUrl: "https://kolektiva.social/", topImageKey: "org_kolektiva-mastodon" },
  { id: 1045, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Save a threatened page now", description: "One-click archive of any URL — .gov pages, news, evidence. Scrub-proof your sources before they vanish.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wayback Machine 'Save Page Now'", authorRole: "Movement Organization", targetUrl: "https://web.archive.org/save", topImageKey: "org_wayback-machine-save-page-now" },
  { id: 1046, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Pixelfed account (federated Insta)", description: "Federated photo-sharing, no algorithm. Activist-friendly Insta alternative with no Meta tracking or shadowban.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pixelfed", authorRole: "Movement Organization", targetUrl: "https://pixelfed.social/", topImageKey: "org_pixelfed" },
  { id: 1047, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Embroider + ship a Trump quote to the archive", description: "Embroider a Trump quote and ship it to the archive. Group exhibitions, gallery shows, permanent record.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Tiny Pricks Project", authorRole: "Movement Organization", targetUrl: "https://www.tinypricksproject.com/", topImageKey: "org_tiny-pricks-project" },
  { id: 1048, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Knit a Welcome Blanket for a new immigrant", description: "Knit a 40\" blanket with a welcome note. Each is hand-delivered to a newly-arrived immigrant family.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome Blanket Project", authorRole: "Movement Organization", targetUrl: "https://www.welcomeblanket.org/", topImageKey: "org_welcome-blanket-project", amplifiesGroups: ["immigrant"] },
  { id: 1049, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Knit a Pussyhat from updated patterns", description: "Knit a Pussyhat from updated patterns or mail one in for the next march. Visible cohort = visible resistance.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Pussyhat Project", authorRole: "Movement Organization", targetUrl: "https://www.pussyhatproject.com/", topImageKey: "org_pussyhat-project", amplifiesGroups: ["woman"] },
  { id: 1050, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Sign up for the postcard drop", description: "Hand-illustrate postcards to swing-district voters. Personal mail still cuts through algorithm-poisoned discourse.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "The Postcard Posse", authorRole: "Movement Organization", targetUrl: "https://thepostcardposse.org/", topImageKey: "org_the-postcard-posse" },
  { id: 1051, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Mail a handmade card to a detained migrant", description: "Mail handmade cards to a specific person in ICE detention. Mail breaks isolation; signals 'someone's watching'.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants", amplifiesGroups: ["immigrant"] },
  { id: 1052, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign petitions to overturn Citizens United", description: "Sign petitions for the constitutional amendment overturning Citizens United. Long fight; needs persistent pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Move to Amend", authorRole: "Movement Organization", targetUrl: "https://www.movetoamend.org/", topImageKey: "org_move-to-amend" },
  { id: 1053, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign current petitions", description: "Sign petitions on corporate accountability and judicial reform. Their pressure has produced FTC and SEC actions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Public Citizen", authorRole: "Movement Organization", targetUrl: "https://www.citizen.org/", topImageKey: "org_public-citizen" },
  { id: 1054, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Demand fair maps — end partisan gerrymandering", description: "Sign for independent redistricting. Gerrymandered maps let MAGA hold state legislatures with 30% of voters.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/tell-congress-we-demand-fair-maps/", topImageKey: "org_common-cause" },
  { id: 1055, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign court-reform petitions", description: "Sign court-reform petitions. Demand Justice drove the SCOTUS-expansion conversation — momentum keeps it alive.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Demand Justice", authorRole: "Movement Organization", targetUrl: "https://demandjustice.org/", topImageKey: "org_demand-justice" },
  { id: 1056, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign media-reform petitions", description: "Sign petitions on platform disinfo, net neutrality, and FCC oversight. Trump's FCC is gutting consumer protections.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Free Press", authorRole: "Movement Organization", targetUrl: "https://www.freepress.net/", topImageKey: "org_free-press" },
  { id: 1057, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign civil-rights petitions", description: "Sign petitions on ICE detention and warrantless surveillance. CCR wins these in court — your name builds standing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Center for Constitutional Rights", authorRole: "Movement Organization", targetUrl: "https://ccrjustice.org/", topImageKey: "org_center-for-constitutional-rights" },
  { id: 1058, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Black-led racial-justice petitions", description: "Sign Black-led racial-justice petitions — police accountability, voting rights, corporate equity. CoC moves money.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Color of Change", authorRole: "Movement Organization", targetUrl: "https://colorofchange.org/", topImageKey: "org_color-of-change" },
  { id: 1059, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign civil-liberties petitions", description: "Sign civil-liberties petitions on surveillance, big-tech, and antitrust. Their email pressure flips swing senators.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Demand Progress", authorRole: "Movement Organization", targetUrl: "https://demandprogress.org/", topImageKey: "org_demand-progress" },
  { id: 1060, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign AAPI petitions", description: "Sign AAPI campaigns on hate-crime response, immigration, and voting access. Trump's anti-Asian rhetoric needs counter-pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "18MillionRising", authorRole: "Movement Organization", targetUrl: "https://www.18millionrising.org/actions/", topImageKey: "org_18millionrising" },
  { id: 1061, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Christian-rooted petitions vs. Christian nationalism", description: "Sign Christian petitions against Christian nationalism. The right's loudest base needs visible religious dissent — that's you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1062, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign anti-militarism petitions", description: "Sign anti-war petitions targeting the Pentagon budget and weapons sales. Restrain Trump's foreign-policy improv.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Win Without War", authorRole: "Movement Organization", targetUrl: "https://winwithoutwar.org/", topImageKey: "org_win-without-war" },
  { id: 1063, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign petitions to close ICE facilities", description: "Sign petitions targeting specific ICE detention facilities for closure. Local fights, federal pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Detention Watch Network", authorRole: "Movement Organization", targetUrl: "https://www.detentionwatchnetwork.org/", topImageKey: "org_detention-watch-network", amplifiesGroups: ["immigrant"] },
  { id: 1064, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the open letter against book bans", description: "Sign the open letter against book bans. Names from authors, librarians, and readers create local-news pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans", amplifiesGroups: ["libraryWorker", "educator", "student"] },
  { id: 1065, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Avaaz US-targeted petitions", description: "Sign Avaaz US-targeted petitions. High signature volume amplifies pressure on Congress and corporations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Avaaz", authorRole: "Movement Organization", targetUrl: "https://secure.avaaz.org/page/en/", topImageKey: "org_avaaz" },
  { id: 1066, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the petition to protect voting rights in the Senate", description: "Tell your senators to defend voting rights against the assault on free and fair elections. People For's open call to action.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "People For (formerly People For the American Way)", authorRole: "Movement Organization", targetUrl: "https://www.peoplefor.org/urge-senate-protect-voting-rights", topImageKey: "org_people-for-formerly-people-for-the-american-way" },
  { id: 1067, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign children's-rights petitions", description: "Sign petitions on child healthcare, gun violence, and poverty programs. Trump's budget cuts hit kids first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Children's Defense Fund", authorRole: "Movement Organization", targetUrl: "https://www.childrensdefense.org/", topImageKey: "org_children-s-defense-fund" },
  { id: 1068, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a SURJ member", description: "Become a SURJ member to organize white people for racial justice. Apply for the virtual intro call.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Showing Up for Racial Justice", authorRole: "Movement Organization", targetUrl: "https://surj.org/", topImageKey: "org_showing-up-for-racial-justice" },
  { id: 1069, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a DSA member", description: "DSA chapters run mutual aid, electoral, and tenant work in nearly every metro. Joining locally finds the doers near you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Democratic Socialists of America", authorRole: "Movement Organization", targetUrl: "https://www.dsausa.org/", topImageKey: "org_democratic-socialists-of-america" },
  { id: 1070, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Sunrise Movement", description: "Climate-led, youth-driven org. Join Sunrise to organize for the Green New Deal and climate accountability.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sunrise Movement", authorRole: "Movement Organization", targetUrl: "https://www.sunrisemovement.org/", topImageKey: "org_sunrise-movement" },
  { id: 1071, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Mijente", description: "Latinx organizing for immigration defense and abolition. Local circles plug you in to immediate work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mijente", authorRole: "Movement Organization", targetUrl: "https://mijente.net/", topImageKey: "org_mijente", amplifiesGroups: ["immigrant"] },
  { id: 1072, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join United We Dream", description: "Largest immigrant-youth-led network in the country. Plug into ICE response, deportation defense, and policy work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "United We Dream", authorRole: "Movement Organization", targetUrl: "https://unitedwedream.org/", topImageKey: "org_united-we-dream", amplifiesGroups: ["immigrant"] },
  { id: 1073, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Bend the Arc", description: "Jewish anti-authoritarian organizing. Join to find Jewish-led action against Christian nationalism near you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bend the Arc (Jewish progressive)", authorRole: "Movement Organization", targetUrl: "https://www.bendthearc.us/", topImageKey: "org_bend-the-arc-jewish-progressive" },
  { id: 1074, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Jewish Voice for Peace", description: "Jewish-led anti-occupation and civil-liberties organizing. Local chapters in 70+ cities.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Jewish Voice for Peace", authorRole: "Movement Organization", targetUrl: "https://www.jewishvoiceforpeace.org/", topImageKey: "org_jewish-voice-for-peace" },
  { id: 1075, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join T'ruah (rabbinic human rights)", description: "Rabbinic human rights org. Rabbis + cantors lead immigration defense, anti-Christian-nationalism, and dignity work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "T'ruah", authorRole: "Movement Organization", targetUrl: "https://truah.org/", topImageKey: "org_t-ruah" },
  { id: 1076, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Subscribe to FCNL action alerts (Quaker)", description: "Quaker action alerts for constituent calls and emails. Pacifist-rooted, focused on Pentagon budget and immigration.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1077, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Pax Christi USA (Catholic peace)", description: "Catholic peace + justice movement. Join for nonviolence training and faith-rooted resistance to militarism.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pax Christi USA", authorRole: "Movement Organization", targetUrl: "https://paxchristiusa.org/", topImageKey: "org_pax-christi-usa" },
  { id: 1078, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a NETWORK action (Catholic social justice)", description: "Catholic social-justice lobby. Take action on healthcare, immigration, and the federal budget — nuns lead this.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NETWORK Lobby", authorRole: "Movement Organization", targetUrl: "https://networklobby.org/", topImageKey: "org_network-lobby" },
  { id: 1080, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Sikh Coalition action", description: "Sikh civil-rights advocacy. Take action on hate-crime response, religious-discrimination, and racial profiling.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sikh Coalition", authorRole: "Movement Organization", targetUrl: "https://www.sikhcoalition.org/", topImageKey: "org_sikh-coalition" },
  { id: 1084, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Volunteer with Mothers Out Front", description: "Volunteer with Mothers Out Front. Mom-led climate org with flexible roles around school and family schedules.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mothers Out Front", authorRole: "Movement Organization", targetUrl: "https://mothersoutfront.org/", topImageKey: "org_mothers-out-front", amplifiesGroups: ["woman"] },
  { id: 1085, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take an ADAPT action (disability rights)", description: "Take an ADAPT action — disability-led direct action against Medicaid cuts and institutionalization.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ADAPT", authorRole: "Movement Organization", targetUrl: "https://adapt.org/", topImageKey: "org_adapt", amplifiesGroups: ["disabled"] },
  { id: 1086, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Black Voters Matter action", description: "Take a Black Voters Matter action. Voter-protection fights happen at county and state level — they target there.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Black Voters Matter", authorRole: "Movement Organization", targetUrl: "https://blackvotersmatterfund.org/", topImageKey: "org_black-voters-matter" },
  { id: 1087, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Mi Familia Vota action", description: "Take a Mi Familia Vota action. Latino civic engagement — voter registration and protection in swing states.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mi Familia Vota", authorRole: "Movement Organization", targetUrl: "https://www.mifamiliavota.org/", topImageKey: "org_mi-familia-vota", amplifiesGroups: ["immigrant"] },
  { id: 1088, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Climate Justice Alliance action", description: "Take a Climate Justice Alliance action. Frontline community-led climate fights — pipelines, refineries, evictions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Climate Justice Alliance", authorRole: "Movement Organization", targetUrl: "https://climatejusticealliance.org/", topImageKey: "org_climate-justice-alliance" },
  { id: 1091, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Sponsor a refugee household", description: "Sponsor a refugee household through a verified federal pathway. Remote prep work counts.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us", amplifiesGroups: ["immigrant"] },
  { id: 1092, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Make your city 'welcoming' for immigrants", description: "Push your city to certify as a 'welcoming city' for immigrants. Public commitment makes ICE cooperation costly.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcoming America", authorRole: "Movement Organization", targetUrl: "https://welcomingamerica.org/", topImageKey: "org_welcoming-america", amplifiesGroups: ["immigrant"] },
  { id: 1093, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Pressure your mayor on sanctuary policy", description: "Pressure your mayor to join the immigrant-friendly cities coalition. Mayoral commitments slow ICE locally.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Cities for Action", authorRole: "Movement Organization", targetUrl: "https://www.citiesforaction.us/", topImageKey: "org_cities-for-action", amplifiesGroups: ["immigrant"] },
  { id: 1094, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Volunteer to furnish + resettle refugee homes", description: "Furnish + resettle refugee homes — physical setup or remote logistics. Trump's cuts mean more families with less support.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Homes Not Borders", authorRole: "Movement Organization", targetUrl: "https://www.homesnotborders.org/", topImageKey: "org_homes-not-borders", amplifiesGroups: ["immigrant"] },
  { id: 1095, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Get an organizer for your workplace", description: "Free organizer helps you unionize your workplace, confidentially. Trump's NLRB is gutted — build power directly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "EWOC (Emergency Workplace Organizing Committee)", authorRole: "Movement Organization", targetUrl: "https://workerorganizing.org/", topImageKey: "org_ewoc-emergency-workplace-organizing-committee", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1096, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Join the federal-worker network", description: "Join the federal-worker network. Trump's RIFs and Schedule F purges need cross-agency mutual aid + organizing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Federal Unionists Network", authorRole: "Movement Organization", targetUrl: "https://www.federalunionists.net/", topImageKey: "org_federal-unionists-network", amplifiesGroups: ["fedWorker", "unionWorker"] },
  { id: 1097, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Subscribe to independent labor media", description: "Subscribe to indie labor media + training calendar. Best source for what's happening in shops outside the big unions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Labor Notes", authorRole: "Movement Organization", targetUrl: "https://labornotes.org/", topImageKey: "org_labor-notes", amplifiesGroups: ["unionWorker"] },
  { id: 1098, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Start a workplace petition", description: "Host a workplace petition — raises, anti-ICE-cooperation pledges. Public petitions force the boss to acknowledge.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Coworker.org", authorRole: "Movement Organization", targetUrl: "https://home.coworker.org/", topImageKey: "org_coworker-org", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1099, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take a UE solidarity action", description: "Solidarity action with UE — independent rank-and-file union. Often the most aggressive on contract fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "UE (United Electrical Workers)", authorRole: "Movement Organization", targetUrl: "https://www.ueunion.org/", topImageKey: "org_ue-united-electrical-workers", amplifiesGroups: ["unionWorker"] },
  { id: 1100, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Apply for IWW membership", description: "Apply for IWW membership. All-trades radical union; remote onboarding. Best fit if your shop won't tolerate the bigs.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Industrial Workers of the World", authorRole: "Movement Organization", targetUrl: "https://www.iww.org/", topImageKey: "org_industrial-workers-of-the-world", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1101, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Sign on to a National Domestic Workers Alliance campaign", description: "Sign on to NDWA campaigns. Domestic workers (housekeepers, nannies, caregivers) organizing for federal protections.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "National Domestic Workers Alliance", authorRole: "Movement Organization", targetUrl: "https://www.domesticworkers.org/", topImageKey: "org_national-domestic-workers-alliance", amplifiesGroups: ["woman", "immigrant", "lowIncome"] },
  { id: 1102, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Send solidarity to Starbucks Workers United", description: "Send solidarity to Starbucks workers fighting union-busting. Their store-by-store wins set the precedent for service work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Starbucks Workers United", authorRole: "Movement Organization", targetUrl: "https://sbworkersunited.org/", topImageKey: "org_starbucks-workers-united", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1103, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take an Amazon Labor Union action", description: "Take an Amazon Labor Union action. The hardest org fight in the country — solidarity dollars and petitions matter.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Amazon Labor Union (IBT Local 1)", authorRole: "Movement Organization", targetUrl: "https://www.amazonlaborunion.org/", topImageKey: "org_amazon-labor-union-ibt-local-1", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1104, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Use the free legal hotline (workplace family rights)", description: "Free legal hotline for workplace family + caregiving rights. Use if you're being denied FMLA, pumping breaks, or accommodations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "A Better Balance", authorRole: "Movement Organization", targetUrl: "https://www.abetterbalance.org/", topImageKey: "org_a-better-balance", amplifiesGroups: ["woman", "lowIncome"] },
  { id: 1105, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Sign on to a Fight For A Union worker campaign", description: "Successor to Fight for $15. Sign on to a sectoral campaign for living wages and a real union, not just minimums.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Fight For A Union", authorRole: "Movement Organization", targetUrl: "https://fightforaunion.org/", topImageKey: "org_fight-for-a-union", amplifiesGroups: ["unionWorker", "lowIncome"] },
  { id: 1106, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign the moral covenant", description: "Sign Rev. Barber's moral covenant. Poor people's commitment to anti-poverty action grounded in faith and policy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Repairers of the Breach (Rev. Barber)", authorRole: "Movement Organization", targetUrl: "https://breachrepairers.org/", topImageKey: "org_repairers-of-the-breach-rev-barber" },
  { id: 1107, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to action alerts", description: "Subscribe to Sojourners' Christian-justice action alerts. Progressive Christian voice in DC policy fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sojourners", authorRole: "Movement Organization", targetUrl: "https://sojo.net/", topImageKey: "org_sojourners" },
  { id: 1108, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to actions", description: "Subscribe to Faithful America's Christian-rooted campaigns against Christian nationalism. Visible religious dissent.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1109, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Faith in Public Life advocacy action", description: "Sign on to multi-faith advocacy actions. Coalition lobbying that fuses Christian, Jewish, Muslim, and Hindu progressives.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faith in Public Life", authorRole: "Movement Organization", targetUrl: "https://www.faithinpubliclife.org/", topImageKey: "org_faith-in-public-life" },
  { id: 1110, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Take a rabbinic action", description: "Take a rabbinic action. Rabbis and cantors organize on immigration, occupation, and Christian nationalism.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "T'ruah", authorRole: "Movement Organization", targetUrl: "https://truah.org/", topImageKey: "org_t-ruah" },
  { id: 1111, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Pax Christi USA peace action", description: "Sign Pax Christi USA peace actions. Catholic-rooted resistance to militarism and the Pentagon budget.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pax Christi USA", authorRole: "Movement Organization", targetUrl: "https://paxchristiusa.org/", topImageKey: "org_pax-christi-usa" },
  { id: 1112, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Subscribe to Quaker action alerts", description: "Subscribe to Quaker constituent-action emails. Pacifist-rooted, focused on Pentagon and immigration policy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1113, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to an Auburn Seminary faith-leader campaign", description: "Sign on to faith-leader campaigns. Auburn trains multi-faith clergy in social justice and movement leadership.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Auburn Seminary", authorRole: "Movement Organization", targetUrl: "https://auburnseminary.org/", topImageKey: "org_auburn-seminary" },
  { id: 1115, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Hindus for Human Rights action", description: "Counter Hindu nationalism in US politics. Sign on as a Hindu or ally; Modi's allies have major Trump-admin ties.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Hindus for Human Rights", authorRole: "Movement Organization", targetUrl: "https://www.hindusforhumanrights.org/", topImageKey: "org_hindus-for-human-rights" },
  { id: 1116, category: "PRAYER", categoryColor: "#7d6321", actionType: "Online", title: "Sign on to a Sikh Coalition civil-rights action", description: "Sign Sikh Coalition civil-rights actions. Hate-crime response, religious-discrimination, and racial-profiling work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sikh Coalition", authorRole: "Movement Organization", targetUrl: "https://www.sikhcoalition.org/", topImageKey: "org_sikh-coalition" },
  { id: 1117, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up as a volunteer attorney", description: "Sign up as a volunteer attorney. Match takes 20 minutes; cases include immigrants, election workers, federal whistleblowers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "We the Action", authorRole: "Movement Organization", targetUrl: "https://wetheaction.org/", topImageKey: "org_we-the-action", amplifiesGroups: ["lawyer", "immigrant", "electionWorker", "whistleblower"] },
  { id: 1118, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as an attorney", description: "Hours go to immigrants and federal workers fighting Trump-era retaliation. Lawyers especially — 20-min match.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Lawyers for Good Government", authorRole: "Movement Organization", targetUrl: "https://www.lawyersforgoodgovernment.org/", topImageKey: "org_lawyers-for-good-government", amplifiesGroups: ["lawyer", "immigrant", "fedWorker"] },
  { id: 1119, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Find pro bono cases (formerly Pro Bono Net)", description: "Find pro bono cases. Volunteer-attorney matching for civil-legal cases — most need procedural help, not litigation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Scale Justice (Pro Bono Net)", authorRole: "Movement Organization", targetUrl: "https://scalejustice.org/", topImageKey: "org_scale-justice-pro-bono-net", amplifiesGroups: ["lawyer"] },
  { id: 1120, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer your tech skills", description: "Volunteer your tech skills. Local brigades build tools for governments and nonprofits — replace shitty .gov UX.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Code for America", authorRole: "Movement Organization", targetUrl: "https://codeforamerica.org/", topImageKey: "org_code-for-america" },
  { id: 1121, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up as a tech volunteer", description: "Sign up as a tech volunteer. Project matching for devs, designers, and PMs supporting democracy-org tooling.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "DemocracyLab", authorRole: "Movement Organization", targetUrl: "https://www.democracylab.org/", topImageKey: "org_democracylab" },
  { id: 1122, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer your professional skills", description: "Volunteer your professional skills (design, marketing, ops, finance) to nonprofits. 1–10 hour bites; remote-friendly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Catchafire", authorRole: "Movement Organization", targetUrl: "https://www.catchafire.org/", topImageKey: "org_catchafire" },
  { id: 1123, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as a translator", description: "Volunteer as a translator for asylum cases. Crisis-language work — hours can save someone from deportation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Respond Crisis Translation", authorRole: "Movement Organization", targetUrl: "https://respondcrisistranslation.org/", topImageKey: "org_respond-crisis-translation", imageContain: true, amplifiesGroups: ["immigrant"] },
  { id: 1124, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as a linguist", description: "Volunteer as a linguist for crisis-response work. Less-resourced languages especially needed for refugee work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CLEAR Global", authorRole: "Movement Organization", targetUrl: "https://clearglobal.org/", topImageKey: "org_clear-global", amplifiesGroups: ["immigrant"] },
  { id: 1125, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign on to a Doctors for America healthcare campaign", description: "Sign on to Doctors for America campaigns. Medical voices that move members of Congress on Medicaid + ACA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Doctors for America", authorRole: "Movement Organization", targetUrl: "https://www.doctorsforamerica.org/", topImageKey: "org_doctors-for-america" },
  { id: 1126, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Train as asylum-evaluation clinician", description: "Train as an asylum-evaluation clinician. Forensic medical exams for asylum cases — without one, deportation odds spike.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Physicians for Human Rights", authorRole: "Movement Organization", targetUrl: "https://phr.org/", topImageKey: "org_physicians-for-human-rights", amplifiesGroups: ["immigrant"] },
  { id: 1127, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up to run for office (STEM)", description: "Sign up to run for office (STEM). Trump's anti-science agenda needs scientists in office — they'll train you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "314 Action", authorRole: "Movement Organization", targetUrl: "https://314action.org/", topImageKey: "org_314-action", amplifiesGroups: ["scientist"] },
  { id: 1128, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer with Authors Against Book Bans", description: "Volunteer with Authors Against Book Bans. Authors, librarians, readers showing up at school-board meetings.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans", amplifiesGroups: ["libraryWorker", "educator"] },
  { id: 1129, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Join Concerned Archivists Alliance", description: "Archivists organizing to preserve federal records as Trump scrubs them. Need archivists, devs, and metadata pros.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Concerned Archivists Alliance", authorRole: "Movement Organization", targetUrl: "https://concernedarchivists.wordpress.com/", topImageKey: "org_concerned-archivists-alliance", amplifiesGroups: ["libraryWorker", "scientist"] },
  { id: 1130, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer on detained-immigrant cases", description: "Volunteer on detained-immigrant cases. Free training + case match. Pro bono representation triples release odds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigration Justice Campaign", authorRole: "Movement Organization", targetUrl: "https://immigrationjustice.us/", topImageKey: "org_immigration-justice-campaign", amplifiesGroups: ["immigrant"] },
  { id: 1131, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Take the anti-coup civil-resistance pledge", description: "Take the anti-coup civil-resistance pledge. Public commitment to nonviolent action if Trump refuses to leave office.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Choose Democracy", authorRole: "Movement Organization", targetUrl: "https://choosedemocracy.us/", topImageKey: "org_choose-democracy" },
  { id: 1133, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Make daily-call habit", description: "Daily script + your reps' direct lines. Two minutes a weekday is what stopped 2017's ACA repeal — same model works.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "5 Calls", authorRole: "Movement Organization", targetUrl: "https://5calls.org/", topImageKey: "org_5-calls" },
  { id: 1134, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set up daily texts to your reps", description: "Text RESIST to 50409. Resistbot turns your text into emails, faxes, or letters to your reps — daily takes seconds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistbot", authorRole: "Movement Organization", targetUrl: "https://resist.bot/", topImageKey: "org_resistbot", firstTimerFriendly: true },
  { id: 1135, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Carry KYR cards for ICE encounters", description: "Print + carry Know-Your-Rights cards. Pull one out if ICE approaches — works for citizen and non-citizen alike.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigrant Defense Project", authorRole: "Movement Organization", targetUrl: "https://www.immigrantdefenseproject.org/", topImageKey: "org_immigrant-defense-project", amplifiesGroups: ["immigrant"] },
  { id: 1137, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set election reminders for every contest", description: "Reminders for every contest — primaries, school board, judges. Off-cycle elections are where MAGA quietly stacks boards.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote.org", authorRole: "Movement Organization", targetUrl: "https://www.vote.org/", topImageKey: "org_vote-org" },
  { id: 1138, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send an SMS that becomes an email/fax to your reps", description: "Text turns into emails or faxes to your reps. Resistbot is the laziest possible way to keep contacting them.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistbot", authorRole: "Movement Organization", targetUrl: "https://resist.bot/", topImageKey: "org_resistbot", firstTimerFriendly: true },
  { id: 1139, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send today's email script", description: "Send today's email script to your reps. 5 Calls' staff write the message; you spend 90 seconds personalizing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "5 Calls", authorRole: "Movement Organization", targetUrl: "https://5calls.org/", topImageKey: "org_5-calls" },
  { id: 1140, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: reject mass government surveillance", description: "Email your reps to oppose surveillance expansion. Trump's DHS uses these tools to track immigrants, journalists, and protesters.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/tell-congress-reject-mass-government-surveillance/", topImageKey: "org_common-cause", firstTimerFriendly: true },
  { id: 1141, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send email-your-rep", description: "Email-your-rep on consumer protection and corporate accountability fights. Their tracker is updated weekly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Public Citizen", authorRole: "Movement Organization", targetUrl: "https://www.citizen.org/", topImageKey: "org_public-citizen" },
  { id: 1142, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send anti-militarism email", description: "Send an anti-militarism email to your reps. Win Without War targets Pentagon budget votes specifically.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Win Without War", authorRole: "Movement Organization", targetUrl: "https://winwithoutwar.org/", topImageKey: "org_win-without-war" },
  { id: 1143, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send Christian-rooted email-your-rep", description: "Send a Christian-rooted email-your-rep. Religious framing changes which Republicans actually engage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1144, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send Quaker constituent email", description: "Send a Quaker constituent email. FCNL writes the script; email lands at your senator's office in seconds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1145, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email targeting specific ICE facilities", description: "Email actions against specific ICE facility operators. Detention Watch identifies who to pressure for closures.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Detention Watch Network", authorRole: "Movement Organization", targetUrl: "https://www.detentionwatchnetwork.org/", topImageKey: "org_detention-watch-network", amplifiesGroups: ["immigrant"] },
  { id: 1146, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email your school board re: book bans", description: "Email your school board against book bans. Pre-written templates work — boards capitulate when pressure hits.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans", amplifiesGroups: ["libraryWorker", "educator", "student"] },
  { id: 1147, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a workshop", description: "Workshops most arrest-action groups send people through. Get de-escalation and jail-support before you need them.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Training for Change", authorRole: "Movement Organization", targetUrl: "https://www.trainingforchange.org/", topImageKey: "org_training-for-change" },
  { id: 1148, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a training", description: "Direct-action training. Ruckus prepared protesters at Standing Rock and Occupy. Sign up for a workshop.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Ruckus Society", authorRole: "Movement Organization", targetUrl: "https://ruckus.org/", topImageKey: "org_ruckus-society" },
  { id: 1149, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to a cohort", description: "Apply with your group for movement-strategy training. Best for orgs that need help going from reactive to strategic.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wildfire Project", authorRole: "Movement Organization", targetUrl: "https://wildfireproject.org/", topImageKey: "org_wildfire-project" },
  { id: 1150, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take a course", description: "Take an organizer course. Sliding-scale tuition; classes on de-escalation, racial justice, and base-building.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PeoplesHub", authorRole: "Movement Organization", targetUrl: "https://www.peopleshub.org/", topImageKey: "org_peopleshub" },
  { id: 1151, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in a free training", description: "Learn what to actually do when ICE detains a neighbor or a Nazi accosts someone on transit. Free, 60–90 min.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Right To Be", authorRole: "Movement Organization", targetUrl: "https://righttobe.org/", topImageKey: "org_right-to-be" },
  { id: 1152, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in anti-coup training", description: "Enroll in anti-coup training. Free workshop calendar — what to do if Trump refuses a peaceful transfer of power.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Choose Democracy", authorRole: "Movement Organization", targetUrl: "https://choosedemocracy.us/", topImageKey: "org_choose-democracy" },
  { id: 1153, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Enroll in programs", description: "Storied southern movement school — MLK and Rosa Parks trained here. Apply for residential or virtual programs.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Highlander Center", authorRole: "Movement Organization", targetUrl: "https://beta.highlandercenter.org/", topImageKey: "org_highlander-center" },
  { id: 1154, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a curriculum", description: "Sign up for just-transition + ecological-justice curriculum. Climate work that connects to labor and racial justice.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Movement Generation", authorRole: "Movement Organization", targetUrl: "https://movementgeneration.org/", topImageKey: "org_movement-generation" },
  { id: 1155, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take an abolitionist study course", description: "Take an abolitionist study course. Free curricula; reading groups online and in cities. Replaces police 101 with care 101.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Project NIA", authorRole: "Movement Organization", targetUrl: "https://project-nia.org/", topImageKey: "org_project-nia" },
  { id: 1156, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Sign up for a reading group", description: "Sign up for an abolitionist reading group. Critical Resistance is OG abolition — Angela Davis co-founded it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Critical Resistance", authorRole: "Movement Organization", targetUrl: "https://criticalresistance.org/", topImageKey: "org_critical-resistance" },
  { id: 1157, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to be a paid poll worker", description: "Apply to be a paid poll worker. Local elections are short on workers; you get paid + protect access for hours of your day.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Power the Polls", authorRole: "Movement Organization", targetUrl: "https://www.powerthepolls.org/", topImageKey: "org_power-the-polls", amplifiesGroups: ["electionWorker"] },
  { id: 1158, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take a Know Your Rights training", description: "Take a Know Your Rights training for ICE encounters. Live calendar; bring your block, household, or workplace.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigrant Defense Project", authorRole: "Movement Organization", targetUrl: "https://www.immigrantdefenseproject.org/", topImageKey: "org_immigrant-defense-project", amplifiesGroups: ["immigrant"] },
  { id: 1160, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Sign up for kindness-toned voter postcards", description: "Write hand-written postcards to swing-state voters. Personal mail still cuts through algorithm-fried discourse.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Postcards to Voters", authorRole: "Movement Organization", targetUrl: "https://postcardstovoters.org/", topImageKey: "org_postcards-to-voters" },
  { id: 1161, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Become a pen pal to a detained migrant", description: "Become a pen pal to a detained migrant. Mail breaks isolation in ICE detention; bilingual letters welcome.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants", amplifiesGroups: ["immigrant"], firstTimerFriendly: true },
  { id: 1162, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Volunteer (LGBTQ youth digital crisis support)", description: "Volunteer for LGBTQ youth digital crisis support. 24/7 chat/text/phone — paid training, ongoing support.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Trevor Project", authorRole: "Movement Organization", targetUrl: "https://www.thetrevorproject.org/", topImageKey: "org_the-trevor-project", amplifiesGroups: ["lgbtq"] },
  { id: 1164, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Practice rest-as-resistance prompts", description: "Practice rest-as-resistance prompts. Tricia Hersey's free library — burnout is the goal of fascism, sleep counters it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Nap Ministry (Tricia Hersey)", authorRole: "Movement Organization", targetUrl: "https://thenapministry.wordpress.com/", topImageKey: "org_the-nap-ministry-tricia-hersey" },
  { id: 1165, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Find + amplify your local mutual aid", description: "Find + amplify your local mutual aid network. Map of US-wide groups — money, supplies, people on the ground.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mutual Aid Hub", authorRole: "Movement Organization", targetUrl: "https://www.mutualaidhub.org/", topImageKey: "org_mutual-aid-hub" },
  { id: 1166, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost a single Olive Branch family fund", description: "Boost a single Palestinian family's GoFundMe from a vetted queue. Direct, traceable, no big-org skim.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Operation Olive Branch", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/opolivebranch", topImageKey: "org_operation-olive-branch" },
  { id: 1167, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Capital B (Black-led)", description: "Subscribe + share Capital B coverage. Black-led investigative work that mainstream outlets don't cover.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1168, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share The 19th* (gender + politics)", description: "Subscribe + share The 19th. Gender + politics reporting on abortion, trans rights, and women's health under Trump.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th", amplifiesGroups: ["woman", "repro", "lgbtq"] },
  { id: 1169, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Documented (NYC immigration)", description: "Subscribe + share Documented. NYC immigration-focused journalism that hits ICE operations in real time.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://documentedny.com/", topImageKey: "org_documented", amplifiesGroups: ["immigrant"] },
  { id: 1171, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share The Lever", description: "Subscribe + share The Lever. Sirota's outfit on dark money and corporate corruption — best independent reporting.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1172, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Submit + share a press-freedom incident", description: "Submit + share press-freedom incidents. Public record of every press attack — fuels lawsuits and policy fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "U.S. Press Freedom Tracker", authorRole: "Movement Organization", targetUrl: "https://pressfreedomtracker.us/", topImageKey: "org_u-s-press-freedom-tracker", amplifiesGroups: ["journalist"] },
  { id: 1174, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Download free protest art", description: "Download free protest art. Pro-grade posters from Shepard Fairey and others; print at home for any march.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Amplifier", authorRole: "Movement Organization", targetUrl: "https://amplifier.org/", topImageKey: "org_amplifier" },
  { id: 1175, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Download free anti-fascist posters", description: "Download free anti-fascist posters. Co-op of printmakers; high-quality designs for protests, walls, and zines.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Justseeds Artists' Cooperative", authorRole: "Movement Organization", targetUrl: "https://justseeds.org/", topImageKey: "org_justseeds-artists-cooperative" },
  { id: 1176, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Download educational graphics", description: "Download educational graphics. Hand-drawn movement art — climate, mining, Trump-era issues. Free to print.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Beehive Design Collective", authorRole: "Movement Organization", targetUrl: "https://beehivecollective.org/", topImageKey: "org_beehive-design-collective" },
  { id: 1177, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Submit an embroidery piece", description: "Embroider a Trump quote and ship to the project archive. Permanent record + group-show exhibitions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tiny Pricks Project", authorRole: "Movement Organization", targetUrl: "https://www.tinypricksproject.com/", topImageKey: "org_tiny-pricks-project" },
  { id: 1178, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Apply to programs", description: "Apply for forum theater + virtual workshops. Boal's method for rehearsing political action — practice the protest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Theatre of the Oppressed NYC", authorRole: "Movement Organization", targetUrl: "https://www.tonyc.nyc/", topImageKey: "org_theatre-of-the-oppressed-nyc" },
  { id: 1179, category: "IRREVERENCE", categoryColor: "#9333ea", actionType: "Online", title: "Use the tactical-prank toolkit", description: "Use the Yes Men's tactical-prank toolkit. Step-by-step satire playbook — they impersonated execs to expose climate lies.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Yes Men", authorRole: "Movement Organization", targetUrl: "https://theyesmen.org/", topImageKey: "org_the-yes-men" },
  { id: 1180, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Refer an artist at risk", description: "Refer an artist at risk. Solidarity for persecuted artists — visa, legal, and relocation support during crackdowns.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Artists at Risk Connection (PEN America)", authorRole: "Movement Organization", targetUrl: "https://artistsatriskconnection.org/", topImageKey: "org_artists-at-risk-connection-pen-america" },
  { id: 1181, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Find your local mutual aid network", description: "Find your local mutual aid network. Pick one neighbor to support this week — money, food, rides, anything.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mutual Aid Hub", authorRole: "Movement Organization", targetUrl: "https://www.mutualaidhub.org/", topImageKey: "org_mutual-aid-hub" },
  { id: 1186, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Volunteer as a translator for asylum seekers", description: "Translate documents for asylum seekers. Hours of your time can prevent a deportation; bilingual = high-value.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Respond Crisis Translation", authorRole: "Movement Organization", targetUrl: "https://respondcrisistranslation.org/", topImageKey: "org_respond-crisis-translation", imageContain: true, amplifiesGroups: ["immigrant"] },
  { id: 1192, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Sludge's dark-money & GOP-donor reporting", description: "Subscribe to Sludge and share their campaign-finance investigations on social. Counter dark-money disinfo with sourced reporting.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sludge", authorRole: "Movement Organization", targetUrl: "https://readsludge.com/", topImageKey: "org_sludge" },
  { id: 1193, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Bolts Magazine's local-democracy reporting", description: "Subscribe to Bolts and share their local DA, sheriff, and election-admin coverage. Local democracy is where Trump-era threats land first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bolts Magazine", authorRole: "Movement Organization", targetUrl: "https://boltsmag.org/", topImageKey: "org_bolts-magazine" },
  { id: 1194, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Drop Site News on Trump's wars & civil liberties", description: "Subscribe to Drop Site (ex-Intercept staff) and share their war and civil-liberties coverage. Counter the war-machine narrative.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Drop Site News", authorRole: "Movement Organization", targetUrl: "https://www.dropsitenews.com/", topImageKey: "org_drop-site-news" },
  { id: 1196, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost More Perfect Union's worker-power journalism", description: "Subscribe to More Perfect Union and share their worker-power video reporting. Anti-corporate journalism that hits Trump donors directly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "More Perfect Union", authorRole: "Movement Organization", targetUrl: "https://perfectunion.us/", topImageKey: "org_more-perfect-union" },
  { id: 1202, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost Inkstick's anti-war foreign-policy reporting", description: "Subscribe to Inkstick and share their non-DC foreign policy coverage. Counter the bipartisan war-and-empire consensus.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inkstick Media", authorRole: "Movement Organization", targetUrl: "https://inkstickmedia.com/", topImageKey: "org_inkstick-media" },
  { id: 1203, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Read + share data", description: "Read + share wealth-concentration data. Inequality.org has the charts that make 'eat the rich' arguments concrete.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inequality.org", authorRole: "Movement Organization", targetUrl: "https://inequality.org/", topImageKey: "org_inequality-org" },
  { id: 1204, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Sign up for op-ed training", description: "Sign up for op-ed training. They've placed thousands of underrepresented voices in major papers — works.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The OpEd Project", authorRole: "Movement Organization", targetUrl: "https://www.theopedproject.org/", topImageKey: "org_the-oped-project" },
  { id: 1205, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use weekly LTE prompts (formerly Sister District)", description: "Use weekly LTE prompts targeting state-level fights. Coordinated submissions to district papers move ratings.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "States Win (FKA Sister District)", authorRole: "Movement Organization", targetUrl: "https://stateswin.org/", topImageKey: "org_states-win-fka-sister-district" },
  { id: 1206, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use the Two-Minute Activist tool", description: "Use AAUW's two-minute activist tool. LTE templates + submission. Women's-org muscle behind every signature.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "AAUW", authorRole: "Movement Organization", targetUrl: "https://www.aauw.org/", topImageKey: "org_aauw", amplifiesGroups: ["woman"] },
  { id: 1207, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use the LTE writer tool", description: "Use Sierra Club's LTE writer. Climate-focused, chapter-targeted, gets published in regional papers regularly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sierra Club", authorRole: "Movement Organization", targetUrl: "https://www.sierraclub.org/", topImageKey: "org_sierra-club" },
  { id: 1208, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use LTE templates with verified statistics", description: "Use Inequality.org's LTE templates with verified stats. Drop the chart links and let editors do the rest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inequality.org", authorRole: "Movement Organization", targetUrl: "https://inequality.org/", topImageKey: "org_inequality-org" },
  { id: 1215, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Call peer crisis line: 877-565-8860", description: "Trans peer crisis line: 877-565-8860. No police dispatch, no involuntary holds. Save the number for your friends.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Trans Lifeline", authorRole: "Movement Organization", targetUrl: "https://translifeline.org/", topImageKey: "org_trans-lifeline", amplifiesGroups: ["lgbtq"] },
  { id: 1216, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Reach via 24/7 chat / text / phone", description: "LGBTQ youth crisis line — 24/7 chat, text, phone. Save it; share it with any kid in your life feeling targeted.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Trevor Project", authorRole: "Movement Organization", targetUrl: "https://www.thetrevorproject.org/", topImageKey: "org_the-trevor-project", amplifiesGroups: ["lgbtq"] },
  { id: 1217, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Call peer hotline / chat", description: "Peer hotline + chat for LGBTQ folks of any age. Calm peer support, not crisis — for the bad-day moments.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "LGBT National Help Center", authorRole: "Movement Organization", targetUrl: "https://lgbthotline.org/", topImageKey: "org_lgbt-national-help-center", amplifiesGroups: ["lgbtq"] },
  { id: 1218, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Text HOME to 741741", description: "Trained counselor 24/7 — free, anonymous, no police dispatch. Save it now; share with anyone queer, trans, or targeted.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Crisis Text Line", authorRole: "Movement Organization", targetUrl: "https://www.crisistextline.org/", topImageKey: "org_crisis-text-line", amplifiesGroups: ["lgbtq"] },
  { id: 1219, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Subscribe to the Movement Memos podcast", description: "Subscribe to Kelly Hayes' podcast. Anti-burnout, abolitionist, movement-stamina lessons — keep going for the long fight.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Truthout / Kelly Hayes", authorRole: "Movement Organization", targetUrl: "https://truthout.org/series/movement-memos/", topImageKey: "org_truthout-kelly-hayes" },
  { id: 1220, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a peer mental-health chapter", description: "Find a peer mental-health chapter. Campus + online network — good fit for college students or new grads.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Active Minds", authorRole: "Movement Organization", targetUrl: "https://activeminds.org/", topImageKey: "org_active-minds" },
  { id: 1221, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a free virtual support group", description: "Find a free virtual support group. Family + peer mental-health support; weekly, online, no insurance needed.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAMI", authorRole: "Movement Organization", targetUrl: "https://www.nami.org/", topImageKey: "org_nami" },
  { id: 1223, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Sign up to run for office (under 40, progressive)", description: "Sign up to run for office. Under 40, progressive — they handle the hard parts, you focus on the door knocks.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Run for Something", authorRole: "Movement Organization", targetUrl: "https://runforsomething.net/", topImageKey: "org_run-for-something" },
  { id: 1224, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to candidate training (women)", description: "Apply for free women's candidate training. They've run thousands of women — training is rigorous, free, ongoing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote Run Lead", authorRole: "Movement Organization", targetUrl: "https://voterunlead.org/", topImageKey: "org_vote-run-lead", amplifiesGroups: ["woman"] },
  { id: 1225, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to candidate training (Dem women)", description: "Apply to candidate training for Democratic women. Six-month program; alumni include 1,200+ elected officials.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Emerge America", authorRole: "Movement Organization", targetUrl: "https://emergeamerica.org/", topImageKey: "org_emerge-america", amplifiesGroups: ["woman"] },
  { id: 1226, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to candidate training (Black women)", description: "Apply to Black women's candidate training. Pipeline org for the most underrepresented group in elected office.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Higher Heights for America", authorRole: "Movement Organization", targetUrl: "https://higherheightsforamerica.org/", topImageKey: "org_higher-heights-for-america", amplifiesGroups: ["woman"] },
  { id: 1230, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Save threatened gov pages with one click", description: "One-click archive of any threatened gov page. Save before Trump's admin scrubs it — works on any URL.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wayback Machine 'Save Page Now'", authorRole: "Movement Organization", targetUrl: "https://web.archive.org/save", topImageKey: "org_wayback-machine-save-page-now" },
  { id: 1231, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Pick a banned book + read it", description: "Pick a banned book + read it. Live, sortable list — read what they don't want in school libraries.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PEN America banned-books list", authorRole: "Movement Organization", targetUrl: "https://pen.org/banned-books-list-2022/", topImageKey: "org_pen-america-banned-books-list" },
  { id: 1232, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Set election reminders (every contest)", description: "Set election reminders for every contest. Off-cycle elections (judges, school boards) are where MAGA quietly stacks boards.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote.org", authorRole: "Movement Organization", targetUrl: "https://www.vote.org/", topImageKey: "org_vote-org" },
  { id: 1233, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Find DOJ-accredited rep training", description: "Free DOJ-accredited rep training. Trump's mass deportation needs more accredited reps — non-lawyers can do this.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CLINIC (Catholic Legal Immigration Network)", authorRole: "Movement Organization", targetUrl: "https://www.cliniclegal.org/", topImageKey: "org_clinic-catholic-legal-immigration-network", amplifiesGroups: ["immigrant"] },
  // MoveOn front-page petitions — https://front.moveon.org/petitions/
  { id: 1234, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Mandate that ICE agents show their face and identification", description: "Demand Congress require immigration agents to display agency ID and name badges, like other law enforcement.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/unmask-ice", topImageKey: "org_moveon", amplifiesGroups: ["immigrant"] },
  { id: 1235, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Keep the U.S. out of forever wars", description: "Oppose U.S. military action in Iran. Tell Congress to prevent another Middle Eastern war.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/no-war-with-iran-18", topImageKey: "org_moveon" },
  { id: 1236, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Do not cooperate with ICE", description: "Tell mayors and local officials to refuse cooperation with ICE and protect their residents.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/do-not-cooperate-with-ice", topImageKey: "org_moveon", amplifiesGroups: ["immigrant"] },
  { id: 1237, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Pam Bondi must go", description: "Demand Attorney General Pam Bondi resign or be impeached over her DOJ agenda.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/pam-bondi-must-go", topImageKey: "org_moveon" },
  { id: 1238, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "No warehouses for ICE detention centers", description: "Block ICE's $38B push to convert warehouses into immigration detention facilities.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/no-warehouses-for-ice-detention-centers", topImageKey: "org_moveon", amplifiesGroups: ["immigrant"] },

  // Common Cause direct-action campaigns — https://www.commoncause.org/take-action/
  { id: 1239, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Save the USPS and mail-in voting", description: "Sign to defend USPS from privatization. Mail-in voting and rural delivery die together — voter suppression by infrastructure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/save-the-us-postal-service/", topImageKey: "org_common-cause" },
  { id: 1240, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Defend the SPLC against right-wing attacks", description: "Sign to defend the Southern Poverty Law Center. Trump-aligned groups are using lawfare to discredit hate-tracking research.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/defend-the-splc-and-our-civil-rights/", topImageKey: "org_common-cause" },
  { id: 1241, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Hold Trump's DOJ lawyers accountable", description: "Email state bars asking for ethics review of DOJ lawyers advancing Trump's anti-democracy agenda. Bar discipline is a real lever.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/hold-trumps-doj-lawyers-accountable/", topImageKey: "org_common-cause" },
  { id: 1242, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Reject Trump's $10B presidential cash grab", description: "Email Congress to block Trump's $10B presidential allowance push. Funnels public money toward MAGA-aligned contractors.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/reject-trumps-10-billion-cash-grab/", topImageKey: "org_common-cause" },
  { id: 1243, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Pledge to be the change in your community", description: "Take Common Cause's pledge — vote in every election, recruit one neighbor, follow at least one local race. Habit beats vibes.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/take-the-pledge-be-the-change/", topImageKey: "org_common-cause" },
  { id: 1244, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Remove Trump from office", description: "Sign Common Cause's call for impeachment based on documented abuses. Petition pressure feeds the political will needed.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/remove-trump-from-office-now-2/", topImageKey: "org_common-cause" },

  // ── 50501 Movement, Tesla Takedown, Indivisible, satire creators batch ──
  // (Imported from resistact_new_cards_FINAL.csv — author-set tone vectors,
  // categories canonicalized, locations mapped to LOCATION_OPTIONS, amplifies
  // groups set where the action explicitly serves a vulnerable group.)
  { id: 1245, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Vote YES on War Powers Resolution to stop Trump's Iran war", description: "Action Network letter from 50501. Tells your Congressperson to vote YES on the War Powers Resolution to block Trump's unauthorized military escalation against Iran. Pre-written, edits encouraged.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://actionnetwork.org/letters/e8187bd3c13d6812ad7e41897d096f8d3ae76f60", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1246, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Help count the crowd at your next protest", description: "50501's We Count tool — submit headcounts and photos from rallies you attend so accurate turnout numbers reach press and Congress instead of MAGA's lowballed counts.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://bit.ly/m/WeCount", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1247, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join the No Kings Twitch organizing stream", description: "50501's recurring Twitch livestream — strategy briefings, training, and community check-ins for the No Kings campaign. Watch live or follow for replays.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://twitch.tv/50501movement", toneOverride: { anger: 1, comedy: 1, subversion: 1, hope: 2, energy: 0 }, adminApproved: false },
  { id: 1248, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take 50501's Marching 101 protest training", description: "Self-paced first-time-protester guide from 50501 — what to wear, what to bring, how to stay safe in a crowd, what to do if police escalate. Read once before your first march.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/FiftyFiftyOneMovement", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 1 }, firstTimerFriendly: true },
  { id: 1249, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Read 50501's Digital Safety primer for activists", description: "Quick guide from 50501 on locking down your phone, secure messaging, and metadata hygiene before joining protests. Trump-era surveillance is real — don't make it easy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/FiftyFiftyOneMovement", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 0 }, firstTimerFriendly: true },
  { id: 1250, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Use 50501's Virtual Actions guide if you can't show up in person", description: "Disabled, immunocompromised, working two jobs? 50501's virtual-actions guide is a curated list of from-home protest contributions — phone banking, postcard writing, social amplification, doxx-defense.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/FiftyFiftyOneMovement", toneOverride: { anger: 1, comedy: 0, subversion: 0, hope: 2, energy: 0 }, amplifiesGroups: ["disabled"], adminApproved: false },
  { id: 1251, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Sell your Tesla", description: "Tesla Takedown's headline ask — divest from Musk's company. Trade in, sell to a dealer, or post on Bring-A-Trailer. Every sale chips at the Musk valuation that funds his political project.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 1, energy: 2 }, firstTimerFriendly: true },
  { id: 1252, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Dump your TSLA stock", description: "Tesla Takedown asks anyone holding Tesla shares — directly, in a 401(k), or via index funds — to divest. Switch to a Musk-free ETF; pressure your fund manager.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 1, energy: 2 }, firstTimerFriendly: true },
  { id: 1253, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find a Tesla Takedown protest near you", description: "Map and calendar of weekly Tesla showroom protests across the US. Pick the closest, RSVP, show up. Peaceful, sign-holding, First Amendment.", location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 3 }, adminApproved: false },
  { id: 1254, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Plan a Tesla Takedown protest in your city", description: "No protest in your area yet? Tesla Takedown has a host-an-action toolkit — permits, sign templates, safety protocol, comms scripts. Pick a Saturday and start a chapter.", location: "Multi-state", boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com", topImageKey: "org_tesla-takedown", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 2, energy: 3 }, adminApproved: false },
  { id: 1255, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Push your city to pass a Tesla divestment resolution", description: "Tesla Takedown's City Resolutions track helps you draft and pass a municipal resolution to drop Tesla from city fleets and pension exposure. Templates + sample testimony included.", location: "Multi-state", boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/city-resolutions", topImageKey: "org_tesla-takedown", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1256, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Share your 'I sold my Tesla' story", description: "Tesla Takedown collects defection testimonies — short written or video stories about why you ditched the car. They use them in press, social, and recruitment.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/share-your-story", topImageKey: "org_tesla-takedown", toneOverride: { anger: 2, comedy: 1, subversion: 1, hope: 1, energy: 1 }, firstTimerFriendly: true },
  { id: 1257, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Republican Reps: Not One Penny More for ICE Brutality", description: "Indivisible action — pre-written email to Republican members of Congress demanding they vote against any new ICE funding. Editable script.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/tell-your-republican-members-of-congress-not-one-penny-more-for-ice/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Email-R-MoC-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], firstTimerFriendly: true },
  { id: 1258, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Republican Rep: Stop Bankrolling ICE Brutality", description: "Indivisible script + your Rep's number. 60-second call demanding they oppose ICE funding expansion. Currently flagged TRENDING NOW on Indivisible's action board.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/gop-house-stop-bankrolling-ice/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Call-R-Rep-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1259, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Republican Senator: Stop Bankrolling ICE Brutality", description: "Indivisible's Senate-side companion call. Same ask: vote no on more ICE money. Senate phone numbers + script provided.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/gop-senate-stop-ice-brutality/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Call-R-Senator-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1260, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Democrats: Fiercely Oppose the New GOP ICE Funding Push", description: "Indivisible action targeting Democratic Reps — telling your own party to actually fight, not just vote no quietly. Anti-rollover messaging.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/urge-democrats-fiercely-oppose-new-gop-effort-shovel-billions-more-dollars-ice-and-border-patrol/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/260429_No-Money-for-ICE_Email-D-MoC-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1261, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senator: Oppose Warrantless AI Mass Surveillance", description: "Indivisible action against AI-driven mass-surveillance authorities being added to spending bills. Script + Senate switchboard.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/tell-your-senators-oppose-warrantless-ai-mass-surveillance/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/240409_FISA-CTA-2_1240x790-500x319.png", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant", "journalist"], adminApproved: false },
  { id: 1262, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Rep: Oppose Warrantless AI Mass Surveillance", description: "Indivisible House-side companion. Same ask, House script.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/tell-representatives-no-to-ai-warrantless-mass-surveillance/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/240409_FISA-CTA-2_1240x790-500x319.png", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant", "journalist"], adminApproved: false },
  { id: 1263, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Reject the Deportation & Detention Agenda", description: "Indivisible omnibus action against the Trump deportation expansion package — email your Reps and Senators with one click.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/reject-the-deportation-and-detention-agenda/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/03/260309_No-More-Detention-Centers-blue_1240x790-500x319.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], firstTimerFriendly: true },
  { id: 1264, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senators: End the Illegal War on Iran", description: "Indivisible Senate call companion. Phone is louder than email — staff log calls separately.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/no-war-iran-senate/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/250618_1200-x-600_No-War-with-Iran-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1265, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person", title: "Make a 'No Kings' protest sign and bring it to your next rally", description: "#NoKings has 271K+ posts on TikTok — creators sharing sign templates, slogans, and crowd footage. Make your own using their templates and tag #NoKings to amplify.", location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "No Kings (50501-aligned)", authorRole: "Movement Organization", targetUrl: "https://www.tiktok.com/tag/nokings", toneOverride: { anger: 2, comedy: 1, subversion: 1, hope: 2, energy: 2 }, firstTimerFriendly: true },
  { id: 1266, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Film a '50501 [your state]' intro reel", description: "TikTok pattern: short intro videos like 'We Are 50501 Georgia' from state chapters. Film one for your state, post on TikTok and Reels, link to your chapter's signup. Recruitment in 30 seconds.", location: "National", boosts: 0, spotsTotal: "Unlimited", authorName: "50501 state chapters", authorRole: "Movement Organization", targetUrl: "https://www.tiktok.com/tag/50501", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 1, subversion: 2, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1267, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Stitch or duet a Trump clip with your counter-narrative", description: "TikTok's stitch/duet format is being used to debunk and ridicule Trump quotes in real time. Pick a clip, add 30 seconds of your own context or mockery, post with #Resist or #50501.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/tag/50501", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 1, energy: 1 }, firstTimerFriendly: true },
  { id: 1268, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Follow @teslatakedown on Instagram for weekly action drops", description: "Their IG posts the next Saturday's protest list, sign templates, and creator-made meme content. Lowest-effort way to plug into a national protest schedule.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.instagram.com/teslatakedown/", topImageKey: "org_tesla-takedown", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 1, energy: 0 }, firstTimerFriendly: true },
  { id: 1269, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Submit your protest photo to a 50501 chapter highlight", description: "Instagram chapters like @50501movement run 'NO KINGS', 'May Day', 'DEFENSE' photo highlights from contributors. Tag your chapter; visibility builds the cohort.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "50501 Movement", authorRole: "Movement Organization", targetUrl: "https://www.instagram.com/50501movement/", toneOverride: { anger: 1, comedy: 0, subversion: 1, hope: 2, energy: 0 }, adminApproved: false },
  { id: 1270, category: "MEETING", categoryColor: "#5a3e9e", actionType: "In Person Group", title: "50501 Joplin / Citizens Against Tyranny — monthly meeting", description: "Sat May 16, 2:00 PM. Joplin, MO. 50501 Joplin and Citizens Against Tyranny Network's monthly chapter meeting. Local organizing in deep-red Missouri.", location: "Missouri", eventDate: "2026-05-16", boosts: 0, spotsTotal: "Unlimited", authorName: "Citizens Against Tyranny Network", authorRole: "Movement Organization", targetUrl: "https://events.pol-rev.com/", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 2 }, adminApproved: false },
  { id: 1271, category: "MEETING", categoryColor: "#5a3e9e", actionType: "In Person Group", title: "BloNo IL community meeting & cookout (Central IL Iron Front)", description: "Sun May 17, 2:00 PM. Bloomington, IL. Central Illinois Iron Front community meeting + cookout. Antifascist organizing meets potluck. Bring a side dish.", location: "Illinois", eventDate: "2026-05-17", boosts: 0, spotsTotal: "Unlimited", authorName: "Central Illinois Iron Front", authorRole: "Movement Organization", targetUrl: "https://events.pol-rev.com/", toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 3, energy: 1 }, adminApproved: false },
  { id: 1272, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "We The People of Ohio — Constitution day in Mentor", description: "Sun May 17, 8:00 AM. Mentor, OH. Constitution-themed visibility action. Peaceful, free, family-friendly. Hosted by Kathy.", location: "Ohio", eventDate: "2026-05-17", boosts: 0, spotsTotal: "Unlimited", authorName: "Mentor OH locals", authorRole: "Citizen Activist", targetUrl: "https://events.pol-rev.com/", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 3, energy: 2 }, adminApproved: false },
  { id: 1273, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Subscribe to MeidasTouch on YouTube", description: "2.7M followers on TikTok, even bigger on YouTube. Daily anti-Trump news takedowns. Subscribe so the algorithm pushes their content to your feed and others'.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MeidasTouch Network", authorRole: "Movement Organization", targetUrl: "https://www.youtube.com/@MeidasTouch", topImageKey: "org_youtube", imageContain: true, toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1274, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Share MeidasTouch's latest Trump takedown clip", description: "Pick a recent MeidasTouch reel — the punchier the better — and share it on your story or repost. Their model is reach-driven; sharing is the action.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MeidasTouch Network", authorRole: "Movement Organization", targetUrl: "https://www.tiktok.com/@meidastouch", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 2, subversion: 1, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1275, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Listen to Lizz Winstead's Feminist Buzzkills podcast", description: "Daily Show co-creator Lizz Winstead's weekly comedy podcast about abortion rights, post-Roe America, and the fight against the Christian right. Subscribe wherever you get podcasts.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Abortion Access Front", authorRole: "Movement Organization", targetUrl: "https://aafront.org/feminist-buzzkills-live/", toneOverride: { anger: 2, comedy: 3, subversion: 2, hope: 2, energy: 0 }, amplifiesGroups: ["repro", "woman"], adminApproved: false },
  { id: 1276, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Donate to Abortion Access Front", description: "Lizz Winstead's org — comedy meets clinic defense. Road trips to abortion clinics, destigmatizing comedy shows, post-Dobbs clinic-side support.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Abortion Access Front", authorRole: "Movement Organization", targetUrl: "https://aafront.org/donate/", toneOverride: { anger: 3, comedy: 2, subversion: 2, hope: 2, energy: 1 }, amplifiesGroups: ["repro", "woman"], adminApproved: false },
  { id: 1277, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Watch and share a Blaire Erskine satire video", description: "Blaire Erskine's deadpan-news-anchor satire reels (1.1M TikTok likes) skewer MAGA talking points one fake interview at a time. Pick one, share it, tag a relative who needs it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Blaire Erskine", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/@blaireerskine", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1278, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Subscribe to Blaire Erskine's Substack", description: "The newsletter version of Blaire Erskine's deadpan-news-anchor MAGA satire — bonus fake interviews skewering Trump talking points, behind-the-scenes on her viral TikTok reels, no algorithm gating. Direct to your inbox.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Blaire Erskine", authorRole: "Citizen Activist", targetUrl: "https://blaireerskine.substack.com/", toneOverride: { anger: 1, comedy: 3, subversion: 1, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1279, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Subscribe to The Lincoln Project's video drops", description: "Republicans-against-Trump satirical attack ads. Subscribe on YouTube and follow on TikTok/IG for the new releases — they're shareable weapons against MAGA relatives.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lincoln Project", authorRole: "Movement Organization", targetUrl: "https://www.youtube.com/@LincolnProject", topImageKey: "org_youtube", imageContain: true, toneOverride: { anger: 3, comedy: 3, subversion: 2, hope: 1, energy: 0 }, adminApproved: false },
  { id: 1280, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Use a satire creator's audio to make your own anti-Trump TikTok", description: "TikTok's audio-reuse mechanic is a force multiplier. Pick a viral political satire audio (MeidasTouch, Lizz Winstead, Blaire Erskine), film a 15-second take with your local angle, post.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/discover/political-satire", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 2, comedy: 3, subversion: 3, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1281, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Comment-bomb viral Trump videos with action links", description: "TikTok and IG comment sections on Trump-aligned content reach undecided/curious viewers. Drop a clean comment with a link to a 5Calls script or local action — short, no insult, just info. Action over rage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Independent creators", authorRole: "Citizen Activist", targetUrl: "https://www.tiktok.com/tag/50501", topImageKey: "org_tiktok", imageContain: true, toneOverride: { anger: 1, comedy: 1, subversion: 3, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1282, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: No to Warrantless AI Mass Surveillance", description: "One-click Indivisible email to your full Congressional delegation. Demands they strip warrantless AI surveillance provisions from spending bills before they pass.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/tell-congress-say-no-warrantless-ai-mass-surveillance/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/04/240409_FISA-CTA_1240x790-500x319.png", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant", "journalist"], adminApproved: false },
  { id: 1283, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senators: Block the Deportation & Detention Expansion", description: "Call your Senators and demand they publicly oppose new ICE detention centers and the mass deportation expansion. Indivisible script + direct Senate numbers included.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/deportation-detention-agenda-senate/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/03/260309_No-More-Detention-Centers-red_sen_1240x790-500x319.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1284, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Rep: Reject the Deportation & Detention Agenda", description: "Call your House Representative to block Trump's mass deportation and detention expansion. Indivisible call script and Rep phone numbers provided.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/deportation-detention-agenda-house/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/03/260309_No-More-Detention-Centers-blue_rep_1240x790-500x319.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1285, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Stop Trump's Illegal War on Iran", description: "One-click Indivisible email to your full delegation invoking the War Powers Act. Demands Congress vote to halt Trump's unauthorized military escalation against Iran.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/no-iran-war/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260224_1200-x-600_No-War-with-Iran-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1286, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Rep: End the Illegal War on Iran", description: "Call your House Representative to demand a vote to end Trump's unauthorized war on Iran. Indivisible script + direct House phone numbers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/no-war-iran-house/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260224_1200-x-600_No-War-with-Iran-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1287, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Kill the GOP Voter Suppression Bills", description: "Email your full delegation to stop the SAVE Act and MEGA Act — GOP bills that would purge millions of eligible voters before the 2026 elections. One-click Indivisible action.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://act.indivisible.org/sign/stop-gops-new-voter-suppression-legislation/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260206_SAVE-MEGA-Act_Email-MoC-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1288, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call your Senators: Vote NO on GOP Voter Suppression", description: "Call your Senators to vote against the SAVE Act and MEGA Act — Republican bills that would gut voter registration and purge eligible voters before 2026. Indivisible script included.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/stop-save-senate/", topImageUrl: "https://indivisible.org/wp-content/uploads/2026/02/260206_SAVE-MEGA-Act_Call-Sen-500x319.png", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1289, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email your Governor: Stop the Redistricting Coup", description: "Republicans are redrawing congressional maps mid-decade to lock in House control before 2026. Email your governor demanding they commit to fair redistricting — not partisan gerrymandering.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/campaigns/redistricting-coup-underway/", topImageUrl: "https://indivisible.org/wp-content/uploads/2025/11/The-Redistricting-Coup-is-Underway-500x281.png", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1290, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call Democratic Senators: Block Trump's Crypto Corruption Bill", description: "Call your Democratic Senators to oppose the CLARITY Act — Trump's crypto deregulation bill that strips SEC authority and enables his own crypto-corruption schemes. Indivisible script provided.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Indivisible", authorRole: "Movement Organization", authorLink: "https://indivisible.org/", targetUrl: "https://indivisible.org/actions/stop-trumps-crypto-corruption/", topImageUrl: "https://indivisible.org/wp-content/uploads/2025/12/crypto_corruption-500x500.jpg", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },

  // ── NAACP (added 2026-05-14) ──────────────────────────────────────────────────
  { id: 1291, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Congress: Reject Harmful Cuts to Social Safety Net Programs", description: "Congress is moving to eliminate healthcare for 11.8 million people, slash one-third of the SNAP budget ($300B), and gut Social Security, Medicare, Medicaid, and Veterans benefits — all to fund tax breaks for the wealthy. The NAACP calls it un-American. Email your reps to vote NO.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-reject-harmful-funding-cuts", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1281545908.jpg.webp?itok=uA1GiwQi", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1292, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Call Your Senator: Vote NO on the SAVE Act Voter Suppression Bill", description: "The SAVE Act would disenfranchise 21 million Americans — married women whose ID names differ from voter rolls, elderly without current IDs, students with mismatched addresses. Voter suppression disguised as protection. Call the Capitol Switchboard and demand your senator vote no.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-vote-no-save-act", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/JKnight_220923_0709%20%281%29.jpg.webp", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1293, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: No New Funding for ICE", description: "ICE agents are killing and terrorizing communities with zero accountability. The NAACP is demanding Congress cut ICE funding, strip agent immunity, remove DHS Secretary Kristi Noem, and end federal-local law enforcement collusion. Contact your representatives now.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-no-new-funding-ice", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/Untitled-7.jpg.webp", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1294, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Report a Dirty AI Data Center Being Built Near You", description: "AI data centers are being built in Black and low-income communities, burning fuels that emit cancer-causing chemicals. The NAACP is mapping where they're going. Report any planned or proposed data center in your area — your tip fuels national advocacy and local strategy.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://forms.office.com/r/0BjBrg6TJU", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/64d27f8d3d504e5ad0833726_hdr-data-center-types.jpg.webp", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1295, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "No Healthcare, No Vote: Demand Congress Protect ACA Tax Credits", description: "Nearly 24 million Americans will lose ACA health coverage if enhanced premium tax credits expire. The NAACP is calling on Congress to extend them — because healthcare is a right, not a privilege. Email your representative before the deadline.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/no-healthcare-no-vote", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1287924870.jpg.webp?itok=Gzy0cAK2", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1296, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the NAACP Petition: Protect Black Workers", description: "Black unemployment hit 7.2% in 2025 — nearly double the national rate — driven by mass federal job cuts and DEI rollbacks that targeted Black workers in healthcare, education, and public service. The NAACP demands a moratorium on targeted layoffs and an immediate pause on DEI dismantling. Sign now.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/protect-black-workers", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1196015209.jpg.webp", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1297, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Stop Elon Musk's xAI from Poisoning Black Communities", description: "Musk's xAI installed unpermitted gas turbines in Boxtown, Tennessee — a predominantly Black neighborhood — generating cancer-causing pollution equal to a full power plant. Email Congress directly to demand accountability and protect communities from Big Tech's AI expansion.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://support.naacp.org/a/tell-congress-to-protect-our-communities-from-ai-data-center-operations", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/environmental-justice.jpg.webp?itok=a8N4Y7-k", toneOverride: { anger: 3, comedy: 0, subversion: 1, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1298, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass the John R. Lewis Voting Rights Advancement Act", description: "The JLVRAA restores federal oversight of states with discriminatory voting histories, protects ballot access for communities of color, and guarantees equal voting rights for every citizen. Reject the SAVE Act. Advance the JLVRAA. Voting rights are American rights — contact Congress now.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/tell-congress-protect-our-voting-rights", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/iStock-1202146507.jpg.webp?itok=57dCxKlE", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1299, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Share Your Story: How Federal Budget Cuts Are Hurting Your Family", description: "Congress is slashing Medicaid and SNAP while handing tax breaks to billionaires. The NAACP needs your story — how would losing healthcare, food assistance, or housing support affect you or someone you love? Personal testimonies shift congressional votes. Two minutes to submit.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://support.naacp.org/a/budget-and-tax-stories", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/GettyImages-844235780-cropped.jpg.webp", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 1, energy: 0 }, firstTimerFriendly: true, adminApproved: false },
  { id: 1301, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email Your Senator: Kill the 'Kill Nonprofits' Bill (H.R. 9495)", description: "H.R. 9495 lets the government strip tax-exempt status from any nonprofit it labels 'terrorist supporting' — meaning the NAACP, ACLU, Planned Parenthood, any org that criticizes the administration. This is the infrastructure for silencing civil society. Email your senator to stop it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAACP", authorRole: "Civil Rights Organization", authorLink: "https://naacp.org/", targetUrl: "https://naacp.org/actions/oppose-hr-9495-protect-nonprofit-organizations", topImageUrl: "https://naacp.org/sites/default/files/styles/hero_desktop/public/images/pexels-life-matters-4613879-%281%29.jpg.webp?itok=G50qUJOv", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 1, energy: 1 }, adminApproved: false },

  // ── Dissent Pins resistance merch ─────────────────────────────────────────────
  { id: 1302, category: "PERSONAL COMMITMENT", categoryColor: "#23297e", actionType: "Online", title: "Slap a 'No War Is Holy' Sticker on Your Car (or Laptop)", description: "Tired of hearing Trump claim divine favor for his wars? This UV-laminated bumper sticker (5.25″ × 3″) pushes back on the gospel of holy wars. Weather-resistant for indoor or outdoor use — sticker or car magnet. From Dissent Pins.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/no-war-is-holy-bumper-sticker", topImageUrl: "https://dissentpins.com/cdn/shop/files/NoWarIsHolyStickerMock-up_2000x2000.jpg?v=1776273173", toneOverride: { anger: 2, comedy: 1, subversion: 2, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1303, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Buy a Fifth Amendment Sticker — 50% to Immigrant Rights Orgs", description: "The Fifth Amendment protects everyone in the U.S. — citizens and non-citizens alike. Show it. 50% of profits go directly to immigrant rights organizations doing legal defense and community education, including Hands Off NYC, Illinois Coalition for Immigrant Rights, and Portland Immigrant Rights Coalition. 8.3″ wide, UV-laminated.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/fifth-amendment-bumper-sticker", topImageUrl: "https://dissentpins.com/cdn/shop/files/FifthAmendmentBumperSticker_1500x1500.png?v=1752677646", toneOverride: { anger: 2, comedy: 0, subversion: 1, hope: 2, energy: 1 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1304, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Buy an Abolish ICE Liberty Sticker — 50% to Immigrant Rights Orgs", description: "Show solidarity with neighbors under threat from ICE enforcement. 50% of profits fund five immigrant rights organizations doing legal defense and community education. UV-laminated sticker (6.5″ × 4.4″) or car magnet.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/abolish-ice-liberty-bumper-sticker-or-car-magnet", topImageUrl: "https://dissentpins.com/cdn/shop/files/AbolishICELibertycarmagnetonblue2000x2000_2000x2000.jpg?v=1766517162", toneOverride: { anger: 3, comedy: 0, subversion: 2, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },
  { id: 1305, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", title: "Buy a FCK ICE Tee — 100% to Immigrant Defense Funds", description: "Wear your resistance and fund it. 100% of profits go directly to Minnesota Immigrant Rapid Response Fund, Immigrant Law Center of Minnesota, and UNIDOSMN. Light blue, 100% cotton, sizes XS–4XL. Made with Vermont-based New Duds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Dissent Pins", authorRole: "Resistance Merch", authorLink: "https://dissentpins.com/", targetUrl: "https://dissentpins.com/collections/best-sellers/products/fckice-tshirt", topImageUrl: "https://dissentpins.com/cdn/shop/files/FCKICEHoodieUGCJoinbrandsDanTinklerMar202612000x2000_1024x.jpg?v=1773673949", toneOverride: { anger: 3, comedy: 1, subversion: 2, hope: 2, energy: 2 }, amplifiesGroups: ["immigrant"], adminApproved: false },

  // ── Religious Action Center of Reform Judaism — Legislative Action Center ───
  { id: 1306, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass the Environmental Justice for All Act", description: "Reform Jewish constituent email backing the A. Donald McEachin Environmental Justice for All Act (S. 919 / H.R. 1705). Forces federal agencies to weigh environmental and health impacts on Black, brown, low-income, and Indigenous communities before approving permits — the people Trump's deregulation hits first. One click sends to your delegation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/97971/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Hands%20cradling%20Earth.png?itok=6LiFeyEf", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1307, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass the FAMILY Act for Paid Family + Medical Leave", description: "Reform Jewish constituent email backing the FAMILY Act — paid family and medical leave for every worker in America. The U.S. is the only wealthy country without it. One click sends to your Reps and Senators.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/97797/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Coins%20stack%20with%20balance%20scale.png?itok=LoJBbP7S", toneOverride: { anger: 1, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1308, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Close Loopholes, Ban Assault Weapons, Fund Violence Intervention", description: "Reform Jewish action backing eight gun-violence-prevention measures — universal background checks, an assault weapons ban, safe storage, community violence intervention funding, and more. Faith voices move members who tune out everyone else. One-click email.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/Campaigns/97975/Respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/keep%20our%20schools%20safe%20sign.png?itok=V9BPpWTZ", toneOverride: { anger: 3, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1309, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Mandate Hate Crime Reporting (IRPHA)", description: "Reform Jewish ask to pass the bipartisan Improving Reporting to Prevent Hate Act — requires local law enforcement to actually report hate crimes to the FBI. Reporting is voluntary right now, which is why federal hate-crime data is unusable. One-click constituent email.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/115231/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/memorial%20candle.png?itok=F95veFJk", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1310, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Urge Congress: Pass the West Bank Violence Prevention Act", description: "Reform Jewish-led ask for U.S. sanctions on Israeli settlers and entities driving violence against Palestinians in the West Bank. Jewish constituents pushing this carries weight Trump and Netanyahu can't deflect. One-click email to your full delegation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/131611/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Jerusalem%20Day%20celebrations.png?itok=2n1dkw_y", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1311, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Your State Legislators: Protect LGBTQ+ People in Your State", description: "Reform Jewish state-level email pushing back on the 500+ anti-LGBTQ+ bills introduced in 2024. Targets your Governor and state legislators with a faith-rooted framing on equal protection — the message that lands in red and purple statehouses when nothing else does.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/98070/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-10/Young%20woman%20waving%20LGBTQ%2Bflag.png?itok=DIxOv-AP", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, amplifiesGroups: ["lgbtq"], adminApproved: false },
  { id: 1312, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: Pass H.R. 40 — Commission to Study Reparations", description: "Reform Jewish constituent email urging passage of H.R. 40 / S. 40 — establishes a federal Commission to Study and Develop Reparation Proposals for African Americans. Doesn't pay reparations; it produces the official record that makes them possible. Jewish memory in service of Black liberation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "RAC of Reform Judaism", authorRole: "RAC", authorLink: "https://rac.org/", targetUrl: "https://www.votervoice.net/URJ/campaigns/97892/respond", topImageUrl: "https://rac.org/sites/default/files/styles/page_header/public/2025-11/RAC%20header%20-%20Reparations.png?itok=gCQMs0dl", toneOverride: { anger: 2, comedy: 0, subversion: 0, hope: 2, energy: 1 }, adminApproved: false },

  // ── Etsy anti-Trump merch (indie makers) ──────────────────────────────────
  // og:image URLs scraped from each listing's product page. Etsy CDN images
  // are stable but the listings themselves can be pulled by sellers — if a
  // card 404s the link, the admin panel can swap the targetUrl without
  // touching the image.
  { id: 1313, category: "IRREVERENCE", categoryColor: "#9333ea", actionType: "Online", title: "Buy the \"Waiting for the Big Beautiful Obituary\" Anti-Trump Tee", description: "Subtle FDT tee that flips Trump's \"big, beautiful\" branding into the obituary nobody's writing yet. Anti-MAGA, V-neck option, the kind of shirt that gets a knowing nod at the protest and a long stare in the suburbs. Indie maker (TeeTaniumCo) ships from Raleigh, NC.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "TeeTaniumCo (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/TeeTaniumCo", targetUrl: "https://www.etsy.com/listing/4484525481/anti-trump-tee-waiting-for-big-beautiful", topImageUrl: "https://i.etsystatic.com/46711686/r/il/38bf26/7886752294/il_1080xN.7886752294_gy8z.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1314, category: "IRREVERENCE", categoryColor: "#9333ea", actionType: "Online", title: "Slap a \"When It Happens\" Anti-Trump Wine Label on the Bottle", description: "Custom champagne / wine label sticker for the bottle you're saving for the day Trump is finally out. Subtle FDT, Democrat-gift-grade, makes any cabinet shelf into a countdown clock. Stick it now, pop it later — UncorkedLabels ships from Ocoee, FL.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "UncorkedLabels (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/UncorkedLabels", targetUrl: "https://www.etsy.com/listing/4357310155/anti-trump-custom-wine-label-funny", topImageUrl: "https://i.etsystatic.com/45057606/r/il/171012/7696003810/il_1080xN.7696003810_4ugp.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
  { id: 1315, category: "IRREVERENCE", categoryColor: "#9333ea", actionType: "Online", title: "Buy the \"President and Dumb Should Be Different People\" Tee", description: "Anti-Trump slogan tee that says the quiet part out loud. Wearable irreverence for anyone tired of pretending we're still doing the diplomatic-disagreement thing about this presidency. TeeGeekBoutique ships from San Jose, CA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "TeeGeekBoutique (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/TeeGeekBoutique", targetUrl: "https://www.etsy.com/listing/4469069065/anti-trump-tee-president-and-dumb-should", topImageUrl: "https://i.etsystatic.com/46736936/r/il/c5a9ce/7834235639/il_1080xN.7834235639_6k7m.jpg", toneOverride: { anger: 2, comedy: 2, subversion: 2, hope: 1, energy: 1 }, adminApproved: false },
  { id: 1316, category: "IRREVERENCE", categoryColor: "#9333ea", actionType: "Online", title: "Buy the \"Go Back, We Screwed Up\" Trump Evolution Tee", description: "The evolution-of-man cartoon, except the last frame is an apology. \"Go back, we screwed up.\" Vote-blue, Kamala-friendly, pure billboard energy on a t-shirt. PrintfulApparelUS ships from Stafford, TX.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PrintfulApparelUS (Etsy)", authorRole: "Resistance Merch", authorLink: "https://www.etsy.com/shop/PrintfulApparelUS", targetUrl: "https://www.etsy.com/listing/1797660855/anti-trump-tshirt-go-back-we-screwed-up", topImageUrl: "https://i.etsystatic.com/53712756/r/il/57fd0e/6288678088/il_1080xN.6288678088_ll21.jpg", toneOverride: { anger: 1, comedy: 3, subversion: 2, hope: 2, energy: 1 }, adminApproved: false },
];

// ─── Seed receipts (The Smacks) ───────────────────────────────────────────────
// IDs start at 5001 to avoid collisions with admin-created receipts.
// Bump seed:receipts version key whenever you add/edit entries here.
const SEED_RECEIPTS = [
  {
    id: 5001,
    title: "Impeach Trump Again",
    tags: ["Trump", "MAGA", "Fascism"],
    imageUrl: "/Smacks/impeach.png",
    caption: "He was impeached twice and should have been removed. Twice wasn't enough — the country deserves accountability. Share this. #ImpeachTrump #ResistAct",
    adminApproved: true,
  },
  {
    id: 5002,
    title: "Rock the Vote",
    tags: ["Voting Rights"],
    imageUrl: "/Smacks/rock-the-vote.webp",
    caption: "Your vote is your most powerful tool. Use it. Share it. Protect it. #RockTheVote #ResistAct",
    adminApproved: true,
  },
];

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
    return c.json({ approval });
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

    const noUrl: any[] = [];

    for (const card of (await kv.getByPrefix("action:")) as any[]) {
      if (card && typeof card === "object" && card.adminApproved === true && !card.targetUrl && !card.pinToTop) {
        noUrl.push({ ...card, _store: "action" });
      }
    }

    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      const card = await kv.get(`user-action:${id}`) as any;
      if (card && typeof card === "object" && card.adminApproved === true && !card.targetUrl) {
        noUrl.push({ ...card, _store: "user-action" });
      }
    }

    noUrl.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return c.json({ cards: noUrl });
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

    const enriched = list.map((u) => ({
      ...u,
      totalActions: totalByUser[u.userId] ?? 0,
      lastActiveAt: lastActiveByUser[u.userId] ?? null,
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
    return c.json({ user: record });
  } catch (err) {
    return c.json({ error: `Approval failed: ${err}` }, 500);
  }
});

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
    const limit  = Math.min(Number(c.req.query("limit")  ?? 20), 100);
    const offset = Math.max(Number(c.req.query("offset") ?? 0),   0);

    // Seed Ellen user if not done yet
    await seedEllenUser();

    // One-time: remove fake placeholder seed cards (IDs 1–18) from the DB
    const fakePurged = await kv.get("cleanup:fake-seeds:v1");
    if (!fakePurged) {
      const fakeIds = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18];
      for (const id of fakeIds) await kv.del(`action:${id}`);
      await kv.set("cleanup:fake-seeds:v1", true);
      console.log("Purged fake seed cards 1–18.");
    }

    // One-time: re-purge the placeholder seed cards (ids 2–17 minus 11) that
    // were re-seeded after the v1 cleanup ran. SEED_CARDS no longer references
    // them, so deleting their KV records is final — they won't reappear.
    const fakePurgedV2 = await kv.get("cleanup:purge-fake-seeds:v2");
    if (!fakePurgedV2) {
      const ids = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17];
      for (const id of ids) await kv.del(`action:${id}`);
      await kv.set("cleanup:purge-fake-seeds:v2", true);
      console.log(`Purged ${ids.length} fake seed cards (v2): ${ids.join(", ")}`);
    }

    // One-time: remove dropped seed cards. Add new IDs to the array and bump
    // the version key whenever you delete cards from SEED_CARDS.
    const droppedPurged = await kv.get("cleanup:dropped-seeds:v1");
    if (!droppedPurged) {
      const droppedIds = [1136, 1185]; // Apiary repro-pledge duplicates
      for (const id of droppedIds) await kv.del(`action:${id}`);
      await kv.set("cleanup:dropped-seeds:v1", true);
      console.log(`Purged ${droppedIds.length} dropped seed cards.`);
    }

    // One-time: zero out boosts on the early seed cards that started with
    // `boosts: 5` placeholder values. These were carry-over from the original
    // Figma demo data. Live data writes get preserved on re-seed via the
    // merge logic below, so the seed file alone can't clear them.
    const boostsResetDone = await kv.get("cleanup:reset-boosts-5:v1");
    if (!boostsResetDone) {
      const resetIds = [8, 9, 10, 13];
      for (const id of resetIds) {
        const existing = (await kv.get(`action:${id}`)) as any;
        if (existing && typeof existing === "object") {
          await kv.set(`action:${id}`, { ...existing, boosts: 0 });
        }
      }
      await kv.set("cleanup:reset-boosts-5:v1", true);
      console.log(`Reset boosts to 0 on ${resetIds.length} demo cards.`);
    }

    // One-time: rewrite Blaire Erskine Substack description (id 1278). The
    // CSV-imported version was vague about why users would subscribe; the
    // updated copy makes the anti-MAGA satire connection explicit so admins
    // and users can immediately see why it's on-topic.
    const blaireUpdated = await kv.get("cleanup:blaire-substack-desc:v1");
    if (!blaireUpdated) {
      const newDesc = "The newsletter version of Blaire Erskine's deadpan-news-anchor MAGA satire — bonus fake interviews skewering Trump talking points, behind-the-scenes on her viral TikTok reels, no algorithm gating. Direct to your inbox.";
      for (const prefix of ["action:", "user-action:"]) {
        const existing = (await kv.get(`${prefix}1278`)) as any;
        if (existing && typeof existing === "object") {
          await kv.set(`${prefix}1278`, { ...existing, description: newDesc });
        }
      }
      await kv.set("cleanup:blaire-substack-desc:v1", true);
      console.log("Updated Blaire Erskine Substack description (id 1278).");
    }

    // One-time: clear stray `notOnTopic` flags on cards 265/266/267 (Apple/
    // Google subscription cancellations). These were flagged by a stray
    // human click in a past admin session — the rest of the cancel-subs
    // cluster (Amazon/Microsoft/Xbox/etc.) was approved cleanly. Going
    // forward the off-topic badge is AI-set only.
    const strayFlagsCleared = await kv.get("cleanup:clear-stray-offtopic:v1");
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
      await kv.set("cleanup:clear-stray-offtopic:v1", true);
      console.log(`Cleared stray notOnTopic flags on ${ids.length} cards.`);
    }

    // One-time: backfill `topImageUrl` on the 37 CSV-imported cards (IDs
    // 1245–1281) using og:image URLs scraped from each card's targetUrl host.
    // Tesla cards are skipped — they already use the local `org_tesla-takedown`
    // asset. TikTok / Twitch / Pol-Rev pages don't expose og:image, so they
    // borrow the 50501 / brand-equivalent image as a sensible fallback.
    const imagesBackfillDone = await kv.get("cleanup:backfill-images-1245:v1");
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
      await kv.set("cleanup:backfill-images-1245:v1", true);
      console.log(`Backfilled topImageUrl on ${imageBackfillCount} new cards.`);
    }

    // One-time: clear the previously-backfilled topImageUrl on TikTok/YouTube
    // cards so the new local SVG logos (org_tiktok / org_youtube, with
    // imageContain) take over. The resolver prefers topImageUrl over
    // topImageKey, so we must null it explicitly.
    const tiktokYoutubeRekeyDone = await kv.get("cleanup:tiktok-youtube-rekey:v1");
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
      await kv.set("cleanup:tiktok-youtube-rekey:v1", true);
      console.log(`Cleared topImageUrl on ${cleared} TikTok/YouTube cards (rekeyed to local SVGs).`);
    }

    // One-time: zero out placeholder `boosts: 5` on the second batch — admin-
    // added cards (IDs 2000+) that shipped with a default-5 value. These live
    // under `user-action:` (not `action:`) since they came through the user-
    // submission flow. v3 since v2 wrote to the wrong prefix.
    const boostsResetV3Done = await kv.get("cleanup:reset-boosts-5:v3");
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
      await kv.set("cleanup:reset-boosts-5:v3", true);
      console.log(`Reset boosts to 0 on ${resetIds.length} admin-added cards.`);
    }

    // Seed/refresh the org-action library (IDs 1000+) into KV. Bump the version
    // key (e.g. v4 → v5) whenever you've edited SEED_CARDS and want the live
    // feed to pick up the new title/url/image. Existing user activity (`boosts`)
    // and admin curation flags (`quickAction`) are preserved across re-seeds —
    // only seed-managed metadata (title/desc/url/image) is overwritten.
    // One-time: set boosts = 950 on the pinned Spread the Word card.
    const boostsFixed1 = await kv.get("cleanup:set-boosts-1-950:v1");
    if (!boostsFixed1) {
      const card1 = await kv.get("action:1") as any;
      if (card1 && typeof card1 === "object") {
        await kv.set("action:1", { ...card1, boosts: 950 });
      }
      await kv.set("cleanup:set-boosts-1-950:v1", true);
      console.log("Set boosts = 950 on action:1 (Spread the Word).");
    }

    const orgsSeeded = await kv.get("seed:org-actions:v20");
    if (!orgsSeeded) {
      // Mark the seed as done UP FRONT — if the request times out partway
      // through the 260-card loop, the next request still skips the loop
      // instead of dying again. The cards already written stay; missing ones
      // get filled in on the next version bump.
      await kv.set("seed:org-actions:v20", true);
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
      console.log(`Re-seeded ${count} org-action cards (v13).`);
    }

    // One-time migration: any pre-rename card still using `spotsUsed` gets a
    // matching `boosts` field copied in (without removing spotsUsed, so an
    // older client deploy keeps working).
    const migratedBoosts = await kv.get("migrate:spotsused-to-boosts:v1");
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
      await kv.set("migrate:spotsused-to-boosts:v1", true);
      console.log(`Migrated ${migrated} cards from spotsUsed → boosts.`);
    }

    // One-time migration: zero out boosts on all org seed cards (id >= 1000)
    // that were incorrectly seeded with boosts: 4.
    const boostsZeroed = await kv.get("migration:reset-boosts:v1");
    if (!boostsZeroed) {
      let zeroed = 0;
      for (const card of (await kv.getByPrefix("action:")) as any[]) {
        if (card && typeof card === "object" && typeof card.id === "number" && card.id >= 1000) {
          card.boosts = 0;
          await kv.set(`action:${card.id}`, card);
          zeroed++;
        }
      }
      await kv.set("migration:reset-boosts:v1", true);
      console.log(`Reset boosts to 0 on ${zeroed} org seed cards.`);
    }

    // One-time migration: set adminApproved on all action cards.
    // Cards with images (topImageKey or topImageUrl) get adminApproved: true,
    // EXCEPT for the batch added in action:1251–1271 which need admin review.
    // All user-created cards without adminApproved also get flagged as false.
    const adminApprovedMigrated = await kv.get("migration:admin-approved:v1");
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
      await kv.set("migration:admin-approved:v1", true);
      console.log(`Admin-approved migration: ${approved} approved, ${flagged} flagged pending.`);
    }

    // One-time migration: set eventDate on the pol-rev event cards.
    const eventDatesMigrated = await kv.get("migration:event-dates:v1");
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
      await kv.set("migration:event-dates:v1", true);
      console.log("Event-dates migration complete.");
    }

    // One-time migrations for user-created cards (from origin/develop)
    const migrationV1 = await kv.get("migration:user-cards:v1");
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
      await kv.set("migration:user-cards:v1", true);
      console.log("User-card migration v1 complete.");
    }

    // One-time: mark user-submitted cards (user-action:*) that have NO
    // targetUrl as unapproved so the admin can review and add the correct
    // action link. authorLink (author homepage) is a separate field and is
    // intentionally NOT used as a substitute here.
    const noUrlReviewDone = await kv.get("migration:nourl-review:v1");
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
      await kv.set("migration:nourl-review:v1", true);
      console.log(`nourl-review: marked ${marked} user-submitted cards without a targetUrl as unapproved.`);
    }

    // One-time: re-approve the "Be Pretti Good" memorial beanie card.
    // The nourl-review migration flagged it because it has no targetUrl
    // (it's a crafting card with no external link), but it was previously
    // approved and should stay live.
    const beanieReapproved = await kv.get("cleanup:reapprove-beanie:v1");
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
      await kv.set("cleanup:reapprove-beanie:v1", true);
      console.log(`Beanie re-approval migration: ${reapproved} cards updated.`);
    }

    // One-time: backfill `targetUrl` on user-submitted cards that were saved
    // with a `link` field instead. The create endpoint previously stored the
    // AskFlow URL as `link`; everything else (admin panel, nourl-review,
    // EditCardModal) reads `targetUrl`. Rename the field in place.
    const linkToTargetUrlDone = await kv.get("cleanup:link-to-targeturl:v1");
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
      await kv.set("cleanup:link-to-targeturl:v1", true);
      console.log(`link→targetUrl migration: fixed ${fixed} user-submitted cards.`);
    }

    // One-time: any card with no image (no topImageUrl, no topImageKey, no
    // topImage) gets adminApproved:false so it lands in the admin review queue
    // instead of leaking to anon users. The create endpoint requires an image
    // up front; this migration cleans up cards admitted before that rule.
    const noImageReviewDone = await kv.get("migration:no-image-review:v1");
    if (!noImageReviewDone) {
      let demoted = 0;
      for (const prefix of ["action:", "user-action:"]) {
        for (const c of (await kv.getByPrefix(prefix)) as any[]) {
          if (!c || typeof c !== "object" || typeof c.id !== "number") continue;
          const hasImage = Boolean(c.topImageUrl) || Boolean(c.topImageKey) || Boolean(c.topImage);
          if (hasImage) continue;
          if (c.adminApproved === false) continue; // already in the review queue
          await kv.set(`${prefix}${c.id}`, { ...c, adminApproved: false });
          demoted++;
        }
      }
      await kv.set("migration:no-image-review:v1", true);
      console.log(`No-image review migration: demoted ${demoted} cards to adminApproved=false.`);
    }

    // One-time: bulk-mark PETITION cards as "5–10 minutes" and strip any
    // `quickAction: true` so the matcher classifies them as the new `10min`
    // bucket (not `5min` via the quickAction shortcut). Touches both `action:*`
    // (org seeds) and `user-action:*` (admin-added / user-submitted).
    const petitions10minDone = await kv.get("migration:petitions-10min:v1");
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
      await kv.set("migration:petitions-10min:v1", true);
      console.log(`Petitions 10-min migration: updated ${updated} cards.`);
    }

    // Seed The Smacks receipts. Bump the version key whenever SEED_RECEIPTS changes.
    const receiptsSeeded = await kv.get("seed:receipts:v1");
    if (!receiptsSeeded) {
      await kv.set("seed:receipts:v1", true);
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
    const commonCauseDone = await kv.get("migration:common-cause-actions:v1");
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
      const updatedIds = [...currentIds, ...newCards.map((c) => c.id)];
      for (const card of newCards) {
        await kv.set(`user-action:${card.id}`, card);
      }
      await kv.set("user-action:ids", updatedIds);
      await kv.set("migration:common-cause-actions:v1", true);
      console.log(`Added ${newCards.length} Common Cause action cards (ids ${base + 1}–${base + 3}).`);
    }

    // One-time migration: add local/Mobilize action cards sourced from spreadsheet
    const mobilizeLocalDone = await kv.get("migration:mobilize-local-actions:v1");
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
          category: "SPREAD POSITIVITY", categoryColor: "#d97706",
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
      const updatedIds = [...currentIds, ...newCards.map((c) => c.id)];
      for (const card of newCards) {
        await kv.set(`user-action:${card.id}`, card);
      }
      await kv.set("user-action:ids", updatedIds);
      await kv.set("migration:mobilize-local-actions:v1", true);
      console.log(`Added ${newCards.length} local/Mobilize action cards (ids ${base + 1}–${base + 22}).`);
    }

    // One-time migration: add second batch of Mobilize/50501 action cards
    const mobilizeV2Done = await kv.get("migration:mobilize-actions-v2:v1");
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
      const updatedIds = [...currentIds, ...newCards.map((c) => c.id)];
      for (const card of newCards) {
        await kv.set(`user-action:${card.id}`, card);
      }
      await kv.set("user-action:ids", updatedIds);
      await kv.set("migration:mobilize-actions-v2:v1", true);
      console.log(`Added ${newCards.length} Mobilize/50501 action cards (v2) (ids ${base + 1}–${base + 24}).`);
    }

    // Fetch ALL action:* cards from the KV store (real cards only after purge)
    const allActionCards = await kv.getByPrefix("action:");
    const seenIds = new Set<number>();
    const allCards: any[] = [];
    for (const card of allActionCards) {
      if (card && typeof card === "object" && typeof card.id === "number" && !seenIds.has(card.id)) {
        seenIds.add(card.id);
        allCards.push(card);
      }
    }

    // Also fetch user-created cards
    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      if (seenIds.has(id)) continue;
      const card = await kv.get(`user-action:${id}`);
      if (card && typeof card === "object") {
        seenIds.add(id);
        allCards.push(card);
      }
    }

    allCards.sort((a, b) => a.id - b.id);
    const total = allCards.length;
    const cards = allCards.slice(offset, offset + limit);

    console.log(`Returning ${cards.length} of ${total} action cards (offset=${offset}, limit=${limit}).`);
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
    const userCardIds = (await kv.get("user-action:ids") ?? []) as number[];
    for (const id of userCardIds) {
      if (seenIds.has(id)) continue;
      const card = await kv.get(`user-action:${id}`);
      if (card && typeof card === "object") { seenIds.add(id); allCards.push(card); }
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
    const usersCount = (users as any[]).filter((u) => u && typeof u === "object" && u.userId).length;

    console.log(`Stats: ${allCards.length} acts, ${citiesCount} cities, ${usersCount} users`);
    return c.json({ citiesCount, usersCount, actsCount: allCards.length });
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
        from: "ResistAct <noreply@resistact.us>",
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
    "social media", "flash mob", "funding", "training", "meeting",
    "join a group", "news story", "labor", "legal", "professional skills",
    "mental health", "prayer", "boost", "spread positivity", "crafting",
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

    const { title, description, category, categoryColor, location, isOnline, spotsTotal, sponsor, link, targetUrl: targetUrlField, authorName: reqAuthorName, authorRole: reqAuthorRole, authorLink, vettingInfo, actionType, timeCommitment, quickAction, topImageUrl, imageContain, toneOverride, amplifiesGroups } =
      await c.req.json<{
        title: string; description: string; category: string; categoryColor: string;
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
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (token) {
      const user = await getUser(token);
      if (user) {
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
    const { id: _id, createdBy: _createdBy, createdAt: _createdAt,
            authorAvatarKey: _avatarKey, topImageKey: _topImageKey,
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
    const hasImage = Boolean(card.topImageUrl) || Boolean(card.topImageKey) || Boolean(card.topImage);
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
  "ART PIECE": "#896312",
  "BOYCOTT": "#7a1f7a",
  "CRAFTING": "#c34e00",
  "EMAIL CAMPAIGN": "#c2185b",
  "FUNDING": "#127f05",
  "HOUSING": "#0a5b89",
  "IRREVERENCE": "#9333ea",
  "JOIN A GROUP": "#9c2779",
  "LABOR": "#a83f1c",
  "LETTER TO EDITOR": "#3f5c8c",
  "MEETING": "#5a3e9e",
  "MENTAL HEALTH": "#6b5b95",
  "NEWS STORY": "#3b4a73",
  "OTHER": "#3f3f3f",
  "PERSONAL COMMITMENT": "#5e1f7a",
  "PETITION": "#05737f",
  "PRAYER": "#7d6321",
  "PROFESSIONAL SKILLS": "#1f635c",
  "PROTEST": "#23297e",
  "SOCIAL MEDIA": "#e44b4b",
  "SPREAD POSITIVITY": "#d97706",
  "TRAINING": "#126d89",
  "TRANSPORTATION": "#0a6e3f",
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

    const ext = (file.name?.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const key = `${crypto.randomUUID()}.${ext}`;
    const buf = await file.arrayBuffer();

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(key, buf, { contentType: file.type, upsert: false });
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
      console.log(`Admin ${admin.record.name} deleted seed card #${id}`);
      return c.json({ success: true });
    }

    // Try user-created card
    const userCard = await kv.get(`user-action:${id}`);
    if (userCard) {
      await kv.del(`user-action:${id}`);
      const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
      await kv.set("user-action:ids", currentIds.filter((x) => x !== id));
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
          from: "ResistAct <noreply@resistact.us>",
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
    return c.json({ receipts });
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
    console.log(`Admin ${admin.record.name} deleted receipt #${id}`);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: `Delete failed: ${err}` }, 500);
  }
});

Deno.serve(app.fetch);