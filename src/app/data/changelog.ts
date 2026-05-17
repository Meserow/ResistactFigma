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
          "7 new email-campaign cards from the Religious Action Center of Reform Judaism: Environmental Justice for All Act, FAMILY Act paid leave, gun-violence package, hate-crime reporting (IRPHA), West Bank Violence Prevention Act, state LGBTQ+ protections, and H.R. 40 reparations commission.",
          "4 new indie Etsy anti-Trump merch cards under Irreverence: a \"Big Beautiful Obituary\" tee (TeeTaniumCo), a \"When It Happens\" wine label (UncorkedLabels), a \"President and Dumb Should Be Different People\" tee (TeeGeekBoutique), and a \"Go Back, We Screwed Up\" evolution tee (PrintfulApparelUS).",
          "22 local and regional action cards: Indivisible chapter protests, Know Your Rights canvasses, ICE rapid-response signups, crafting parties, and frontline-org donate links — spanning Washington, California, New York, Illinois, Delaware, Maryland, Florida, and DC. All pending admin image review before going public.",
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
          "Brand-new “The Smacks” tab: a library of shareable political images you can post directly to Instagram, Threads, Bluesky, Twitter, and more.",
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
          "Tap “My Tier” in your profile dropdown to see the full tier ladder.",
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
          "Hero panel button renamed to “Quick Matches for Me”.",
          "Carousel expanded to 12 matches (up from 10).",
          "When you pick “Both equal” location, the 12 slots are now split 50/50 online vs. in-person — no more 11/12 online results.",
          "“Show me all my matches” now applies a score floor (30% of the top match) so you see genuine matches instead of all 396 cards re-sorted.",
          "Targeted group checkboxes display in two columns so the list is half the height.",
          "Page 2 footer (Back / Show me my matches) is pinned below the scrollable content — no more white gap at the bottom.",
          "Clicking a targeted-group checkbox no longer collapses the dropdown and blanks the modal.",
        ],
      },
      {
        heading: "Location filter",
        items: [
          "“Online” renamed to “Remote”, “From Home” renamed to “At Home”, “Multi-state” renamed to “Multi-State” — consistent with how people actually talk about these options.",
          "Existing cards with the old location strings continue to filter and display correctly (backward-compatible mapping).",
          "The Add-an-Action and Edit-card location dropdowns use the same new names.",
        ],
      },
      {
        heading: "Add an Action modal",
        items: [
          "ResistAct fist logo added to the header; “Make an ASK” label removed.",
          "Title field moved above Category so the most important field comes first.",
        ],
      },
      {
        heading: "Admin panel",
        items: [
          "Edit button added to each pending card's approval row — opens the full edit modal inline.",
          "Version badge and changelog link are now visible to admin users only.",
          "Spread the Word card is excluded from the “cards without URLs” admin list.",
          "95 existing cards had their URL migrated from the authorLink field into the proper targetUrl field.",
        ],
      },
      {
        heading: "Bug fixes & polish",
        items: [
          "Spread the Word card always shows the correct description regardless of what's stored in the database.",
          "Category filter “+ N more” dropdown is no longer clipped by the navbar's overflow-hidden container.",
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
          "Renamed from “What's your fit today?” to “Quick Match Tool”.",
          "Four sample matches (up from three) and they're now visually distinct — no two cards in the strip share the same image.",
          "Slot 1 is always “Spread the Word about ResistAct” until you mark it done — easy first action that grows the community.",
          "Setting picker + state field share one row above the sliders for a tighter top half.",
          "Sliders moved to a two-column layout to halve vertical scroll, with calmer type weight and indented under the section heading.",
          "Card descriptions in the preview clamp to 2 lines + a right-aligned italic “Read more →” so the modal doesn't jump as you slide.",
          "“Not a good match” buttons get an orange outline and a monochrome thumbs-down icon (no more yellow emoji).",
          "Card heights locked to a stable 240px so the modal stops jumping around when you drag sliders.",
        ],
      },
      {
        heading: "Decisions made clearer",
        items: [
          "Donation-focus question defaults to “Yes — show me high-leverage races” so people don't miss it.",
          "Donation toggle buttons stacked title + subtitle for legibility.",
          "Two final CTAs on the modal's last page: an outline “Show me all my matches → no sign up required” and a filled “#jointheresistance → Sign up to save your match settings.”",
          "Privacy footnote uses a modern lock icon (instead of a starred *) and is tucked under the buttons in a single right-aligned block.",
        ],
      },
      {
        heading: "Brand consistency",
        items: [
          "Navbar “Join the Resistance” CTA adopts the same #jointheresistance two-line treatment used in the modal — sign-up reason explicit on the button.",
          "Spread the Word card never shows a boost button (you can't boost the share-this-site card on behalf of yourself).",
        ],
      },
      {
        heading: "Visual rest",
        items: [
          "Less bold, less navy. Most headings demoted to dark-gray semibold so the modal stops shouting.",
          "“Read more →” links across all cards are now right-aligned and italic (was left-aligned and bold).",
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
          "Live replacement: tap “Not a good match” and the next-best candidate slides in.",
          "Tone sliders renamed for clarity (Time Commitment, Confrontational, Humorous, Subversive, Hopeful, Motivation) and laid out horizontally so they take less vertical space.",
          "New optional question: laser-focused donation guidance for high-leverage midterm races.",
        ],
      },
      {
        heading: "Feed",
        items: [
          "Completed actions now stay visible but sort to the bottom of every view (instead of being hidden).",
          "“Today's Five” strip removed — Quick Matches replaces it as the on-ramp for new visitors.",
        ],
      },
      {
        heading: "Identity & safety",
        items: [
          "Reframed the targeted-group question from “Are you part of…” to “Do you want to focus on…” — about action focus, not personal identity. We no longer collect identity data.",
          "Personal-risk down-ranking removed. The sliders already steer risk-averse users away (low Confrontational + low Motivation + Remote = a safe feed).",
          "Universal “⚠ In-person — know your rights” chip on PROTEST and FLASH MOB cards, linking to ACLU's protesters' rights guide.",
        ],
      },
      {
        heading: "Admin",
        items: [
          "Time commitment now saves correctly when editing a card (previously stuck on “5 min” if the card had been quickAction).",
          "“TODAY'S 5” admin badge renamed to “HIGHLIGHTED”.",
          "TikTok and YouTube cards now use proper high-res logos instead of low-res scraped OG images.",
        ],
      },
      {
        heading: "Other",
        items: [
          "Hero CTA renamed: “Match Me with Acts” → “Quick Matches for My Mood”.",
          "“At home” setting option merged into “Remote” (they were functionally identical).",
          "“Any” option renamed to “Both”.",
          "Bottom-left version badge is now a clickable link to this changelog.",
        ],
      },
    ],
  },
];
