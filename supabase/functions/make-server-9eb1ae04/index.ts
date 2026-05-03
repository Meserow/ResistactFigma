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
    allowHeaders: ["Content-Type", "Authorization"],
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

// On first login (any provider), create an approval record.
// First user ever → auto-approved admin. Everyone else → pending.
async function ensureApprovalRecord(user: any) {
  const existing = await kv.get(`user:approval:${user.id}`);
  if (existing) return existing as any;

  const adminSetup = await kv.get("admin:setup");
  const isFirst = !adminSetup;

  const record = {
    userId: user.id,
    email: user.email ?? "",
    name:
      user.user_metadata?.full_name ??
      user.user_metadata?.name ??
      user.email?.split("@")[0] ??
      "Resistor",
    avatar: user.user_metadata?.avatar_url ?? null,
    status: isFirst ? "approved" : "pending",
    isAdmin: isFirst,
    provider: user.app_metadata?.provider ?? "email",
    createdAt: new Date().toISOString(),
  };

  await kv.set(`user:approval:${user.id}`, record);
  if (isFirst) await kv.set("admin:setup", true);

  return record;
}

async function requireAdmin(token: string | undefined) {
  if (!token) return null;
  const user = await getUser(token);
  if (!user) return null;
  const record = await kv.get(`user:approval:${user.id}`) as any;
  if (!record?.isAdmin) return null;
  return { user, record };
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
  { id: 1, isFeatured: true, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", timeCommitment: "Ongoing", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct so we can build a stronger resistance network together.", boosts: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", authorAvatarKey: "imgImage34" },
  { id: 2, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person", timeCommitment: "Half day", title: "Make 1460 Orange Paper Chains", description: "Help trans kids survive the next 4 years by sending them paper chains with 365x4 links to will help them see that there will be an end to this persecution of them.", boosts: 500, spotsTotal: 1000, authorName: "Jo Jones", authorRole: "Citizen Activist", topImageKey: "imgImage12", authorAvatarKey: "imgImage" },
  { id: 3, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "In Person Group", timeCommitment: "< 1 hour", title: "Join us in forming human RESIST", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community is forming a human 'RESIST' sign visible from above — join us!", location: "Boston, MA", boosts: 50, spotsTotal: 200, authorName: "Meg Jones", authorRole: "Franklin High School", topImageKey: "imgImage6", authorAvatarKey: "imgImage4" },
  { id: 4, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", timeCommitment: "Ongoing", title: "Help Me Launch Over Los Angeles", description: "I have the land to protect and the people to set up a massive Trump balloon over my house, but I need the funding to purchase it. Go to my GoFundMe and help me buy it!", isOnline: true, location: "Los Angeles, CA", boosts: 739, spotsTotal: "Unlimited", authorName: "Patrick Escarcega", authorRole: "Citizen Activist", topImageKey: "imgImage19", authorAvatarKey: "imgImage1" },
  { id: 5, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", timeCommitment: "Full day", title: "Show Trump We Are United", description: "March on the Capitol with us to show Trump the size of the resistance. Spread the word about July 4th Patriotic Resistance March and bring all your friends and family!", location: "Washington DC", boosts: 2, spotsTotal: 10, authorName: "John Smith", authorRole: "MoveOn.org", topImageKey: "imgImage13", authorAvatarKey: "imgImage20" },
  { id: 6, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", timeCommitment: "1–3 hours", title: "Here Let me Pray for You", description: "We are social media warriors who prove the religious left lives its values. Join us online to pray for our conservative brothers/sisters in Christ who have strayed from His teachings.", isOnline: true, boosts: 52, spotsTotal: 75, authorName: "McKenna Hartman", authorRole: "Citizen Activist", topImageKey: "imgImage7", authorAvatarKey: "imgImage16" },
  { id: 7, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", timeCommitment: "Ongoing", title: "Spread the Word about ResistAct", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community needs your help spreading awareness about ResistAct.", boosts: 3020, spotsTotal: "Unlimited", authorName: "Ellen Meserow", authorRole: "ResistAct Founder", topImageKey: "imgImage25", authorAvatarKey: "imgImage34" },
  { id: 8, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "In Person Group", timeCommitment: "1–3 hours", title: "Petition the Leftist Billionaires", description: "We need electronic billboards that show the daily price of eggs/gas since Trump took office. Another to show the Trump deficit versus Elon Musk's wealth. Another to show...", typeTag: "FLASH MOB", boosts: 5, spotsTotal: 10, authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage14", authorAvatarKey: "imgImage2" },
  { id: 9, category: "PETITION", categoryColor: "#05737f", actionType: "In Person", timeCommitment: "< 1 hour", title: "Stop Funding Fox", description: "MoveOn Civic Action has a long history of taking on Fox's lies. With actions taken by thousands of MoveOn members, we've been able to put pressure on cable providers to drop Fox News.", location: "Austin, TX", boosts: 5, spotsTotal: 10, authorName: "Meg Jones", authorRole: "Franklin High School", topImageKey: "imgImage21", authorAvatarKey: "imgImage4" },
  { id: 10, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", timeCommitment: "< 1 hour", title: "Towns Across America Blackout", description: "On Tuesday, April 22, 2025, we invite you to participate in a nationwide television blackout in protest of Trump's signing of the bill to defund Planned Parenthood.", location: "Austin, TX", boosts: 5, spotsTotal: 10, authorName: "Patrick Escarcega", authorRole: "Citizen Activist", topImageKey: "imgImage17", authorAvatarKey: "imgImage1" },
  { id: 11, category: "ART PIECE", categoryColor: "#896312", actionType: "In Person Group", timeCommitment: "Full day", title: "Puppets for March on Washington", description: "We are making effigies of Trump and his minions for the March on Washington on July 4th. Join in even if you can't attend — we will help the attendees get them!", location: "Austin, TX", boosts: 5, spotsTotal: 10, authorName: "John Smith", authorRole: "MoveOn.org", topImageKey: "imgImage8", authorAvatarKey: "imgImage20" },
  { id: 12, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", timeCommitment: "Ongoing", title: "Help Fund my Elon Mural!", description: "I am making a mural to show Elon as a reincarnation of Adolf Hitler, using a real photo of Trump giving the Nazi salute! It will be in my community center's parking lot!", isOnline: true, boosts: 500, spotsTotal: "Unlimited", authorName: "McKenna Hartman", authorRole: "Citizen Activist", topImageKey: "imgImage10", authorAvatarKey: "imgImage16" },
  { id: 13, category: "TRAINING", categoryColor: "#126d89", actionType: "In Person Group", timeCommitment: "1–3 hours", title: "Online ICE Rapid Response", description: "The immigrant and refugee community has received direct threats about deportations and immigration raids. Our community has set up a rapid response network — join us.", location: "Austin, TX", boosts: 5, spotsTotal: 10, authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImageKey: "imgImage5", authorAvatarKey: "imgImage3" },
  { id: 14, category: "FLASH MOB", categoryColor: "#ff00d5", actionType: "Online", timeCommitment: "< 1 hour", title: "Petition the Leftist Billionaires", description: "We need electronic billboards that show the daily price of eggs/gas since Trump took office. Another to show the Trump deficit versus Elon Musk's wealth. Another to show...", typeTag: "FLASH MOB", boosts: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage15", authorAvatarKey: "imgImage2" },
  { id: 15, category: "PETITION", categoryColor: "#05737f", actionType: "In Person", timeCommitment: "< 1 hour", title: "Stop Funding Fox", description: "MoveOn Civic Action has a long history of taking on Fox's lies. With actions taken by thousands of MoveOn members, we've been able to put pressure on cable providers.", location: "Austin, TX", boosts: 500, spotsTotal: "Unlimited", authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImageKey: "imgImage22", authorAvatarKey: "imgImage3" },
  { id: 16, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", timeCommitment: "< 1 hour", title: "Towns Across America Blackout", description: "On Tuesday, April 22, 2025, we invite you to participate in a nationwide television blackout in protest of Trump's signing of the bill to defund Planned Parenthood.", location: "Austin, TX", boosts: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage18", authorAvatarKey: "imgImage2" },
  { id: 17, category: "ART PIECE", categoryColor: "#896312", actionType: "In Person Group", timeCommitment: "Half day", title: "Puppets for March on Washington", description: "We are making effigies of Trump and his minions for the March on Washington on July 4th. Join in even if you can't attend — we will help the attendees get them!", location: "Austin, TX", boosts: 500, spotsTotal: "Unlimited", authorName: "Adam Jordan", authorRole: "Catholic Legal Immigration Network", authorLink: "https://www.cliniclegal.org/", topImageKey: "imgImage9", authorAvatarKey: "imgImage3" },
  { id: 18, category: "FUNDING", categoryColor: "#127f05", actionType: "Online", timeCommitment: "Ongoing", title: "Help Fund my Elon Mural!", description: "I am making a mural to show Elon as a reincarnation of Adolf Hitler, using a real photo of Trump giving the Nazi salute! It will be in my community center's parking lot!", isOnline: true, boosts: 500, spotsTotal: "Unlimited", authorName: "Nancie Kosnoff", authorRole: "Citizen Activist", topImageKey: "imgImage11", authorAvatarKey: "imgImage2" },
  { id: 19, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", timeCommitment: "< 1 hour", title: "SH*T Bag: Two Bags, One Movement", description: "Dog poop bags featuring Trump — made from plant-based materials (PBAT + PLA + Corn Starch), leak-proof, strong, traps odors, and 'resistant to hate.' Fair-trade and BSCI-compliant. Buy a pack and put it to good use.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Smolotov LLC", authorRole: "Resistance Merch", targetUrl: "https://www.smolotov.com/products/smolotov-unscented-leakproof-dog-poop-bags", topImageUrl: "https://www.smolotov.com/cdn/shop/files/4-Rolls_Box_Bag_2400px.jpg?v=1771553420&width=800" },
  { id: 1000, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Search any brand's political donations before you buy", description: "Search 7,000+ companies' political donations before you buy. Stop accidentally funding the people deporting your neighbors.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Goods Unite Us", authorRole: "Movement Organization", targetUrl: "https://www.goodsuniteus.com/", topImageKey: "org_goods-unite-us" },
  { id: 1001, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Get the browser extension that flags MAGA-aligned brands", description: "Browser extension auto-flags MAGA-aligned brands as you shop. Make every checkout a small political choice.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Progressive Shopper", authorRole: "Movement Organization", targetUrl: "https://progressiveshopper.com/", topImageKey: "org_progressive-shopper" },
  { id: 1002, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Use the Trump-tied retailers boycott list", description: "Spreadsheet of every retailer carrying Trump-family products. Pull up before you shop — names update weekly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Grab Your Wallet", authorRole: "Movement Organization", targetUrl: "https://grabyourwallet.org/", topImageKey: "org_grab-your-wallet" },
  { id: 1003, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Join coordinated 24-hour economic blackouts", description: "Coordinated 24-hour buy-nothing blackouts that hit corporate dailies. Sign up for the next date.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The People's Union USA", authorRole: "Movement Organization", targetUrl: "https://thepeoplesunionusa.com/", topImageKey: "org_the-people-s-union-usa" },
  { id: 1004, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Sign the Tesla Takedown commitment", description: "Sell Tesla stock, dump the lease, and join Saturday dealership protests. Hits Musk where it actually hurts.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/", topImageKey: "org_tesla-takedown" },
  { id: 1005, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Join the Latino-led economic blackout", description: "Latino-led campaign to freeze spending in protest of mass-deportation policies. Sign up for the calendar.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Latino Freeze Movement", authorRole: "Movement Organization", targetUrl: "https://www.latinofreeze.com/", topImageKey: "org_latino-freeze-movement" },
  { id: 1006, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Switch your spending to a Black-women-owned biz", description: "Directory of Black-women-owned businesses to swap your usual orders into. Buy here instead of Amazon.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Buy From a Black Woman", authorRole: "Movement Organization", targetUrl: "https://www.buyfromablackwoman.org/", topImageKey: "org_buy-from-a-black-woman" },
  { id: 1007, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Buy Anti-Trump Merch from Individual Makers", description: "Handmade anti-Trump shirts, signs, stickers, and pins from independent Etsy sellers — your dollars go to indie creators, not corporate retailers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Etsy (Anti-Trump Market)", authorRole: "Indie Makers Marketplace", targetUrl: "https://www.etsy.com/market/anti_trump", topImageKey: "org_anti-trump-merch" },
  { id: 1008, category: "BOYCOTT", categoryColor: "#7a1f7a", actionType: "Online", title: "Buy from a Native-owned business instead", description: "Native-owned business directory + marketplace. Trump's land-grab and pipeline pushes hit these communities first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Beyond Buckskin", authorRole: "Movement Organization", targetUrl: "https://www.beyondbuckskin.com/", topImageKey: "org_beyond-buckskin" },
  { id: 1009, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "RSVP to the next Saturday Tesla Takedown", description: "Live map of Tesla dealership protests near you. Saturday actions only — no commitment required.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Tesla Takedown", authorRole: "Movement Organization", targetUrl: "https://www.teslatakedown.com/", topImageKey: "org_tesla-takedown" },
  { id: 1010, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Subscribe to Free DC mobilization alerts", description: "DC-area mobilization alerts for protests, court days, and federal-building actions. Subscribe and show up.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Free DC", authorRole: "Movement Organization", targetUrl: "https://freedcproject.org/sign-up", topImageKey: "org_free-dc" },
  { id: 1011, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Become a Veterans for Peace member", description: "Vets in service insignia deter cops and counter-protesters at rallies. Be the visible spine of your local march.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Veterans for Peace", authorRole: "Movement Organization", targetUrl: "https://www.veteransforpeace.org/", topImageKey: "org_veterans-for-peace" },
  { id: 1012, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Join About Face: Veterans Against the War", description: "Post-9/11 vets organizing direct action against US wars. More aggressive than VFP — for vets ready to risk arrest.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "About Face", authorRole: "Movement Organization", targetUrl: "https://aboutfaceveterans.org/", topImageKey: "org_about-face" },
  { id: 1013, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find an ADAPT chapter (disability direct action)", description: "Disability-led direct action — sit-ins, building takeovers, hill visits. Find or start a chapter; remote roles available.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "ADAPT", authorRole: "Movement Organization", targetUrl: "https://adapt.org/", topImageKey: "org_adapt" },
  { id: 1014, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Find a Drag Story Hour to attend / livestream", description: "Show up to a Drag Story Hour to protect performers from Proud Boys harassment. Adults present = events go forward.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Drag Story Hour", authorRole: "Movement Organization", targetUrl: "https://www.dragstoryhour.org/", topImageKey: "org_drag-story-hour" },
  { id: 1015, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Sign up for Refuse Fascism action alerts", description: "Anti-fascist protest network with simple action alerts. Stand against Trump's authoritarian playbook publicly.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Refuse Fascism", authorRole: "Movement Organization", targetUrl: "https://refusefascism.org/", topImageKey: "org_refuse-fascism" },
  { id: 1016, category: "PROTEST", categoryColor: "#23297e", actionType: "In Person Group", title: "Sign up with Code Pink", description: "Code Pink runs the disruptive bird-dog actions you see in Senate hearings. Get alerts for the next DC pop-up.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Code Pink", authorRole: "Movement Organization", targetUrl: "https://www.codepink.org/", topImageKey: "org_code-pink" },
  { id: 1017, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Volunteer as a Practical Support driver (repro)", description: "Drive abortion-seekers to/from clinics and overnight stays. Trump's national-ban push makes practical support life-saving.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Apiary for Practical Support", authorRole: "Movement Organization", targetUrl: "https://apiaryps.org/ps-volunteer", topImageKey: "org_apiary-for-practical-support" },
  { id: 1018, category: "TRANSPORTATION", categoryColor: "#0a6e3f", actionType: "In Person Group", title: "Sponsor + drive for refugees via Welcome.US", description: "Drive refugees to appointments, IKEA runs, school. Trump cut admissions but families already here need community.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us" },
  { id: 1019, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a tip (anonymous SecureDrop)", description: "Submit a tip via SecureDrop. ProPublica turns insider docs into pressure that has fired federal officials.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ProPublica", authorRole: "Movement Organization", targetUrl: "https://www.propublica.org/tips/", topImageKey: "org_propublica" },
  { id: 1020, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a tip on criminal-justice / detention", description: "Tip line for prison conditions, ICE detention abuses, and prosecutor misconduct. Their reporting changes laws.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Marshall Project", authorRole: "Movement Organization", targetUrl: "https://www.themarshallproject.org/", topImageKey: "org_the-marshall-project" },
  { id: 1021, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a leak to The Intercept", description: "Submit national-security leaks via SecureDrop. Intercept broke Snowden — they protect sources better than most.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Intercept", authorRole: "Movement Organization", targetUrl: "https://theintercept.com/", topImageKey: "org_the-intercept" },
  { id: 1022, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Tell them about an ICE raid (NYC)", description: "NYC tip line for ICE raids and immigration enforcement. Real-time alerts go to neighborhood networks.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://www.mobilize.us/handsoffnyc/event/929506/", topImageKey: "org_handsoffnyc" },
  { id: 1023, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a Black-community story", description: "Pitch a Black-community story to a Black-led investigative newsroom. Coverage that mainstream outlets miss.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1024, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a gender + politics story", description: "Pitch a story on abortion access, trans healthcare bans, or gender + politics. They cover what AP won't.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th" },
  { id: 1025, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch on local DA / sheriff / election admin", description: "Pitch on your local DA, sheriff, or election admin. MAGA's takeover happens at county level — Bolts covers it nationally.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bolts Magazine", authorRole: "Movement Organization", targetUrl: "https://boltsmag.org/", topImageKey: "org_bolts-magazine" },
  { id: 1026, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Send an investigative idea", description: "Pitch an investigative idea; they fund the reporter to chase it. Best route for a freelancer with a real lead.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Type Investigations", authorRole: "Movement Organization", targetUrl: "https://www.typeinvestigations.org/", topImageKey: "org_type-investigations" },
  { id: 1027, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a war / civil-liberties story", description: "Pitch ex-Intercept reporters on US wars and civil liberties. Fewer institutional constraints, more aggressive coverage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Drop Site News", authorRole: "Movement Organization", targetUrl: "https://www.dropsitenews.com/", topImageKey: "org_drop-site-news" },
  { id: 1028, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Pitch a labor story (video)", description: "Pitch a labor story for video — strikes, union drives, wage theft. Their content goes viral on TikTok and IG.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "More Perfect Union", authorRole: "Movement Organization", targetUrl: "https://perfectunion.us/", topImageKey: "org_more-perfect-union" },
  { id: 1029, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Send a dark-money tip", description: "Tip Sirota's team on dark money or corporate corruption. They've forced multiple federal investigations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1030, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Submit a campaign-finance tip", description: "Tip on a campaign-finance violation or shadow donor. Sludge specializes in unmasking who's actually paying for what.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sludge", authorRole: "Movement Organization", targetUrl: "https://readsludge.com/", topImageKey: "org_sludge" },
  { id: 1031, category: "NEWS STORY", categoryColor: "#3b4a73", actionType: "Online", title: "Report a press-freedom violation", description: "Report any arrest, equipment seizure, or assault on a journalist. Trump-era press attacks need a public record.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "U.S. Press Freedom Tracker", authorRole: "Movement Organization", targetUrl: "https://pressfreedomtracker.us/submit-incident/", topImageKey: "org_u-s-press-freedom-tracker" },
  { id: 1032, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find your nearest chapter + meeting time", description: "Find your nearest DSA chapter and meeting time. Local chapters run mutual aid, tenant work, and electoral campaigns.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "DSA (Democratic Socialists of America)", authorRole: "Movement Organization", targetUrl: "https://www.dsausa.org/", topImageKey: "org_dsa-democratic-socialists-of-america" },
  { id: 1033, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Apply to a virtual intro call", description: "White-led solidarity for Black, brown, and Indigenous-led campaigns. Apply for the virtual intro to start showing up.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "SURJ (Showing Up for Racial Justice)", authorRole: "Movement Organization", targetUrl: "https://surj.org/", topImageKey: "org_surj-showing-up-for-racial-justice" },
  { id: 1034, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Sign up for a hub welcome call", description: "Youth-led climate org with remote-friendly local hubs. Sign up for a welcome call to find your role this season.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sunrise Movement", authorRole: "Movement Organization", targetUrl: "https://www.sunrisemovement.org/", topImageKey: "org_sunrise-movement" },
  { id: 1035, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "RSVP for next event (local + virtual)", description: "RSVP to the next local + virtual event. WFP runs electoral campaigns and issue ballot fights state by state.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Working Families Party", authorRole: "Movement Organization", targetUrl: "https://workingfamilies.org/", topImageKey: "org_working-families-party" },
  { id: 1036, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join virtual monthly mass assembly", description: "Rev. Barber's monthly mass assembly fuses faith and policy. Join virtually to plug into Poor People's organizing nationally.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Poor People's Campaign (Rev. Barber)", authorRole: "Movement Organization", targetUrl: "https://www.poorpeoplescampaign.org/", topImageKey: "org_poor-people-s-campaign-rev-barber" },
  { id: 1037, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find your local circle", description: "Latinx-led organizing focused on immigration defense and abolition. Find your local circle.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mijente", authorRole: "Movement Organization", targetUrl: "https://mijente.net/", topImageKey: "org_mijente" },
  { id: 1038, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a local team", description: "Mom-led climate org with neighborhood teams. Find a local team — work fits around school pickups and naptime.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mothers Out Front", authorRole: "Movement Organization", targetUrl: "https://mothersoutfront.org/", topImageKey: "org_mothers-out-front" },
  { id: 1039, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Find a local group", description: "Progressive Jewish organizing against Christian nationalism and authoritarianism. Find a local group.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bend the Arc (Jewish progressive)", authorRole: "Movement Organization", targetUrl: "https://www.bendthearc.us/", topImageKey: "org_bend-the-arc-jewish-progressive" },
  { id: 1041, category: "MEETING", categoryColor: "#5a3e9e", actionType: "Online", title: "Join a federal-worker organizing call", description: "Federal-worker organizing call. Trump's purges and RIFs are coordinated — cross-agency response has to be too.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Federal Unionists Network", authorRole: "Movement Organization", targetUrl: "https://www.federalunionists.net/", topImageKey: "org_federal-unionists-network" },
  { id: 1042, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Migrate your X follows to Bluesky", description: "Free extension finds your X follows on Bluesky in one click. Bring your network when you ditch Musk's platform.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sky Follower Bridge", authorRole: "Movement Organization", targetUrl: "https://skyfollowerbridge.com/", topImageKey: "org_sky-follower-bridge", imageContain: true },
  { id: 1043, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Bluesky account", description: "Make a Bluesky account. No algorithm tilt, no Musk, no Meta — where activist Twitter rebuilt itself.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bluesky", authorRole: "Movement Organization", targetUrl: "https://bsky.app/", topImageKey: "org_bluesky" },
  { id: 1044, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Mastodon account on a movement-aligned server", description: "Mastodon account on an anti-fascist server. Federated, no corporate owner, harder to deplatform leftists.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Kolektiva (Mastodon)", authorRole: "Movement Organization", targetUrl: "https://kolektiva.social/", topImageKey: "org_kolektiva-mastodon" },
  { id: 1045, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Save a threatened page now", description: "One-click archive of any URL — .gov pages, news, evidence. Scrub-proof your sources before they vanish.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wayback Machine 'Save Page Now'", authorRole: "Movement Organization", targetUrl: "https://web.archive.org/save", topImageKey: "org_wayback-machine-save-page-now" },
  { id: 1046, category: "SOCIAL MEDIA", categoryColor: "#e44b4b", actionType: "Online", title: "Make a Pixelfed account (federated Insta)", description: "Federated photo-sharing, no algorithm. Activist-friendly Insta alternative with no Meta tracking or shadowban.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pixelfed", authorRole: "Movement Organization", targetUrl: "https://pixelfed.social/", topImageKey: "org_pixelfed" },
  { id: 1047, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Embroider + ship a Trump quote to the archive", description: "Embroider a Trump quote and ship it to the archive. Group exhibitions, gallery shows, permanent record.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Tiny Pricks Project", authorRole: "Movement Organization", targetUrl: "https://www.tinypricksproject.com/", topImageKey: "org_tiny-pricks-project" },
  { id: 1048, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Knit a Welcome Blanket for a new immigrant", description: "Knit a 40\" blanket with a welcome note. Each is hand-delivered to a newly-arrived immigrant family.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome Blanket Project", authorRole: "Movement Organization", targetUrl: "https://www.welcomeblanket.org/", topImageKey: "org_welcome-blanket-project" },
  { id: 1049, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Knit a Pussyhat from updated patterns", description: "Knit a Pussyhat from updated patterns or mail one in for the next march. Visible cohort = visible resistance.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Pussyhat Project", authorRole: "Movement Organization", targetUrl: "https://www.pussyhatproject.com/", topImageKey: "org_pussyhat-project" },
  { id: 1050, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Sign up for the postcard drop", description: "Hand-illustrate postcards to swing-district voters. Personal mail still cuts through algorithm-poisoned discourse.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "The Postcard Posse", authorRole: "Movement Organization", targetUrl: "https://thepostcardposse.org/", topImageKey: "org_the-postcard-posse" },
  { id: 1051, category: "CRAFTING", categoryColor: "#c34e00", actionType: "In Person Group", title: "Mail a handmade card to a detained migrant", description: "Mail handmade cards to a specific person in ICE detention. Mail breaks isolation; signals 'someone's watching'.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants" },
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
  { id: 1063, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign petitions to close ICE facilities", description: "Sign petitions targeting specific ICE detention facilities for closure. Local fights, federal pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Detention Watch Network", authorRole: "Movement Organization", targetUrl: "https://www.detentionwatchnetwork.org/", topImageKey: "org_detention-watch-network" },
  { id: 1064, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the open letter against book bans", description: "Sign the open letter against book bans. Names from authors, librarians, and readers create local-news pressure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans" },
  { id: 1065, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign Avaaz US-targeted petitions", description: "Sign Avaaz US-targeted petitions. High signature volume amplifies pressure on Congress and corporations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Avaaz", authorRole: "Movement Organization", targetUrl: "https://secure.avaaz.org/page/en/", topImageKey: "org_avaaz" },
  { id: 1066, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign the petition to protect voting rights in the Senate", description: "Tell your senators to defend voting rights against the assault on free and fair elections. People For's open call to action.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "People For (formerly People For the American Way)", authorRole: "Movement Organization", targetUrl: "https://www.peoplefor.org/urge-senate-protect-voting-rights", topImageKey: "org_people-for-formerly-people-for-the-american-way" },
  { id: 1067, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Sign children's-rights petitions", description: "Sign petitions on child healthcare, gun violence, and poverty programs. Trump's budget cuts hit kids first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Children's Defense Fund", authorRole: "Movement Organization", targetUrl: "https://www.childrensdefense.org/", topImageKey: "org_children-s-defense-fund" },
  { id: 1068, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a SURJ member", description: "Become a SURJ member to organize white people for racial justice. Apply for the virtual intro call.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Showing Up for Racial Justice", authorRole: "Movement Organization", targetUrl: "https://surj.org/", topImageKey: "org_showing-up-for-racial-justice" },
  { id: 1069, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Become a DSA member", description: "DSA chapters run mutual aid, electoral, and tenant work in nearly every metro. Joining locally finds the doers near you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Democratic Socialists of America", authorRole: "Movement Organization", targetUrl: "https://www.dsausa.org/", topImageKey: "org_democratic-socialists-of-america" },
  { id: 1070, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Sunrise Movement", description: "Climate-led, youth-driven org. Join Sunrise to organize for the Green New Deal and climate accountability.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sunrise Movement", authorRole: "Movement Organization", targetUrl: "https://www.sunrisemovement.org/", topImageKey: "org_sunrise-movement" },
  { id: 1071, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Mijente", description: "Latinx organizing for immigration defense and abolition. Local circles plug you in to immediate work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mijente", authorRole: "Movement Organization", targetUrl: "https://mijente.net/", topImageKey: "org_mijente" },
  { id: 1072, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join United We Dream", description: "Largest immigrant-youth-led network in the country. Plug into ICE response, deportation defense, and policy work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "United We Dream", authorRole: "Movement Organization", targetUrl: "https://unitedwedream.org/", topImageKey: "org_united-we-dream" },
  { id: 1073, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Bend the Arc", description: "Jewish anti-authoritarian organizing. Join to find Jewish-led action against Christian nationalism near you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bend the Arc (Jewish progressive)", authorRole: "Movement Organization", targetUrl: "https://www.bendthearc.us/", topImageKey: "org_bend-the-arc-jewish-progressive" },
  { id: 1074, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Jewish Voice for Peace", description: "Jewish-led anti-occupation and civil-liberties organizing. Local chapters in 70+ cities.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Jewish Voice for Peace", authorRole: "Movement Organization", targetUrl: "https://www.jewishvoiceforpeace.org/", topImageKey: "org_jewish-voice-for-peace" },
  { id: 1075, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join T'ruah (rabbinic human rights)", description: "Rabbinic human rights org. Rabbis + cantors lead immigration defense, anti-Christian-nationalism, and dignity work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "T'ruah", authorRole: "Movement Organization", targetUrl: "https://truah.org/", topImageKey: "org_t-ruah" },
  { id: 1076, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Subscribe to FCNL action alerts (Quaker)", description: "Quaker action alerts for constituent calls and emails. Pacifist-rooted, focused on Pentagon budget and immigration.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1077, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Join Pax Christi USA (Catholic peace)", description: "Catholic peace + justice movement. Join for nonviolence training and faith-rooted resistance to militarism.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Pax Christi USA", authorRole: "Movement Organization", targetUrl: "https://paxchristiusa.org/", topImageKey: "org_pax-christi-usa" },
  { id: 1078, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a NETWORK action (Catholic social justice)", description: "Catholic social-justice lobby. Take action on healthcare, immigration, and the federal budget — nuns lead this.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NETWORK Lobby", authorRole: "Movement Organization", targetUrl: "https://networklobby.org/", topImageKey: "org_network-lobby" },
  { id: 1080, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Sikh Coalition action", description: "Sikh civil-rights advocacy. Take action on hate-crime response, religious-discrimination, and racial profiling.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sikh Coalition", authorRole: "Movement Organization", targetUrl: "https://www.sikhcoalition.org/", topImageKey: "org_sikh-coalition" },
  { id: 1084, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Volunteer with Mothers Out Front", description: "Volunteer with Mothers Out Front. Mom-led climate org with flexible roles around school and family schedules.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mothers Out Front", authorRole: "Movement Organization", targetUrl: "https://mothersoutfront.org/", topImageKey: "org_mothers-out-front" },
  { id: 1085, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take an ADAPT action (disability rights)", description: "Take an ADAPT action — disability-led direct action against Medicaid cuts and institutionalization.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "ADAPT", authorRole: "Movement Organization", targetUrl: "https://adapt.org/", topImageKey: "org_adapt" },
  { id: 1086, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Black Voters Matter action", description: "Take a Black Voters Matter action. Voter-protection fights happen at county and state level — they target there.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Black Voters Matter", authorRole: "Movement Organization", targetUrl: "https://blackvotersmatterfund.org/", topImageKey: "org_black-voters-matter" },
  { id: 1087, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Mi Familia Vota action", description: "Take a Mi Familia Vota action. Latino civic engagement — voter registration and protection in swing states.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mi Familia Vota", authorRole: "Movement Organization", targetUrl: "https://www.mifamiliavota.org/", topImageKey: "org_mi-familia-vota" },
  { id: 1088, category: "JOIN A GROUP", categoryColor: "#9c2779", actionType: "Online", title: "Take a Climate Justice Alliance action", description: "Take a Climate Justice Alliance action. Frontline community-led climate fights — pipelines, refineries, evictions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Climate Justice Alliance", authorRole: "Movement Organization", targetUrl: "https://climatejusticealliance.org/", topImageKey: "org_climate-justice-alliance" },
  { id: 1091, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Sponsor a refugee household", description: "Sponsor a refugee household through a verified federal pathway. Remote prep work counts.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcome.US", authorRole: "Movement Organization", targetUrl: "https://welcome.us/", topImageKey: "org_welcome-us" },
  { id: 1092, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Make your city 'welcoming' for immigrants", description: "Push your city to certify as a 'welcoming city' for immigrants. Public commitment makes ICE cooperation costly.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Welcoming America", authorRole: "Movement Organization", targetUrl: "https://welcomingamerica.org/", topImageKey: "org_welcoming-america" },
  { id: 1093, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Pressure your mayor on sanctuary policy", description: "Pressure your mayor to join the immigrant-friendly cities coalition. Mayoral commitments slow ICE locally.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Cities for Action", authorRole: "Movement Organization", targetUrl: "https://www.citiesforaction.us/", topImageKey: "org_cities-for-action" },
  { id: 1094, category: "HOUSING", categoryColor: "#0a5b89", actionType: "In Person Group", title: "Volunteer to furnish + resettle refugee homes", description: "Furnish + resettle refugee homes — physical setup or remote logistics. Trump's cuts mean more families with less support.", isOnline: false, boosts: 0, spotsTotal: "Unlimited", authorName: "Homes Not Borders", authorRole: "Movement Organization", targetUrl: "https://www.homesnotborders.org/", topImageKey: "org_homes-not-borders" },
  { id: 1095, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Get an organizer for your workplace", description: "Free organizer helps you unionize your workplace, confidentially. Trump's NLRB is gutted — build power directly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "EWOC (Emergency Workplace Organizing Committee)", authorRole: "Movement Organization", targetUrl: "https://workerorganizing.org/", topImageKey: "org_ewoc-emergency-workplace-organizing-committee" },
  { id: 1096, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Join the federal-worker network", description: "Join the federal-worker network. Trump's RIFs and Schedule F purges need cross-agency mutual aid + organizing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Federal Unionists Network", authorRole: "Movement Organization", targetUrl: "https://www.federalunionists.net/", topImageKey: "org_federal-unionists-network" },
  { id: 1097, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Subscribe to independent labor media", description: "Subscribe to indie labor media + training calendar. Best source for what's happening in shops outside the big unions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Labor Notes", authorRole: "Movement Organization", targetUrl: "https://labornotes.org/", topImageKey: "org_labor-notes" },
  { id: 1098, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Start a workplace petition", description: "Host a workplace petition — raises, anti-ICE-cooperation pledges. Public petitions force the boss to acknowledge.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Coworker.org", authorRole: "Movement Organization", targetUrl: "https://home.coworker.org/", topImageKey: "org_coworker-org" },
  { id: 1099, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take a UE solidarity action", description: "Solidarity action with UE — independent rank-and-file union. Often the most aggressive on contract fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "UE (United Electrical Workers)", authorRole: "Movement Organization", targetUrl: "https://www.ueunion.org/", topImageKey: "org_ue-united-electrical-workers" },
  { id: 1100, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Apply for IWW membership", description: "Apply for IWW membership. All-trades radical union; remote onboarding. Best fit if your shop won't tolerate the bigs.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Industrial Workers of the World", authorRole: "Movement Organization", targetUrl: "https://www.iww.org/", topImageKey: "org_industrial-workers-of-the-world" },
  { id: 1101, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Sign on to a National Domestic Workers Alliance campaign", description: "Sign on to NDWA campaigns. Domestic workers (housekeepers, nannies, caregivers) organizing for federal protections.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "National Domestic Workers Alliance", authorRole: "Movement Organization", targetUrl: "https://www.domesticworkers.org/", topImageKey: "org_national-domestic-workers-alliance" },
  { id: 1102, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Send solidarity to Starbucks Workers United", description: "Send solidarity to Starbucks workers fighting union-busting. Their store-by-store wins set the precedent for service work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Starbucks Workers United", authorRole: "Movement Organization", targetUrl: "https://sbworkersunited.org/", topImageKey: "org_starbucks-workers-united" },
  { id: 1103, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Take an Amazon Labor Union action", description: "Take an Amazon Labor Union action. The hardest org fight in the country — solidarity dollars and petitions matter.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Amazon Labor Union (IBT Local 1)", authorRole: "Movement Organization", targetUrl: "https://www.amazonlaborunion.org/", topImageKey: "org_amazon-labor-union-ibt-local-1" },
  { id: 1104, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Use the free legal hotline (workplace family rights)", description: "Free legal hotline for workplace family + caregiving rights. Use if you're being denied FMLA, pumping breaks, or accommodations.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "A Better Balance", authorRole: "Movement Organization", targetUrl: "https://www.abetterbalance.org/", topImageKey: "org_a-better-balance" },
  { id: 1105, category: "LABOR", categoryColor: "#a83f1c", actionType: "Online", title: "Sign on to a Fight For A Union worker campaign", description: "Successor to Fight for $15. Sign on to a sectoral campaign for living wages and a real union, not just minimums.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Fight For A Union", authorRole: "Movement Organization", targetUrl: "https://fightforaunion.org/", topImageKey: "org_fight-for-a-union" },
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
  { id: 1117, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up as a volunteer attorney", description: "Sign up as a volunteer attorney. Match takes 20 minutes; cases include immigrants, election workers, federal whistleblowers.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "We the Action", authorRole: "Movement Organization", targetUrl: "https://wetheaction.org/", topImageKey: "org_we-the-action" },
  { id: 1118, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as an attorney", description: "Hours go to immigrants and federal workers fighting Trump-era retaliation. Lawyers especially — 20-min match.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Lawyers for Good Government", authorRole: "Movement Organization", targetUrl: "https://www.lawyersforgoodgovernment.org/", topImageKey: "org_lawyers-for-good-government" },
  { id: 1119, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Find pro bono cases (formerly Pro Bono Net)", description: "Find pro bono cases. Volunteer-attorney matching for civil-legal cases — most need procedural help, not litigation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Scale Justice (Pro Bono Net)", authorRole: "Movement Organization", targetUrl: "https://scalejustice.org/", topImageKey: "org_scale-justice-pro-bono-net" },
  { id: 1120, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer your tech skills", description: "Volunteer your tech skills. Local brigades build tools for governments and nonprofits — replace shitty .gov UX.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Code for America", authorRole: "Movement Organization", targetUrl: "https://codeforamerica.org/", topImageKey: "org_code-for-america" },
  { id: 1121, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up as a tech volunteer", description: "Sign up as a tech volunteer. Project matching for devs, designers, and PMs supporting democracy-org tooling.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "DemocracyLab", authorRole: "Movement Organization", targetUrl: "https://www.democracylab.org/", topImageKey: "org_democracylab" },
  { id: 1122, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer your professional skills", description: "Volunteer your professional skills (design, marketing, ops, finance) to nonprofits. 1–10 hour bites; remote-friendly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Catchafire", authorRole: "Movement Organization", targetUrl: "https://www.catchafire.org/", topImageKey: "org_catchafire" },
  { id: 1123, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as a translator", description: "Volunteer as a translator for asylum cases. Crisis-language work — hours can save someone from deportation.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Respond Crisis Translation", authorRole: "Movement Organization", targetUrl: "https://respondcrisistranslation.org/", topImageKey: "org_respond-crisis-translation", imageContain: true },
  { id: 1124, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer as a linguist", description: "Volunteer as a linguist for crisis-response work. Less-resourced languages especially needed for refugee work.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CLEAR Global", authorRole: "Movement Organization", targetUrl: "https://clearglobal.org/", topImageKey: "org_clear-global" },
  { id: 1125, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign on to a Doctors for America healthcare campaign", description: "Sign on to Doctors for America campaigns. Medical voices that move members of Congress on Medicaid + ACA.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Doctors for America", authorRole: "Movement Organization", targetUrl: "https://www.doctorsforamerica.org/", topImageKey: "org_doctors-for-america" },
  { id: 1126, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Train as asylum-evaluation clinician", description: "Train as an asylum-evaluation clinician. Forensic medical exams for asylum cases — without one, deportation odds spike.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Physicians for Human Rights", authorRole: "Movement Organization", targetUrl: "https://phr.org/", topImageKey: "org_physicians-for-human-rights" },
  { id: 1127, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Sign up to run for office (STEM)", description: "Sign up to run for office (STEM). Trump's anti-science agenda needs scientists in office — they'll train you.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "314 Action", authorRole: "Movement Organization", targetUrl: "https://314action.org/", topImageKey: "org_314-action" },
  { id: 1128, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer with Authors Against Book Bans", description: "Volunteer with Authors Against Book Bans. Authors, librarians, readers showing up at school-board meetings.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans" },
  { id: 1129, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Join Concerned Archivists Alliance", description: "Archivists organizing to preserve federal records as Trump scrubs them. Need archivists, devs, and metadata pros.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Concerned Archivists Alliance", authorRole: "Movement Organization", targetUrl: "https://concernedarchivists.wordpress.com/", topImageKey: "org_concerned-archivists-alliance" },
  { id: 1130, category: "PROFESSIONAL SKILLS", categoryColor: "#1f635c", actionType: "Online", title: "Volunteer on detained-immigrant cases", description: "Volunteer on detained-immigrant cases. Free training + case match. Pro bono representation triples release odds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigration Justice Campaign", authorRole: "Movement Organization", targetUrl: "https://immigrationjustice.us/", topImageKey: "org_immigration-justice-campaign" },
  { id: 1131, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Take the anti-coup civil-resistance pledge", description: "Take the anti-coup civil-resistance pledge. Public commitment to nonviolent action if Trump refuses to leave office.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Choose Democracy", authorRole: "Movement Organization", targetUrl: "https://choosedemocracy.us/", topImageKey: "org_choose-democracy" },
  { id: 1133, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Make daily-call habit", description: "Daily script + your reps' direct lines. Two minutes a weekday is what stopped 2017's ACA repeal — same model works.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "5 Calls", authorRole: "Movement Organization", targetUrl: "https://5calls.org/", topImageKey: "org_5-calls" },
  { id: 1134, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set up daily texts to your reps", description: "Text RESIST to 50409. Resistbot turns your text into emails, faxes, or letters to your reps — daily takes seconds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistbot", authorRole: "Movement Organization", targetUrl: "https://resist.bot/", topImageKey: "org_resistbot" },
  { id: 1135, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Carry KYR cards for ICE encounters", description: "Print + carry Know-Your-Rights cards. Pull one out if ICE approaches — works for citizen and non-citizen alike.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigrant Defense Project", authorRole: "Movement Organization", targetUrl: "https://www.immigrantdefenseproject.org/", topImageKey: "org_immigrant-defense-project" },
  { id: 1137, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Set election reminders for every contest", description: "Reminders for every contest — primaries, school board, judges. Off-cycle elections are where MAGA quietly stacks boards.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote.org", authorRole: "Movement Organization", targetUrl: "https://www.vote.org/", topImageKey: "org_vote-org" },
  { id: 1138, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send an SMS that becomes an email/fax to your reps", description: "Text turns into emails or faxes to your reps. Resistbot is the laziest possible way to keep contacting them.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Resistbot", authorRole: "Movement Organization", targetUrl: "https://resist.bot/", topImageKey: "org_resistbot" },
  { id: 1139, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send today's email script", description: "Send today's email script to your reps. 5 Calls' staff write the message; you spend 90 seconds personalizing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "5 Calls", authorRole: "Movement Organization", targetUrl: "https://5calls.org/", topImageKey: "org_5-calls" },
  { id: 1140, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Tell Congress: reject mass government surveillance", description: "Email your reps to oppose surveillance expansion. Trump's DHS uses these tools to track immigrants, journalists, and protesters.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/tell-congress-reject-mass-government-surveillance/", topImageKey: "org_common-cause" },
  { id: 1141, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send email-your-rep", description: "Email-your-rep on consumer protection and corporate accountability fights. Their tracker is updated weekly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Public Citizen", authorRole: "Movement Organization", targetUrl: "https://www.citizen.org/", topImageKey: "org_public-citizen" },
  { id: 1142, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send anti-militarism email", description: "Send an anti-militarism email to your reps. Win Without War targets Pentagon budget votes specifically.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Win Without War", authorRole: "Movement Organization", targetUrl: "https://winwithoutwar.org/", topImageKey: "org_win-without-war" },
  { id: 1143, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send Christian-rooted email-your-rep", description: "Send a Christian-rooted email-your-rep. Religious framing changes which Republicans actually engage.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Faithful America", authorRole: "Movement Organization", targetUrl: "https://www.faithfulamerica.org/", topImageKey: "org_faithful-america" },
  { id: 1144, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Send Quaker constituent email", description: "Send a Quaker constituent email. FCNL writes the script; email lands at your senator's office in seconds.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Friends Committee on National Legislation", authorRole: "Movement Organization", targetUrl: "https://www.fcnl.org/", topImageKey: "org_friends-committee-on-national-legislation" },
  { id: 1145, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email targeting specific ICE facilities", description: "Email actions against specific ICE facility operators. Detention Watch identifies who to pressure for closures.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Detention Watch Network", authorRole: "Movement Organization", targetUrl: "https://www.detentionwatchnetwork.org/", topImageKey: "org_detention-watch-network" },
  { id: 1146, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Email your school board re: book bans", description: "Email your school board against book bans. Pre-written templates work — boards capitulate when pressure hits.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Authors Against Book Bans", authorRole: "Movement Organization", targetUrl: "https://www.authorsagainstbookbans.com/", topImageKey: "org_authors-against-book-bans" },
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
  { id: 1157, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Apply to be a paid poll worker", description: "Apply to be a paid poll worker. Local elections are short on workers; you get paid + protect access for hours of your day.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Power the Polls", authorRole: "Movement Organization", targetUrl: "https://www.powerthepolls.org/", topImageKey: "org_power-the-polls" },
  { id: 1158, category: "TRAINING", categoryColor: "#126d89", actionType: "Online", title: "Take a Know Your Rights training", description: "Take a Know Your Rights training for ICE encounters. Live calendar; bring your block, household, or workplace.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Immigrant Defense Project", authorRole: "Movement Organization", targetUrl: "https://www.immigrantdefenseproject.org/", topImageKey: "org_immigrant-defense-project" },
  { id: 1160, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Sign up for kindness-toned voter postcards", description: "Write hand-written postcards to swing-state voters. Personal mail still cuts through algorithm-fried discourse.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Postcards to Voters", authorRole: "Movement Organization", targetUrl: "https://postcardstovoters.org/", topImageKey: "org_postcards-to-voters" },
  { id: 1161, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Become a pen pal to a detained migrant", description: "Become a pen pal to a detained migrant. Mail breaks isolation in ICE detention; bilingual letters welcome.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Freedom for Immigrants", authorRole: "Movement Organization", targetUrl: "https://www.freedomforimmigrants.org/", topImageKey: "org_freedom-for-immigrants" },
  { id: 1162, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Volunteer (LGBTQ youth digital crisis support)", description: "Volunteer for LGBTQ youth digital crisis support. 24/7 chat/text/phone — paid training, ongoing support.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Trevor Project", authorRole: "Movement Organization", targetUrl: "https://www.thetrevorproject.org/", topImageKey: "org_the-trevor-project" },
  { id: 1164, category: "SPREAD POSITIVITY", categoryColor: "#d97706", actionType: "Online", title: "Practice rest-as-resistance prompts", description: "Practice rest-as-resistance prompts. Tricia Hersey's free library — burnout is the goal of fascism, sleep counters it.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Nap Ministry (Tricia Hersey)", authorRole: "Movement Organization", targetUrl: "https://thenapministry.wordpress.com/", topImageKey: "org_the-nap-ministry-tricia-hersey" },
  { id: 1165, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Find + amplify your local mutual aid", description: "Find + amplify your local mutual aid network. Map of US-wide groups — money, supplies, people on the ground.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mutual Aid Hub", authorRole: "Movement Organization", targetUrl: "https://www.mutualaidhub.org/", topImageKey: "org_mutual-aid-hub" },
  { id: 1166, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Boost a single Olive Branch family fund", description: "Boost a single Palestinian family's GoFundMe from a vetted queue. Direct, traceable, no big-org skim.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Operation Olive Branch", authorRole: "Movement Organization", targetUrl: "https://linktr.ee/opolivebranch", topImageKey: "org_operation-olive-branch" },
  { id: 1167, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Capital B (Black-led)", description: "Subscribe + share Capital B coverage. Black-led investigative work that mainstream outlets don't cover.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Capital B", authorRole: "Movement Organization", targetUrl: "https://capitalbnews.org/", topImageKey: "org_capital-b" },
  { id: 1168, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share The 19th* (gender + politics)", description: "Subscribe + share The 19th. Gender + politics reporting on abortion, trans rights, and women's health under Trump.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The 19th*", authorRole: "Movement Organization", targetUrl: "https://19thnews.org/", topImageKey: "org_the-19th" },
  { id: 1169, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share Documented (NYC immigration)", description: "Subscribe + share Documented. NYC immigration-focused journalism that hits ICE operations in real time.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Documented", authorRole: "Movement Organization", targetUrl: "https://documentedny.com/", topImageKey: "org_documented" },
  { id: 1171, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Subscribe + share The Lever", description: "Subscribe + share The Lever. Sirota's outfit on dark money and corporate corruption — best independent reporting.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Lever", authorRole: "Movement Organization", targetUrl: "https://www.levernews.com/", topImageKey: "org_the-lever" },
  { id: 1172, category: "BOOST", categoryColor: "#8a00e6", actionType: "Online", title: "Submit + share a press-freedom incident", description: "Submit + share press-freedom incidents. Public record of every press attack — fuels lawsuits and policy fights.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "U.S. Press Freedom Tracker", authorRole: "Movement Organization", targetUrl: "https://pressfreedomtracker.us/", topImageKey: "org_u-s-press-freedom-tracker" },
  { id: 1174, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Download free protest art", description: "Download free protest art. Pro-grade posters from Shepard Fairey and others; print at home for any march.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Amplifier", authorRole: "Movement Organization", targetUrl: "https://amplifier.org/", topImageKey: "org_amplifier" },
  { id: 1175, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Download free anti-fascist posters", description: "Download free anti-fascist posters. Co-op of printmakers; high-quality designs for protests, walls, and zines.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Justseeds Artists' Cooperative", authorRole: "Movement Organization", targetUrl: "https://justseeds.org/", topImageKey: "org_justseeds-artists-cooperative" },
  { id: 1176, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Download educational graphics", description: "Download educational graphics. Hand-drawn movement art — climate, mining, Trump-era issues. Free to print.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Beehive Design Collective", authorRole: "Movement Organization", targetUrl: "https://beehivecollective.org/", topImageKey: "org_beehive-design-collective" },
  { id: 1177, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Submit an embroidery piece", description: "Embroider a Trump quote and ship to the project archive. Permanent record + group-show exhibitions.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Tiny Pricks Project", authorRole: "Movement Organization", targetUrl: "https://www.tinypricksproject.com/", topImageKey: "org_tiny-pricks-project" },
  { id: 1178, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Apply to programs", description: "Apply for forum theater + virtual workshops. Boal's method for rehearsing political action — practice the protest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Theatre of the Oppressed NYC", authorRole: "Movement Organization", targetUrl: "https://www.tonyc.nyc/", topImageKey: "org_theatre-of-the-oppressed-nyc" },
  { id: 1179, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Use the tactical-prank toolkit", description: "Use the Yes Men's tactical-prank toolkit. Step-by-step satire playbook — they impersonated execs to expose climate lies.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Yes Men", authorRole: "Movement Organization", targetUrl: "https://theyesmen.org/", topImageKey: "org_the-yes-men" },
  { id: 1180, category: "ART PIECE", categoryColor: "#896312", actionType: "Online", title: "Refer an artist at risk", description: "Refer an artist at risk. Solidarity for persecuted artists — visa, legal, and relocation support during crackdowns.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Artists at Risk Connection (PEN America)", authorRole: "Movement Organization", targetUrl: "https://artistsatriskconnection.org/", topImageKey: "org_artists-at-risk-connection-pen-america" },
  { id: 1181, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Find your local mutual aid network", description: "Find your local mutual aid network. Pick one neighbor to support this week — money, food, rides, anything.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Mutual Aid Hub", authorRole: "Movement Organization", targetUrl: "https://www.mutualaidhub.org/", topImageKey: "org_mutual-aid-hub" },
  { id: 1186, category: "ACT OF KINDNESS", categoryColor: "#0d8c6e", actionType: "Online", title: "Volunteer as a translator for asylum seekers", description: "Translate documents for asylum seekers. Hours of your time can prevent a deportation; bilingual = high-value.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Respond Crisis Translation", authorRole: "Movement Organization", targetUrl: "https://respondcrisistranslation.org/", topImageKey: "org_respond-crisis-translation", imageContain: true },
  { id: 1192, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Boost Sludge's dark-money & GOP-donor reporting", description: "Subscribe to Sludge and share their campaign-finance investigations on social. Counter dark-money disinfo with sourced reporting.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sludge", authorRole: "Movement Organization", targetUrl: "https://readsludge.com/", topImageKey: "org_sludge" },
  { id: 1193, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Boost Bolts Magazine's local-democracy reporting", description: "Subscribe to Bolts and share their local DA, sheriff, and election-admin coverage. Local democracy is where Trump-era threats land first.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Bolts Magazine", authorRole: "Movement Organization", targetUrl: "https://boltsmag.org/", topImageKey: "org_bolts-magazine" },
  { id: 1194, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Boost Drop Site News on Trump's wars & civil liberties", description: "Subscribe to Drop Site (ex-Intercept staff) and share their war and civil-liberties coverage. Counter the war-machine narrative.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Drop Site News", authorRole: "Movement Organization", targetUrl: "https://www.dropsitenews.com/", topImageKey: "org_drop-site-news" },
  { id: 1196, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Boost More Perfect Union's worker-power journalism", description: "Subscribe to More Perfect Union and share their worker-power video reporting. Anti-corporate journalism that hits Trump donors directly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "More Perfect Union", authorRole: "Movement Organization", targetUrl: "https://perfectunion.us/", topImageKey: "org_more-perfect-union" },
  { id: 1202, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Boost Inkstick's anti-war foreign-policy reporting", description: "Subscribe to Inkstick and share their non-DC foreign policy coverage. Counter the bipartisan war-and-empire consensus.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inkstick Media", authorRole: "Movement Organization", targetUrl: "https://inkstickmedia.com/", topImageKey: "org_inkstick-media" },
  { id: 1203, category: "BOOST FACTS", categoryColor: "#5a009e", actionType: "Online", title: "Read + share data", description: "Read + share wealth-concentration data. Inequality.org has the charts that make 'eat the rich' arguments concrete.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inequality.org", authorRole: "Movement Organization", targetUrl: "https://inequality.org/", topImageKey: "org_inequality-org" },
  { id: 1204, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Sign up for op-ed training", description: "Sign up for op-ed training. They've placed thousands of underrepresented voices in major papers — works.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The OpEd Project", authorRole: "Movement Organization", targetUrl: "https://www.theopedproject.org/", topImageKey: "org_the-oped-project" },
  { id: 1205, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use weekly LTE prompts (formerly Sister District)", description: "Use weekly LTE prompts targeting state-level fights. Coordinated submissions to district papers move ratings.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "States Win (FKA Sister District)", authorRole: "Movement Organization", targetUrl: "https://stateswin.org/", topImageKey: "org_states-win-fka-sister-district" },
  { id: 1206, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use the Two-Minute Activist tool", description: "Use AAUW's two-minute activist tool. LTE templates + submission. Women's-org muscle behind every signature.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "AAUW", authorRole: "Movement Organization", targetUrl: "https://www.aauw.org/", topImageKey: "org_aauw" },
  { id: 1207, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use the LTE writer tool", description: "Use Sierra Club's LTE writer. Climate-focused, chapter-targeted, gets published in regional papers regularly.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Sierra Club", authorRole: "Movement Organization", targetUrl: "https://www.sierraclub.org/", topImageKey: "org_sierra-club" },
  { id: 1208, category: "LETTER TO EDITOR", categoryColor: "#3f5c8c", actionType: "Online", title: "Use LTE templates with verified statistics", description: "Use Inequality.org's LTE templates with verified stats. Drop the chart links and let editors do the rest.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Inequality.org", authorRole: "Movement Organization", targetUrl: "https://inequality.org/", topImageKey: "org_inequality-org" },
  { id: 1215, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Call peer crisis line: 877-565-8860", description: "Trans peer crisis line: 877-565-8860. No police dispatch, no involuntary holds. Save the number for your friends.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Trans Lifeline", authorRole: "Movement Organization", targetUrl: "https://translifeline.org/", topImageKey: "org_trans-lifeline" },
  { id: 1216, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Reach via 24/7 chat / text / phone", description: "LGBTQ youth crisis line — 24/7 chat, text, phone. Save it; share it with any kid in your life feeling targeted.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "The Trevor Project", authorRole: "Movement Organization", targetUrl: "https://www.thetrevorproject.org/", topImageKey: "org_the-trevor-project" },
  { id: 1217, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Call peer hotline / chat", description: "Peer hotline + chat for LGBTQ folks of any age. Calm peer support, not crisis — for the bad-day moments.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "LGBT National Help Center", authorRole: "Movement Organization", targetUrl: "https://lgbthotline.org/", topImageKey: "org_lgbt-national-help-center" },
  { id: 1218, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Text HOME to 741741", description: "Trained counselor 24/7 — free, anonymous, no police dispatch. Save it now; share with anyone queer, trans, or targeted.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Crisis Text Line", authorRole: "Movement Organization", targetUrl: "https://www.crisistextline.org/", topImageKey: "org_crisis-text-line" },
  { id: 1219, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Subscribe to the Movement Memos podcast", description: "Subscribe to Kelly Hayes' podcast. Anti-burnout, abolitionist, movement-stamina lessons — keep going for the long fight.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Truthout / Kelly Hayes", authorRole: "Movement Organization", targetUrl: "https://truthout.org/series/movement-memos/", topImageKey: "org_truthout-kelly-hayes" },
  { id: 1220, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a peer mental-health chapter", description: "Find a peer mental-health chapter. Campus + online network — good fit for college students or new grads.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Active Minds", authorRole: "Movement Organization", targetUrl: "https://activeminds.org/", topImageKey: "org_active-minds" },
  { id: 1221, category: "MENTAL HEALTH", categoryColor: "#6b5b95", actionType: "Online", title: "Find a free virtual support group", description: "Find a free virtual support group. Family + peer mental-health support; weekly, online, no insurance needed.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "NAMI", authorRole: "Movement Organization", targetUrl: "https://www.nami.org/", topImageKey: "org_nami" },
  { id: 1223, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Sign up to run for office (under 40, progressive)", description: "Sign up to run for office. Under 40, progressive — they handle the hard parts, you focus on the door knocks.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Run for Something", authorRole: "Movement Organization", targetUrl: "https://runforsomething.net/", topImageKey: "org_run-for-something" },
  { id: 1224, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to candidate training (women)", description: "Apply for free women's candidate training. They've run thousands of women — training is rigorous, free, ongoing.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote Run Lead", authorRole: "Movement Organization", targetUrl: "https://voterunlead.org/", topImageKey: "org_vote-run-lead" },
  { id: 1225, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to candidate training (Dem women)", description: "Apply to candidate training for Democratic women. Six-month program; alumni include 1,200+ elected officials.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Emerge America", authorRole: "Movement Organization", targetUrl: "https://emergeamerica.org/", topImageKey: "org_emerge-america" },
  { id: 1226, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Apply to candidate training (Black women)", description: "Apply to Black women's candidate training. Pipeline org for the most underrepresented group in elected office.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Higher Heights for America", authorRole: "Movement Organization", targetUrl: "https://higherheightsforamerica.org/", topImageKey: "org_higher-heights-for-america" },
  { id: 1230, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Save threatened gov pages with one click", description: "One-click archive of any threatened gov page. Save before Trump's admin scrubs it — works on any URL.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Wayback Machine 'Save Page Now'", authorRole: "Movement Organization", targetUrl: "https://web.archive.org/save", topImageKey: "org_wayback-machine-save-page-now" },
  { id: 1231, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Pick a banned book + read it", description: "Pick a banned book + read it. Live, sortable list — read what they don't want in school libraries.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "PEN America banned-books list", authorRole: "Movement Organization", targetUrl: "https://pen.org/banned-books-list-2022/", topImageKey: "org_pen-america-banned-books-list" },
  { id: 1232, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Set election reminders (every contest)", description: "Set election reminders for every contest. Off-cycle elections (judges, school boards) are where MAGA quietly stacks boards.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Vote.org", authorRole: "Movement Organization", targetUrl: "https://www.vote.org/", topImageKey: "org_vote-org" },
  { id: 1233, category: "OTHER", categoryColor: "#3f3f3f", actionType: "Online", title: "Find DOJ-accredited rep training", description: "Free DOJ-accredited rep training. Trump's mass deportation needs more accredited reps — non-lawyers can do this.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "CLINIC (Catholic Legal Immigration Network)", authorRole: "Movement Organization", targetUrl: "https://www.cliniclegal.org/", topImageKey: "org_clinic-catholic-legal-immigration-network" },
  // MoveOn front-page petitions — https://front.moveon.org/petitions/
  { id: 1234, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Mandate that ICE agents show their face and identification", description: "Demand Congress require immigration agents to display agency ID and name badges, like other law enforcement.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/unmask-ice", topImageKey: "org_moveon" },
  { id: 1235, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Keep the U.S. out of forever wars", description: "Oppose U.S. military action in Iran. Tell Congress to prevent another Middle Eastern war.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/no-war-with-iran-18", topImageKey: "org_moveon" },
  { id: 1236, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Do not cooperate with ICE", description: "Tell mayors and local officials to refuse cooperation with ICE and protect their residents.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/do-not-cooperate-with-ice", topImageKey: "org_moveon" },
  { id: 1237, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Pam Bondi must go", description: "Demand Attorney General Pam Bondi resign or be impeached over her DOJ agenda.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/pam-bondi-must-go", topImageKey: "org_moveon" },
  { id: 1238, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "No warehouses for ICE detention centers", description: "Block ICE's $38B push to convert warehouses into immigration detention facilities.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "MoveOn", authorRole: "Movement Organization", targetUrl: "https://sign.moveon.org/petitions/no-warehouses-for-ice-detention-centers", topImageKey: "org_moveon" },

  // Common Cause direct-action campaigns — https://www.commoncause.org/take-action/
  { id: 1239, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Save the USPS and mail-in voting", description: "Sign to defend USPS from privatization. Mail-in voting and rural delivery die together — voter suppression by infrastructure.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/save-the-us-postal-service/", topImageKey: "org_common-cause" },
  { id: 1240, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Defend the SPLC against right-wing attacks", description: "Sign to defend the Southern Poverty Law Center. Trump-aligned groups are using lawfare to discredit hate-tracking research.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/defend-the-splc-and-our-civil-rights/", topImageKey: "org_common-cause" },
  { id: 1241, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Hold Trump's DOJ lawyers accountable", description: "Email state bars asking for ethics review of DOJ lawyers advancing Trump's anti-democracy agenda. Bar discipline is a real lever.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/hold-trumps-doj-lawyers-accountable/", topImageKey: "org_common-cause" },
  { id: 1242, category: "EMAIL CAMPAIGN", categoryColor: "#c2185b", actionType: "Online", title: "Reject Trump's $10B presidential cash grab", description: "Email Congress to block Trump's $10B presidential allowance push. Funnels public money toward MAGA-aligned contractors.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/reject-trumps-10-billion-cash-grab/", topImageKey: "org_common-cause" },
  { id: 1243, category: "PERSONAL COMMITMENT", categoryColor: "#5e1f7a", actionType: "Online", title: "Pledge to be the change in your community", description: "Take Common Cause's pledge — vote in every election, recruit one neighbor, follow at least one local race. Habit beats vibes.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/take-the-pledge-be-the-change/", topImageKey: "org_common-cause" },
  { id: 1244, category: "PETITION", categoryColor: "#05737f", actionType: "Online", title: "Remove Trump from office", description: "Sign Common Cause's call for impeachment based on documented abuses. Petition pressure feeds the political will needed.", isOnline: true, boosts: 0, spotsTotal: "Unlimited", authorName: "Common Cause", authorRole: "Movement Organization", targetUrl: "https://www.commoncause.org/actions/remove-trump-from-office-now-2/", topImageKey: "org_common-cause" },
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

    const approval = await ensureApprovalRecord(user);
    return c.json({ approval });
  } catch (err) {
    console.log("Auth status error:", err);
    return c.json({ error: `Status check failed: ${err}` }, 500);
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
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ users: list });
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

    // One-time: remove dropped seed cards. Add new IDs to the array and bump
    // the version key whenever you delete cards from SEED_CARDS.
    const droppedPurged = await kv.get("cleanup:dropped-seeds:v1");
    if (!droppedPurged) {
      const droppedIds = [1136, 1185]; // Apiary repro-pledge duplicates
      for (const id of droppedIds) await kv.del(`action:${id}`);
      await kv.set("cleanup:dropped-seeds:v1", true);
      console.log(`Purged ${droppedIds.length} dropped seed cards.`);
    }

    // Seed/refresh the org-action library (IDs 1000+) into KV. Bump the version
    // key (e.g. v4 → v5) whenever you've edited SEED_CARDS and want the live
    // feed to pick up the new title/url/image. Existing user activity (`boosts`)
    // and admin curation flags (`quickAction`) are preserved across re-seeds —
    // only seed-managed metadata (title/desc/url/image) is overwritten.
    const orgsSeeded = await kv.get("seed:org-actions:v9");
    if (!orgsSeeded) {
      let count = 0;
      for (const card of SEED_CARDS) {
        if (card.id < 1000) continue;
        const existing = (await kv.get(`action:${card.id}`)) as any;
        const merged: any = { ...card };
        if (existing && typeof existing === "object") {
          // Preserve live engagement counters that users have moved.
          if (typeof existing.boosts === "number")        merged.boosts = existing.boosts;
          else if (typeof existing.spotsUsed === "number") merged.boosts = existing.spotsUsed;
          // Preserve admin-curation flags that aren't owned by the seed.
          if (existing.quickAction === true) merged.quickAction = true;
        }
        await kv.set(`action:${card.id}`, merged);
        count++;
      }
      await kv.set("seed:org-actions:v9", true);
      console.log(`Re-seeded ${count} org-action cards (v6).`);
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

    const { title, description, category, categoryColor, location, isOnline, spotsTotal, sponsor, link, vettingInfo, actionType, topImageUrl, imageContain } =
      await c.req.json<{
        title: string; description: string; category: string; categoryColor: string;
        location?: string; isOnline?: boolean; spotsTotal: number | "Unlimited";
        sponsor?: string; link?: string; vettingInfo?: string; actionType?: string;
        topImageUrl?: string | null; imageContain?: boolean;
      }>();

    if (!title || !description || !category) {
      return c.json({ error: "title, description and category are required" }, 400);
    }

    // Auto-increment ID starting at 100 to avoid collisions with seed data
    const currentIds = (await kv.get("user-action:ids") ?? []) as number[];
    const nextId = currentIds.length > 0 ? Math.max(...currentIds) + 1 : 100;

    const card = {
      id: nextId,
      category: category.toUpperCase(),
      categoryColor,
      title,
      description,
      location: location || undefined,
      isOnline: isOnline ?? false,
      actionType: actionType ?? (isOnline ? "Online" : "In Person Group"),
      sponsor: sponsor || undefined,
      link: link || undefined,
      vettingInfo: vettingInfo || undefined,
      boosts: 0,
      spotsTotal,
      authorName: approval.name,
      authorRole: "Citizen Activist",
      authorAvatarKey: null,
      topImageKey: null,
      topImageUrl: topImageUrl || null,
      imageContain: imageContain === true ? true : undefined,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
    };

    await kv.set(`user-action:${nextId}`, card);
    await kv.set("user-action:ids", [...currentIds, nextId]);
    console.log(`User ${approval.name} created ASK #${nextId}: "${title}"`);
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

// ─── POST /actions/upload-image — upload to Supabase Storage, return URL ─────
// Approved users only. Auto-creates the public bucket on first call.
app.post("/make-server-9eb1ae04/actions/upload-image", async (c) => {
  try {
    const token = c.req.header("Authorization")?.split(" ")[1];
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    const user = await getUser(token);
    if (!user) return c.json({ error: "Invalid or expired token" }, 401);

    const approval = await kv.get(`user:approval:${user.id}`) as any;
    if (!approval || approval.status !== "approved") {
      return c.json({ error: "Your account must be approved to upload." }, 403);
    }

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

Deno.serve(app.fetch);