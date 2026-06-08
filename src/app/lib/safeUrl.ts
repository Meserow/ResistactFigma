// Client-side URL safety.
//
// The Edge Function validates URLs on write (see validateSubmittedUrl in
// index.ts), but the client must not treat the server as the only gate:
//   1. Legacy rows predate that check and may still hold a "javascript:" URL.
//   2. A future server regression shouldn't translate into stored XSS.
//
// React does NOT sanitize href/src, so a "javascript:alert(1)" value rendered
// into <a href> executes on click. safeHref returns a safe href string, or
// undefined for anything that isn't a navigable, allowlisted URL — so
// `href={safeHref(url)}` renders an inert anchor instead of a script sink.

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "sms", "tel"]);

export function safeHref(value: unknown): string | undefined {
  if (value == null) return undefined;
  const raw = String(value).trim();
  if (raw === "") return undefined;

  // Site-relative ("/x", "./x", "../x") and protocol-relative ("//host") URLs
  // resolve to the current http(s) origin — always safe.
  if (raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../")) return raw;
  if (raw.startsWith("//")) return raw;

  // Browsers strip embedded C0 control chars (tab/newline/CR/null) before
  // parsing, so "java\tscript:" executes as "javascript:". Detect the scheme on
  // a copy with every char <= 0x20 removed so smuggled control chars can't slip
  // a disallowed scheme past the allowlist.
  const collapsed = Array.from(raw)
    .filter((ch) => ch.charCodeAt(0) > 0x20)
    .join("");
  const schemeMatch = collapsed.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):/);
  if (schemeMatch) {
    return ALLOWED_SCHEMES.has(schemeMatch[1].toLowerCase()) ? raw : undefined;
  }

  // No scheme and not a path → a bare host like "example.com". Prefix https://
  // so it navigates as intended and can never later be reinterpreted as a
  // disallowed scheme.
  return "https://" + raw;
}
