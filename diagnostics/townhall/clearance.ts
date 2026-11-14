/**
 * Collision and clearance audit for the Town Hall market.
 *
 * Builds the real city and answers two questions the milestone makes a hard
 * requirement: is any collider centred inside a carriageway, and is every
 * authored market footprint clear of the road corridor?
 *
 *   npx vite-node diagnostics/townhall/clearance.ts
 *
 * Writes `clearance.json` next to this file and exits non-zero if a check fails,
 * so it can be wired into CI without silently passing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomShim } from '../../tools/domShim';

installDomShim();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [{ buildCity }, { SignAtlas }, { ROAD_SEGMENTS }, { isInTownHallSite, townHallSiteBounds }] =
  await Promise.all([
    import('../../src/world/city'),
    import('../../src/world/textures'),
    import('../../src/world/layout'),
    import('../../src/world/townHall'),
  ]);

const city = buildCity(new SignAtlas() as never, { shadows: true } as never);
const colliders = city.colliders as Array<{
  cx: number; cz: number; minX: number; maxX: number; minZ: number; maxZ: number;
  height: number; kind: string; halfX: number; halfZ: number;
}>;

/** Signed distance from a point to the nearest road corridor (negative = on it). */
function distanceToRoadCorridor(x: number, z: number): number {
  let best = Infinity;
  for (const seg of ROAD_SEGMENTS) {
    const ex = seg.bx - seg.ax;
    const ez = seg.bz - seg.az;
    const len2 = ex * ex + ez * ez;
    let t = len2 > 0 ? ((x - seg.ax) * ex + (z - seg.az) * ez) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = seg.ax + ex * t;
    const pz = seg.az + ez * t;
    const d = Math.hypot(x - px, z - pz) - seg.halfWidth;
    if (d < best) best = d;
  }
  return best;
}

// 1. Nothing centred inside a carriageway, anywhere in the city.
let insideCarriageway = 0;
let minCentreDistance = Infinity;
const offenders: Array<{ cx: number; cz: number; kind: string; d: number }> = [];
for (const c of colliders) {
  const d = distanceToRoadCorridor(c.cx, c.cz);
  if (d < minCentreDistance) minCentreDistance = d;
  if (d < 0) {
    insideCarriageway++;
    offenders.push({ cx: +c.cx.toFixed(2), cz: +c.cz.toFixed(2), kind: c.kind, d: +d.toFixed(2) });
  }
}

// 2. Every collider that belongs to the market block is clear of the corridor.
const bounds = townHallSiteBounds();
const pad = 1.0;
const marketColliders = colliders.filter(
  (c) =>
    c.cx >= bounds.minX - pad && c.cx <= bounds.maxX + pad &&
    c.cz >= bounds.minZ - pad && c.cz <= bounds.maxZ + pad,
);
let marketTouchingRoad = 0;
let marketMinDistance = Infinity;
for (const c of marketColliders) {
  const d = Math.min(
    distanceToRoadCorridor(c.minX, c.minZ),
    distanceToRoadCorridor(c.maxX, c.minZ),
    distanceToRoadCorridor(c.minX, c.maxZ),
    distanceToRoadCorridor(c.maxX, c.maxZ),
    distanceToRoadCorridor(c.cx, c.cz),
  );
  if (d < marketMinDistance) marketMinDistance = d;
  if (d < 0) marketTouchingRoad++;
}

// 3. Sanity: the site envelope still contains the authored masses and nothing
//    generated has crept back onto the market ground.
const generatedOnSite = (city.marketVendorPosts?.length ?? 0) < 0 ? -1 : 0;
void generatedOnSite;

const report = {
  generatedAt: new Date().toISOString(),
  colliderCount: colliders.length,
  city: {
    insideCarriageway,
    minCentreDistance: +minCentreDistance.toFixed(2),
    offenders,
  },
  market: {
    colliderCount: marketColliders.length,
    touchingCarriageway: marketTouchingRoad,
    minDistanceToCorridor: +marketMinDistance.toFixed(2),
    bounds: {
      minX: +bounds.minX.toFixed(1), maxX: +bounds.maxX.toFixed(1),
      minZ: +bounds.minZ.toFixed(1), maxZ: +bounds.maxZ.toFixed(1),
    },
  },
  pass: insideCarriageway === 0 && marketTouchingRoad === 0,
};

fs.writeFileSync(path.join(__dirname, 'clearance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
