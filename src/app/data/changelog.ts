// User-facing changelog. Add a new entry at the top of `CHANGELOG` every time
// we bump the version in package.json before pushing to main. Keep copy in
// product-language, not dev-language — readers are the people using the site.

export interface ChangelogEntry {
  version: string;
  date: string;     // YYYY-MM-DD
  title: string;    // Short headline
  sections: ChangelogSection[];
}

export interface ChangelogSection {
  heading: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.7",
    date: "2026-05-17",
    title: "Gamification animations — counters roll, bookmarks bounce, streaks burn, avatars get XP rings",
    sections: [
      {
        heading: "What's new (all gated behind prefers-reduced-motion)",
        items: [
          "Action-count roll-up — the \"I did this · 6\" number now tweens up from 6 → 7 over 600ms with a brief scale-pop on the count, instead of snapping. Feels like the click did something.",
          "Bookmark spring-bounce — clicking the bookmark icon pops it (scale 1 → 1.45 → back) with cubic-bezier overshoot. Only fires on a real toggle, not on the page-load render that paints already-bookmarked cards.",
          "Streak flame — at Day 7+ a flickering 🔥 appears next to your day counter in the hero. Subtle skew + drop-shadow keyframe makes it look like it's breathing. Day 1–6 stays clean so the flame is something earned.",
          "Sparkle twinkle — the ✨ in \"✨ Matched for you\" now twinkles (scale + rotate + opacity wobble on a 2.2s loop). Says \"this is fresh\" without being neon.",
          "Match results stagger-in — when you apply a new Match config, the first 12 cards fade up with 40ms stagger so the lineup looks built rather than just appeared. Infinite-scroll loads stay silent.",
          "Featured card shimmer — Boosted ⭐ cards get a diagonal highlight sweep across their navy hero image every ~5.5s. Soft, single pass, easy to ignore but draws the eye.",
          "Avatar XP ring — your tier-colored progress ring now wraps your profile photo in the mobile menu, filling clockwise toward the next tier. Apple Watch / Strava energy.",
          "First-match-wizard confetti — the very first time you finish the Match wizard (ever, per browser), a 180-piece confetti burst rains down. Once. Then never again.",
        ],
      },
      {
        heading: "Already in the app from before",
        items: [
          "The big celebration modal that fires when you mark an action DONE — full-screen fireworks, three waves of bursts, color pulses on tier-up, count-up of your total action count — has been around for a while. We didn't replace any of that; the new animations layer in around it for the smaller moments that didn't have feedback yet.",
        ],
      },
      {
        heading: "Accessibility",
        items: [
          "Everything in this release respects `prefers-reduced-motion`. The shared `lib/animations.ts` module exports a `prefersReducedMotion()` check, and the CSS keyframes are gated by `@media (prefers-reduced-motion: reduce) { animation: none !important; }`. So if your OS has \"Reduce motion\" on, the streak flame just sits there, the sparkle just sits there, the bookmark just toggles instantly — no movement at all.",
          "The confetti helper also returns immediately for reduced-motion users — no DOM created, no work done.",
        ],
      },
    ],
  },
  {
    version: "1.0.6",
    date: "2026-05-17",
    title: "Match banner: all 5 tone chips visible at all times, with bumped ones highlighted",
    sections: [
      {
        heading: "What changed",
        items: [
          "The match banner under \"✨ Matched for you\" used to hide tone chips (Confrontational, Humor, Subversive, Hopeful, Motivation) when they were sitting at the default value — so all-defaults users saw just ⏱ time and 🗺 setting. Confusing if you wanted a quick \"what are my settings right now?\" check.",
          "Now: all 5 tone chips are visible at all times. Ones at the default render greyed out + thin border (background context). Ones you've bumped off the default render in orange-accent + bold + navy text — so anything you've customised pops at a glance.",
          "Hover any chip for a tooltip that says whether it's at default or what value it's been bumped to.",
        ],
      },
      {
        heading: "Why",
        items: [
          "Earlier today we'd flipped the logic the other way (only show bumped chips) because we'd briefly had a version where every tone dim showed up loudly even when nothing was set — felt like noise. This is the middle path: always show everything, but make the customised stuff visually louder than the defaults.",
        ],
      },
    ],
  },
  {
    version: "1.0.5",
    date: "2026-05-17",
    title: "Facebook share preview now matches the new Spread the Word illustration",
    sections: [
      {
        heading: "What was wrong",
        items: [
          "When you shared resistact.org on Facebook, the preview thumbnail showed an old photo+illustration mashup — even though the in-app Spread the Word card had already been swapped to the new fully-illustrated version with the cartoon crowd, the Capitol dome, and the bright orange fist.",
          "The bug: the Open Graph meta tag in our HTML still pointed at the old `og-image.jpg` file, so every social platform that scraped the URL got the old image.",
        ],
      },
      {
        heading: "What changed",
        items: [
          "Generated a 1200×800 JPEG version of the new illustration as `og-image-v2.jpg` — 289 KB, ~9× smaller than the source PNG, so Facebook's scraper finishes pulling it before timing out.",
          "Pointed both the `og:image` and `twitter:image` meta tags at the new file, with correct width/height attributes for the new dimensions.",
          "Used a new filename instead of overwriting the old one because Facebook caches OG images by URL — a new URL is the single most reliable way to force every social platform to re-scrape.",
        ],
      },
      {
        heading: "If old previews still appear after deploy",
        items: [
          "Facebook caches share previews per-URL for ~24 hours. To force-refresh: open https://developers.facebook.com/tools/debug/, paste https://www.resistact.org/, click Scrape Again. Twitter/X is similar at https://cards-dev.twitter.com/validator.",
          "Anyone who already saw the old preview on Facebook may still see it for a while — FB caches at multiple layers. New shares from this point on will use the new image.",
        ],
      },
    ],
  },
  {
    version: "1.0.4",
    date: "2026-05-17",
    title: "Cards lift on hover — a tiny bit of physicality, without making anyone seasick",
    sections: [
      {
        heading: "What changed",
        items: [
          "Hovering over any action card now lifts it 4px, scales it 2%, and rotates it 0.3° — subtle enough you feel it more than you see it. The shadow still lifts to a softer larger shadow underneath. Reads as \"I am clickable and physical\" without screaming for attention.",
          "Why not the literal \"shake\" we talked about? Shake is the single worst CSS animation for vestibular disorders, it reads as an error signal in UI vocabulary (think iOS wrong-password), and on a dense feed of 400+ cards a mouse passing over a dozen of them while you scroll would feel like the page is malfunctioning. The lift achieves the same \"I noticed you\" effect without those costs.",
        ],
      },
      {
        heading: "Accessibility",
        items: [
          "All three transforms (lift, scale, microtilt) are gated behind `prefers-reduced-motion: no-preference`. If you have \"Reduce motion\" turned on in your OS settings (macOS, iOS, Windows, Android — all support it), the cards still get the shadow-lift but they don't move. No flag to toggle in our app — we just respect the system setting.",
          "The hovered card also paints above its neighbors so its edges don't get clipped where it overlaps the next card in the grid.",
        ],
      },
    ],
  },
  {
    version: "1.0.3",
    date: "2026-05-17",
    title: "Admin → Online now shows the last 24 hours, with at-a-glance freshness",
    sections: [
      {
        heading: "Online tab is now \"active today\", not \"on right now\"",
        items: [
          "The Admin Panel's Online tab used to only show users active in the last 5 minutes — which meant 0 most of the time, and useless for checking whether a Facebook blast actually drew traffic. It now shows everyone active in the last 24 hours.",
          "The list is still sorted most-recent first and still refreshes every 30 seconds while the tab is open.",
        ],
      },
      {
        heading: "Color-tiered status dots",
        items: [
          "Green dot = active in the last 5 minutes (\"online now\").",
          "Amber dot = active in the last hour (\"active recently\").",
          "Gray dot = active today, but not recently.",
          "Hover the dot to see the label. This way you can still tell who's live right this second without losing the bigger \"who used the site today\" picture.",
        ],
      },
      {
        heading: "Under the hood",
        items: [
          "The /admin/online-users endpoint default window jumped from 5 minutes to 1440 minutes (24h), and the upper cap went from 60 minutes to a full week. The frontend now requests 1440 by default.",
          "Same data source as before: `user:last-seen:*` keys written on every authenticated request. No new tracking, no new storage — just a wider read window.",
        ],
      },
    ],
  },
  {
    version: "1.0.2",
    date: "2026-05-17",
    title: "Google Analytics 4 wired in — privacy-respecting, event-tracked",
    sections: [
      {
        heading: "Analytics live in production",
        items: [
          "Google Analytics 4 (G-7QS8YBZZXY) now ships with every page. Gtag loads asynchronously after first paint, so there's no performance cost up front.",
          "Privacy posture: IPs are anonymized before storage, Google Signals (cross-device ad tracking) is disabled, ad-personalization signals are off, and visitors with browser-level Do-Not-Track are skipped entirely — gtag doesn't even load for them.",
          "If you see this version badge in the bottom-left, the deploy is live.",
        ],
      },
      {
        heading: "Events being tracked beyond page views",
        items: [
          "action_completed — fires when a user marks an action as DONE. Carries the card ID and category (BOYCOTT / PETITION / PROTEST / etc.) so we can see which categories drive engagement.",
          "share — fires on every share-button click across The Smacks (11 destinations: native share, copy-image, Facebook, Threads, Bluesky, Instagram, Pinterest, Reddit, Tumblr, X, download) AND across the Spread-the-Word modal. Each event carries a method dimension so per-platform share counts are visible.",
          "match_set — fires when a user finishes the Match wizard and applies preferences. Captures the time bucket and all five tone dimensions, so we can see which configurations users actually pick.",
        ],
      },
      {
        heading: "Why it's a hardcoded ID instead of an env var",
        items: [
          "GA4 Measurement IDs are public — Google embeds them in every page's HTML the moment gtag loads, so there's no security difference between committing the ID and not committing it. Hardcoding the fallback means production picks it up automatically without needing the build environment to have .env configured.",
          "An env var still wins over the fallback when set — handy if we add separate staging vs. production GA properties later.",
        ],
      },
      {
        heading: "Match Me: \"5–10 min\" now hard-filters",
        items: [
          "Picking the \"A few minutes — 5–10 min\" stop in the Match wizard now actually drops cards that take longer. Previously it was a ranking signal only, so you'd see all 400+ cards with the short ones at the top. Now you only see cards in the 5min and 10min buckets — typically 60–100 actions. The 30min / 1hr / few-hours / ongoing stops stay ranking-only as before.",
          "Also restored: the banner chip strip only shows tone dimensions you've moved off the default. With all-defaults you'll see just ⏱ time and any state / group / donation chips. Bumping a tone slider above default makes its chip appear.",
        ],
      },
    ],
  },
  {
    version: "1.0.1",
    date: "2026-05-17",
    title: "Privacy-first Google Analytics, email consent at signup, per-platform share tracking",
    sections: [
      {
        heading: "Privacy-first analytics",
        items: [
          "Google Analytics 4 is now active — but only if the environment has a measurement ID configured and your browser's Do-Not-Track header is off. Both conditions must hold; if either fails, no scripts load and no network calls are made.",
          "IP anonymization is on. Google Signals and ad-personalization are disabled. No tracking for tracking's sake — just the signals we need to understand which actions are resonating.",
          "Three events are tracked: completing an action (with category), applying Match Me preferences, and sharing a Smack (per-destination — Facebook, Bluesky, X, download, copy, etc.).",
        ],
      },
      {
        heading: "Email opt-in at account creation",
        items: [
          "A checkbox at signup lets you say yes (or no) to receiving ResistAct emails about new actions, updates, and resistance news. Off by default — you have to actively check it.",
          "Your choice is stored on your account. The admin user list now shows an 'emails ok' or 'no emails' badge on each user row so we always know who we can reach.",
        ],
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-05-17",
    title: "🎉 ResistAct 1.0 — production launch. Smaller-faster Smacks, smarter match banner, 36 fresh cards, and the catalog crosses 1,373.",
    sections: [
      {
        heading: "🚀 1.0 — out of beta",
        items: [
          "ResistAct is officially production. Everything below v1.0 was the building phase — this is the version we're standing behind as our first stable release. Performance, security, and admin tooling are all hardened; the catalog crossed 1,373 hand-curated action cards.",
        ],
      },
      {
        heading: "Faster, lighter Smacks",
        items: [
          "Image audit: every Smack PNG now has a WebP sibling generated at 82% quality. Browsers automatically load WebP via <picture>, so The Smacks tab is 80–90% lighter on first paint — roughly 47 MB of bandwidth saved per visitor. Originals stay on disk as fallback.",
          "Sharing routes through the WebP too. Native share, Copy-for-Facebook, and Save-image-via all upload ~300–450 KB files instead of 2–3 MB PNGs. Social uploads finish in a heartbeat.",
          "New \"Download high-res (for print)\" button on the share modal — explicit one-click access to the original PNG when you actually want the lossless full-size file (framing, printing, archiving). Other share actions stay on the WebP path.",
          "Senate added to the Smacks library (the existing WebP sibling means it loads at 253 KB, not 2.2 MB).",
        ],
      },
      {
        heading: "Match-for-Me banner — now shows your settings",
        items: [
          "When Match Mode is active, the orange banner at the top of the feed now reads \"Matched for you. Showing N actions.\" — the live count of cards currently passing your filters.",
          "Underneath the headline, a chip strip surfaces every preference you set: ⏱ time bucket, 🔥 confrontational level, 😄 humor level, 🎭 subversive level, 🌅 hopeful level, ⚡ motivation, 📍 state, 🤝 amplified-group count, 💵 donation focus. Tone dimensions left at the default are omitted so the strip stays short.",
          "Edit / Clear buttons stay anchored on the right. Banner stacks vertically on mobile.",
        ],
      },
      {
        heading: "New action cards (36 since v0.9)",
        items: [
          "21 grassroots-fun batch 1: 13 indie Etsy items (candles, pins, stickers, magnets, tees) — Smells Like F*ck Trump candle, Light Me When He's Dead, MeloraTShirts Big Beautiful Obituary, Let's Go Blood Clot stickers, 3D-printed FUCK TRUMP pin, 86 47 pin, Grumpy Cat First-Of-All pin, Epstein Files pin, RESIST Tesla T decal, Elon-was-crazy magnet, Peace President My Ass candle, Worst President Since Trump pin, Tired Democrat Activist sticker. Plus 5 content-creator boosts (Randy Rainbow, Secret Handshake game, Songs for Liberation, TACO meme, Hamburg Trump opera) and 3 craftivism cards (Subversive Cross Stitch, Badass Cross Stitch, Craftivist Collective).",
          "5 grassroots-fun batch 2 addendum: Dissent Pins full collection (incl. Swastikar), Resistance Knitters on Bluesky, Feline & Floss free anti-ICE cross-stitch pattern, Fresh Prints anti-Trump resistance coloring book, Indivisible \"Honk to Dump Trump / Trump ❤️ Epstein\" overpass banner drops.",
          "12 grassroots-fun batch 3: \"Unpaid Protester Hating For Free\" pin, Crows Against Kings pin, Suburban Housewives Against Trump buttons, 8647 Floral pin, four Shannon Downey/Badass Cross Stitch tutorials (Abolish ICE pin, anti-Trump voodoo doll, Joyful Menace Society, Yay! flag), Subversive Cross Stitch No Kings PDF, Tom Morello at NYC anti-ICE, This Hour Has 22 Minutes Trump sketch, Iranian embassy AI memes via CNN.",
          "Image scraping pipeline: Etsy product photos via Chrome MCP; LinkTree and Ko-fi OG via curl; TikTok and Instagram via the microlink third-party preview service (with the known caveat that TikTok/IG CDN URLs carry signed expirations — fallbacks render gracefully when they age out).",
        ],
      },
      {
        heading: "Avatar fallback fix",
        items: [
          "New shared UserAvatar component swaps to an initial-letter circle when the avatar URL fails to load — Google profile pictures rotate URLs aggressively and were rendering as Chrome's torn-paper broken-image icon. Also adds referrer-policy=\"no-referrer\" which fixes the most common cause (Google 403s on unexpected referrer headers) before the fallback even fires. Applied to the Admin Panel user list, the per-user detail drawer, and the top-nav profile button.",
        ],
      },
      {
        heading: "Carry-over from 0.9.0 — already shipped",
        items: [
          "Everything in 0.9.0 (Approve All, site-updating banner, auto-shared Smacks, My Tier Dashboard overhaul, tier color ramp, Facts hero intro, time-commitment badges, category dedup, new Smacks, 24 action cards) and 0.8.0 (admin user dashboards, full-screen fireworks, XSS-safe URLs, Push-back-on-Facts, faster loading) is in 1.0 as well. See the entries below for details.",
        ],
      },
    ],
  },
  {
    version: "0.9.0",
    date: "2026-05-17",
    title: "Site-updating banner, Approve All, auto-shared Smacks, My Tier Dashboard overhaul, and tier color ramp",
    sections: [
      {
        heading: "Admin: Approve All button",
        items: [
          "A green '✓ Approve all N showing' button now appears in the pending-only banner — one click approves every card currently visible after your filters are applied.",
          "If you've filtered by category or location first, only those cards get approved — not the entire queue. The count in the button updates live as you filter.",
        ],
      },
      {
        heading: "Admin: Site-updating banner",
        items: [
          "New toggle in the admin dropdown: '🔧 Show updating banner' — flip it on before a deploy and a full-width navy banner appears for all visitors: 'SITE UPDATING — PLEASE BE PATIENT (2 minutes!)'.",
          "Flip it off after the deploy and the banner disappears. State is stored in the database so it survives page refreshes and is visible to every user immediately.",
          "Button shows an orange 'ON' badge and changes label to 'Turn off updating banner' so you always know if it's live.",
        ],
      },
      {
        heading: "The Smacks — auto-shared tracking",
        items: [
          "No more manual 'I shared it' button. The moment you click any share destination (Facebook, Bluesky, Threads, X, Instagram, Pinterest, Reddit, Tumblr, Download, or Copy image), the card is automatically marked as Shared.",
          "A green '✓ Shared' badge replaces the Share button on the card tile — so your history is accurate without you having to remember to tap anything.",
          "Boost button moved from the card footer to the same bottom-left image-overlay position it occupies on action cards — consistent across both tabs.",
        ],
      },
      {
        heading: "My Tier Dashboard — redesigned",
        items: [
          "Renamed from 'My Tier' to 'My Tier Dashboard' everywhere.",
          "Tier rows are now compact enough that the whole ladder, progress bar, and scoreboard fit on a phone screen without scrolling.",
          "Tier names are styled in their own color against white — Spark is now legible (was washed out against the white modal background).",
          "Tier ladder removed from the profile dropdown — the progress bar and 'N acts done' label are enough there; the full ladder lives in the modal.",
          "Pending Acts and Pending Smacks items in the dropdown are now gray (same as other items) instead of red — the red badge numbers still flag the count.",
        ],
      },
      {
        heading: "Tier color overhaul",
        items: [
          "All six tiers now flow through a single orange ramp: Spark (gold), Ember (soft orange), Flame (bright orange), Blaze (deep orange), Wildfire (burnt orange), Inferno (dark rust).",
          "A separate 'label color' is now used when tier names appear as text on white backgrounds, so every tier name is legible at any size.",
          "Action count badge on the avatar changed from red to navy — less alarming, more on-brand.",
        ],
      },
      {
        heading: "The Facts — hero intro panel",
        items: [
          "The Facts tab now opens with an intro panel identical in style to The Smacks hero — explains what a Fact is and why pre-loaded rebuttals matter.",
        ],
      },
      {
        heading: "Tier progress language",
        items: [
          "The standalone action count in the profile dropdown now reads '26 acts done' instead of a bare number.",
          "'N more actions to reach…' now reads 'N more acts to reach…' throughout the tier progress bar and modal.",
        ],
      },
      {
        heading: "Quick Match — completed cards excluded",
        items: [
          "The Quick Match carousel no longer shows actions you've already completed — they're filtered out at pick-time so every slot is a fresh opportunity.",
        ],
      },
      {
        heading: "Time-commitment badge on cards",
        items: [
          "Action cards now display a time-commitment badge so you can see '5–10 min' or '~1 hr' at a glance without opening the card.",
          "All 'Cancel your…' subscription cards confirmed at 5–10 minutes.",
        ],
      },
      {
        heading: "Category filter deduplication",
        items: [
          "Six category filters had mixed-case duplicates (e.g. 'Boycott' and 'BOYCOTT' both appeared as separate chips). All categories are now stored as uppercase — BOYCOTT, PROTEST, PETITION, LETTER WRITING, CRAFTING, SPREAD POSITIVITY — so each filter chip is unique.",
        ],
      },
      {
        heading: "New Smacks",
        items: [
          "'Gas Prices' added to The Smacks with Economy / Trump / MAGA tags.",
        ],
      },
      {
        heading: "New action cards",
        items: [
          "19 ICE / detention / Iran-war response cards seeded: Tesla divestment guide, NDLON Adopt-A-School + Adopt-A-Corner, Bay Area rapid-response training, Seattle Federal Building Fridays, Sabey Corp ICE-lease picket (Tukwila), De-ICE Citizens Bank national day of action, Indivisible Harlem Know-Your-Rights canvass, ICE Out For Good Greenwich canvass, NELA monthly meeting (LA), El Refugio Stewart Detention visitation (GA), First Friends Elizabeth Detention visitation (NJ), RAICES Texas donate, NBFN Immigration Bond + Pretrial Bail funds, and NDLON Immigrant Defense Fund.",
          "5 addendum grassroots-fun cards: Dissent Pins full collection, Resistance Knitters Bluesky group, Feline and Floss free anti-ICE cross-stitch pattern, Fresh Prints anti-Trump coloring book, and Indivisible 'Honk to Dump Trump / Trump ❤️ Epstein' overpass banner drops.",
        ],
      },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-05-17",
    title: "Admin user dashboards, full-screen fireworks on \"I did this\", XSS-safe URLs, Push-back-on-Facts, faster loading",
    sections: [
      {
        heading: "Admin: see active users + their tier + recent activity",
        items: [
          "Users tab in the Admin Panel now defaults to a new \"Active\" filter showing anyone who's marked an action done in the last 30 days, sorted by most-recently-active first.",
          "Every user row gains a color-coded tier chip (Spark / Ember / Flame / Blaze / Wildfire / Inferno), total action count, and \"active 3d ago\" relative timestamp inline — no click required to spot your power users vs. lapsed accounts.",
          "Click any user row to open a per-user dashboard drawer: their tier badge with a progress bar to the next tier, a by-category breakdown chip cloud (BOYCOTT 3 / PETITION 7 / etc.), and a reverse-chronological timeline of their last 50 completed actions with titles and direct links.",
          "Backed by a new admin-only endpoint that batch-aggregates completion records — no per-row round-trips on the list view.",
        ],
      },
      {
        heading: "Fireworks when you hit \"I did this\"",
        items: [
          "Every fresh action completion triggers a viewport-wide fireworks display that bleeds well past the modal edges: vertical rocket-trail launch streaks rise from below before each explosion, six burst origins scattered across the screen fire ~360 particles total with gravity-arc keyframes (peak → hang → drift down), every particle carries a 4-layer luminous glow, and ~18% of particles are sparklers that twinkle on/off as they fall. Plus a 130-piece confetti storm raining from above.",
          "Tier-up moments (Spark → Ember, Ember → Flame, etc.) get a dramatically bigger show: three waves of bursts across 14 origins (~700+ particles), 200-piece confetti storm, full-screen radial flash in the new tier's color, and particles fly nearly twice as far. Unmistakably different from a regular completion.",
          "Distance to the next tier is framed in human time: \"1 more,\" \"one a day this week,\" \"about a month at one a day\" — instead of just a raw number.",
          "Modal background is now fully opaque (earlier draft had a see-through gradient that competed with the action grid behind). Un-doing a completion does NOT retrigger fireworks. Esc / backdrop / Close button all dismiss earlier.",
        ],
      },
      {
        heading: "Share-button focus fix (Spread the Word)",
        items: [
          "Fixed a bug where clicking Bluesky / Threads / X on the Spread-the-Word modal could leave Facebook on top — because the Facebook share opened a popup window while the others opened tabs, and the OS kept the FB popup above subsequent tabs.",
          "All share buttons now open as regular tabs with a stable per-platform window name, so re-clicking the same platform reuses its tab instead of stacking duplicates, and the newly-clicked tab gets focused reliably.",
        ],
      },
      {
        heading: "Faster loading",
        items: [
          "First-page action cards are now cached locally — returning visitors see ~100 cards on first paint instead of waiting for the server round-trip.",
          "First-time visitors now see skeleton placeholders while the live cards load, instead of a single lonely fallback card.",
          "The Smacks tab no longer ships a duplicate search bar — search lives in the top nav only.",
        ],
      },
      {
        heading: "Push back on The Facts — pre-written comments to paste",
        items: [
          "New Push back button on every fact card opens a modal with three pre-formatted comment versions you can paste onto someone else's social-media post. (Earlier draft labeled this \"Reply\" — replaced because the click prepares ammo for elsewhere, not a reply on ResistAct.)",
          "Short (X / Bluesky), Conversational (Threads / LinkedIn / Reddit), and With receipts (Instagram / Facebook / long-form) — each shows a live character count.",
          "One-click copy for each version, plus a Copy link button for just the source URL. The modal does not post anywhere — you paste it yourself.",
        ],
      },
      {
        heading: "The Smacks tab — sharper intro",
        items: [
          "New intro panel at the top of The Smacks explains what a Smack is and why we use them — cartoon-villain administration, cartoon-simple responses.",
          "Location and Category filters removed from The Smacks tab — they only ever applied to action cards. Tag chips inside the page do the real filtering.",
        ],
      },
      {
        heading: "Quick time stop — 5–10 minutes",
        items: [
          "Matcher slider gains a new \"A few minutes — 5–10 min\" stop between Quick wins and Light touch.",
          "Add an Action and Edit Card pickers get the matching stop so planners can mark a card as 5–10 minutes.",
          "Existing petition cards have been bulk-relabeled to 5–10 minutes (and the legacy quickAction shortcut stripped) so the matcher classifies them correctly.",
        ],
      },
      {
        heading: "New action cards",
        items: [
          "5 more grassroots-fun cards in the addendum batch: Dissent Pins full collection (including the Swastikar Tesla pin), Resistance Knitters Bluesky group, Feline and Floss free anti-ICE cross-stitch pattern (Ko-fi), Fresh Prints anti-Trump resistance coloring book (Etsy), and Indivisible chapter \"Honk to Dump Trump / Trump ❤️ Epstein\" overpass banner drops.",
          "21 grassroots-fun cards: 13 indie Etsy items (candles, pins, stickers, magnets, tees — \"Smells Like F*ck Trump\" candle, \"Light Me When He's Dead\" No Kings candle, \"Big Beautiful Obituary\" tee (MeloraTShirts), \"Let's Go Blood Clot\" stickers, 3D-printed \"FUCK TRUMP\" lapel pin, \"86 47\" decode-the-numbers pin, Grumpy-Cat-with-mug pin, \"Epstein Files Protest\" pin, RESIST-Tesla-T-badge decal, \"I Bought This Before We Knew Elon Was Crazy\" magnet, \"Peace President, My Ass!\" candle, \"Worst President Since Trump\" recursive pin, \"Tired Democrat Activist\" sticker), plus 5 content-creator boosts (Randy Rainbow TikTok, \"Secret Handshake\" Iran-war satirical game, Songs for Liberation ICE-facility singing flash mob, the \"TACO\" meme, Trump Parody Opera in Hamburg), and 3 craftivism cards (Subversive Cross Stitch, Badass Cross Stitch, Craftivist Collective \"gentle protest\" mini-banners).",
          "19 cards from the earlier May 17 spreadsheet load — focused on ICE / detention / Iran-war response: Tesla divestment guide, NDLON's Adopt-A-School + Adopt-A-Corner (volunteers stand watch at ICE pickup spots), Bay Area rapid-response training, Seattle Federal Building Fridays, Sabey Corp ICE-lease picket (Tukwila), Indivisible Highlands honk-and-waves, De-ICE Citizens Bank national day of action, Indivisible Harlem Know-Your-Rights canvass (NYC), ICE Out For Good Greenwich canvass, NELA monthly meeting (LA), Indivisible LA Home Depot boycott, Indivisible Westside LA weekly NO WARS protest, El Refugio Stewart Detention visitation (GA), First Friends Elizabeth Detention visitation (NJ), RAICES Texas donate, NBFN Immigration Bond + Pretrial Bail funds, and NDLON Immigrant Defense Fund.",
          "Seven rows from the same spreadsheet were skipped as exact-URL duplicates of cards already in the database.",
          "7 new email-campaign cards from the Religious Action Center of Reform Judaism: Environmental Justice for All Act, FAMILY Act paid leave, gun-violence package, hate-crime reporting (IRPHA), West Bank Violence Prevention Act, state LGBTQ+ protections, and H.R. 40 reparations commission.",
          "4 new indie Etsy anti-Trump merch cards under Irreverence: a \"Big Beautiful Obituary\" tee (TeeTaniumCo), a \"When It Happens\" wine label (UncorkedLabels), a \"President and Dumb Should Be Different People\" tee (TeeGeekBoutique), and a \"Go Back, We Screwed Up\" evolution tee (PrintfulApparelUS).",
          "22 local and regional action cards: Indivisible chapter protests, Know Your Rights canvasses, ICE rapid-response signups, crafting parties, and frontline-org donate links — spanning Washington, California, New York, Illinois, Delaware, Maryland, Florida, and DC. All pending admin image review before going public.",
          "24 more action cards from Mobilize and 50501: national online actions (War Powers Resolution letter, 50501 virtual hub, Indivisible ICE petitions), local protests and banner drops in Beverly MA, Joplin MO, Fort Myers FL, Portland OR, Vancouver WA, Tacoma WA, Palo Alto CA, and Seattle neighborhoods, plus NDLON Adopt-A-School, El Refugio volunteering in Georgia, Mijente's #NoTechForIce campaign, Fremont CA rapid-response training, and the Let's Get Free! DC march on July 9.",
        ],
      },
      {
        heading: "XSS guard on card URLs",
        items: [
          "The create / edit / approve endpoints now reject `targetUrl`, `authorLink`, and `topImageUrl` values whose scheme isn't in the http / https / mailto / sms / tel allowlist. Closes a stored-XSS path where a `javascript:` URL on the action link could have executed in a user's browser after admin approval.",
          "Text fields (title, description, author name, etc.) were already safe — they render through React JSX which auto-escapes every special character. A QA tester's `<script>...</script>` paste was harmless on display, but the test surfaced the URL-field gap that's now closed.",
        ],
      },
      {
        heading: "No more imageless cards leaking to the public",
        items: [
          "Any card without a header image is now automatically held in the admin review queue — the server now refuses to mark such a card as approved.",
          "Existing cards that slipped through (mostly admin-added TikTok-tag follow cards and volunteer-org cards) have been demoted to pending until a header image is uploaded.",
        ],
      },
      {
        heading: "Tier thresholds lowered",
        items: [
          "All six tiers now require significantly fewer actions: Ember at 3 (was 5), Flame at 10 (was 20), Blaze at 25 (was 75), Wildfire at 50 (was 200), Inferno at 100 (was 500).",
          "The tier ladder in the How It Works modal and the My Tier panel update automatically.",
        ],
      },
      {
        heading: "Small fixes",
        items: [
          "Matcher slider labels tightened: \"~30 min / month\" and \"~1 hr / month\" now read just \"~30 min\" and \"~1 hr\" (and \"~1 day / month\" → \"~1 day\").",
          "Desktop tab switcher (The Acts / The Facts / The Smacks) tightened horizontally so the pill takes less place in the top bar.",
          "Trimmed the static-fallback card list down to a single safety-net card now that the live store reliably owns the catalog.",
          "Facebook Smacks share now copies the image to your clipboard instead of downloading it — paste directly into your Facebook post with ⌘V or Ctrl+V. A blue instruction banner guides you through the step. Falls back to a file download if the clipboard API is unavailable.",
        ],
      },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-05-16",
    title: "How It Works overhaul, tier icon upgrades, scoreboard in My Tier, and four new Smacks",
    sections: [
      {
        heading: "How Does ResistAct Work — redesigned",
        items: [
          "Intro paragraph rewritten to be shorter and more direct.",
          "Each bullet now runs inline — the bold title flows straight into the body copy without a line break.",
          "Added a fifth bullet: 'Read The Facts. Share The Smacks.' explaining both tabs to new visitors.",
          "Left-side icons now use a gradient of blues (lightest to darkest navy) plus ResistAct orange for the final item, all with white icons.",
          "Right panel shows the full Kroger photo with the tier ladder as a frosted-glass overlay across the lower portion of the image.",
          "Tier ladder text contrast improved: Spark name lightened for readability on white, taglines and range numbers darkened.",
        ],
      },
      {
        heading: "Tier icon upgrades",
        items: [
          "Ember now uses the FlameKindling icon (flame with logs) to distinguish it from plain Flame.",
          "Blaze now uses a solid filled flame, visually heavier than the Ember and Flame outline icons.",
          "Wildfire shows two overlapping flames; Inferno shows three — outer flames at 80% opacity so the cluster reads as a group.",
          "Inferno icon color fixed to pure white (was a faint pink that was hard to see on the dark maroon background).",
        ],
      },
      {
        heading: "Scoreboard moved into My Tier",
        items: [
          "Per-category action breakdown ('Your scoreboard') removed from the profile dropdown and moved inside the My Tier modal.",
          "Profile dropdown is now cleaner — tier progress mini-bar leads directly to the My Tier button.",
        ],
      },
      {
        heading: "New Smacks",
        items: [
          "Five previously unwired images now appear in The Smacks: ResistAct, Epstein, Project 2025, Voting Rights, and Epstein Redactions.",
        ],
      },
      {
        heading: "Action cards",
        items: [
          "\"Did it!\" button renamed to \"DONE!\" — same checkmark, clearer language.",
          "Three Common Cause petition cards added: rejecting Trump's 'War First, People Last' budget, defunding ICE and Trump's ballroom, and blocking Trump's mail-voting executive order.",
        ],
      },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-05-16",
    title: "The Smacks, gamification tiers, revamped Add an Action, and a wave of polish",
    sections: [
      {
        heading: "The Smacks — new tab",
        items: [
          "Brand-new 'The Smacks' tab: a library of shareable political images you can post directly to Instagram, Threads, Bluesky, Twitter, and more.",
          "Share buttons added for Instagram, Threads, and Bluesky across the platform.",
          "Card grid layout redesigned for a cleaner, more visual feel.",
          "Admin tools: approve, delete, and review pending smacks from the admin panel.",
          "Smack count shown in the Navbar stats bar alongside acts and facts counts.",
        ],
      },
      {
        heading: "Resistance Tiers — gamification",
        items: [
          "Your avatar is now a flame icon that reflects your tier level — Spark, Ember, Flame, Blaze, Wildfire, or Inferno.",
          "Six tiers based on total actions completed: 0–4 (Spark) through 500+ (Inferno), with escalating colors from yellow to deep red.",
          "Tier progress bar and next-tier countdown visible in your dropdown menu.",
          "Tap 'My Tier' in your profile dropdown to see the full tier ladder.",
          "Action count displayed in a red badge on your avatar.",
        ],
      },
      {
        heading: "Add an Action — revamped",
        items: [
          "Restructured into a cleaner 4-step flow: category → details → image & URL → author & tone.",
          "Author name and role now have their own dedicated step.",
          "URL health scanning: submission flags broken or redirecting links automatically.",
          "Any signed-in user can now upload a header image directly from their computer.",
          "Header image upload moved after the sign-in step so uploads always have an authenticated session.",
        ],
      },
      {
        heading: "Matching & feed",
        items: [
          "Pending cards are now shown to admins in Match Me results even when they fall below the score threshold — so new cards get reviewed in context.",
          "Carousel now always fills to 12 matches with a secondary fallback when preferences are very narrow.",
        ],
      },
      {
        heading: "Admin panel",
        items: [
          "Pending card count in the Cards tab no longer flickers through intermediate numbers while loading — count appears only when fully loaded.",
          "Image lightbox added to the Edit Card modal — click the header image preview to see it full-size.",
          "Warning badge added to pending cards where the author URL appears to be a homepage rather than a direct action link.",
          "Scoreboard in the user dropdown is now collapsed by default — click to expand.",
        ],
      },
      {
        heading: "Polish & fixes",
        items: [
          "Card buttons renamed from 'Take this action' to 'I want to ResistAct!'",
          "Tone sliders now show 4 labeled stops with plain-English descriptions (None / Low / Bold / High) instead of unlabeled notches.",
          "Match Settings accessible from the navbar and hero area — no need to re-open the full Match Me flow.",
          "InfoModal no longer overflows on small screens.",
          "Autocomplete disabled on form inputs to prevent browser autofill interfering with card fields.",
        ],
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-05-12",
    title: "Smarter matching, location rename, modal polish, and UI fixes",
    sections: [
      {
        heading: "Quick Matches for Me",
        items: [
          "Hero panel button renamed to 'Quick Matches for Me'.",
          "Carousel expanded to 12 matches (up from 10).",
          "When you pick 'Both equal' location, the 12 slots are now split 50/50 online vs. in-person — no more 11/12 online results.",
          "'Show me all my matches' now applies a score floor (30% of the top match) so you see genuine matches instead of all 396 cards re-sorted.",
          "Targeted group checkboxes display in two columns so the list is half the height.",
          "Page 2 footer (Back / Show me my matches) is pinned below the scrollable content — no more white gap at the bottom.",
          "Clicking a targeted-group checkbox no longer collapses the dropdown and blanks the modal.",
        ],
      },
      {
        heading: "Location filter",
        items: [
          "'Online' renamed to 'Remote', 'From Home' renamed to 'At Home', 'Multi-state' renamed to 'Multi-State' — consistent with how people actually talk about these options.",
          "Existing cards with the old location strings continue to filter and display correctly (backward-compatible mapping).",
          "The Add-an-Action and Edit-card location dropdowns use the same new names.",
        ],
      },
      {
        heading: "Add an Action modal",
        items: [
          "ResistAct fist logo added to the header; 'Make an ASK' label removed.",
          "Title field moved above Category so the most important field comes first.",
        ],
      },
      {
        heading: "Admin panel",
        items: [
          "Edit button added to each pending card's approval row — opens the full edit modal inline.",
          "Version badge and changelog link are now visible to admin users only.",
          "Spread the Word card is excluded from the 'cards without URLs' admin list.",
          "95 existing cards had their URL migrated from the authorLink field into the proper targetUrl field.",
        ],
      },
      {
        heading: "Bug fixes & polish",
        items: [
          "Spread the Word card always shows the correct description regardless of what's stored in the database.",
          "Category filter '+ N more' dropdown is no longer clipped by the navbar's overflow-hidden container.",
          "All native select dropdowns now have right padding so the browser chevron doesn't crowd the text.",
          "Compact carousel cards (Quick Match strip) no longer show the flame / share button.",
          "Modal titles across Match Me, Add an Action, and Info are all styled consistently (bold, navy, 20px).",
        ],
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-05-12",
    title: "Quick Match carousel, smarter slider layout, unified 'How It Works' modal",
    sections: [
      {
        heading: "Quick Match Tool",
        items: [
          "Now surfaces 10 matches instead of 4 — browse them 4 at a time with Prev / Next carousel navigation and dot indicators.",
          "Sliders reset the carousel to page 1 automatically so your freshest top picks are always shown first.",
          "Admin-highlighted cards (⭐ HIGHLIGHTED in the admin panel) get a +7 scoring boost so your curated picks reliably appear in Quick Matches.",
          "Time Commitment expanded from 4 to 6 stops: Quick wins → Light touch → Some effort → Regular → Committed → All in.",
          "Time Commitment slider runs full width above the two-column grid, with 'Quick wins' and 'All in' labels flanking the track.",
          "Location preference replaced the pill buttons (Remote / In-person / Both) with a 4-stop slider: Remote only → Mostly Remote → In-person → Both equal.",
          "'Where are you?' state picker moved to the Sharpen Your Matches page and restyled to match that page's layout.",
          "Footer buttons redesigned as two-line stacked cards: 'These Matches Look Good! / Show Me More' and 'Sharpen your matches / Tell us more about who you are'.",
          "'What kind of actions are you up for?' is now a subtitle under the Quick Match Tool heading rather than a standalone section title.",
          "ResistAct fist logo added to the Quick Match Tool header.",
          "'Not a good match' renamed to 'Not a great match'.",
        ],
      },
      {
        heading: "How Does ResistAct Work modal",
        items: [
          "Logo click, Mead quote click, and the 'How This Works' hero pill all open the same modal — no more duplicate modals.",
          "Rewritten to blend the emotional mission statement with the structured how-it-works explainer.",
          "Two-column 50/50 layout: steps with icons on the left, Kroger Baby Trump photo on the right.",
          "ResistAct fist logo added to the modal header.",
          "'Pick what fits your day' icon is pink to distinguish it from the orange brand color.",
        ],
      },
      {
        heading: "Card improvements",
        items: [
          "'Read more →' on the Spread the Word card now matches the font size of other cards.",
          "Spread the Word 'Read more' modal now includes a 'Spread the Word!' action button that launches the share flow.",
          "Card details modal updated to accept an optional share callback for pinToTop cards.",
        ],
      },
      {
        heading: "Navigation",
        items: [
          "ResistAct logo in the navbar is now a clickable button — opens the How It Works modal.",
        ],
      },
    ],
  },
  {
    version: "0.2.1",
    date: "2026-05-12",
    title: "Quick Match Tool polish, brand-aligned join CTA, calmer visuals",
    sections: [
      {
        heading: "Quick Match Tool",
        items: [
          "Renamed from 'What's your fit today?' to 'Quick Match Tool'.",
          "Four sample matches (up from three) and they're now visually distinct — no two cards in the strip share the same image.",
          "Slot 1 is always 'Spread the Word about ResistAct' until you mark it done — easy first action that grows the community.",
          "Setting picker + state field share one row above the sliders for a tighter top half.",
          "Sliders moved to a two-column layout to halve vertical scroll, with calmer type weight and indented under the section heading.",
          "Card descriptions in the preview clamp to 2 lines + a right-aligned italic 'Read more →' so the modal doesn't jump as you slide.",
          "'Not a good match' buttons get an orange outline and a monochrome thumbs-down icon (no more yellow emoji).",
          "Card heights locked to a stable 240px so the modal stops jumping around when you drag sliders.",
        ],
      },
      {
        heading: "Decisions made clearer",
        items: [
          "Donation-focus question defaults to 'Yes — show me high-leverage races' so people don't miss it.",
          "Donation toggle buttons stacked title + subtitle for legibility.",
          "Two final CTAs on the modal's last page: an outline 'Show me all my matches → no sign up required' and a filled '#jointheresistance → Sign up to save your match settings.'",
          "Privacy footnote uses a modern lock icon (instead of a starred *) and is tucked under the buttons in a single right-aligned block.",
        ],
      },
      {
        heading: "Brand consistency",
        items: [
          "Navbar 'Join the Resistance' CTA adopts the same #jointheresistance two-line treatment used in the modal — sign-up reason explicit on the button.",
          "Spread the Word card never shows a boost button (you can't boost the share-this-site card on behalf of yourself).",
        ],
      },
      {
        heading: "Visual rest",
        items: [
          "Less bold, less navy. Most headings demoted to dark-gray semibold so the modal stops shouting.",
          "'Read more →' links across all cards are now right-aligned and italic (was left-aligned and bold).",
          "Subtitle removed under the modal title — the title is enough.",
        ],
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-05-12",
    title: "Quick Matches overhaul, completed-cards-stay-visible, safer privacy posture",
    sections: [
      {
        heading: "Quick Matches for My Mood (overhauled)",
        items: [
          "Two-step modal instead of three — almost everything on the first page.",
          "Sample matches show as real card previews (side-by-side) instead of a text list.",
          "Setting + state moved up front; state field only appears when in-person is on the table.",
          "Live replacement: tap 'Not a good match' and the next-best candidate slides in.",
          "Tone sliders renamed for clarity (Time Commitment, Confrontational, Humorous, Subversive, Hopeful, Motivation) and laid out horizontally so they take less vertical space.",
          "New optional question: laser-focused donation guidance for high-leverage midterm races.",
        ],
      },
      {
        heading: "Feed",
        items: [
          "Completed actions now stay visible but sort to the bottom of every view (instead of being hidden).",
          "'Today's Five' strip removed — Quick Matches replaces it as the on-ramp for new visitors.",
        ],
      },
      {
        heading: "Identity & safety",
        items: [
          "Reframed the targeted-group question from 'Are you part of…' to 'Do you want to focus on…' — about action focus, not personal identity. We no longer collect identity data.",
          "Personal-risk down-ranking removed. The sliders already steer risk-averse users away (low Confrontational + low Motivation + Remote = a safe feed).",
          "Universal '⚠ In-person — know your rights' chip on PROTEST and FLASH MOB cards, linking to ACLU's protesters' rights guide.",
        ],
      },
      {
        heading: "Admin",
        items: [
          "Time commitment now saves correctly when editing a card (previously stuck on '5 min' if the card had been quickAction).",
          "'TODAY'S 5' admin badge renamed to 'HIGHLIGHTED'.",
          "TikTok and YouTube cards now use proper high-res logos instead of low-res scraped OG images.",
        ],
      },
      {
        heading: "Other",
        items: [
          "Hero CTA renamed: 'Match Me with Acts' → 'Quick Matches for My Mood'.",
          "'At home' setting option merged into 'Remote' (they were functionally identical).",
          "'Any' option renamed to 'Both'.",
          "Bottom-left version badge is now a clickable link to this changelog.",
        ],
      },
    ],
  },
];
