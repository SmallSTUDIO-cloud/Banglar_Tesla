/**
 * Gameplay reference snapshot for road-geometry changes (CLI).
 *
 * Road geometry feeds races, missions, traffic, pickups and place markers. Before
 * changing a segment, dump every derived value, change the geometry, dump again,
 * and diff. That is the only way to prove a road edit did not silently move a
 * race gate, shrink a shortcut or shift a shop marker.
 *
 * The snapshot itself lives in `tools/gameplaySnapshot.ts`, shared with the drift
 * test, so this CLI and the test can never disagree about what is being compared.
 *
 * Run: npx vite-node tools/snapshot-gameplay.ts > before.json
 * Or:  npm run baseline:update   (regenerates the golden file, gated on approval)
 */

import { buildGameplaySnapshot, serialiseSnapshot } from './gameplaySnapshot';

console.log(serialiseSnapshot(buildGameplaySnapshot({ includeAiTimings: true })));
