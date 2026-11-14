/**
 * Canonical English road names and their accepted aliases.
 *
 * ## Why this exists
 *
 * `বাবর রোড` romanises legitimately as *both* "Babar Road" (the spelling this
 * project shipped) and "Babor Road" (the spelling OpenStreetMap uses, across 22
 * ways in the checked-in extract). Decision B of the 2026-10-29 mission fixes
 * **Babor Road** as the canonical *displayed* spelling while keeping every
 * existing identifier — `babar_0`…`babar_3`, `babar_w`/`babar_mid`/
 * `babar_humayun`/`babar_e`, the `babar_humayun`/`babar_mid` race refs and the
 * `place.bridge` i18n key — exactly as they were. Those are data tokens, not
 * prose; renaming them would break saves, races and localisation lookups for a
 * cosmetic spelling change.
 *
 * ## Scope of "alias support", honestly stated
 *
 * There is **no road-search UI in the game today**. Nothing currently resolves a
 * player-typed road name, so this table is not wired into a screen. It is the
 * seam such a feature would use, and it is tested so the two spellings cannot
 * silently diverge. Do not claim the game "supports searching for Babar Road";
 * it supports *matching* it if a search is ever added.
 */

/** Canonical displayed spelling -> accepted alternative spellings. */
export const ROAD_NAME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'Babor Road': ['Babar Road'],
  'Babor Road West': ['Babar Road West'],
};

/**
 * Normalise a road name for comparison: lower-case, collapse punctuation and
 * whitespace. Keeps Bangla untouched, so `বাবর রোড` still matches itself.
 */
export function normalizeRoadName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every accepted spelling for a canonical name, including itself. */
export function spellingsFor(canonical: string): readonly string[] {
  return [canonical, ...(ROAD_NAME_ALIASES[canonical] ?? [])];
}

/**
 * True when `query` names the same road as `canonical`, in either spelling.
 * Uses whole-token comparison so "Babar" does not match a road merely
 * containing that substring in an unrelated word.
 */
export function roadNameMatches(query: string, canonical: string): boolean {
  const q = normalizeRoadName(query);
  if (!q) return false;
  return spellingsFor(canonical).some((s) => normalizeRoadName(s) === q);
}

/**
 * Resolve any accepted spelling back to the canonical one, or `null`.
 * Case- and punctuation-insensitive.
 */
export function canonicalRoadName(query: string): string | null {
  const q = normalizeRoadName(query);
  if (!q) return null;
  for (const canonical of Object.keys(ROAD_NAME_ALIASES)) {
    if (normalizeRoadName(canonical) === q) return canonical;
    if (ROAD_NAME_ALIASES[canonical].some((a) => normalizeRoadName(a) === q)) return canonical;
  }
  return null;
}
