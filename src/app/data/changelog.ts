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
    version: "1.2.107",
    date: "2026-05-27",
    title: "Card subtitles: 313 cards rewritten for consistent 2-line length",
    sections: [
      {
        heading: "Card grid",
        items: [
          "Rewrote the italic subtitle on 313 cards so each one fills ~2 lines of text at the wide-desktop layout instead of being either one bare line (a location/date like 'Tukwila WA (May 29)') or a wall of three. Most rewrites kept the original punchy phrase intact and added the missing context — who runs it, what the format is, what action you actually take.",
          "Examples: the NoTechForIce card now reads 'Pressure Palantir, Amazon, and Microsoft to end ICE surveillance tools' instead of having no subtitle at all. 'Search any brand's political donations before you buy' now reads 'Database lookup for 7,000+ brands' political donations before you buy' instead of the bare 'Database lookup for 7,000+ brands'.",
          "Event-day protest cards now name the cause (e.g. 'Show up for Southend Indivisible's protest against ICE's expansion') instead of only showing the city and date.",
        ],
      },
    ],
  },
  {
    version: "1.2.106",
    date: "2026-05-28",
    title: "Hotfix: restored the orange 'But what can one person do?' line",
    sections: [
      {
        heading: "Hero",
        items: [
          "Reverted the previous hero font fix from `display=block` to `display=swap`. The block mode was hiding the orange handwritten line during its entire ~2.4s visibility window before the logo took over, so first-time visitors weren't seeing it at all. The preload + sans-serif fallback stay in place, so the script-font flash is still much briefer than before — just no longer hidden.",
        ],
      },
    ],
  },
  {
    version: "1.2.105",
    date: "2026-05-28",
    title: "Fixed the script-font flash on the hero headline",
    sections: [
      {
        heading: "Hero",
        items: [
          "Fixed the brief flash where 'But what can one person do?' would render in the system handwriting font (Apple Chancery / Snell Roundhand on Mac) before swapping to Rock Salt. The font now preloads during initial HTML parse, hides the text until Rock Salt is ready (up to 3s), and falls back to a neutral sans-serif instead of generic cursive if anything slips through.",
        ],
      },
    ],
  },
  {
    version: "1.2.104",
    date: "2026-05-27",
    title: "Card subtitles now cap at two lines",
    sections: [
      {
        heading: "Card grid",
        items: [
          "On the main feed and Quick Match preview, the italic subtitle under each card's title can no longer spill onto three or four lines. Anything longer than two lines now gets a trailing ellipsis instead of pushing the card taller than its neighbors. Cards line up cleanly across the grid again.",
        ],
      },
    ],
  },
  {
    version: "1.2.103",
    date: "2026-05-27",
    title: "Admin: read-only 'View as' impersonation",
    sections: [
      {
        heading: "Admin",
        items: [
          "New 'View as' button on every approved non-admin user in Admin Panel → Users. Click it and the app reloads the feed exactly as that user sees it — their Match Me preferences, their bookmarks, their day streak, their completed cards, their boosted cards. A persistent dark-blue banner at the top of the page makes it impossible to forget you're in view-as mode.",
          "Read-only. Boost, complete, bookmark, approve-card, Match Me edit, and 'Add an Act' are all disabled — they no-op with a toast saying 'View-as is read-only'. Anything you DO accidentally type still wouldn't write to the impersonated user's account because the underlying admin token is still yours.",
          "Click 'Exit' on the banner to drop back to your own view. Every start and end gets written to KV under `audit:impersonation:<adminId>:<targetId>:<timestamp>` so we have a trail. The impersonated user is NOT notified.",
          "Known limitations (intentional for v1): static smacks are still pencil-editable, the admin-panel button is still visible (so you can exit and re-enter), and submitting flag-a-card / feedback while impersonating works normally (it tags as you, not them). Future polish.",
        ],
      },
    ],
  },
  {
    version: "1.2.102",
    date: "2026-05-27",
    title: "Refine Your Matches: renamed modal + more obvious Next/Back buttons",
    sections: [
      {
        heading: "Quick Match Tool",
        items: [
          "Renamed the wizard from 'Quick Match Tool' to 'Refine Your Matches'.",
          "The Next and Back step-navigation buttons are now bold orange pill badges — thick orange border, wider padding, orange text — so it's impossible to miss where to go between the two wizard pages.",
        ],
      },
    ],
  },
  {
    version: "1.2.101",
    date: "2026-05-27",
    title: "Quick Match Tool: location & quick-filter row above category pills",
    sections: [
      {
        heading: "Quick Match Tool",
        items: [
          "Moved the Location control out of the slider grid and down to a compact row just above the category chip picker, matching the layout of the main page.",
          "Location now shows as a state dropdown on that same row. Two new quick-toggle pills — 'Prefer online' and '5 min max' — sit alongside it so you can instantly narrow your matches without adjusting the time slider.",
          "'Prefer online' toggles the remote-only setting on and off. '5 min max' caps results to quick under-5-minute actions. Both toggle back to defaults with a second click.",
        ],
      },
    ],
  },
  {
    version: "1.2.100",
    date: "2026-05-27",
    title: "Welcome email banner now ships with the function itself",
    sections: [
      {
        heading: "Onboarding",
        items: [
          "Real welcome emails were going out without the banner because the edge function was trying to fetch the JPEG from the live site, and the file only existed on develop (not yet on main / resistact.org). Embedded the banner bytes directly in the edge function code so the image always renders regardless of where the JPEG file has or hasn't been deployed.",
        ],
      },
    ],
  },
  {
    version: "1.2.99",
    date: "2026-05-27",
    title: "Admin: Missing Image tab back to zero — cartoon banners count as images",
    sections: [
      {
        heading: "Admin",
        items: [
          "Reverted an over-strict image check that was flagging 137 cards as missing images even though they all have cartoon banners. Any non-null cartoonImageUrl is correctly treated as a valid image again — the client resolves stale KV paths to the CDN via the cartoon manifest, so those cards are visually complete.",
        ],
      },
    ],
  },
  {
    version: "1.2.98",
    date: "2026-05-27",
    title: "Welcome email: banner now ships inline · new \"first time\" tip",
    sections: [
      {
        heading: "Onboarding",
        items: [
          "Welcome and waitlist emails now embed the ResistAct banner as an inline attachment instead of relying on the recipient's mail client to fetch it from resistact.org. Apple Mail's privacy proxy was refusing the external fetch, so banners weren't appearing for most Apple Mail users. With the inline attachment the image renders unconditionally.",
          "Rewrote the \"First time here?\" tip in the welcome email to point at the actual UI: \"Browse with the Category pills and set your Location at the top of the feed to see what fits. Then tap Refine Your Matches to dial it in by time, energy, and tone.\" Names match exactly what's on screen.",
        ],
      },
    ],
  },
  {
    version: "1.2.97",
    date: "2026-05-27",
    title: "Two card banners regenerated to fix nonsense text and off-topic art",
    sections: [
      {
        heading: "Visual polish",
        items: [
          "The \"Subscribe to actions\" card (Faithful America) was showing a banner with a misspelled protest sign that read \"SUBSCRITE TO ACTIONS.\" Replaced with a new banner — a young woman with a small cross necklace and a few fellow congregants in front of a stained-glass church. No more invented words.",
          "The \"Buy a Fifth Amendment Sticker or Magnet\" card (Dissent Pins) was showing a generic protester holding a blank orange sign, which didn't tell you the act was actually a sticker purchase. Replaced with a banner showing hands applying a sticker to a laptop, plus a bumper sticker and round magnet on a wood tabletop. Now reads clearly as merch.",
        ],
      },
    ],
  },
  {
    version: "1.2.96",
    date: "2026-05-27",
    title: "Welcome email logo now actually loads in Apple Mail",
    sections: [
      {
        heading: "Bug fix",
        items: [
          "Apple Mail's privacy proxy pre-fetches images via Apple servers, but doesn't follow 301 redirects. Our bare-apex resistact.org URL was 301-redirecting to www.resistact.org, so the proxy got a redirect and returned nothing — the inbox showed a missing-image placeholder where the banner should be. Switched the email template to hit www.resistact.org directly, bypassing the redirect.",
        ],
      },
    ],
  },
  {
    version: "1.2.95",
    date: "2026-05-27",
    title: "Admin: Missing Image tab now correctly flags 111 cards with broken cartoon paths",
    sections: [
      {
        heading: "Admin",
        items: [
          "The Missing Image tab was reporting zero broken cards even though 111 approved acts had a cartoon banner path pointing to the old local file location (not the CDN). The check now only counts a cartoon URL as valid if it's an absolute https:// URL — relative paths from before the CDN migration are treated as missing. The Missing Image tab will now show all 111 affected cards.",
        ],
      },
    ],
  },
  {
    version: "1.2.94",
    date: "2026-05-27",
    title: "Fix: cartoon banners missing on some cards after CDN move",
    sections: [
      {
        heading: "Bug fix",
        items: [
          "Some cards (like the Refuse Fascism march card) were showing a broken image placeholder despite having a cartoon banner. The cartoon URL stored in the database still pointed to the old local file path from before images moved to Supabase's CDN. The app now always prefers the CDN URL from the manifest over the stale database value, so all cartoon banners load correctly.",
        ],
      },
    ],
  },
  {
    version: "1.2.93",
    date: "2026-05-27",
    title: "Welcome and waitlist emails: branded redesign",
    sections: [
      {
        heading: "Onboarding",
        items: [
          "Both transactional emails (the welcome on approval and the application-received note on signup) now use a branded template with the ResistAct logo, navy headline, orange CTA button, and a short tip block. Plain-text fallback included for accessibility and clients that don't render HTML.",
          "Single shared template helper in the edge function so future emails (admin broadcasts, event notifications, etc.) can reuse the same look without duplication.",
        ],
      },
    ],
  },
  {
    version: "1.2.92",
    date: "2026-05-27",
    title: "Signup now always sends an email — welcome or waitlist",
    sections: [
      {
        heading: "Onboarding",
        items: [
          "Admin-allowlisted accounts (auto-approved on signup) now get the same welcome email that manually-approved users get. Previously these accounts slipped past the approval step and never received any email at all.",
          "Brand-new pending users now get a short \"we got your application\" email immediately on signup, so the signup flow doesn't feel like a black hole while they wait for an admin to approve them.",
        ],
      },
    ],
  },
  {
    version: "1.2.91",
    date: "2026-05-27",
    title: "Admin: Incomplete tab split into Missing URL and Missing Image",
    sections: [
      {
        heading: "Admin",
        items: [
          "The Incomplete tab is now two separate tabs — Missing URL (approved acts with no action link, with an inline URL field to fix them) and Missing Image (approved acts with no image, with a link to the act's destination so you can find a good image). Both currently show zero; the split makes it easier to triage each issue type independently going forward.",
        ],
      },
    ],
  },
  {
    version: "1.2.90",
    date: "2026-05-27",
    title: "All outgoing emails now come from noreply@resistact.org",
    sections: [
      {
        heading: "Internal",
        items: [
          "The friend-invite email and the feedback-to-admin email were still set to send from noreply@resistact.us, a leftover from an earlier sender setup. Both now match the production domain and the new approval welcome email at noreply@resistact.org, so there's a single verified Resend sender across every transactional email the site sends.",
        ],
      },
    ],
  },
  {
    version: "1.2.89",
    date: "2026-05-27",
    title: "Admin: Incomplete tab now correctly recognizes cartoon banners as images",
    sections: [
      {
        heading: "Admin",
        items: [
          "The Incomplete tab was showing 137 approved acts as missing an image even though they all had cartoon banners. The check now recognizes cartoon banners as a valid image, so the count drops to zero. No acts were actually broken — this was purely an admin-panel false alarm.",
        ],
      },
    ],
  },
  {
    version: "1.2.88",
    date: "2026-05-27",
    title: "Safari: sign in with Google + sign out now work the first time",
    sections: [
      {
        heading: "Bug fix",
        items: [
          "On macOS Safari, clicking \"Sign in with Google\" sometimes did nothing on the first click and only worked on the second. The auth flow was doing a tiny async cryptography step in between your click and the redirect to Google — and Safari was dropping the redirect because it thought the click had \"expired.\" Switched the flow to a more compatible mode so the redirect fires immediately on click.",
          "Sign out was occasionally leaving the UI looking signed in until reload — Safari's tracking-prevention was blocking the network call we were waiting on. We now clear your session locally first (instantly) so the UI updates right away.",
        ],
      },
    ],
  },
  {
    version: "1.2.87",
    date: "2026-05-27",
    title: "Facebook share on mobile now actually works",
    sections: [
      {
        heading: "Sharing",
        items: [
          "Tapping Facebook from Spread the Word on a phone (iOS or Android) used to drop you on Facebook's feed with nothing composed — Facebook stripped pre-fill from their sharer years ago. Now mobile Facebook behaves like Instagram and TikTok: we copy the caption + link to your clipboard and show a toast telling you to paste it into Facebook. Desktop is unchanged — the popup composer still pulls in the ResistAct link preview automatically.",
        ],
      },
    ],
  },
  {
    version: "1.2.86",
    date: "2026-05-27",
    title: "Welcome email when a new user is approved",
    sections: [
      {
        heading: "Onboarding",
        items: [
          "When an admin approves a pending user, the user now gets a short welcome email from noreply@resistact.org confirming their account is live and inviting them back to pick an act. Send is best-effort — if Resend has a hiccup, the approval itself still goes through and the failure is logged for the admin to see.",
        ],
      },
    ],
  },
  {
    version: "1.2.85",
    date: "2026-05-27",
    title: "Your location now follows your account across devices",
    sections: [
      {
        heading: "Personalization",
        items: [
          "Once you set your Location — either by tapping the Location pill at the top of the feed or by picking a state in the Refine Your Matches wizard — we now save it to your account and pre-apply it next time you visit (any device, any browser you're signed in on).",
          "The two surfaces now stay in sync: pick a state in the wizard and the Location pill reflects it; pick a state on the pill and it's there next time you open the wizard. No more re-entering it.",
        ],
      },
    ],
  },
  {
    version: "1.2.84",
    date: "2026-05-27",
    title: "Done checkmark on cards is now green",
    sections: [
      {
        heading: "Visual polish",
        items: [
          "The ✓ done count in the corner of each card now renders in the brand teal-green (#0d8c6e) — same color as the \"I did this!\" pill inside the card modal. Previously it was gray and read as a neutral metric; now it lands as a positive signal at a glance.",
        ],
      },
    ],
  },
  {
    version: "1.2.83",
    date: "2026-05-27",
    title: "40 acts now link directly to the action page, not just the org homepage",
    sections: [
      {
        heading: "Improvements",
        items: [
          "Forty acts that previously linked to an org's Instagram, TikTok, or homepage now go straight to the specific action page — the sign-up form, the event finder, the how-to guide, or the tool you actually need. Highlights: United We Dream court-watch and MigraWatch hotline, 50501 protest events and marshal toolkit, Indivisible postcard-writing and town hall playbook, March for Our Lives Take Action, Sunrise Movement hub-finder, Tesla Takedown event search, Green America bank-switch map, ICE Watch/Vecinos app, and the ALA banned-books list.",
        ],
      },
    ],
  },
  {
    version: "1.2.82",
    date: "2026-05-27",
    title: "Mobile: Location and Category dropdowns now actually open",
    sections: [
      {
        heading: "Bug fix",
        items: [
          "Tapping Location or Category on a phone now opens a full-width drawer of options directly beneath the chip strip. Before, the dropdown panel was getting silently clipped by the horizontally-scrollable filter row, so nothing appeared to happen on tap. The chips themselves still scroll side-to-side; only the open panel moved out from under the strip.",
          "Tapping a checkbox inside the drawer no longer closes it instantly — you can pick multiple states or categories in one go before tapping outside to dismiss.",
        ],
      },
    ],
  },
  {
    version: "1.2.81",
    date: "2026-05-27",
    title: "Admin one-click re-categorize from the card modal",
    sections: [
      {
        heading: "Admin",
        items: [
          "Open any act and the category pill on the banner now has a small pencil icon (admins only). Click it to see every category grouped by theme — Make/Do, Reach Out, Show Up, Care, Money/Stuff, Other — and tap the right one to move the act over. The pill updates in place and the change syncs back to the feed without reload. Cards without a header image get the same picker in the content area instead.",
        ],
      },
    ],
  },
  {
    version: "1.2.80",
    date: "2026-05-27",
    title: "Location is now the first filter pill",
    sections: [
      {
        heading: "Visual polish",
        items: [
          "The Acts filter row now leads with Location instead of Category. \"Where can I act?\" is most people's first cut at the feed, so the pill order on both mobile and desktop now reads: Location → Category → Prefer Online → 5 Minutes Max.",
        ],
      },
    ],
  },
  {
    version: "1.2.79",
    date: "2026-05-27",
    title: "Online tab: per-user act counts + anonymous activity",
    sections: [
      {
        heading: "Admin",
        items: [
          "Each user in the Online tab now shows how many acts they've completed all-time, as a small orange chip next to their last-seen timestamp. Zero-act users render with a faded \"0 acts\" so you can scan who's lurking vs. who's actually doing things.",
          "New \"Not-logged-in activity\" panel below the user list shows three totals: anonymous completions, logged-in completions, and the all-time total across both. Anon completions are an estimate (total card counters minus the sum of logged-in completions) so you can see how much of the action is coming from unsigned visitors.",
          "Once the edge function is redeployed, the same panel will start showing a reverse-chronological list of recent anonymous completions (action title + timestamp) over the last 7 days. The aggregate totals work without the deploy; the per-event list fills in going forward only.",
        ],
      },
    ],
  },
  {
    version: "1.2.78",
    date: "2026-05-27",
    title: "Admin panel opens on \"Online\" by default · no more 30s polling",
    sections: [
      {
        heading: "Admin",
        items: [
          "Admin panel now opens straight to the Online tab — quickest read on who's been active. Switch to Cards / Users / etc. via the dropdown when you need them.",
          "Online tab no longer re-fetches every 30 seconds in the background. It loads once when you open the tab; tap Refresh for a fresh read.",
        ],
      },
    ],
  },
  {
    version: "1.2.77",
    date: "2026-05-27",
    title: "Admin \"Online\" tab now covers the last 7 days",
    sections: [
      {
        heading: "Admin",
        items: [
          "The Online tab in the admin panel now shows every user active in the last 7 days (was: last 24 hours). Catches weekly returners, not just same-day folks. The status dot still tiers green (live in the last 5 min) → amber (last hour) → gray-400 (active today) → gray-200 (active this week), so the live signal is preserved inside the wider list.",
        ],
      },
    ],
  },
  {
    version: "1.2.76",
    date: "2026-05-27",
    title: "Tighter cards + signed-in users get the rich \"How This Works\"",
    sections: [
      {
        heading: "Visual polish",
        items: [
          "Card content area tightened: less vertical padding above and below the title/footer, smaller gap between the title and the author row. The banner image stays the same size — only the white space underneath was trimmed, so the feed packs more cards into the same scroll without the art feeling cramped.",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "\"How This Works\" now opens the rich two-column overlay (with the Baby Trump grocery-store image and the Spark → Inferno resistance-tier ladder) for signed-in users too. Previously logged-in folks fell through to a plain text-only fallback — same content as the signed-out version is now consistent everywhere.",
        ],
      },
    ],
  },
  {
    version: "1.2.75",
    date: "2026-05-27",
    title: "Cartoon banner coverage: 100% of approved cards",
    sections: [
      {
        heading: "Images",
        items: [
          "The last three cards that gpt-image-1's content filter had rejected — \"Download free protest art\" (1174), the soy-candle card with the F-word title (1336), and the Tesla Takedown LA Bluesky card (2171) — now have cartoonized banners via softened prompts (script: retry-failed-cards.mjs). Every approved act on the site now displays with the unified comic-style banner.",
        ],
      },
    ],
  },
  {
    version: "1.2.74",
    date: "2026-05-27",
    title: "Cartoon banners shift down ~20px on the grid",
    sections: [
      {
        heading: "Visual polish",
        items: [
          "Cartoonized card banners on the grid now anchor at `object-[center_20%]` instead of `object-top`. Effect: the visible band shifts down ~20px so wearable items (buttons, shirts, badges) painted at chest level by gpt-image-1 stay visible on the grid card — not just inside the modal. Original (non-cartoon) photos still use `object-top` so unrelated cards aren't affected.",
        ],
      },
    ],
  },
  {
    version: "1.2.73",
    date: "2026-05-27",
    title: "Approve-with-image buttons now work on all pending cards",
    sections: [
      {
        heading: "Admin",
        items: [
          "The \"Approve N with images\" button in the admin panel was failing silently for 137 bulk-imported cards. Those cards had cartoon banner artwork on disk, but the artwork path was never written back to their database records — so the server correctly refused to approve them (no image). A one-time backfill now writes the cartoon image path into every affected record. The button works.",
          "Approval failures now surface a visible error toast instead of disappearing quietly.",
          "The \"Approve N with images\" button now appears whenever any pending card has an image, not only when every card has one.",
        ],
      },
      {
        heading: "Fixes",
        items: [
          "Quick Match results are capped to a minimum of 20 cards so the carousel doesn't show a different (smaller) set than the main feed after clicking \"These look good.\"",
          "Bulk-imported cards now carry a short synopsis sentence — the small subtitle below the title that was missing from recently harvested acts.",
          "Cards that switched from logo-fit images to full-bleed cartoon banners no longer get the logo padding treatment.",
        ],
      },
    ],
  },
  {
    version: "1.2.72",
    date: "2026-05-25",
    title: "Specific ask reads first on \"Tell Congress\" cards",
    sections: [
      {
        heading: "Card titles",
        items: [
          "A wall of \"Tell Congress\" cards all looked identical at a glance because the boilerplate verb-phrase was the title and the specific ask was the small subtitle. Now when a title's head starts with Tell / Call / Email / Urge / Ask / Write / Sign AND the tail is longer, they swap — the specific ask (e.g. \"Pass H.R. 40 — Commission to Study Reparations\") becomes the prominent title and \"Tell Congress\" shrinks to the italic subtitle below. Reads like a news headline.",
        ],
      },
    ],
  },
  {
    version: "1.2.71",
    date: "2026-05-25",
    title: "Card title subtitle reads as a real subtitle now",
    sections: [
      {
        heading: "Visual polish",
        items: [
          "Subtitle below the card title (auto-split on ': ' or ' — ', or pulled from the hand-authored synopsis) was visually indistinct from the title — it looked like natural line wrap, not a smaller secondary line. Fixed: subtitle now renders smaller (11/12px), lighter (gray-400), italic, with more vertical separation. The trailing colon is also stripped from the head — \"Call your Senators: End the Illegal War on Iran\" now reads as \"Call your Senators\" + a clearly subordinate \"End the Illegal War on Iran.\"",
        ],
      },
    ],
  },
  {
    version: "1.2.70",
    date: "2026-05-25",
    title: "Pill-filter selections persist across reloads",
    sections: [
      {
        heading: "UX",
        items: [
          "Category pills, Location dropdown picks, Prefer Online toggle, 5 Minutes Max, Show completed acts, and Sort order are now saved to localStorage on every change. Reload the page or close + reopen the tab and your filters come back exactly as you left them.",
          "Same-device only for now — not synced cross-device yet. Match Me / Refine Your Matches preferences remain on the server-side record, just like before.",
        ],
      },
    ],
  },
  {
    version: "1.2.69",
    date: "2026-05-25",
    title: "Remote pill renamed to \"Prefer Online\"",
    sections: [
      {
        heading: "Filter behavior",
        items: [
          "Renamed the Remote pill to \"Prefer Online\". Same behavior — composes with state picks, adds online + at-home cards on top of any selected state — just clearer copy that signals it's a preference rather than a hard mode.",
        ],
      },
    ],
  },
  {
    version: "1.2.68",
    date: "2026-05-25",
    title: "Remote is its own pill, separate from the Location dropdown",
    sections: [
      {
        heading: "Filter behavior",
        items: [
          "Removed \"Remote\" from the Location dropdown — that dropdown is now states only.",
          "Renamed the pill from \"+ Remote\" → \"Remote\".",
          "Picking states and clicking Remote now compose naturally: pick Washington alone for WA in-person; click Remote alone for online + at-home everywhere; both checked = the union. The matcher still treats \"Remote\" as online OR at-home, so knitting and prayer cards aren't lost.",
          "Removed the auto-add-Remote behavior — Remote no longer toggles on by itself when you pick a state. Users opt in explicitly via the pill.",
        ],
      },
    ],
  },
  {
    version: "1.2.67",
    date: "2026-05-25",
    title: "Location filter encourages local + remote, not either-or",
    sections: [
      {
        heading: "Filter behavior",
        items: [
          "Renamed the \"Remote Only\" pill to \"+ Remote\" — additive framing makes it clear this filter ADDS remote actions on top of your state pick, instead of narrowing to online-only.",
          "Picking a state now AUTO-INCLUDES remote actions by default. The default state for someone in Washington is \"Washington + Remote\" — they see local in-person actions AND online/at-home actions in one feed. Uncheck \"+ Remote\" to narrow to strictly in-person.",
          "Broadened what \"Remote\" means in the matcher: now covers both online actions (`isOnline: true`) AND at-home actions (`atHome: true`) like knitting, prayer, postcard writing, cross-stitch. Previously those at-home-not-online cards got dropped from a Remote filter even though they're location-independent.",
        ],
      },
    ],
  },
  {
    version: "1.2.66",
    date: "2026-05-25",
    title: "Card category color now always matches the filter chip",
    sections: [
      {
        heading: "Color drift fix",
        items: [
          "On the card grid, the colored category label (e.g. \"LETTER TO EDITOR\") now reads from the canonical CATEGORY_COLORS map instead of each card's stored categoryColor field. Same source of truth as the filter chip in the Navbar, so selecting a filter and seeing the matching cards renders in one consistent color. Cleans up mismatches that crept in over many import batches (a card stored as navy categoryColor for \"Letter to Editor\" now renders red-brown like every other LTE card and the chip itself).",
        ],
      },
    ],
  },
  {
    version: "1.2.65",
    date: "2026-05-25",
    title: "Bookmark moves to modal · I-did-this shows count · hot-card flicker · stats tick-up",
    sections: [
      {
        heading: "Modal action row",
        items: [
          "\"I did this!\" pill in the modal now shows the running done count next to the label, matching the way the Boost button has always shown its count.",
          "Bookmark moved from the icon-only top-right corner of the card into the modal as a labeled \"Bookmark\" button with the bookmark icon. Now actually discoverable for users who weren't reading the tiny outline icon as an action.",
        ],
      },
      {
        heading: "Card grid",
        items: [
          "Removed the bookmark icon from the top-right corner of each card (it now lives in the modal). Only the admin edit pencil stays up there, and it renders only when canEdit is true — non-admins see nothing in that slot. Text column padding tightens accordingly.",
        ],
      },
      {
        heading: "Card animations",
        items: [
          "Stats tick up smoothly: when a boost or done count changes, the digit animates from old → new instead of popping. Restored useAnimatedNumber on both pills.",
          "Hot-card flicker: cards with boost counts at or above the threshold (currently 5, near the top of the catalog distribution) get a slow 2s opacity + scale pulse on the 🔥 emoji. Quiet enough to scan past, lively enough to notice. Honors prefers-reduced-motion.",
        ],
      },
    ],
  },
  {
    version: "1.2.64",
    date: "2026-05-25",
    title: "Unified action row · titles get more room",
    sections: [
      {
        heading: "Card layout",
        items: [
          "Pulled Flag and Share down from the top-right corner of the card and into the footer alongside Boost and Done. All four are now styled as one cohesive row: Boost and Done as small rounded pills with their color tint and count, Flag and Share as icon-only circles — same height (h-7), same rounded-full shape. Reads as a single control set, not two scattered clusters.",
          "Spread the Word still suppresses Flag (not user-submitted) and Boost (can't boost yourself); only Done and Share render there.",
        ],
      },
      {
        heading: "Title space",
        items: [
          "Freed up horizontal space for card titles. With Flag and Share out of the absolute top-right, the text column drops from pr-16 to pr-9 and only needs to clear the slim bookmark + edit pair. Long titles like \"Boost Randy Rainbow's Anti-Trump Musical Parodies on TikTok\" now wrap to two lines instead of three.",
        ],
      },
    ],
  },
  {
    version: "1.2.63",
    date: "2026-05-25",
    title: "Card footer: stats lead, author follows · KYR chip into the modal · Spread the Word loses its category label",
    sections: [
      {
        heading: "Card layout",
        items: [
          "Flipped the card footer: 🔥 boost and ✓ done counters now sit on the left, the author block moves to the right corner with text right-aligned. Stats lead the eye; author is supporting context.",
          "Moved the \"⚠ In-person — know your rights\" chip off the grid and into the card-details modal, where it sits right above the action row on PROTEST / FLASH MOB cards. Same field of view as the link-out, so the safety reminder lands at the moment of decision.",
          "Spread the Word card no longer shows the \"BOOST\" category label — it's the hero card, not a category-bucketed Act, so the label was just noise.",
        ],
      },
    ],
  },
  {
    version: "1.2.62",
    date: "2026-05-25",
    title: "Card grid rebuilt — image on the right, text on the left, color creeps back",
    sections: [
      {
        heading: "New card layout",
        items: [
          "Cards on the Acts grid are no longer a full-width banner stacked over text. The image is now a small square on the right; the category (now ALL CAPS) and the title live on the left. Time, online/location, and type-tag chips sit inline under the title. Cards are shorter, scannable, and the eye can land on the title without a banner getting in the way.",
          "Spread the Word stays the hero — it keeps its full banner illustration at 50% saturation as the lone color anchor in the grid.",
          "Compact (Quick Match preview) cards keep the old banner-on-top layout because that view is small enough the horizontal split would feel cramped.",
        ],
      },
      {
        heading: "Color",
        items: [
          "Brought back a whisper of color: card banners go from full grayscale (saturate 0) to a faint saturate(0.2). Hover still pops the focused card back to full color.",
          "Category filter chips now use the category's own color when selected. Click PROTEST and the chip turns navy; click CALL and it turns pink. The relationship between chip color and category color across the grid is now consistent.",
        ],
      },
      {
        heading: "Under the hood",
        items: [
          "Extracted the category-to-color map into a shared CATEGORY_COLORS lookup (lib/categoryGroups.ts) plus a colorForCategory() helper, so the Navbar chip and any future component pull from one place instead of redefining it.",
        ],
      },
    ],
  },
  {
    version: "1.2.61",
    date: "2026-05-25",
    title: "Card grid: descriptions and \"I did this!\" move to the modal — stats take their place",
    sections: [
      {
        heading: "Cleaner card grid",
        items: [
          "Removed the description text from cards on the Acts grid. The full description still lives inside the card-details modal that opens on click; the grid now reads as title + author + stats, so more cards fit per scroll and the eye can scan instead of read.",
          "Replaced the \"I did this!\" pill on each card with a quiet read-only stats row: 🔥 boost count and ✓ done count. The action itself still lives inside the modal alongside Boost — the grid stays a preview, the modal is where you act.",
          "Spread the Word card hides the boost stat (it can't be boosted) and shows just the share/done count.",
          "Quick Match preview cards keep the description + Read More link — that compact view is the user's only look at the card before deciding.",
        ],
      },
    ],
  },
  {
    version: "1.2.60",
    date: "2026-05-25",
    title: "Boost button moves into the card-details modal only",
    sections: [
      {
        heading: "Cleaner card grid",
        items: [
          "Removed the orange \"🔥 Boost\" pill that sat on every card image. Boost still works — it just lives inside the card-details modal now, alongside \"I did this!\" and the link-out. The grid stays calmer; the action lives where the user is already paying attention.",
          "\"I did this!\" stays on the card. Open the card to boost.",
        ],
      },
    ],
  },
  {
    version: "1.2.59",
    date: "2026-05-25",
    title: "Card banners go full grayscale — Spread the Word stays the lone color anchor",
    sections: [
      {
        heading: "Visual",
        items: [
          "Every Act banner is now black & white in the grid. Hover still pops the focused card back to full color, so the photo is one click of attention away.",
          "Exception: the pinned \"Spread the Word about ResistAct\" card stays at 50% saturation so the orange/navy brand colors anchor the otherwise grayscale feed.",
        ],
      },
    ],
  },
  {
    version: "1.2.58",
    date: "2026-05-25",
    title: "Self-link \"go follow this author\" cards sent back to admin review",
    sections: [
      {
        heading: "Admin / data",
        items: [
          "Added a one-time server-side migration that un-approves every card whose author link points to the same place as its action URL — i.e. \"go follow @handle\" cards where the only action is to visit the author's own profile. URL match is normalized (trim, lowercase, strip trailing slash, ignore http vs https). The flagged cards land back in admin review so the team can decide which ones genuinely earn a slot under the 10% boost-only cap.",
          "Takes effect on next Edge Function deploy. Runs once and is gated behind a version key.",
        ],
      },
    ],
  },
  {
    version: "1.2.57",
    date: "2026-05-25",
    title: "Fixed broken \"Resistance starter pack\" Bluesky card",
    sections: [
      {
        heading: "Data fix",
        items: [
          "The \"Subscribe to a 50-person Resistance starter pack\" card on Bluesky had a generic URL pointing to the 50501 profile instead of a real starter pack. Verified via Bluesky's API and updated to 50501's actual \"Voices of the Resistance\" starter pack (123 vetted journalists / experts / organizers). Retitled accordingly and noted the alternate \"50501: The People's Movement\" pack (26 organizers) in the description.",
        ],
      },
    ],
  },
  {
    version: "1.2.56",
    date: "2026-05-25",
    title: "Stronger card-banner fade — editorial feel",
    sections: [
      {
        heading: "Visual",
        items: [
          "Pushed the card-banner desaturation from 0.55 to 0.35 so the grid reads calmer — the photos hold their shape but stop fighting each other for attention. Hover still pops a focused card back to full color.",
        ],
      },
    ],
  },
  {
    version: "1.2.55",
    date: "2026-05-25",
    title: "Fixed duplicate ALL-CAPS + Title-Case category pills",
    sections: [
      {
        heading: "Bug fix",
        items: [
          "Category pill row was showing both \"BOOST\" and \"Boost\", \"CRAFTING\" and \"Crafting\", \"ART PIECE\" and \"Art/Performance Art\", etc — because some upstream cards were skipping the per-card category normalization that resolveCard does. Added a defensive normalizing pass at the chip-render layer so all variants fold into the canonical title-case bucket before deduplication. Pill list should read as one chip per category now.",
        ],
      },
    ],
  },
  {
    version: "1.2.54",
    date: "2026-05-25",
    title: "Call/Write → Call · scroll nudge button reworded",
    sections: [
      {
        heading: "Category cleanup",
        items: [
          "Renamed the \"Call/Write\" category to just \"Call.\" The bucket only ever held phone-call actions — letter-writing has its own Letter Writing and Letter to Editor categories, so the slash label was misleading.",
          "Live cards still carrying the old label are renamed at the server on next Edge Function deploy (one-time KV migration). In the meantime, the client folds the old label forward at render time so users always see \"Call.\"",
        ],
      },
      {
        heading: "Copy",
        items: [
          "Reworded the lower-right scroll-nudge toast button from \"Open Quick Acts for Me Tool\" to \"Refine My Matches\" — matches what the same button at the top of the page already says.",
        ],
      },
    ],
  },
  {
    version: "1.2.53",
    date: "2026-05-25",
    title: "Indivisible-authored cards: shared banner image",
    sections: [
      {
        heading: "Data",
        items: [
          "25 Indivisible-authored cards that had no banner image (showing only the generic ResistAct logo fallback) now share a dedicated Indivisible banner. Cards that already had a real image are untouched. Direct KV write — takes effect on next page load; no edge function deploy needed.",
        ],
      },
    ],
  },
  {
    version: "1.2.52",
    date: "2026-05-25",
    title: "Persistent bottom banner — acts, tag, facts + smacks in one row",
    sections: [
      {
        heading: "Bottom banner",
        items: [
          "Restructured the always-on bottom banner into three sections: the acts count sits on the left, the \"Pick one. Do it. Share it. Come back tomorrow.\" tag is centered, and facts + smacks counts sit on the right. The count no longer gets jammed inside the call-to-action sentence.",
          "Mobile-friendly: on narrow screens the side labels (acts/facts/smacks) collapse to just the colored numbers so the center tag stays readable.",
          "Removed the duplicate facts/smacks block from the page-bottom footer (it's now in the persistent banner, so the footer only carries the copyright + disclaimer).",
        ],
      },
    ],
  },
  {
    version: "1.2.51",
    date: "2026-05-25",
    title: "Cleaner card art — location pill no longer cuts across the logo, Quick Match skips placeholder cards",
    sections: [
      {
        heading: "Card layout",
        items: [
          "Fixed the location pill cutting across the ResistAct logo on cards without their own art. The pill now caps at 55% of the card width with a tidy ellipsis instead of stretching across the banner — long sentence-style location values from older imports no longer collide with the centered fallback logo.",
        ],
      },
      {
        heading: "Quick Match",
        items: [
          "Quick Match no longer fills the carousel with cards that fall back to the generic ResistAct logo banner. Cards with real banner art are prioritized; placeholder-image cards only show up if filtering would otherwise leave the carousel under-full.",
        ],
      },
    ],
  },
  {
    version: "1.2.50",
    date: "2026-05-25",
    title: "Category cleanup — 30+ Acts redistributed, color drift fixed",
    sections: [
      {
        heading: "Category cleanup",
        items: [
          "Untangled the catch-all gray CALL/WRITE bucket. 19 Acts redistributed to their proper homes: 11 to Social Media (TikTok films, quote-tweets, Threads posts, screenshot-and-post actions), 4 to Letter Writing (postcards to officials + formal public comments on federal rules), 1 to Letter to Editor, 3 to Call/Write (the actual phone calls + the United We Dream text-bank shift).",
          "Merged the BOOST color split. The 72 \"Follow & boost @handle.bsky.social\" bulk-imported Bluesky cards were rendering in gray while the original \"Subscribe + share <newsroom>\" Boost cards rendered in purple. Same concept, just import drift — unified everything to the purple #8a00e6 swatch.",
          "Fixed the Personal Commitment color split. 4 Acts (save threatened gov pages, banned-book reading, election reminders, No War Is Holy sticker) were drifting in Protest-blue; now consistent with the rest of the category in purple.",
          "Fixed 7 single-card color outliers + mis-categorizations: an Epstein Protest Walk Interest Meeting was the wrong blue; an FFI volunteer card and FFI alert-subscription card had color drift; a DOJ-accredited rep training card was off-color; a Faith in Action federation card was tagged PRAYER instead of Join a Group; a #DivestMusk pension resolution card was tagged Letter Writing instead of Join a Group; a Twin Cities organizing panel was the wrong shade of green; the lone \"Video\" category card was folded into Social Media.",
        ],
      },
      {
        heading: "Under the hood",
        items: [
          "Added 10 missing entries to the bulk-import category-color table (BOOST, CALL/WRITE, LETTER WRITING, FLASH MOB, PURCHASE, plus the catch-all gray categories) so future weekly imports stay on-color instead of drifting back to whatever the harvest pipeline picks.",
        ],
      },
    ],
  },
  {
    version: "1.2.49",
    date: "2026-05-25",
    title: "Smacks tag pills match Acts + Facts styling",
    sections: [
      {
        heading: "Visual polish",
        items: [
          "Smacks tag chips on the navbar were heavier (font-semibold, px-3, leading Tag icon) and read as a different control than the Acts category and Facts category pills. Switched to the shared chip style — px-2.5, font-medium, no leading icon. All three tabs now use the same pill treatment.",
        ],
      },
    ],
  },
  {
    version: "1.2.48",
    date: "2026-05-25",
    title: "Recategorized 11 phone-call Acts into Call/Write",
    sections: [
      {
        heading: "Categories",
        items: [
          "11 Acts whose titles start with \"Call\" were scattered across EMAIL CAMPAIGN, MENTAL HEALTH, TRAINING, and Petition. Pulled them into a single Call/Write bucket (pink) so phone-call actions are findable together — Indivisible legislator-call scripts, the 5 Calls weekly habit, the CCIJ ICE rapid-response hotline, and the Trans Lifeline / LGBT Help Center peer-support hotlines. The broader gray CALL/WRITE bucket (postcards, public comments, social posts, video calls-to-action) is unchanged.",
        ],
      },
    ],
  },
  {
    version: "1.2.47",
    date: "2026-05-25",
    title: "Match preferences no longer auto-apply on login",
    sections: [
      {
        heading: "UX",
        items: [
          "Stopped auto-applying saved Refine Your Matches preferences when the user signs in. Users now see the full unfiltered Acts grid on load and have to explicitly open the wizard + click \"These Matches Look Good!\" to filter. Their saved sliders / picks still persist in the background (localStorage ↔ user record), so when they DO open the wizard their previous state is restored — they just don't get a surprise-filtered feed.",
        ],
      },
    ],
  },
  {
    version: "1.2.46",
    date: "2026-05-25",
    title: "Read more modal: desktop banner up to 360px",
    sections: [
      {
        heading: "Read more modal",
        items: [
          "Banner image on desktop bumped from 260px → 360px so the image reads as a real piece of the experience, not a thumbnail. Phone stays at 180px.",
        ],
      },
    ],
  },
  {
    version: "1.2.45",
    date: "2026-05-25",
    title: "Read more modal: taller header image (desktop)",
    sections: [
      {
        heading: "Read more modal",
        items: [
          "Banner image grew from 140/180px → 180/260px so the header has real presence on desktop. Phone stays at the smaller 180px so the title + buttons don't fall below the fold on small screens. Modal still capped at max-h-90vh so anything that overflows scrolls.",
        ],
      },
    ],
  },
  {
    version: "1.2.44",
    date: "2026-05-25",
    title: "Search now finds cards beyond the first 20",
    sections: [
      {
        heading: "Critical bug fix",
        items: [
          "Search and filters were running against only the first 20 cards because the full dataset prefetch waited for a filter to be active before firing. Symptom: searching \"refer\" on resistact.org returned 4 cards instead of 5 — \"Refer an artist at risk\" (card id 1180) was past the initial batch and hadn't loaded yet. Fix: prefetch the remaining cards as soon as the initial 20 land, regardless of filter state. The in-memory cards array now catches up to the full 825 within seconds of page load, so search always sees everything.",
        ],
      },
    ],
  },
  {
    version: "1.2.43",
    date: "2026-05-25",
    title: "Renamed the match-tool button",
    sections: [
      {
        heading: "Hero",
        items: [
          "Button label changed from \"Quick Act Matching Tool\" → \"Refine Your Matches\" with subtitle \"Your preferences stay saved.\" The new copy hints at persistence and refinement rather than novelty.",
        ],
      },
    ],
  },
  {
    version: "1.2.42",
    date: "2026-05-25",
    title: "Quick Match preview: dialed description back to 3 lines",
    sections: [
      {
        heading: "Quick Match",
        items: [
          "Reverted Quick Matches preview tile description from 4 lines to 3 — 4 was overflowing without leaving room for Read more. 3-line clamp + 140-char Read more threshold reads as a balanced summary.",
        ],
      },
    ],
  },
  {
    version: "1.2.41",
    date: "2026-05-25",
    title: "News Story moved to Other",
    sections: [
      {
        heading: "Quick Match",
        items: [
          "Moved News Story out of the \"Reach Out\" chip group and into \"Other\" — it's a consume-and-share action, not an outbound contact action like the other Reach Out chips.",
        ],
      },
    ],
  },
  {
    version: "1.2.40",
    date: "2026-05-25",
    title: "Quick Match preview cards show more description",
    sections: [
      {
        heading: "Quick Match",
        items: [
          "Preview cards in the Quick Matches grid (compact mode) now show up to 4 lines of description instead of 2. \"Read more →\" only kicks in for descriptions over ~200 chars (was 90). Fills the tile's vertical space rather than leaving a gap above the I-did-this row.",
        ],
      },
    ],
  },
  {
    version: "1.2.39",
    date: "2026-05-25",
    title: "State picker moved to page 1 + alphabetized category chips",
    sections: [
      {
        heading: "Quick Match",
        items: [
          "State dropdown (\"Your state — optional, for in-person nearby\") moved from page 2 of the wizard to page 1 directly under the Location slider, so all location-shaped settings live together.",
          "Category chips within each Match-these group row are now alphabetized — Make/Do reads Art/Performance Art → Boycott → Crafting → Flash Mob → Protest → Video, and so on for every row. Easier to scan than the previous curated order.",
        ],
      },
    ],
  },
  {
    version: "1.2.38",
    date: "2026-05-25",
    title: "Quick Match: two clean pages, no more Skip-these",
    sections: [
      {
        heading: "Quick Match",
        items: [
          "Removed the \"Skip these\" section entirely. The positive \"Match these\" picker covers the same intent without the cognitive load of ticking 22 things to exclude one.",
          "Tone sliders (anger / comedy / subversion / hope / energy) moved to page 2 of the wizard under a \"Sharpen your matches — dial in tone\" header. Page 1 is now focused: Time + Location + Match these categories + Quick Matches preview. Page 2 is refinement: tone + identity (vulnerable groups).",
          "Boost category moved from \"Money / Stuff\" to \"Care\" in the category chip grid.",
        ],
      },
    ],
  },
  {
    version: "1.2.37",
    date: "2026-05-25",
    title: "Quick Match flow reordered + Video in Make/Do",
    sections: [
      {
        heading: "Quick Match",
        items: [
          "Step 0 reorganized so the wizard flows in priority order: Time + Location at the top (the two fundamentals), then category pickers (Match these / Skip these), then tone sliders in a new \"Sharpen your matches — dial in tone\" section. Tone is refinement, so it lives below the things that decide what shows at all.",
          "Renamed the \"Sharpen your matches\" CTA button to \"Tell us more about you\" so it doesn't collide with the new section header. Button still leads to step 1 (vulnerable groups).",
          "Video category moved from the catch-all \"Other\" group into \"Make / Do\" alongside Crafting / Art/Performance Art / Flash Mob / Protest / Boycott.",
        ],
      },
    ],
  },
  {
    version: "1.2.36",
    date: "2026-05-25",
    title: "Witness + Bird-Dog grouped under Show Up",
    sections: [
      {
        heading: "Quick Match",
        items: [
          "Witness and Bird-Dog moved into the \"Show Up\" chip group alongside Meeting, Join a Group, Training, Professional Skills, and Labor. Also included the explicit \"Show Up\" category itself so it lives next to its theme.",
        ],
      },
    ],
  },
  {
    version: "1.2.35",
    date: "2026-05-25",
    title: "Quick Matches cleanup",
    sections: [
      {
        heading: "Quick Match",
        items: [
          "\"Spread the Word about ResistAct\" no longer appears in Quick Matches. It's pinned at the top of the live feed already; surfacing it here too crowded out actual matched picks.",
          "Boycott moved from \"Other\" to \"Make / Do\" in the category chip grid (where Crafting / Protest / Flash Mob / Art/Performance Art live).",
        ],
      },
    ],
  },
  {
    version: "1.2.34",
    date: "2026-05-25",
    title: "Call/Write + Letter Writing grouped under \"Reach Out\"",
    sections: [
      {
        heading: "Quick Match",
        items: [
          "Quick Match category chip grid now groups Call/Write and Letter Writing under \"Reach Out\" alongside Petition / Email Campaign / Letter to Editor / News Story / Social Media. Previously these were in the synthetic \"Other\" fallback bucket because they hadn't been explicitly placed.",
        ],
      },
    ],
  },
  {
    version: "1.2.33",
    date: "2026-05-25",
    title: "Phone Acts filters actually work now",
    sections: [
      {
        heading: "Critical bug fix",
        items: [
          "On mobile (below 768px), the Acts page filter row was rendering visual placeholder buttons that DID NOTHING — no onClick, no dropdown, no state. Users could see Category / Location / etc. labels but tapping them was a dead end. Replaced with working Category dropdown, Location dropdown, Remote Only toggle, and 5 Min Max toggle. Bug had been latent since the mobile filter row was first added.",
        ],
      },
    ],
  },
  {
    version: "1.2.32",
    date: "2026-05-25",
    title: "Quick Match: pick categories you want, + thumbs-up button",
    sections: [
      {
        heading: "Quick Match",
        items: [
          "New \"Match these categories\" picker in the wizard. Pick one or more categories (e.g. Crafting + Protest + Petition) and the matcher hard-filters to only those. Leave blank for \"any category.\" Picking a category here removes it from the \"Skip these\" list automatically (they're contradictory).",
          "Matcher algorithm updated: `score()` now drops to 0 for cards whose category isn't in the user's `includedCategories` picks, the same way it already drops to 0 for excluded categories. Hard filter at the engine layer — both the matched feed AND the Quick Matches preview respect it.",
          "Thumbs-up \"Great match\" button added next to the existing thumbs-down on each Quick Matches tile. Clicking turns the button into a soft-green \"Thanks!\" confirmation; the corresponding thumbs-down disables to prevent contradictory feedback on the same card.",
        ],
      },
    ],
  },
  {
    version: "1.2.31",
    date: "2026-05-25",
    title: "Picking a state turns Remote Only off",
    sections: [
      {
        heading: "Navigation",
        items: [
          "Location filter: adding a state in the dropdown now automatically unchecks Remote Only — picking a state implies in-person, which contradicts \"online only.\" Clicking Remote Only when states are already picked still just adds Remote without disturbing them, so users can opt back into both if they want.",
        ],
      },
    ],
  },
  {
    version: "1.2.30",
    date: "2026-05-25",
    title: "Modal CTA anchored to the right",
    sections: [
      {
        heading: "Read more modal",
        items: [
          "\"I want to ResistAct! →\" now anchors to the right side of the action row. \"I did this!\" and Boost cluster on the left. The eye lands on the primary call-to-action last. On narrow viewports the row stacks gracefully.",
        ],
      },
    ],
  },
  {
    version: "1.2.29",
    date: "2026-05-25",
    title: "Push checkpoint — May 25 batch",
    sections: [
      {
        heading: "Today's highlights",
        items: [
          "Acts grid feels calmer: card banners desaturated at rest (full color on hover), banner heights cut by a third, image-bug behind dozens of \"missing images\" found + fixed (webp generator wired into prebuild).",
          "Filter bar reorganized: categories wrap to multiple rows, Location is a pill at the end, Remote Only + 5 Minutes Max are pills, Sort moved into the result-count banner.",
          "Read-more modal redesigned + portaled so it opens centered over the page; clicking anywhere on a card opens the modal first, then act from inside (link out / I did this / Boost).",
          "Library counts moved: \"Pick one of N acts. Do it. Share it. Come back tomorrow.\" in the persistent footer. Facts + smacks counts in the page footer.",
          "Admin edit-card dropdown now lists all 35 categories actually in use (was missing 8). New Video category added. Art Piece folds into Art/Performance Art at display time.",
        ],
      },
    ],
  },
  {
    version: "1.2.28",
    date: "2026-05-25",
    title: "Click-a-card → modal first. Act from inside the modal.",
    sections: [
      {
        heading: "UX",
        items: [
          "Clicking anywhere on an action card now opens the Read More modal first, instead of going straight to the external link. Read the full description, see the image at a comfortable size, then decide what to do.",
          "The modal now carries the full action toolkit: the primary link out (\"I want to ResistAct! →\"), the \"I did this!\" toggle (teal pill, same identity as the on-card pill), and Boost (orange, with running count). Preview-then-act stays inside one focused surface.",
          "Card title and image area no longer link out directly — click-the-card opens the modal in all cases. Boost / Bookmark / Share / Edit / I-did-this pills on the card still work via inline stop-propagation, so power users can still act without opening the modal.",
        ],
      },
    ],
  },
  {
    version: "1.2.27",
    date: "2026-05-25",
    title: "Read-more modal now opens correctly over the page (portal fix)",
    sections: [
      {
        heading: "Critical bug fix",
        items: [
          "The \"Read more\" modal was rendering INSIDE the card cell instead of as a full-page overlay. Root cause: ActionCard applies a CSS hover transform (lift + scale + slight rotate) — when you clicked Read more while still hovering, that transform created a containing block that captured the modal's position:fixed. The modal then anchored to the card, not the viewport. Quick Match read-more worked because those cards aren't in a hovered transform state when clicked. Now uses React's createPortal to hoist the modal DOM out of the card subtree entirely, so it always overlays the whole page correctly.",
        ],
      },
    ],
  },
  {
    version: "1.2.26",
    date: "2026-05-25",
    title: "Read-more modal redesigned",
    sections: [
      {
        heading: "Read more modal",
        items: [
          "Title font dropped from 22/26px to 17/20px so long card titles stop wrapping across 4–5 lines on narrow viewports.",
          "Backdrop darkened (60%→80% opacity) and gained a backdrop-blur so the page behind the modal stops competing visually.",
          "Header image reduced from 200/260px to 140/180px — the title and description now have proportional weight instead of being dominated by the banner.",
          "Modal max width narrowed from 640px to 560px to feel less sprawling on desktop.",
          "Category label is mixed-case (matches the card grid change earlier today). Online/Location badge uses the same white-pill treatment as the card grid.",
        ],
      },
    ],
  },
  {
    version: "1.2.25",
    date: "2026-05-25",
    title: "Sort moved next to the live result count",
    sections: [
      {
        heading: "Navigation",
        items: [
          "Sort lives inside the results banner now, right beside the live count. Three banner variants: \"Showing all 825 actions — unfiltered\" (gray banner with Find my match + Sort), \"X actions match your filters\" (new — light navy banner shown when categories / search / location filters are active), and \"Matched for you. Showing N actions.\" (orange Match banner — Sort sits next to Edit / Clear).",
          "Show completed acts toggle moved with Sort — still inside the Sort dropdown menu under a divider line.",
          "Reclaimed the entire right side of the navbar: it's now empty unless filters are active (in which case Clear all is the only thing there).",
        ],
      },
    ],
  },
  {
    version: "1.2.24",
    date: "2026-05-25",
    title: "\"Remote Only\" pill added to the filter row",
    sections: [
      {
        heading: "Navigation",
        items: [
          "New \"Remote Only\" pill in the filter pill row, right before 5 Minutes Max. Toggles the Remote / online-only filter in one click instead of opening the Location dropdown. Composes with any selected states the same way picking Remote in the dropdown does.",
        ],
      },
    ],
  },
  {
    version: "1.2.23",
    date: "2026-05-25",
    title: "Reverted Remote-exclusivity (composes with states again)",
    sections: [
      {
        heading: "Navigation",
        items: [
          "Location filter \"Remote\" is back to behaving like any other location chip — it composes with state picks instead of being mutually exclusive. Label is back to \"Remote\" instead of \"Remote Only.\"",
        ],
      },
    ],
  },
  {
    version: "1.2.22",
    date: "2026-05-25",
    title: "Hidden time bomb: TikTok CDN URLs expire after ~2 weeks",
    sections: [
      {
        heading: "Bug fix",
        items: [
          "Discovered that 6 cards (Randy Rainbow, Secret Handshake game, Trump Parody Opera, Tom Morello protest song, This Hour Has 22 Minutes, Iranian Embassy memes) had their banner images set to TikTok CDN URLs with `x-expires` parameters. Those URLs silently 403 after ~2 weeks. The card looked imageless on a fresh browser but appeared fine on your laptop because the browser had cached it before expiry. Replaced all 6 with the TikTok SVG logo fallback (`topImageKey: org_tiktok`) so they have a stable image until an admin uploads a permanent one.",
          "Client-side filter now also treats any URL pointing at `tiktokcdn` or `cdninstagram` hosts as effectively no-image (because both rotate signed URLs and silently expire). Cards using those hosts are hidden from non-admin viewers; admins still see them in the Pending tab so the image can be rehosted.",
        ],
      },
      {
        heading: "Server",
        items: [
          "Reverted the `approved-without-image-cleanup:v2` migration bump from earlier today — that fix is no longer needed (the imageless cards were actually a rendering bug, not stale approval state). Kept the `seed:org-actions:v26` bump so the new image URLs and TikTok-logo fallbacks push to production on next deploy.",
        ],
      },
    ],
  },
  {
    version: "1.2.21",
    date: "2026-05-25",
    title: "Cleaner filter bar, calmer card design, smarter Location filter",
    sections: [
      {
        heading: "Bug fixes",
        items: [
          "\"Read more →\" link in the standard card now uses the same orange-underline styling as the featured/Quick Match version — visual consistency across both card variants.",
          "Online/Location badge on card banners now uses a white pill with dark gray text + a subtle shadow, instead of black/white, so it stays readable on any banner photo.",
        ],
      },
      {
        heading: "Filter behavior",
        items: [
          "Location filter: \"Remote Only\" is now mutually exclusive with state picks. Checking Remote Only clears any selected states; checking a state clears Remote Only. Stops the contradictory {Remote, California} state from being possible.",
        ],
      },
      {
        heading: "Visual polish",
        items: [
          "Category labels on each card are now mixed-case (\"Crafting\", \"Email Campaign\") instead of ALL-CAPS — calmer, easier to scan in a wall of cards.",
          "\"Clear all\" button moved into the right column above the Sort dropdown, so the left side stays cleanly focused on filters.",
        ],
      },
      {
        heading: "Footer",
        items: [
          "The total number of acts now rides inside the persistent \"Pick one. Do it. Share it. Come back tomorrow.\" message at the bottom of the page — it reads \"Pick one of <strong>825</strong> acts.\" The bottom-of-page footer now shows only facts and smacks counts.",
        ],
      },
    ],
  },
  {
    version: "1.2.20",
    date: "2026-05-25",
    title: "Complete category list in the admin edit modal + Video category",
    sections: [
      {
        heading: "Admin",
        items: [
          "Added the 8 categories that were missing from the admin edit-card dropdown but ARE active in production data: Bird-Dog, Call/Write, Host, Irreverence, Learn, Letter Writing, Show Up, Witness. Combined those amounted to ~150 cards that couldn't be edited cleanly.",
          "Added new Video category for video-based actions.",
          "Re-sorted the dropdown alphabetically so editors can find labels quickly.",
        ],
      },
      {
        heading: "Data cleanup",
        items: [
          "\"Art Piece\" cards now display under the canonical \"Art/Performance Art\" category. The merge happens client-side via normaliseCategory — no data migration required.",
        ],
      },
    ],
  },
  {
    version: "1.2.19",
    date: "2026-05-25",
    title: "\"Remote\" reads as \"Remote Only\" in the Location dropdown",
    sections: [
      {
        heading: "Navigation",
        items: [
          "Clearer wording — the first option in the Location dropdown now reads \"Remote Only\" so it's obvious it's a strict online-only filter rather than \"anywhere including remote.\"",
        ],
      },
    ],
  },
  {
    version: "1.2.18",
    date: "2026-05-25",
    title: "5 Minutes Max joins the pill row",
    sections: [
      {
        heading: "Navigation",
        items: [
          "5 Minutes Max moved from the right side of the filter bar into the pill row, sitting right after the Location pill. All filters now live in one continuous row of pills; the right side is just Sort.",
        ],
      },
    ],
  },
  {
    version: "1.2.17",
    date: "2026-05-25",
    title: "Sort dropdown styled lighter",
    sections: [
      {
        heading: "Navigation",
        items: [
          "Sort dropdown no longer has a border or background. Reads as plain text that's clickable rather than a button. Font size dropped to match the 5 Minutes Max toggle stacked above it, so the right-side column feels cohesive.",
        ],
      },
    ],
  },
  {
    version: "1.2.16",
    date: "2026-05-25",
    title: "Dropped the \"Filter by\" label",
    sections: [
      {
        heading: "Navigation",
        items: [
          "Removed the tiny \"Filter by\" label at the start of the filter row. The pills speak for themselves.",
        ],
      },
    ],
  },
  {
    version: "1.2.15",
    date: "2026-05-25",
    title: "Location joins the category pill row",
    sections: [
      {
        heading: "Navigation",
        items: [
          "Location is now styled exactly like the category pills and sits at the end of the category row, with a small map-pin icon and a chevron. Clicking it still opens the same state-picker dropdown — only the visual treatment changed. Result: one continuous wrap-friendly row of filter pills instead of a separate Location column on the left.",
        ],
      },
    ],
  },
  {
    version: "1.2.14",
    date: "2026-05-25",
    title: "Filter bar reshuffle — \"Filter by\" label promoted, 5 Min Max moved next to Sort",
    sections: [
      {
        heading: "Navigation",
        items: [
          "The \"Filter by\" tiny uppercase label now sits ABOVE the Location pill instead of inline left of it.",
          "5 Minutes Max moved from the left side of the filter bar to a vertical stack with Sort on the right side. Now there's a clean \"filter\" column on the left (Filter by / Location / Category pills) and a clean \"view options\" column on the right (5 Minutes Max / Sort).",
        ],
      },
    ],
  },
  {
    version: "1.2.13",
    date: "2026-05-25",
    title: "WebP image optimization re-enabled, safely",
    sections: [
      {
        heading: "Performance",
        items: [
          "Added a build-time WebP generator (scripts/generate-webp-siblings.mjs). Every JPG/PNG in the public/ folder now gets a sibling .webp file written automatically before each build. Backfilled 64 new .webp files in this release.",
          "Re-enabled the auto-WebP behavior in the image component now that we can guarantee every public image has a webp twin. Browsers that support webp (Chrome, Edge, Firefox, Safari 14+) load the smaller webp version; older browsers fall back to the original .jpg/.png. No more silent rendering failures.",
          "Net effect: card banners stay sharp, page weight drops noticeably on large PNG-heavy pages, and the bug that made dozens of cards look imageless cannot happen again.",
        ],
      },
    ],
  },
  {
    version: "1.2.12",
    date: "2026-05-25",
    title: "MAJOR BUG FIX: dozens of card images that looked \"missing\" now show",
    sections: [
      {
        heading: "Critical bug fix",
        items: [
          "ResistAct's image component was silently breaking every card banner that pointed to a JPG/PNG in the public/ folder unless that image happened to have a sibling .webp file. It assumed all images had webp pairs (only the Smacks did), built a <picture> element pointing at the missing .webp, the browser tried to load it, got a 404, and didn't fall back to the perfectly-good .jpg next to it. Result: dozens of cards (Pretti Good beanie, ACLU, 5 Calls, MoveOn, Indivisible, Mobilize, every Tesla Takedown org logo, etc.) looked imageless even though the actual image files were intact on disk and on S3.",
          "Disabled the auto-webp logic until we add a real build-time webp generator. All affected cards should immediately show their banner image again on hard reload.",
        ],
      },
    ],
  },
  {
    version: "1.2.11",
    date: "2026-05-25",
    title: "5 Minutes Max + Location stacked vertically",
    sections: [
      {
        heading: "Navigation",
        items: [
          "On the Acts page, the \"5 Minutes Max\" toggle and the \"Location\" dropdown now sit stacked in one narrow column instead of taking two horizontal slots. Reclaims more space so the category pill row spreads out further before wrapping.",
        ],
      },
    ],
  },
  {
    version: "1.2.10",
    date: "2026-05-25",
    title: "Library counts moved to the footer",
    sections: [
      {
        heading: "Navigation",
        items: [
          "The \"661 acts · 102 facts · 36 smacks\" stats no longer take up real estate at the top right of the navbar. They now sit calmly above the copyright in the footer, freeing horizontal space so the category pill row stays readable.",
        ],
      },
    ],
  },
  {
    version: "1.2.9",
    date: "2026-05-25",
    title: "Categories wrap to multiple rows + no more imageless cards on the public feed",
    sections: [
      {
        heading: "Navigation",
        items: [
          "Category pills now wrap to as many rows as needed (usually two) instead of trying to fit on one horizontally-scrolling line. You see every category at a glance.",
        ],
      },
      {
        heading: "Bug fix",
        items: [
          "Cards without a header image will no longer show on the public Acts feed. Tightened the approval gate two ways: (1) cards now have to be explicitly `adminApproved: true` (not just missing the false flag), and (2) any imageless card is hidden from non-admin viewers as a defense-in-depth guard. Admins still see imageless cards in the Pending tab so they can add an image.",
        ],
      },
    ],
  },
  {
    version: "1.2.8",
    date: "2026-05-25",
    title: "\"Show completed acts\" moved into the Sort menu",
    sections: [
      {
        heading: "Navigation",
        items: [
          "The \"Show Done\" toggle no longer takes up its own slot in the filter row. It now lives inside the Sort dropdown (with a divider line above it) so the top bar stays focused on filters. Only shows up once you've actually marked an Act as done.",
        ],
      },
    ],
  },
  {
    version: "1.2.7",
    date: "2026-05-25",
    title: "Stale browser cache can no longer flash deleted/pending cards",
    sections: [
      {
        heading: "Bug fix",
        items: [
          "ResistAct stashes the first page of Acts in your browser's localStorage so the next visit paints instantly. But that snapshot could include cards that have since been deleted, demoted, or had images removed — and on first paint they'd flash briefly before the live sync replaced them. Now the cache only revives cards that were explicitly `adminApproved: true` when saved. No more ghost cards.",
        ],
      },
    ],
  },
  {
    version: "1.2.6",
    date: "2026-05-25",
    title: "All Acts categories live in the top bar now",
    sections: [
      {
        heading: "Navigation",
        items: [
          "Categories on the Acts page are now inline pills across the top bar instead of being hidden behind a \"Category\" dropdown. You can see every category at a glance, click any pill to filter, click again to clear. On phones (under 640px) the dropdown still appears, since there's no room for the pill row there.",
        ],
      },
    ],
  },
  {
    version: "1.2.5",
    date: "2026-05-25",
    title: "Cards without images get hidden from the public again",
    sections: [
      {
        heading: "Bug fix",
        items: [
          "Some action cards without header images were leaking onto the public feed even though they were supposed to be in the admin Pending queue. Re-bumped the \"approved-without-image-cleanup\" migration so it runs again on next deploy and flips all imageless approved cards back to pending. Also bumped the seed version so the new image URLs wired up earlier this week actually land in KV.",
        ],
      },
    ],
  },
  {
    version: "1.2.4",
    date: "2026-05-25",
    title: "Shorter card banners — more cards on screen, less visual weight",
    sections: [
      {
        heading: "Visual Polish",
        items: [
          "Cut the action-card banner image height from 160px to 108px (about a third shorter). Cards take less vertical space, so more fit on screen and the title/description finally outweigh the image. Pairs with yesterday's saturation change to make the Acts grid feel calmer.",
        ],
      },
    ],
  },
  {
    version: "1.2.3",
    date: "2026-05-25",
    title: "Calmer Acts grid — banner images desaturate at rest",
    sections: [
      {
        heading: "Visual Polish",
        items: [
          "Acts page felt overwhelming because 12 cards in a row were each showing a wildly different brightly-colored banner image. Banner images now sit at 55% saturation by default, then pop back to full color when you hover the card you're considering. The grid reads calmer; the card you're focused on still feels alive.",
          "Tweak the strength later by editing the 0.55 in the .resistact-banner-desat rule (animations.ts) — 0.7 is subtle, 0.3 is editorial.",
        ],
      },
    ],
  },
  {
    version: "1.2.2",
    date: "2026-05-24",
    title: "Smacks now have a pencil-edit button (admin)",
    sections: [
      {
        heading: "Admin",
        items: [
          "Smack tiles now show a pencil icon next to the delete trash icon (for approved smacks) and next to the Approve button (for pending smacks). One click opens an edit modal pre-populated with the smack's title, image, caption, source URL, source label, and tags — same field surface as the Add Smack modal.",
          "The pencil only appears on KV-stored smacks (ids below 5000). Hardcoded static smacks (the ResistAct hero, the cross-stitch voodoo doll, etc. — ids 5000+) live in code, so editing them still requires a code change — the pencil is hidden for those.",
          "Image swap supported: upload a new file via the orange button (same flow as Add Smack), or paste a new URL directly.",
        ],
      },
    ],
  },
  {
    version: "1.2.1",
    date: "2026-05-24",
    title: "5 Minutes Max filter now actually only shows quick actions",
    sections: [
      {
        heading: "Filters",
        items: [
          "Fixed a bug where the '5 Minutes Max' filter was showing multi-hour in-person protests (e.g. the Tukwila ICE protest and the Seattle NO WAR / NO KINGS rally). The state-local upcoming-events pin band that v1.2.0 added wasn't respecting filter chips — it was lifting any upcoming event in your Match Me state to the top of the feed even if a filter said you didn't want it. Now the pin band runs every candidate through the same filter pipeline as the rest of the grid, so '5 Minutes Max', Category, Location, and Search all apply to pinned events too.",
        ],
      },
      {
        heading: "Data cleanup",
        items: [
          "Audited every approved action with quickAction=true and cleared the flag on 15 cards that aren't actually 5-minute actions — cross-stitch projects, joining a rapid-response network, joining a faith federation, an in-person ice cream social, etc. PURCHASE cards (3 stickers/shirts/candles) were intentionally kept as quick — buying something is genuinely a 5-minute checkout flow.",
          "Full audit report at reports/audit-2026-05-24.md for the curious.",
        ],
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-05-24",
    title: "State-local upcoming events pin to the top of Match Me, three new admin audit tools, and an automated inbox importer",
    sections: [
      {
        heading: "Match Me",
        items: [
          "When you've told Match Me your state, any card with an upcoming event date in that state now pins to the top of your matched feed — ahead of every score-based result. The matcher's state bonus (+6) plus its event-proximity bonus (up to +10) could be out-scored by a strong tone match, which meant a rally in your city next week could slip below an online petition. The new hard-pin guarantees the local-and-imminent stuff is the first thing you see, sorted soonest-first. Applies in all sort modes (Popular, A–Z, Newest).",
          "Respects your other Match Me preferences. If you've set Location to 'Remote only', in-person rallies in your state will NOT be pinned (or otherwise surface) — the pin layer now runs `settingMatches` before lifting anything.",
          "For admins, the 'still pending' cards that get appended to your matched feed are also now filtered by Setting + State. Toggling Remote-only actually hides in-person pending cards from the consumer feed view — the AdminPanel queue still shows everything for approval.",
        ],
      },
      {
        heading: "Admin Panel — three new audit tools",
        items: [
          "Big images: lists every stored card image over 500 KB, with a one-click Optimize button per row that round-trips through a new server endpoint to decode (ImageScript), resize to 1200 px wide max, re-encode same format, upload to the bucket, and update the card. Bails if recompression doesn't actually save bytes. The list trims as you optimize.",
          "Broken images: HEAD-checks every card's topImageUrl against a configurable frontend origin (defaults to the browser's current origin) and lists any that 404 or network-error. Catches the case where someone deletes a root-public asset and the database still references it. Built after a cleanup pass blew away ~50 root-public images that were referenced from cards but not from source code.",
          "URL = Author link: lists every card where `targetUrl` and `authorLink` normalize to the same URL. Usually a sign that the bulk-importer set both fields to the source URL and the card never got a distinct creator-homepage link.",
        ],
      },
      {
        heading: "Inbox importer",
        items: [
          "New `tools/import_inbox.py` reads every JSON file the Cowork scout drops in `data/inbox/` and pushes the contained acts through the existing `/admin/bulk-import` endpoint. Two-layer dedup: client-side pre-filter against the live `/actions` inventory (catches cross-source URL collisions), plus the server-side fingerprint (catches re-runs of the same import).",
          "Image enrichment dispatched per platform: Bluesky via the public no-auth API (banner > avatar), TikTok via the inline `avatarLarger` JSON in the initial HTML, YouTube and Substack via og:image scrape with a browser User-Agent. Instagram, Threads, and Facebook are JS-rendered so they land image-less — admin upload required.",
          "Daily scheduled task `resistact-import-inbox` runs at 19:06 local time and triggers the importer. Token loaded from `~/.config/resistact/admin-import-token` (NOT in this repo). Empty inbox is a no-op exit.",
        ],
      },
      {
        heading: "Behind the scenes",
        items: [
          "Cleaned ~80 MB of unreferenced files out of `public/` (mostly orphaned `.png` duplicates of `.webp` images that were actually being served) plus ~3 MB of unused hashed Figma exports in `src/assets/`. Converted `og-image-v3.jpg` → `og-image-v3.webp` (94 KB saved).",
          "Added a sweep migration that demotes any approved card missing either a `targetUrl` or an image (no `topImageUrl`/`topImageKey`) to `adminApproved: false` so it lands in the pending queue. Skips `pinToTop` cards.",
          "Recovered three cards lost to a race condition during a multi-instance migration: Tom Morello (relocated to id 2147), Hartford Yarn Works (2148), Morning Crafter (2149). Patched five regional-event cards that were stored with mobilize.us search URLs as their action link — now point at each org's actual mobilize organizer page.",
          "Bulk-marked the 'Cancel your X' BOYCOTT cards as `5–10 minutes` (was `Ongoing`).",
        ],
      },
    ],
  },
  {
    version: "1.1.52",
    date: "2026-05-24",
    title: "Branded 'Join the Resistance' smack now pinned to the top of the Smacks page",
    sections: [
      {
        heading: "The Smacks",
        items: [
          "A new branded ResistAct smack is now permanently at the top of the Smacks page — regardless of which sort you're using (Top, New, or — for admins — Pending), and regardless of any active tag filter or search query.",
          "Pinning is opt-in per smack (a new `pinToTop` flag on the static smack definitions). Right now exactly one smack is pinned. Pinning more would require deciding how to order the pinned cards among themselves; right now there's no rule for that.",
          "The image was uploaded as a 3.2 MB PNG. We converted it to WebP (517 KB — 84% smaller) for the in-grid render. The original PNG is preserved as `ResistActSmack.png` so the 'Download high-res' button still hands you the full-quality file.",
        ],
      },
    ],
  },
  {
    version: "1.1.51",
    date: "2026-05-24",
    title: "Admin: bulk-approve only the pending cards that have an image",
    sections: [
      {
        heading: "Admin",
        items: [
          "New '✓ Approve N with images' button in the Pending-approval banner, sitting next to the existing '✓ Approve all N showing'. One click bulk-approves only the visible pending cards that already have a top image — leaving imageless ones in pending for you to upload an image to before they can go live.",
          "The button only appears when some — but not all — visible pending cards have an image. If everything has an image, the existing 'Approve all' button covers it; if nothing does, the new button is hidden.",
          "Background: the server rejects approval on any card without a topImageUrl or topImageKey. Before this change, hitting 'Approve all' on a mixed batch surfaced one error per imageless card and partially-approved the rest. The new button lets you separate the easy approvals from the cards that still need image uploads in one pass.",
        ],
      },
      {
        heading: "Fixes",
        items: [
          "Fixed a 'Something went wrong — Cannot access todayISO2 before initialization' crash that could appear on page load. Caused by yesterday's upcoming-event boost code referencing a constant that was declared further down the file; reordered so the constant is in place before any function tries to read it.",
        ],
      },
    ],
  },
  {
    version: "1.1.50",
    date: "2026-05-24",
    title: "Upcoming events rise toward the top + new Broken-images admin tab",
    sections: [
      {
        heading: "Sorting",
        items: [
          "Actions with an upcoming event date now get a sort lift — the closer the event, the bigger the lift. A protest tomorrow will surface near the top of the feed even if it has zero boosts yet; an event in a month gets a small bump; events past today are still hidden as before.",
          "The lift applies to the default 'Popular' sort and to Match Me results. The explicit 'A–Z' and 'Newest' sorts are unchanged — those are user-chosen orderings, so we leave them alone.",
          "Tuned so a strong evergreen card with lots of engagement can still outrank a low-engagement event happening next week — events compete fairly with popular cards rather than always jumping the queue. If a flagship action has 100 boosts and the protest tomorrow has 0, the flagship still wins; if the flagship has 20 boosts, the protest passes it.",
        ],
      },
      {
        heading: "Admin",
        items: [
          "New 'Broken images' tab in the admin panel. It scans every card's top-image URL and lists any that 404 or fail to load, with the HTTP status / error and a Pending badge if the card is unapproved. Use this when a third-party site (Indivisible, NAACP, etc.) rotates an image and our cached link goes dead — you can find the dead ones in one place instead of hunting through the feed.",
          "The scan is slow (one HEAD request per card through the edge function) so it runs on tab-entry and then manual Re-scan only. Frontend origin is pre-filled but editable — useful for checking what resistact.org sees vs. what localhost sees.",
        ],
      },
    ],
  },
  {
    version: "1.1.49",
    date: "2026-05-24",
    title: "Seven new actions imported from a TSV scout batch, all waiting in Admin → Pending",
    sections: [
      {
        heading: "What's new",
        items: [
          "Imported 7 curated actions from a 27-row scout spreadsheet: Indivisible calls to block Trump's $1.8B insurrection slush fund and end the Cuba blockade, plus five in-person events (Seattle NO WAR/NO KINGS, Tukwila ICE HQ protest, Boston Trump Takedown, DC Epstein protest walk interest meeting, Corte Madera CA banner drop).",
          "Each card lands in Admin → Pending with its og:image already attached, so an admin can one-click approve.",
        ],
      },
      {
        heading: "What we rejected",
        items: [
          "20 of the 27 rows were dropped: 8 were exact URL dupes of existing seed cards, 6 had homepage-only links (firstfriendsnjny.org/, raicestexas.org/get-involved/, mijente.net/get-involved/, etc.) where the action URL was identical to the org's source URL, 6 more were event-level duplicates where a different mobilize event ID pointed to the same recurring action already on the site.",
        ],
      },
    ],
  },
  {
    version: "1.1.48",
    date: "2026-05-24",
    title: "Acts catalogue load time cut from 20 seconds to ~1.5 seconds",
    sections: [
      {
        heading: "Performance",
        items: [
          "Yesterday's 'single big fetch' (1.1.47) didn't actually help because the bottleneck wasn't pagination — it was the server. Today the server takes ~1.5 seconds to respond instead of ~20. The blank card shells you were seeing for 20+ seconds on cold loads should be gone.",
          "Two backend fixes did the heavy lifting: (1) the catalogue assembly used to fetch every user-submitted card with its own separate database call — ~450 calls in a chain, one after another. Replaced that with a single batched query. (2) On every request, the server was also re-checking ~40 one-time migration flags one at a time. Now it batches them into a single query and remembers the results.",
          "What you'll notice: the 'Matched for you' banner should fill in almost instantly on a normal connection. Fewer 'Showing 3 actions' moments. Cards stop appearing as empty grey rectangles while the rest of the catalogue loads.",
          "No behaviour change for users. Admins should still see card edits and approvals reflected immediately in their own panel; the public feed updates within ~15 seconds.",
        ],
      },
    ],
  },
  {
    version: "1.1.47",
    date: "2026-05-23",
    title: "Faster first-load — the whole catalogue arrives in one request",
    sections: [
      {
        heading: "Performance",
        items: [
          "The Acts catalogue used to load in 6 chained requests of 100 cards each, with each request paying the edge function's cold-start latency. We've raised the server's per-request cap from 100 to 2000 and switched the client to a single drain — the whole ~600-card catalogue now arrives in one round-trip instead of six.",
          "Net effect on a cold edge function: roughly 3 seconds saved on first page load. The 'Matched for you' banner should jump to its final number almost immediately on most networks, and you should stop seeing 'Showing 3 actions' linger while the rest of the cards trickle in.",
          "Cache and fallback paths preserved: if the catalogue ever grows past 2000 cards, the client falls back to paginated drain for the remainder. No behaviour changes for users; just less waiting.",
        ],
      },
    ],
  },
  {
    version: "1.1.46",
    date: "2026-05-23",
    title: "Match Me banner now shows when more cards are still loading",
    sections: [
      {
        heading: "Match Me",
        items: [
          "The 'Matched for you. Showing N actions.' banner now shows a small spinner and '(125/587) loading more…' message while the rest of the catalogue is still streaming in from the server. Before this, you'd land on the page, see '3 matches' before the rest of the cards had loaded, and assume the matcher was broken — when really it just needed another second or two to finish the sync.",
        ],
      },
    ],
  },
  {
    version: "1.1.45",
    date: "2026-05-23",
    title: "Match Me — relaxed the over-aggressive filter that was returning only 3 cards",
    sections: [
      {
        heading: "Matcher",
        items: [
          "Yesterday's 'max-slider hard filter' (1.1.44) went too far — setting any slider to its maximum (e.g. Humor: Full mockery) was eliminating every card with zero of that tone, which wiped out 17 of 23 categories at once. Combined with other slider preferences, the result was 3-card matches.",
          "Made the hard filter asymmetric: setting a slider to NONE still hard-filters out cards with that tone at FULL (e.g. picking Humor: None still drops Full-mockery cards — you explicitly said you don't want it). But setting a slider to MAX no longer hard-filters cards with zero of it — the soft undershoot penalty from 1.1.43 still pushes them down the ranking, but they remain available when better-matching cards are scarce.",
          "Net effect: you should now get a healthy 15-30 matches instead of 2-5, with the cards that best fit your sliders ranked first.",
        ],
      },
    ],
  },
  {
    version: "1.1.44",
    date: "2026-05-22",
    title: "Match Me — max-slider settings now actually mean it",
    sections: [
      {
        heading: "Matcher",
        items: [
          "Slamming a tone slider to its extreme (Full mockery, None, In-the-streets, Full hope, On fire) is now a hard filter: cards with zero of that dimension are dropped entirely, not just penalised. Before 1.1.44, setting Humor to Full mockery would still surface popular serious petitions because their time + engagement bonuses outweighed the soft tone penalty. Now a card with comedy=0 is removed from the matched feed for any user with comedy=3, no exceptions.",
          "Same in the other direction: setting Humor to None drops Full-mockery cards entirely, instead of relying on the soft overshoot penalty.",
          "Soft penalty still handles the in-between gaps (e.g. you want Bold, card is Mild — still surfaces but ranked lower).",
        ],
      },
    ],
  },
  {
    version: "1.1.43",
    date: "2026-05-22",
    title: "Match Me sliders now work in BOTH directions",
    sections: [
      {
        heading: "Matcher",
        items: [
          "The matcher's tone sliders now penalise cards that are colder than what you asked for — not just hotter. Before 1.1.43, setting Humor to Full mockery would still surface serious petitions because their hope/anger scores added up to a passable match even though they had zero humor. Now a card that's cooler than your slider position by 2+ stops gets pushed down proportionally, mirroring the overshoot penalty that 1.1.37 added in the other direction.",
          "Symmetric weights — moving any slider in either direction has the same magnitude of effect on which cards bubble up.",
          "Cards that are only 1 stop cooler than your preference still pass through unpenalised, so a 'Mild' card still surfaces when you ask for 'Bold' (close enough). The penalty only fires from a 2-stop gap upward.",
        ],
      },
    ],
  },
  {
    version: "1.1.42",
    date: "2026-05-22",
    title: "Match-me banner chips are now actually small",
    sections: [
      {
        heading: "Match Me",
        items: [
          "The preference chips under the 'Matched for you' banner (5-10 min, Confrontational: Low, Humor: None, etc.) were rendering at ~13px instead of the intended 10px because browsers don't inherit font-size into <button> elements by default — the parent container's text-[10px] was being silently overridden. Set the font size explicitly on each chip so they read at the size they were supposed to all along.",
        ],
      },
    ],
  },
  {
    version: "1.1.41",
    date: "2026-05-22",
    title: "Retired past-dated event and petition cards",
    sections: [
      {
        heading: "Cleanup",
        items: [
          "Removed six cards whose described dates had already passed: the Trans Peoria potluck (May 17), the Ethical Consumer Trump-boycott guide (Mar 20), the NAACP 25th Amendment petition (Apr 7), the Citrus Heights Resists ICE! Saturday rally (May 16), the Pretrial Fairness teach-in (May 9), and MoveOn's No Unauthorized War with Iran petition (Apr 20).",
          "Kept the Sierra Club South Coast clean-air petition — Sierra Club is still actively campaigning on it — and Adopt-A-Corner, which runs through Jan 2029 (the date in its description was a program kickoff, not a deadline).",
        ],
      },
    ],
  },
  {
    version: "1.1.40",
    date: "2026-05-22",
    title: "Quick Match Tool — skip whole categories you can't or won't do",
    sections: [
      {
        heading: "Match Me — Skip these",
        items: [
          "New collapsible \"Skip these\" section in the Quick Match Tool, below the tone sliders. Click any category chip — Petition, Crafting, Email Campaign, Protest, etc. — to hide that whole category from your matches. Categories are grouped into themed rows (Make / Do, Reach Out, Show Up, Care, Money / Stuff, Other) so the chip grid is scannable instead of being one long wall of 26 chips.",
          "Excluded categories are hard-filtered from results — same way Setting and State mismatches are filtered today — so a hidden category never sneaks back in via a strong tone score.",
          "The \"Matched for you\" banner gets a new chip: \"Hiding N categories\" — click it to reopen the Match Tool and adjust which categories are hidden.",
          "Exclusions sync to your account when you're signed in (same path as the rest of your match prefs), so they follow you across devices.",
        ],
      },
      {
        heading: "Match Me — smarter on its own",
        items: [
          "When you click \"Not a great match\" on three cards in the same category, the tool now offers to hide that whole category for you. Two buttons: \"Yes, hide\" (adds it to your skipped categories going forward) or \"No, keep showing\" (we'll never ask again for that category).",
          "Builds on the dismissal log that was already being recorded — we just hadn't done anything with it yet.",
        ],
      },
    ],
  },
  {
    version: "1.1.39",
    date: "2026-05-22",
    title: "Made the action-card imports race-safe so cards stop getting dropped",
    sections: [
      {
        heading: "Under the Hood",
        items: [
          "Fixed the race condition that caused us to lose Tom Morello, Hartford Yarn Works, and The Morning Crafter across two deploys last week — when the edge function scales up during a deploy, two instances would run a batch-import at the same time, both write the same list of card-ids back to the index using last-write-wins, and the second write would overwrite the first instance's additions. The card records still existed in the database, but they were invisible to the public feed because the index didn't know about them.",
          "All card-adding migrations now go through a shared helper that: re-checks each card's id before insert (skip if already present, bump to a new id if a different card is using it), commits the index update per-card instead of once-at-the-end (so a concurrent run can shadow at most one id, not a whole batch), and runs a final set-union reconciliation in case anything else wrote during the loop.",
          "The self-heal pass that catches dropped cards now runs once per warm process (i.e. on every deploy/cold-start) instead of once forever — so any future drift gets cleaned up automatically the next time the edge function restarts.",
        ],
      },
    ],
  },
  {
    version: "1.1.37",
    date: "2026-05-22",
    title: "Match Me sliders now actually filter out cards that don't match",
    sections: [
      {
        heading: "Matcher",
        items: [
          "Fixed a bug where setting a tone slider to its lowest position (e.g. 'Humor: None', 'Confrontational: None') didn't actually exclude cards that were high on that dimension — it just stopped giving them a bonus. So if you set Humor to None and another card was both confrontational AND full mockery, the matcher would still surface it because the anger match outweighed the humor mismatch.",
          "The scorer now penalises cards whose tone is hotter than what you asked for on any dimension. Set Humor: None and a Full-mockery card will be pushed below the score floor and dropped from your matches — instead of sneaking in via its anger or subversion score.",
          "Cards that are calmer than you asked for (e.g. you want full mockery, card is mild) still surface — the penalty only applies when the card overshoots your preference, not when it undershoots.",
        ],
      },
    ],
  },
  {
    version: "1.1.36",
    date: "2026-05-22",
    title: "Cleaned up the Google Analytics debugging logs",
    sections: [
      {
        heading: "Under the Hood",
        items: [
          "Removed the temporary console-log instrumentation that was added to the analytics module while we were tracking down why GA was receiving zero data. The wiring is confirmed working, so the play-by-play logs aren't needed anymore. The error-path log is kept (so any future blocker / DNS issue shows up clearly in DevTools), but the normal success path is silent again.",
        ],
      },
    ],
  },
  {
    version: "1.1.35",
    date: "2026-05-22",
    title: "Images wired for 8 new action cards",
    sections: [
      {
        heading: "Action Cards",
        items: [
          "Added header images to 8 recently-added cards: Feline & Floss (#FuckICE pattern), Carlyn Yandle (Trumpiñata), BAD Stitch (Bluesky), The Morning Crafter, mockpolitrick (TikTok), Nikola Protests Tesla, and the two Songs for Liberation / TACO Meme TikTok cards (which use the TikTok logo as a placeholder).",
          "9 Etsy-sourced cards still need images — they're in the Incomplete tab of the admin panel waiting for manual upload.",
        ],
      },
    ],
  },
  {
    version: "1.1.34",
    date: "2026-05-22",
    title: "New Smack — The Supreme Court",
    sections: [
      {
        heading: "New Smacks",
        items: [
          "Added \"Rules for You. Power for Them.\" — breaks down all six conservative justices: luxury gifts, partisan flags, rolled-back rights, and a supermajority locked in for a generation.",
        ],
      },
    ],
  },
  {
    version: "1.1.33",
    date: "2026-05-22",
    title: "Smacks get better titles (and two stubborn ones removed)",
    sections: [
      {
        heading: "Smacks",
        items: [
          "All 26 Smack titles rewritten to actually describe what's in the image — funny, sharp, and shareable.",
          "Removed the ResistAct logo and Richer chart smacks permanently so they stop coming back after being deleted.",
        ],
      },
    ],
  },
  {
    version: "1.1.32",
    date: "2026-05-22",
    title: "Smacks load faster — all images now WebP",
    sections: [
      {
        heading: "Performance",
        items: [
          "All 28 Smack images now served as WebP instead of PNG/JPG. WebP is typically 25–35% smaller at the same quality, so the Smacks page loads noticeably faster, especially on mobile.",
        ],
      },
    ],
  },
  {
    version: "1.1.31",
    date: "2026-05-22",
    title: "2 new Smacks — RFK Jr. & Trump's reflecting pool",
    sections: [
      {
        heading: "New Smacks",
        items: [
          "Added \"America's Health? Stripped, Confused & Rockin'\" — RFK Jr.'s qualifications laid bare: no medical degree, anti-vax activist, raw milk devotee, conspiracy promoter. Share it.",
          "Added \"Painting History\" — Trump spent $13 million in taxpayer money painting the Reflecting Pool with non-waterproof paint while the actual plumbing problem remains. Share it.",
        ],
      },
    ],
  },
  {
    version: "1.1.29",
    date: "2026-05-22",
    title: "Google Analytics fix",
    sections: [
      {
        heading: "Under the Hood",
        items: [
          "Fixed a bug that was silently preventing Google Analytics from receiving any data. The tag was initializing correctly but sending events in a format GA4 does not accept. All visits, completions, and shares should now be tracked.",
        ],
      },
    ],
  },
  {
    version: "1.1.28",
    date: "2026-05-20",
    title: "15 new craftivism & merch actions",
    sections: [
      {
        heading: "New Actions",
        items: [
          "Added 15 new Resistance Acts across Crafting, Art/Performance Art, Social Media, and Spread Positivity — pins, stickers, banners, patterns, coloring books, piñatas, and parody songs.",
          "Highlights: \"Cleanup on Aisle 47\" pin, \"Mars Can Keep Him\" anti-Elon bumper sticker, free #FuckICE cross-stitch from Feline & Floss, anti-Trump coloring book, build-a-Trumpiñata how-to, and mockpolitrick's Trump pardon parody song.",
        ],
      },
    ],
  },
  {
    version: "1.1.27",
    date: "2026-05-20",
    title: "Search is now fast",
    sections: [
      {
        heading: "Performance",
        items: [
          "Searching Resistance Acts is now significantly faster. The card list was being fully re-filtered and re-sorted on every single keystroke (575 cards each time). It now caches the result and only recomputes when you stop typing, so keystrokes are instant.",
        ],
      },
    ],
  },
  {
    version: "1.1.26",
    date: "2026-05-20",
    title: "Search loading indicator",
    sections: [
      {
        heading: "Search",
        items: [
          "Typing in the search box now shows a spinner and dims the card grid while results update. Previously the UI went silent for a moment with no feedback, making it feel broken.",
        ],
      },
    ],
  },
  {
    version: "1.1.25",
    date: "2026-05-20",
    title: "Smacks overhaul, category cleanup, feedback fixed, UX polish",
    sections: [
      {
        heading: "Smacks",
        items: [
          "Deleted smacks now stay deleted across all your devices. Previously the delete was stored in your browser's localStorage, so switching machines or clearing your browser brought them back. Deletes are now recorded server-side.",
          "Deleting a smack now asks 'Sure? Yes / No' before removing it — no more accidental deletes.",
          "Smacks filter tags completely overhauled. Every smack previously had 'Trump' and 'MAGA' as its only tags, making filtering useless. Tags are now topic-based: Accountability, Corruption, Democracy, Economy, Elections, Fascism, Foreign Policy, Humor, Inequality, MAGA, Politics, Voting Rights, and more.",
        ],
      },
      {
        heading: "Category cleanup",
        items: [
          "Art/Performance Art cards were stored as 'Art Piece' internally, causing a mismatch in the edit panel. All fixed — they now display and filter correctly.",
          "The 'Yes Men' prank toolkit card was miscategorized as 'Irreverence' (a one-off category with no UI support). Moved to Art/Performance Art where it belongs.",
          "'Letter Writing' removed from category dropdowns — it had zero cards and was a duplicate of 'Letter to Editor'.",
          "8 cards stuck in 'Other' properly recategorized: candidate training programs → Training, save-gov-pages / read-banned-books / set-election-reminders → Personal Commitment, DOJ rep training → Professional Skills.",
        ],
      },
      {
        heading: "Feedback",
        items: [
          "The feedback form now actually sends. It was previously opening your default email app via a mailto: link, which silently did nothing for most users (Gmail-in-browser, no default mail app configured). Messages now go directly to the server and arrive in email via Resend.",
        ],
      },
      {
        heading: "Small fixes",
        items: [
          "'I did this' button now says 'I did this!' (with the exclamation mark).",
          "Match preference chips below the matched-for-you banner are slightly smaller — they were oversized relative to the surrounding text.",
        ],
      },
    ],
  },
  {
    version: "1.1.24",
    date: "2026-05-20",
    title: "New Purchase category, admin panel improvements, server-side streak tracking",
    sections: [
      {
        heading: "New category: Purchase",
        items: [
          "Added a new 'Purchase' category (amber) for acts that involve buying from resistance-aligned businesses, makers, and merch sellers.",
          "31 cards recategorized from Boycott, Funding, Irreverence, and Crafting into Purchase — including all the buy-merch, buy-from-Black/Native-owned-businesses, and buy-sticker/tee/pin cards.",
        ],
      },
      {
        heading: "Admin panel",
        items: [
          "Users tab is now the default when opening the admin panel — no more waiting for the cards list to load on open.",
          "Tab row replaced with a compact dropdown — fits all five sections without overflow.",
          "Stat chips (Total, Active, Pending, Approved, Rejected) are now clickable to filter the user list directly.",
          "New 'Sync from Supabase' button audits every Supabase auth account against KV approval records and seeds any missing ones — so users who slipped through the signup flow now appear in the admin list.",
          "Admin to-do count moved from the bell icon to below your name in the navbar ('Admin To Dos: N' in red, 'Admin ✓ All clear' in green). Bell icon removed.",
        ],
      },
      {
        heading: "Visit streak",
        items: [
          "Day streak is now tracked server-side so it persists across all your devices and browsers. Previously it was stored in localStorage and would reset whenever you switched devices.",
        ],
      },
    ],
  },
  {
    version: "1.1.23",
    date: "2026-05-19",
    title: "Facebook share fixed on iPhone",
    sections: [
      {
        heading: "Sharing",
        items: [
          "Facebook sharing on iPhone now opens the mobile web share page reliably. Previous attempts used app-specific URLs that launched the Facebook app but produced no post. The share button now opens a browser-based share dialog the same way Threads does — desktop behavior unchanged.",
          "Bluesky sharing on iPhone now copies the text to your clipboard (same as Instagram and TikTok) since the Bluesky app intercepts the web intent URL but doesn't act on it. Desktop keeps the direct web intent.",
        ],
      },
    ],
  },
  {
    version: "1.1.22",
    date: "2026-05-19",
    title: "Infinite scroll overhaul, desktop shows all cards immediately",
    sections: [
      {
        heading: "Feed",
        items: [
          "Replaced the IntersectionObserver sentinel with a passive scroll-event listener that loads more cards when within 1200px of the bottom — more reliable across screen sizes.",
          "Desktop now renders all in-memory cards immediately (no batching) so you never hit a wall after the first 100.",
          "Load More button is now visible on all screen sizes, not just mobile.",
        ],
      },
    ],
  },
  {
    version: "1.1.21",
    date: "2026-05-19",
    title: "Preference chips open Match Me at the right step",
    sections: [
      {
        heading: "Match Me",
        items: [
          "The preference chips shown on each action card (time, setting, tone, state, groups, donation focus) were previously decorative. They are now tappable — tapping one opens the Match Me wizard at the relevant step so you can adjust that preference directly.",
        ],
      },
    ],
  },
  {
    version: "1.1.20",
    date: "2026-05-19",
    title: "iOS share fix, 'Incomplete' admin tab, View Larger fix, tighter feed top padding",
    sections: [
      {
        heading: "iOS Facebook share — fixed for both Spread the Word and Smacks",
        items: [
          "iOS Safari was silently blocking `window.open` AND `window.location.assign` when fired from inside a modal's button handler — which is why tapping the Facebook button on iPhone literally did nothing. Switched both share buttons (Spread the Word modal AND the per-Smack share modal) to use programmatic anchor-click: build a real `<a>` element, click it, remove it. Safari treats that exactly like a tapped link, so the popup blocker stays out of the way.",
          "Desktop behaviour intentionally untouched — desktop still uses `window.open` so users don't lose their place on the ResistAct page when sharing.",
        ],
      },
      {
        heading: "Admin 'Incomplete' tab",
        items: [
          "Renamed the 'No URL' admin tab to 'Incomplete'. Same tab, broader filter — it now lists any approved card missing EITHER an action link (`targetUrl`) OR a top image (no `topImageUrl` and no `topImageKey`). Cards that need either piece of info before they can really publish all sit in one place instead of being scattered.",
          "Edge function endpoint `/admin/actions/no-url` updated to match (returns missing-link + missing-image cards). Endpoint path kept as `no-url` for backwards compatibility; only the label changed.",
        ],
      },
      {
        heading: "Smacks 'View larger' fix",
        items: [
          "Clicking 'View larger' on a smack thumbnail was showing a broken-image icon on many smacks. The tile lightbox used a raw `<img src>` while the thumbnail used `<ImageWithFallback>` — so when only the WebP variant shipped on disk (and the PNG/JPG path in the data was stale), the thumbnail still rendered via its `<source srcSet=webp>` while the lightbox 404-ed on the missing original.",
          "Swapped the lightbox to use `ImageWithFallback` so it picks up the same WebP sibling. View larger now works on every smack.",
        ],
      },
      {
        heading: "Polish",
        items: [
          "Removed 32 px of empty whitespace below the navbar filter bar — `<main>` was rendering with `py-8` (32 px top and bottom). Top padding is now `pt-3` so the feed sits right under the filter row; bottom padding kept at `pb-20` so the last card clears the always-on footer.",
        ],
      },
    ],
  },
  {
    version: "1.1.15",
    date: "2026-05-19",
    title: "Spread the Word always-on, Smacks Facebook share fix, OG image cache-bust to v4, title update",
    sections: [
      {
        heading: "Spread the Word always shows first",
        items: [
          "The 'Spread the Word about ResistAct' card is now pinned to position 1 of the Acts feed UNCONDITIONALLY — search, category filter, location filter, Quick Actions toggle, Match Me preferences, the 'Newest' / 'A–Z' sort orders, even after you mark it 'I did this' or run a Match Me with zero results. The pinned card is now pulled out of the working set BEFORE any filter / scorer runs and prepended back at the end, so nothing in the pipeline can drop it.",
          "Same behaviour whether you're logged in, logged out, an admin, or an anonymous visitor.",
        ],
      },
      {
        heading: "Smacks Facebook share fixed",
        items: [
          "The Smacks Facebook share button now opens FB's `sharer.php` popup with each smack's per-smack share URL (`/s/<id>.html`) — and those per-smack pages now correctly point og:image at the smack's actual image (the diagnostic that hard-coded them to the homepage OG was finally reverted, after burning many hours wondering why every smack preview was the homepage image).",
          "After deploy, sharing a smack on Facebook will show that specific smack as the FB post preview — no clipboard paste needed. The smack image is also copied to your clipboard as a belt-and-suspenders backup if you'd rather use it in a regular FB post or DM.",
          "Note: existing FB caches for previously-shared smacks need a one-time refresh in the FB Sharing Debugger (paste the `/s/<id>.html` URL and click Scrape Again twice) — after that, new shares of the same smack auto-preview correctly.",
        ],
      },
      {
        heading: "Open Graph image cache-bust + title update",
        items: [
          "Renamed the homepage OG image file from `og-image-v3.jpg` to `og-image-v4.jpg`. The `v3` filename had been cached by Facebook with the OLD blue-URL artwork; even after the file's bytes on prod were swapped for the new orange-URL design, FB kept returning the cached blue version because it keys its image cache by URL. Same trick we used going v2→v3 — fresh filename forces FB to re-fetch.",
          "Updated `<title>`, `og:title`, and `twitter:title` from 'ResistAct — Citizen Action' to 'ResistAct — Join The Resistance' so the FB share card's title matches the new branding.",
        ],
      },
    ],
  },
  {
    version: "1.1.10",
    date: "2026-05-18",
    title: "Updated Open Graph image, category dropdown deduplication, Spread the Word card polish",
    sections: [
      {
        heading: "Open Graph image refreshed (again)",
        items: [
          "Swapped in a brand-new 1500×1000 ResistAct OG image (logo + JOIN THE RESISTANCE + capitol scene + URL + feature icons + Together-We-Act footer) — full uncropped composition this time so nothing gets cut off in the Spread the Word card body.",
          "Same image used for both `og-image-v3.jpg` (Facebook scrape target) and `og-image.webp` (in-app card render). The card uses `object-cover object-top` so the top of the image is always anchored to the top of the card, regardless of available height.",
          "Updated the og:image:width / og:image:height meta tags in index.html to match the new dimensions so Facebook doesn't try to scale based on stale values.",
        ],
      },
      {
        heading: "Category dropdown deduplication",
        items: [
          "Server-side seed cards mixed uppercase ('FUNDING', 'EMAIL CAMPAIGN', 'BOOST') with the client UI's Title Case ('Funding', 'Email Campaign', 'Boost'). The result: the navbar Category dropdown showed BOTH 'Funding' and 'FUNDING' as separate filter options.",
          "Added a `normaliseCategory()` helper in resolveCard() that converts every card's category string to canonical Title Case (with stopwords like 'of', 'to', 'and' staying lowercase — so 'Letter to Editor' stays correct). Both the dropdown and the filter comparison now use the same normalized form, so duplicates collapse.",
        ],
      },
      {
        heading: "Spread the Word card polish",
        items: [
          "The 'Spread the Word about ResistAct' card image now anchors to the top of its container (`object-top`) so the logo + JOIN THE RESISTANCE tagline + Margaret Mead quote are always visible at a glance instead of being scaled out of the crop.",
          "Pulled the canonical card image into a `SPREAD_THE_WORD_TOP_IMAGE` constant so the override has a single source of truth alongside the existing `SPREAD_THE_WORD_DESCRIPTION`.",
        ],
      },
    ],
  },
  {
    version: "1.1.9",
    date: "2026-05-18",
    title: "Refreshed Open Graph image, Smacks filter row in the navbar, Spread the Word card branding fix",
    sections: [
      {
        heading: "New Facebook share preview",
        items: [
          "Swapped `og-image-v3.jpg` and `og-image.webp` for a freshly designed 1200×630 share preview (Facebook's exact 1.91:1 recommended aspect ratio, ~253 KB JPG / ~228 KB WebP). No more awkward cropping at the bottom inside the FB share popup.",
          "Cropped to keep the JOIN-THE-RESISTANCE logo, capitol illustration, URL band, and the four-icon 'tool for everyone' panel all front-and-center; the decorative footer strip is trimmed off.",
        ],
      },
      {
        heading: "Smacks filter row moved into the navbar",
        items: [
          "The tag chips (Corruption, Economy, Fascism, MAGA, ResistAct, Trump, Voting Rights, …) and the Top / New / Pending sort toggle used to live in their own row below the 'What's a Smack?' intro card — making two filter rows stacked on top of each other.",
          "Lifted the smacks filter state (active tags + sort) up to App so both Navbar and SmacksPage can read it. Navbar now renders the chips + sort inline in its filter bar when you're on The Smacks tab, sitting on one row with the act/fact/smack counts.",
          "Hid the generic 'SORT Popular' dropdown on The Facts and The Smacks since it only ever drove The Acts feed — having it on the other tabs was a dead button.",
        ],
      },
      {
        heading: "Spread the Word card image fix",
        items: [
          "The pinned 'Spread the Word about ResistAct' card was still showing the old 'RESISTACT — CITIZEN ACTION' illustration because that image URL was baked into the server-side KV record. `resolveCard()` now overrides the topImage for any pinToTop card with the canonical `/og-image-v3.jpg`, same pattern as the description override that was already there.",
          "Add to The Smacks / Submit to The Smacks button now lives in the top-right corner of the 'What's a Smack?' intro card — putting the submission affordance right next to the explanation of what users are creating.",
        ],
      },
      {
        heading: "Per-Smack share previews (the saga)",
        items: [
          "Tried hard to get Facebook to render a different OG preview for each smack share URL (`/s/<id>.html` static stubs with per-smack og:image). Removed the `<meta http-equiv=\"refresh\">` redirect after discovering FB follows it and then re-reads the destination's OG tags. Stripped the stub down to bare minimum HTML to rule out structural parser issues. Tested with WebP images, JPG images, the homepage og-image, fresh cache-bust URLs FB had never seen — every scrape still returned 'Could not resolve hostname / Response Code 0' on the `/s/<id>.html` path while the homepage URL scraped fine.",
          "Conclusion: something at the AWS / CloudFront layer is blocking Facebook's specific scraper IPs on the `/s/*` path. The HTML is correct, the file is reachable from every other source. Investigation paused for now — clipboard-copy + paste into Facebook's composer remains the working share path for individual smacks.",
        ],
      },
      {
        heading: "Polish",
        items: [
          "Quick Match Tool modal tightened up vertically — title + subtitle on one row, slider gaps reduced from 0.5 to 0, less padding around the section divider. Modal should now fit on most screens without scrolling.",
          "Match-results banner chips (`5–10 min`, `Confrontational: High`, etc.) now use simple navy line-icons from lucide-react instead of the previous mix of colourful emojis, so the strip reads as one unified UI element.",
          "Welcome line on the logged-in hero changed from 'Welcome back, [name]' to 'Welcome back to the resistance, [name]'.",
          "Hero match button renamed from 'Quick Acts for Me' to 'Quick Act Matching Tool', subtitle from 'Click here to tailor the options' to 'Let's tailor the options'.",
          "Feedback button now opens a mailto: link AND copies the message to the clipboard, with the success screen explaining both paths — works whether your default mail handler is Apple Mail or Gmail-in-the-browser.",
          "Smack share clipboard-write fixed: PNG canvas conversion (Chrome rejects WebP from clipboard), Promise-based ClipboardItem so the user-gesture context isn't lost, clipboard write before window.open so focus doesn't move first.",
        ],
      },
    ],
  },
  {
    version: "1.1.6",
    date: "2026-05-18",
    title: "Smack share — stripped-down OG stubs to isolate why Facebook scraper kept failing",
    sections: [
      {
        heading: "Diagnostic minimal OG stubs",
        items: [
          "Even after removing the meta-refresh in 1.1.5, Facebook's debug tool kept failing every smack share URL with a misleading 'Could not resolve hostname' error — even brand-new URLs FB had never seen. Reduced the per-Smack stub to the absolute minimum: charset, title, six og:* tags, a JS redirect, and one anchor tag. No canonical, no twitter:* tags, no body image. If FB can scrape this version, the original structure was tripping something in FB's parser. If it still fails, the problem isn't the HTML at all — it's at the AWS/CloudFront layer or in FB's stuck cache for the whole `/s/` path.",
        ],
      },
    ],
  },
  {
    version: "1.1.5",
    date: "2026-05-18",
    title: "Smack share — remove meta-refresh so Facebook actually scrapes the per-Smack OG tags",
    sections: [
      {
        heading: "Per-Smack share previews — meta-refresh fix",
        items: [
          "The Smack share stubs (`/s/<id>.html`) had a `<meta http-equiv=\"refresh\">` to bounce users to the main app. Facebook's scraper, unlike most, FOLLOWS that meta-refresh — landing on `/?smack=<id>`, which is the SPA's index.html with the homepage og:* tags. That's why every per-Smack share preview was coming out as 'RESISTACT.ORG / www.resistact.org' even after the canonical-URL fix in 1.1.4.",
          "Removed the meta-refresh. Redirect is now JS-only (window.location.replace) — Facebook doesn't execute JavaScript, so its scraper reads only the per-Smack og:image / og:title / og:description we wrote and never follows. Real users still get bounced to the right Smack instantly.",
          "After deploy, re-scrape `https://www.resistact.org/s/5001.html` (or any smack) in the FB Sharing Debugger — og:title should now show the smack title and og:image should be the smack image.",
        ],
      },
    ],
  },
  {
    version: "1.1.4",
    date: "2026-05-18",
    title: "Fix Smack share canonical URL (Facebook scrape was returning 403)",
    sections: [
      {
        heading: "Per-Smack share previews — canonical URL fix",
        items: [
          "The 1.1.3 generator wrote a canonical URL of `/s/<id>` (no `.html`) into each Smack share stub, but the actual file on S3 only exists at `/s/<id>.html`. When Facebook tried to validate the canonical URL it got a 403, bailed on the whole scrape, and reported a confusing 'Could not resolve hostname' error in the FB debugger — making the share dialog show the homepage card instead of the Smack image.",
          "Fixed the generator so canonical, og:url, and twitter:url all end in `.html` matching the actual file. Regenerated all 28 share stubs.",
          "After deploying, force-scrape via the FB debugger with a cache-busting query string (e.g. `?v=4`) — FB caches errors aggressively and may need a different URL to re-fetch.",
        ],
      },
    ],
  },
  {
    version: "1.1.3",
    date: "2026-05-18",
    title: "Per-Smack share previews, working feedback email, reliable image-to-clipboard",
    sections: [
      {
        heading: "Per-Smack share previews on Facebook",
        items: [
          "Built a new build-time script (`scripts/generate-smack-share-pages.mjs`) that writes one small static HTML stub per curated Smack into `public/s/<id>.html`. Each stub carries its own `og:image`, `og:title`, and `og:description` pointing at the Smack — so when someone shares a Smack to Facebook, the preview now shows the Smack itself, not the generic homepage card.",
          "Wired the Facebook share button in The Smacks to send `resistact.org/s/<id>.html` to FB's sharer, rather than the bare homepage URL — that's what makes the per-Smack preview appear.",
          "Each share stub does a meta-refresh + JS redirect so anyone clicking the link in a Facebook post lands at the right Smack on the main app (`/?smack=<id>`).",
          "Switched `og:image` to use the smaller WebP sibling (~350 KB vs 2.7 MB PNG) so Facebook's scraper doesn't time out fetching the big seed image.",
          "Added a `prebuild` npm hook so the share pages regenerate automatically every time we build for production. Run `npm run gen:smacks` manually if you just want to update them.",
          "User-submitted Smacks still fall back to the homepage URL — they live in the KV store and would need a server-side `/s/:id` route on the edge function to get per-Smack previews.",
        ],
      },
      {
        heading: "Smacks share — image-to-clipboard fix",
        items: [
          "The 'Copy image to clipboard' button used to silently fail on most browsers because Chrome's clipboard API rejects WebP and our Smacks are served as WebP. We now round-trip the image through a canvas to produce PNG before writing, so the clipboard actually receives the bytes.",
          "Chrome enforces a 'user-gesture' window for clipboard.write — if you await ANY async work first, the gesture is treated as expired and the write is rejected. Rewrote both the Copy and Facebook/Instagram handlers to kick off `clipboard.write` synchronously inside the click event, passing a Promise to ClipboardItem that resolves the PNG blob in the background.",
          "Reordered the Facebook/Instagram flow so the clipboard write fires BEFORE `window.open` — opening the new tab steals focus from the originator, and Chrome refuses clipboard.write once focus is lost. Old order had this backwards, which is why the button felt like it 'did nothing' on desktop.",
          "Removed the 'Share image via…' button on desktop. Browsers like Chrome on Mac do support `navigator.share`, but the macOS share sheet that pops up usually only offers 'Save to Files' — which downloaded the image and made users think the share was broken. Native share now only renders on iOS / Android, where the share sheet actually goes to social apps.",
          "Updated the post-click banner to a loud orange callout that tells users exactly where to paste in Facebook ('What's on your mind?') instead of the previous subtle blue note that people were missing.",
        ],
      },
      {
        heading: "Feedback button now actually emails you",
        items: [
          "The Share Feedback form was POSTing to a Supabase edge-function endpoint that had no email integration — every submission landed in a dead letterbox. Now the form opens a `mailto:` link pre-filled with the user's message, type, and reply address, sent to ellen@meserow.com.",
          "Belt-and-suspenders: the same content is ALSO copied to the clipboard, so users whose default mail handler is Gmail-in-the-browser (which doesn't always honour `mailto:`) can paste straight into a new Gmail tab.",
          "Success state now explains both paths: 'Two ways to send — check your email app, or paste from clipboard into your webmail.'",
        ],
      },
      {
        heading: "Matcher chips — navy line icons",
        items: [
          "The 'Matched for you' banner's preference chips used a mix of colourful emojis (🔥, 😄, 🎭, 🌅, ⚡, etc.) which read as a row of inconsistent Unicode glyphs. Replaced all ten with simple navy line-icons from lucide-react (Clock, Globe, Flame, Smile, VenetianMask, Sun, Zap, MapPin, Users, DollarSign) so the strip reads as one unified UI element.",
        ],
      },
      {
        heading: "Open Graph image — correct aspect ratio for Facebook",
        items: [
          "The previous og-image was 1200×800 (1.5:1), but Facebook's preview window crops to 1.91:1 — which was chopping the bottom of the design off. Regenerated `og-image-v3.jpg` at FB's recommended 1200×630, cropping 30% off the top and 70% off the bottom (losing only the decorative 'Together, We Act' star band).",
          "Also overwrote `og-image.webp` with the same image at the new dimensions for any place that references the WebP variant.",
        ],
      },
    ],
  },
  {
    version: "1.1.2",
    date: "2026-05-18",
    title: "New ResistAct logo lockup, ACT-orange rebrand, smoother Smacks sharing",
    sections: [
      {
        heading: "New logo + brand color",
        items: [
          "New ResistAct logo lockup with the fist + flame, italicised 'ResistAct' wordmark, and 'JOIN THE RESISTANCE' tagline. Replaces the older horizontal logo in the navbar and homepage hero.",
          "Repainted the entire UI's accent orange from the old peach (#fd8e33) to the deeper, more saturated ACT-orange (#ed6624) that lives inside the new logo — applied to 130 spots across 30 files, including the 'Join The Resistance' button, hero pills, focus rings, tier flames, and link hovers. Hover shades darkened to match.",
          "Tightened the hero panel: smaller logo, less vertical padding above and below, and the social pills sit closer to the wordmark so the page reaches the first action card sooner.",
        ],
      },
      {
        heading: "Smacks sharing fixes",
        items: [
          "Facebook share button now opens the actual Facebook composer (sharer.php) instead of dumping you on facebook.com — landing in an active 'create post' box with the image already copied to your clipboard so you can paste with ⌘V.",
          "Instagram share used to silently download the image to disk; now it copies the image to your clipboard first (same as Facebook), then opens Instagram in a new tab. One paste in the post composer and you're done.",
          "The 'Shared' badge on a smack card used to replace the Share button entirely — once you shared once, you couldn't open the modal again. It's now a green 'Share again' button so you can keep going across platforms.",
          "Swapped the Smacks filter chips and sort toggle so the chips sit on the left and the sort sits on the right — matches every other tab and stops the chips from wrapping under the 'What is a Smack' header.",
        ],
      },
      {
        heading: "Social-share preview",
        items: [
          "New 1200×800 Open Graph image (og-image-v3.jpg) with the new ResistAct logo, Margaret Mead quote, feature icons, and 'Together, We Act' footer — replaces the old illustrated preview that Facebook had cached. Filename bumped from v2 to v3 to force every social platform to re-scrape.",
        ],
      },
      {
        heading: "Report-a-problem modal",
        items: [
          "Shortened the flag reason labels from full sentences ('Description or details are wrong') to short single-line phrases ('Details are wrong') so the radio options fit on one row each instead of wrapping to three.",
          "The modal now sizes to your viewport with an internal scroll region — the Cancel / Send report buttons stay pinned at the bottom even on tiny phones, and the radio options no longer push them off-screen.",
          "Radio button labels are no longer bold — they're regular weight so the section headers stay visually distinct.",
        ],
      },
      {
        heading: "Polish",
        items: [
          "The navbar 'Join The Resistance' button now reads 'Sign in or Create an Account…' on the second line, signalling that the flow handles both returning members and new founding-cohort signups.",
          "Site-updating banner copy changed from 'PLEASE BE PATIENT (2 minutes!)' to 'Please be patient if you see any oddities!' — less alarming during quick deploys. The 🔧 emoji bookends are now monochrome white wrench icons (lucide-react) so they don't clash with the navy bar.",
        ],
      },
    ],
  },
  {
    version: "1.1.21",
    date: "2026-05-18",
    title: "Quick-time filter rename, category dropdown, orange match-me toast",
    sections: [
      {
        heading: "Filters",
        items: [
          "Renamed the 'Quick Actions' filter chip to 'I only have 5 minutes tops!' — reads less like a category and more like the user's actual situation.",
          "Acts category filter is now a single dropdown button next to Location. The inline category pills (top-N plus a 'more' overflow) are gone — every category lives inside the dropdown together, so the filter row stays tidy regardless of how many categories are in the dataset.",
        ],
      },
      {
        heading: "Toast polish",
        items: [
          "Scroll-nudge match-me toast redesigned: orange background, larger two-line copy ('Finding it hard to choose?' + 'Let us match you in 30 seconds.'), white CTA button with orange text. Wider (92 vw capped at 480 px) and positioned slightly higher so it clears the footer.",
        ],
      },
    ],
  },
  {
    version: "1.1.1",
    date: "2026-05-18",
    title: "Always-on navy footer, lower-right match-me toast, bolder hero callout",
    sections: [
      {
        heading: "Hero tweaks",
        items: [
          "Bumped the hand-painted 'But what can one person do?' a little bigger and made it visually heavier — the Rock Salt font only ships in one weight, so the extra thickness comes from a matching-orange text stroke rather than a different font weight.",
          "Walked back the red 'one person → ResistAct' cartoon arrow experiment — it kept colliding with the wordmark and didn't read like the rest of the hand-drawn vibe.",
        ],
      },
      {
        heading: "Always-on tagline footer",
        items: [
          "'Pick one. Do it. Share it. Come back tomorrow.' now lives in a navy bar pinned to the bottom of the page on every tab, every scroll position. White type on navy with the orange highlight words preserved.",
          "Added bottom padding to the action grid so the last row of cards doesn't sit underneath the footer.",
        ],
      },
      {
        heading: "Match-me nudge is now a toast",
        items: [
          "The 'Finding it hard to choose?' prompt that used to span the whole bottom of the screen is now a compact navy card in the lower-right corner — clear of the tagline footer.",
          "The toast auto-dismisses after 30 seconds if you don't engage with it, so it doesn't camp out indefinitely.",
        ],
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-05-18",
    title: "New ResistAct wordmark and hero, report-a-problem flag on every act, faster card sync",
    sections: [
      {
        heading: "New ResistAct wordmark",
        items: [
          "Replaced the standalone fist icon + code-styled 'ResistAct' type in the navbar and hero with a single illustrated wordmark: fist of fire on the left, navy 'RESISTACT' next to it, 'CITIZEN ACTION' rule in dark grey underneath. Shipped as a tiny WebP so the page weight didn't budge.",
          "Hero now opens with 'America is being run by cartoon villains. MAGA is nuts.' in dark grey, with a hand-painted orange 'But what can one person do?' stamping in over the logo — a deliberate handwritten layer over the printed wordmark.",
          "Logged-out visitors now see the hero on every tab — The Acts, The Facts, and The Smacks — instead of only on The Acts.",
        ],
      },
      {
        heading: "Report a problem on any act",
        items: [
          "Every act card now has a small flag icon next to the share button. Tap it to file a short report — broken link, out of date, wrong info, off-topic, duplicate, or 'something else' — with an optional detail box. Goes straight to admin review without leaving the feed.",
          "Admins get a new 'Flagged Acts' entry in the user-avatar menu with the open count, a list view of every flag (with reporter and timestamp), and one-click dismiss.",
          "A new 'needs attention' badge sits on the bell next to the user avatar, summing pending acts, pending smacks, pending user applications, and open flags so admins see one total to act on.",
        ],
      },
      {
        heading: "Faster card list",
        items: [
          "The full set of acts now loads in parallel instead of one page at a time. The acts counter next to the sort dropdown reaches its true total in roughly one round trip, and search/filter no longer silently miss cards that hadn't streamed in yet.",
        ],
      },
      {
        heading: "Copy",
        items: [
          "'Quick Matches for Me' → 'Quick Acts for Me' with a new 'Overwhelmed? Click here to tailor the options.' subtitle. 'Add an Action!' → 'Add an Act!' (and the modal title to match). 'What's the Action?' → 'What's the Act?' for the create flow.",
          "'Find another action' → 'Find another act' in the celebration modal.",
          "'Come back tomorrow.' below the hero pills is now bold italic orange for emphasis.",
        ],
      },
      {
        heading: "Small fixes",
        items: [
          "Clicking the 'Spread the Word about ResistAct' card body now opens the share sheet directly instead of the 'How does ResistAct work?' info modal — which made it feel like the share affordance was hidden.",
        ],
      },
    ],
  },
  {
    version: "1.0.9",
    date: "2026-05-17",
    title: "Admin nav cleans up when queues are empty, card gloss on hover, founding-member signup framing",
    sections: [
      {
        heading: "Admin nav cleanup",
        items: [
          "'Pending Acts' and 'Pending Smacks' items now hide entirely from the admin dropdown when their queues are empty — no more phantom menu items saying 'Pending Acts' with nothing to review.",
          "Pending acts count now comes from the server so it reflects the full dataset, not just cards already loaded in the browser. The '21 pending' case that wasn't showing in the nav is fixed.",
          "Amber badge on the Admin Panel button shows how many user applications are waiting for approval — sourced from the server on every page load.",
          "Admin review queue for acts now bypasses match-scoring and ranking, so pending cards can't be suppressed by the score floor. All unapproved cards show up when you switch to pending-only mode.",
          "Tier Dashboard is now available to all logged-in users, not just admins — it was accidentally inside the admin-only render block.",
        ],
      },
      {
        heading: "Card gloss on hover",
        items: [
          "Hovering any action card now fires a single diagonal gloss sweep across the full card face — image header and content area both. Feels like picking up a physical card and catching the light. Gated behind prefers-reduced-motion.",
        ],
      },
      {
        heading: "Founding-member signup framing",
        items: [
          "The signup modal now says 'Apply for founding access' rather than a generic 'Join the Resistance' — makes the approval queue feel intentional. After submitting, you see 'You're in the queue' instead of 'Account pending approval'.",
          "Clicking the Spread the Word card now opens the 'How does ResistAct work?' info modal instead of jumping straight to the share sheet — consistent with clicking the Mead quote in the header.",
        ],
      },
    ],
  },
  {
    version: "1.0.8",
    date: "2026-05-17",
    title: "Cards can no longer be approved without an image — closed three bypass paths",
    sections: [
      {
        heading: "What changed",
        items: [
          "12 image-less cards from a May 2026 Etsy/Bluesky/TikTok creator import had landed in production already approved, showing as half-blank tiles in the live feed. They've all been flipped back to pending and now appear in Admin → Pending — upload a header image to re-approve, or delete.",
          "The PUT /actions/:id endpoint (used by Admin → Edit) no longer accepts `adminApproved` in the request body. Approval can only happen through POST /admin/approve-action/:id, which enforces the image-presence check.",
          "The Etsy-creators bulk-import code now sets `adminApproved` based on whether an image was actually resolved, not unconditionally true.",
        ],
      },
      {
        heading: "How it could happen",
        items: [
          "Three approval paths existed: (1) user submit → defaults to false, fine; (2) admin approve via the proper endpoint → image-required, fine; (3) direct KV writes inside one-off data migrations → no gate. The Etsy-creators migration used path (3) and skipped the gate.",
        ],
      },
    ],
  },
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
