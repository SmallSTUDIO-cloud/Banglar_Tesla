/**
 * Controlled cascade experiment.
 *
 * The audit's headline claim is that most of the 54 evictions are NOT geometric
 * conflicts with the synthetic road. That claim would be weak if it rested only
 * on the one long road the task names, so this runs six independent trials: a
 * short 60 m stub is placed through a single chosen building, and the resulting
 * evictions are split into genuine conflicts (the building overlaps the new
 * carriageway or fails the engine's corridor predicate) and collateral.
 *
 * If the generator were only removing buildings the road physically conflicts
 * with, `collateral` would be 0 in every row.
 *
 *   npx vite-node diagnostics/synthetic-road-audit/probe-cascade.ts
 */

import { installDomShim } from '../../tools/domShim';

installDomShim();

const L = await import('../../src/world/layout');
const A = await import('./analysis');
const { makeSyntheticRoad } = await import('./syntheticRoad');

const { ROAD_SEGMENTS, rebuildRoadSpatialIndex, isFootprintClearOfCorridor } = L;
const ORIGINAL = [...ROAD_SEGMENTS];

const key = (c: { minX: number; maxX: number; minZ: number; maxZ: number; height: number }): string =>
  `${c.minX.toFixed(3)},${c.maxX.toFixed(3)},${c.minZ.toFixed(3)},${c.maxZ.toFixed(3)},${c.height.toFixed(2)}`;

const base = await A.buildWith([]);

// One target per city area, chosen by proximity to a named shipped road.
const PICKS = [
  { label: 'asad_0 frontage', x: -197, z: 214 },
  { label: 'ring_0 frontage', x: -236, z: 90 },
  { label: 'tajmahal_1 frontage', x: 60, z: -120 },
  { label: 'humayun_1 frontage', x: -10, z: 60 },
  { label: 'shahjahan_1 frontage', x: 150, z: 40 },
  { label: 'johuri_bypass frontage', x: -150, z: -150 },
];

const results: Array<Record<string, unknown>> = [];

for (const pick of PICKS) {
  const target = base.traced
    .map((c) => ({ c, d: Math.hypot(c.cx - pick.x, c.cz - pick.z) }))
    .sort((a, b) => a.d - b.d)[0].c;
  const stub = makeSyntheticRoad(`stub_${pick.label.split(' ')[0]}`, target.cx - 30, target.cz, target.cx + 30, target.cz);
  const built = await A.buildWith([stub]);

  const pool = new Map<string, number>();
  for (const c of built.traced) pool.set(key(c), (pool.get(key(c)) ?? 0) + 1);
  const evicted = [];
  for (const c of base.traced) {
    const k = key(c);
    const n = pool.get(k) ?? 0;
    if (n > 0) pool.set(k, n - 1);
    else evicted.push(c);
  }

  let direct = 0;
  try {
    ROAD_SEGMENTS.push(stub);
    rebuildRoadSpatialIndex();
    for (const c of evicted) {
      const sat = A.obbVsStadium(
        { x: c.cx, z: c.cz, width: c.halfX * 2, depth: c.halfZ * 2, yaw: c.yaw, height: c.height },
        stub,
        stub.halfWidth,
      );
      if (sat.depth > 0 || !isFootprintClearOfCorridor(c.cx, c.cz, c.halfX * 2, c.halfZ * 2, c.yaw, 0.55)) direct++;
    }
  } finally {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...ORIGINAL);
    rebuildRoadSpatialIndex();
  }

  results.push({
    stub: stub.id,
    target: { x: +target.cx.toFixed(1), z: +target.cz.toFixed(1) },
    evicted: evicted.length,
    genuineConflicts: direct,
    collateral: evicted.length - direct,
  });
  console.log(
    `${pick.label.padEnd(24)} target=(${target.cx.toFixed(0)},${target.cz.toFixed(0)}) ` +
      `evicted=${String(evicted.length).padStart(2)}  genuine=${direct}  collateral=${evicted.length - direct}`,
  );
}

const totalEvicted = results.reduce((n, r) => n + (r.evicted as number), 0);
const totalGenuine = results.reduce((n, r) => n + (r.genuineConflicts as number), 0);
console.log(`\nTOTAL over ${results.length} independent stubs: evicted=${totalEvicted} genuine=${totalGenuine} ` +
  `collateral=${totalEvicted - totalGenuine} (${((1 - totalGenuine / totalEvicted) * 100).toFixed(0)}% collateral)`);

// Printed rather than written: `@types/node` is not part of this project, so the
// probe stays free of `node:` imports and its output is redirected to
// `out/cascade-experiment.json` by the caller.
console.log('CASCADE_JSON=' + JSON.stringify(
  { trials: results, totalEvicted, totalGenuine, totalCollateral: totalEvicted - totalGenuine },
));
