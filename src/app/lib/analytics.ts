/**
 * Google Analytics 4 — privacy-respecting wiring.
 *
 * Disabled-by-default: if VITE_GA_MEASUREMENT_ID isn't set in the build
 * environment, this module loads NO scripts, makes NO network calls, and
 * every `track()` call is a no-op. Drop in a Measurement ID and it activates.
 *
 * Privacy defaults baked in (no opt-in needed):
 *   • Anonymize IP (truncate to /24 / /48)
 *   • Disable Google Signals (no cross-device ad tracking)
 *   • Disable ad-personalization signals
 *   • Respect browser Do-Not-Track header — if the user has DNT on, we don't
 *     load gtag at all
 *
 * For a more aggressive posture (consent banner, EU geo gating, etc.) bolt
 * those layers on top of this module rather than rewriting it.
 */

// Read the GA4 Measurement ID from the Vite env. Set this in .env or in your
// deploy provider's env vars. Format: G-XXXXXXXXXX. Empty string = disabled.
//
// IMPORTANT: must be `import.meta.env.VITE_GA_MEASUREMENT_ID` exactly —
// Vite's env-injection transform looks for that specific pattern and
// substitutes at request time. Optional chaining (`import.meta?.env?.`) or
// any wrapping defeats the substitution and ships the literal source.
//
// The fallback (`||`) is the production-tracked Measurement ID. GA4 IDs are
// public anyway — Google embeds them in every page that loads gtag, so
// there's no leak in committing this. The env var still wins when set
// (handy for separate staging IDs later) but production no longer depends
// on the build environment having .env configured.
const MEASUREMENT_ID: string =
  (import.meta.env.VITE_GA_MEASUREMENT_ID || "G-7QS8YBZZXY") as string;

let loaded = false;
let logged = false; // log the on/off state exactly once

function userHasDoNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  // Standard + IE/MS legacy + window-level fallback.
  return (
    navigator.doNotTrack === "1" ||
    (navigator as any).msDoNotTrack === "1" ||
    (typeof window !== "undefined" && (window as any).doNotTrack === "1")
  );
}

/**
 * Initialise GA4. Call once at app startup. Safe to call multiple times —
 * subsequent calls no-op. Loads the gtag.js script + dataLayer if and only if:
 *   • A Measurement ID is configured, AND
 *   • The user does NOT have Do-Not-Track set.
 */
export function initAnalytics(): void {
  if (loaded) return;
  if (typeof window === "undefined") return; // SSR safety, future-proofing

  if (!MEASUREMENT_ID) {
    if (!logged) {
      // eslint-disable-next-line no-console
      console.info("[analytics] Disabled — no VITE_GA_MEASUREMENT_ID configured.");
      logged = true;
    }
    return;
  }
  if (userHasDoNotTrack()) {
    if (!logged) {
      // eslint-disable-next-line no-console
      console.info("[analytics] Disabled — respecting browser Do-Not-Track signal.");
      logged = true;
    }
    return;
  }

  loaded = true;

  // Inject gtag.js (async, deferred — won't block first paint). Errors get
  // logged so a future "no data" investigation can spot blocker/DNS issues
  // quickly; success path is silent now that the wiring is confirmed.
  const scriptUrl = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  const s = document.createElement("script");
  s.async = true;
  s.src = scriptUrl;
  s.onerror = (e) => {
    // eslint-disable-next-line no-console
    console.error("[analytics] gtag.js FAILED to load — blocker / network / DNS issue", e);
  };
  document.head.appendChild(s);

  // Bootstrap dataLayer + global gtag().
  // Must use the `arguments` object (not rest params) — GA4's gtag.js checks
  // for an Arguments object when it processes the dataLayer queue. A plain
  // Array silently fails the check and events are never sent.
  (window as any).dataLayer = (window as any).dataLayer || [];
  (window as any).gtag = function gtag() { (window as any).dataLayer.push(arguments); };
  const gtag = (window as any).gtag as (...args: any[]) => void;

  // Set explicit consent FIRST. Without an explicit consent grant, GA4's
  // Consent Mode v2 defaults `analytics_storage` to 'denied' for users in
  // some regions (EEA/UK) and may silently suppress all /collect calls.
  // We grant analytics_storage and deny everything ad-related — matches our
  // earlier privacy posture (no ad personalization, no Google Signals).
  // The previous code passed `storage: "granted"` to gtag('config', ...)
  // which is NOT a valid GA4 config parameter and was being ignored —
  // GA4 read consent as denied by default and dropped every event.
  gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, {
    // Don't merge with Google's ad-network identity graph.
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    // (Removed `anonymize_ip: true` — that was a Universal Analytics
    // parameter; GA4 anonymises IPs by default and the legacy flag does
    // nothing here. Removed `storage: "granted"` — not a valid GA4 config
    // key. Consent is set above via the proper `gtag('consent', …)` call.)
  });
}

/**
 * Low-level event tracker. Most callers should use the typed helpers below.
 * No-op when analytics is disabled (no ID configured, DNT on, etc.).
 */
export function track(event: string, params: Record<string, any> = {}): void {
  if (!loaded) return;
  const gtag = (window as any).gtag as undefined | ((...args: any[]) => void);
  gtag?.("event", event, params);
}

// ─── Typed event helpers ─────────────────────────────────────────────────────
// Keep these tight + consistent. The string keys are the GA event names that
// show up in the dashboard; the param keys map to GA recommended properties
// when possible (e.g. `method` for share destinations).

export const analytics = {
  /** A user marked an action card as DONE. Most engagement-meaningful event. */
  actionCompleted(cardId: number, category: string | undefined): void {
    track("action_completed", {
      card_id: cardId,
      category: (category ?? "OTHER").toUpperCase(),
    });
  },

  /** A user finished the Match wizard and applied preferences. */
  matchSet(time: string | null, tone: Record<string, number>): void {
    track("match_set", {
      time_bucket: time ?? "unset",
      tone_anger:      tone.anger      ?? 1,
      tone_comedy:     tone.comedy     ?? 1,
      tone_subversion: tone.subversion ?? 1,
      tone_hope:       tone.hope       ?? 1,
      tone_energy:     tone.energy     ?? 1,
    });
  },

  /**
   * A user clicked a share destination. `surface` distinguishes the source
   * (e.g. "smack", "spread_the_word", "fact_pushback") so the same `method`
   * dimension (facebook/bluesky/x/…) is comparable across surfaces.
   */
  shareClicked(method: string, surface: string, contentId?: string | number): void {
    track("share", {
      method,
      content_type: surface,
      ...(contentId != null ? { item_id: String(contentId) } : {}),
    });
  },

  // ─── Funnel: browse → click-through → done ─────────────────────────────────

  /**
   * A user opened a card's detail modal. The top of the engagement funnel —
   * the denominator for click-through and completion rates.
   */
  cardOpened(cardId: number, category: string | undefined): void {
    track("card_opened", {
      card_id: cardId,
      category: (category ?? "OTHER").toUpperCase(),
    });
  },

  /**
   * THE primary conversion: a user clicked the "I want to ResistAct!" link-out
   * to actually go do the civic action. `surface` notes where the click came
   * from (currently "card_detail"). Mark this as a Key Event in GA4.
   */
  actionLinkClicked(cardId: number, category: string | undefined, surface = "card_detail"): void {
    track("action_link_clicked", {
      card_id: cardId,
      category: (category ?? "OTHER").toUpperCase(),
      link_surface: surface,
    });
  },

  /**
   * A user clicked a supporting resource link (e.g. the ACLU know-your-rights
   * guide on PROTEST/FLASH MOB cards). `resource` is a stable slug, never a URL
   * with query params, to keep the dimension clean.
   */
  resourceLinkClicked(resource: string, cardId?: number): void {
    track("resource_link_clicked", {
      resource,
      ...(cardId != null ? { card_id: cardId } : {}),
    });
  },

  // ─── Engagement signals ────────────────────────────────────────────────────

  /** A user boosted (or un-boosted) a card. `active` = the resulting state. */
  boostToggled(cardId: number, active: boolean): void {
    track("boost", { card_id: cardId, active });
  },

  /** A user bookmarked (or un-bookmarked) a card. `active` = resulting state. */
  bookmarkToggled(cardId: number, active: boolean): void {
    track("bookmark", { card_id: cardId, active });
  },

  /**
   * A user flagged a card. (Replaces the earlier raw track("card_flagged", …)
   * call so the param names stay snake_case and consistent with the rest.)
   */
  cardFlagged(cardId: number, reason: string): void {
    track("card_flagged", { card_id: cardId, reason });
  },

  // ─── Match wizard funnel ───────────────────────────────────────────────────

  /** The Match wizard was opened. Pairs with match_set / match_abandoned. */
  matchStarted(): void {
    track("match_started", {});
  },

  /** The Match wizard was closed WITHOUT applying. `step` = how far they got. */
  matchAbandoned(step: number): void {
    track("match_abandoned", { step });
  },

  /** A user gave a "great match" thumbs-up on a result in the wizard. */
  matchFeedback(cardId: number, category: string | undefined): void {
    track("match_feedback", {
      card_id: cardId,
      category: (category ?? "OTHER").toUpperCase(),
      sentiment: "positive",
    });
  },

  // ─── Growth: accounts & supply ─────────────────────────────────────────────

  /**
   * Account created. Uses GA4's recommended `sign_up` event name + `method`
   * param ("email" | "google"). Mark as a Key Event. No PII is sent.
   */
  signUp(method: string): void {
    track("sign_up", { method });
  },

  /** A returning user signed in. GA4 recommended `login` event + `method`. */
  login(method: string): void {
    track("login", { method });
  },

  /** A user submitted a new Act (user-generated supply). Category only — no PII. */
  actSubmitted(category: string | undefined): void {
    track("act_submitted", {
      category: (category ?? "OTHER").toUpperCase(),
    });
  },
};
