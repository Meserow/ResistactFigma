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
  // DIAGNOSTIC LOGGING — added temporarily so we can debug "GA shows zero
  // data" by reading the Console on a real visitor's browser. Every step of
  // the init flow logs so we can see exactly where it's bailing or stalling.
  // Strip back to a single info-log once the data flow is confirmed.
  // eslint-disable-next-line no-console
  console.info("[analytics] initAnalytics() called", { measurementId: MEASUREMENT_ID, alreadyLoaded: loaded });

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
      console.warn("[analytics] Disabled — respecting browser Do-Not-Track signal.");
      logged = true;
    }
    return;
  }

  loaded = true;

  // Inject gtag.js (async, deferred — won't block first paint).
  const scriptUrl = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  // eslint-disable-next-line no-console
  console.info("[analytics] Injecting gtag.js script", { src: scriptUrl });
  const s = document.createElement("script");
  s.async = true;
  s.src = scriptUrl;
  s.onload = () => {
    // eslint-disable-next-line no-console
    console.info("[analytics] gtag.js loaded successfully ✓");
  };
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

  // eslint-disable-next-line no-console
  console.info("[analytics] Initial consent + js + config events queued", {
    dataLayerLength: (window as any).dataLayer.length,
  });
}

/**
 * Low-level event tracker. Most callers should use the typed helpers below.
 * No-op when analytics is disabled (no ID configured, DNT on, etc.).
 */
export function track(event: string, params: Record<string, any> = {}): void {
  if (!loaded) {
    // eslint-disable-next-line no-console
    console.warn("[analytics] track() called before initAnalytics — event dropped", { event });
    return;
  }
  const gtag = (window as any).gtag as undefined | ((...args: any[]) => void);
  // eslint-disable-next-line no-console
  console.info("[analytics] track event →", event, params);
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
};
