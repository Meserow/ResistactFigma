// Canonical location values for new/edited action cards. Free-form location
// strings produced too much noise in the filter dropdown — see live data
// audit. New writes pick from this list; legacy values stay until manually
// re-saved.

export const LOCATION_OPTIONS = [
  "Remote",
  "At Home",
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

// Legacy location strings that existed before the canonical rename. Mapped
// to their new equivalents so existing cards and filter chips stay consistent.
const LEGACY_MAP: Record<string, string> = {
  "Online":     "Remote",
  "From Home":  "At Home",
  "Multi-state": "Multi-State",
};

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

// Normalize any free-form location string down to a single canonical
// dropdown value (a state, "Remote", "At Home", "National", "Multi-State",
// or null).
//   "Odenton, MD"      -> "Maryland"
//   "Beaver County, PA" -> "Pennsylvania"
//   "California"       -> "California"
//   "Online"           -> "Remote"   (legacy)
//   "From Home"        -> "At Home"  (legacy)
//   "Multi-state"      -> "Multi-State" (legacy)
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
