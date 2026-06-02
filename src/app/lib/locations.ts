// Canonical location values for new/edited action cards. Free-form location
// strings produced too much noise in the filter dropdown — see live data
// audit. New writes pick from this list; legacy values stay until manually
// re-saved.
//
// LOCATION IS GEOGRAPHY ONLY. Whether an act can be done remotely / from home /
// online is a SEPARATE concept, tracked by the card's `isOnline` flag — NOT a
// location value. That's why "Remote"/"At Home"/"Online" are deliberately
// absent here: a card can be tied to a state AND be doable remotely at the same
// time. Legacy cards that stored "Remote" etc. in `location` are folded into
// `isOnline` at read time by normalizeCardLocation().

export const LOCATION_OPTIONS = [
  "National",
  "Multi-State",
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "Washington DC", "West Virginia", "Wisconsin", "Wyoming",
] as const;

// Legacy GEOGRAPHIC location strings mapped to their canonical equivalents.
// The old "do it from anywhere" strings ("Remote"/"Online"/"From Home"/
// "At Home") are intentionally NOT here — they are no longer location values.
// They fold into the `isOnline` flag instead (see REMOTE_LOCATION_STRINGS and
// normalizeCardLocation below).
const LEGACY_MAP: Record<string, string> = {
  "Multi-state": "Multi-State",
};

// Legacy location strings that actually meant "doable from anywhere". When a
// card stored one of these in `location`, it really meant `isOnline: true`.
// normalizeCardLocation() folds them into the flag and clears the location.
export const REMOTE_LOCATION_STRINGS = new Set([
  "Remote", "At Home", "From Home", "Online",
]);

// Split a card's stored fields into the disambiguated model:
//   isOnline  — single canonical "remote / online / at-home" flag
//   location  — geography only (state / National / Multi-State / undefined)
// Folds the legacy `atHome` boolean and the legacy remote location strings
// into `isOnline`, and strips those strings out of `location`. A geographic
// location (a state, "National", "Multi-State", or a free-form "City, ST")
// passes through untouched, so a card can be BOTH state-tied AND remote.
export function normalizeCardLocation(
  card: { isOnline?: boolean; atHome?: boolean; location?: string | null },
): { isOnline: boolean; location: string | undefined } {
  const raw = (card.location ?? "").trim();
  const locIsRemote = REMOTE_LOCATION_STRINGS.has(raw);
  return {
    isOnline: !!card.isOnline || !!card.atHome || locIsRemote,
    location: raw === "" || locIsRemote ? undefined : raw,
  };
}

// USPS 2-letter codes → full state name. Used to normalize legacy
// "City, ST" location strings down to a state for the filter dropdown.
const STATE_BY_CODE: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "Washington DC", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
};

const STATE_NAMES = new Set<string>(LOCATION_OPTIONS as readonly string[]);

// Normalize any free-form location string down to a single canonical GEOGRAPHIC
// dropdown value (a state, "National", "Multi-State", or null). Remote/online/
// at-home strings are NOT geography and resolve to null — remote-ness lives on
// the `isOnline` flag (see normalizeCardLocation).
//   "Odenton, MD"      -> "Maryland"
//   "Beaver County, PA" -> "Pennsylvania"
//   "California"       -> "California"
//   "Multi-state"      -> "Multi-State" (legacy)
//   "Online" / "Remote" / "At Home" -> null  (these are isOnline, not a place)
//   "Earth"            -> null
export function locationToState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // Remap legacy canonical strings before anything else.
  if (LEGACY_MAP[s]) return LEGACY_MAP[s];
  if (STATE_NAMES.has(s)) return s;
  // Strip a trailing ", XX" 2-letter code or ", FullStateName" suffix.
  const m = s.match(/,\s*([^,]+)\s*$/);
  if (m) {
    const tail = m[1].trim();
    const upper = tail.toUpperCase();
    if (STATE_BY_CODE[upper]) return STATE_BY_CODE[upper];
    if (STATE_NAMES.has(tail)) return tail;
  }
  return null;
}
