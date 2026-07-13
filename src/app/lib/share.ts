/**
 * share.ts — one home for the social-share plumbing that used to be
 * copy-pasted across ShareModal, SpreadTheWordModal, SmacksPage and
 * FactShareModal. Each copy drifted (e.g. Bluesky's iOS handling differed
 * between ShareModal and SmacksPage; a dead Facebook `quote=` param lingered
 * in one), which is why "the share types are all unreliable." Fix once here.
 *
 * This module is deliberately framework-light: the platform ICONS live in
 * share.tsx (they're JSX); this file is pure logic so it can be imported
 * anywhere without pulling React in.
 */

/** ── Device detection — the SINGLE source of truth ──────────────────────────
 *  There used to be four different UA regexes across the share modals, which
 *  drifted (an iPad, reporting as "Macintosh" since iPadOS 13, fell through to
 *  the desktop branch everywhere). Import these instead of writing new checks.
 *  These read `navigator` at call time so they're SSR/test-safe. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    // iPadOS ≥13 masquerades as MacIntel; maxTouchPoints unmasks it.
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}
export function isMobile(): boolean {
  return isIOS() || isAndroid();
}
/** True if this browser can share the given File via the native sheet. */
export function canShareFiles(file: File): boolean {
  return typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
}

/** Absolute-ify a possibly-relative URL against the current origin. A
 *  fully-qualified URL (Supabase storage, http(s)) is returned unchanged —
 *  gluing origin onto an absolute URL produced "https://site https://…". */
export function abs(url: string): string {
  return /^https?:\/\//i.test(url) ? url : window.location.origin + url;
}

const enc = encodeURIComponent;

/** Intent-URL builders. Each returns the URL to open in a new tab (or, for
 *  sms/mailto, to assign to location.href). Callers decide open-vs-copy. */
export const intents = {
  facebook: (url: string) =>
    `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
  x: (text: string, url?: string) =>
    url
      ? `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`
      : `https://twitter.com/intent/tweet?text=${enc(text)}`,
  threads: (text: string) =>
    `https://www.threads.net/intent/post?text=${enc(text)}`,
  bluesky: (text: string) =>
    `https://bsky.app/intent/compose?text=${enc(text)}`,
  whatsapp: (text: string) => `https://wa.me/?text=${enc(text)}`,
  pinterest: (media: string, url: string, description: string) =>
    `https://pinterest.com/pin/create/button/?media=${enc(media)}&url=${enc(url)}&description=${enc(description)}`,
  reddit: (url: string, title: string) =>
    `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}`,
  tumblr: (source: string, caption: string) =>
    `https://www.tumblr.com/widgets/share/tool?posttype=photo&content=${enc(source)}&caption=${enc(caption)}`,
  // `sms:?&body=` is the cross-platform form: `sms:?body=` is the Android
  // shape, some iOS versions need `sms:&body=`; `?&` satisfies both.
  sms: (body: string) => `sms:?&body=${enc(body)}`,
  mailto: (subject: string, body: string) =>
    `mailto:?subject=${enc(subject)}&body=${enc(body)}`,
};

/** Open a share URL in a new tab. Handles two hard-won quirks:
 *
 *  1. iOS Safari popup blocker — window.open from a modal button handler is
 *     silently blocked, but a programmatic <a>.click() is treated as a genuine
 *     navigation and slips past. So on iOS we build+click an anchor.
 *  2. Window stacking on desktop — mixing a Facebook popup *window* with
 *     other share *tabs* confused OS stacking (a later Bluesky tab opened
 *     BEHIND the floating FB popup). Using a stable per-platform window NAME
 *     opens a tab, re-uses it on repeat clicks, and lets us .focus() it. We
 *     omit noopener (which would deny us the window ref) and null win.opener
 *     ourselves for the same security benefit.
 *
 *  Pass `platformId` to get the stable per-platform tab name. */
export function openShareWindow(url: string, platformId?: string): void {
  if (isIOS()) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener,noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const name = platformId ? `resistact-share-${platformId}` : "_blank";
  const win = window.open(url, name);
  if (win) {
    try { win.opener = null; } catch { /* cross-origin, already detached */ }
    try { win.focus(); } catch { /* popup blocker / browser-quirky */ }
  }
}

/** Navigate to an sms:/mailto: URL. Use location.href, not window.open —
 *  window.open('mailto:…') is popup-blocked in several browsers. */
export function openProtocolUrl(url: string): void {
  window.location.href = url;
}

/** Fire the native share sheet for a link+text share, if available. Returns
 *  true if the share sheet was invoked. Call SYNCHRONOUSLY from a tap handler
 *  (no await before it) so iOS keeps the user-gesture alive. */
export function nativeShareLink(data: { title?: string; text?: string; url: string }): boolean {
  if (typeof navigator === "undefined" || !navigator.share) return false;
  if (navigator.canShare && !navigator.canShare(data)) return false;
  navigator.share(data).catch(() => {});
  return true;
}
