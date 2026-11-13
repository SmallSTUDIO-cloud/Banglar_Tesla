/**
 * Regenerate the live world snapshot by running the real `buildCity()`.
 *
 * Kept separate from `worldSnapshot.ts` (which is pure) because this half needs
 * the DOM shim and the full city generator. Shared by the drift test and
 * `scripts/update-world-baseline.ts` so they cannot disagree.
 */

import { installDomShim } from './domShim';
import { buildWorldSnapshot, type WorldSnapshot } from './worldSnapshot';

/**
 * Pinned quality. `buildCity` only reads `shadows` from it, and shadows affect
 * mesh chunking, never placement — pinning it keeps the snapshot independent of
 * whatever the player's device selected.
 */
const BASELINE_QUALITY = { shadows: true } as const;

/** Generate the world snapshot from a fresh city build. */
export async function generateWorldSnapshot(): Promise<WorldSnapshot> {
  installDomShim();
  // Dynamic import so the shim is in place before textures are evaluated.
  const [{ buildCity }, { SignAtlas }] = await Promise.all([
    import('../src/world/city'),
    import('../src/world/textures'),
  ]);
  const city = buildCity(new SignAtlas(), BASELINE_QUALITY as never);
  return buildWorldSnapshot(city as never);
}
