import { describe, expect, it } from 'vitest';
import { installDomShim } from '../../tools/domShim';
import { ROAD_SEGMENTS, rebuildRoadSpatialIndex, type RoadSegment } from '../../src/world/layout';
import {
  LEGACY_FRONTAGE_DECISIONS,
  legacyFrontageDecision,
  legacyFrontageStepCount,
} from '../../src/world/frontageLayout';
import { buildWorldSnapshot, worldDigest } from '../../tools/worldSnapshot';

/**
 * Frontage accept/reject isolation.
 *
 * The defect: a building candidate rejected by `canPlaceBuilding` used to shift
 * every later candidate on the same frontage, because the walk advanced by
 * `bWidth + gap` when a candidate was placed and by a fixed 4.5 m when it was
 * rejected. Rejections therefore moved their neighbours — and, because one RNG
 * stream is shared per segment, also changed their width/depth/height. A road
 * added across the city cost 54 buildings, of which only 19 overlapped it
 * (`docs/SYNTHETIC_ROAD_AUDIT.md`).
 *
 * The fix requires a candidate's identity — position, size and style — to be
 * settled before anything tests whether it fits, so a rejection can only ever
 * *remove* that one candidate. These tests pin that property directly:
 *
 *   1. the shipped accept/reject pattern is a frozen table (140 frontages);
 *   2. installing a road may only remove buildings inside that road, and may
 *      only add buildings along its own frontage — never re-place a neighbour.
 *
 * The second test is the regression: on the pre-fix walk it fails, because
 * displaced neighbours appear dozens of metres from the road.
 */

installDomShim();

/** A straight segment reusing the real schema, exactly as the audit installs it. */
function syntheticSegment(id: string, ax: number, az: number, bx: number, bz: number): RoadSegment {
  const length = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / length;
  const uz = (bz - az) / length;
  return {
    id,
    from: `${id}_a`,
    to: `${id}_b`,
    ax, az, bx, bz,
    length, ux, uz,
    leftX: uz, leftZ: -ux,
    width: 9, halfWidth: 4.5, sidewalk: 1.5,
    kind: 'main',
    nameEn: id, nameBn: id,
    // Test fixture only: reuses the closest existing source tag; nothing is
    // exported or persisted and no production data gains a new provenance value.
    source: 'osm',
    jamProne: true, deadEnd: false,
    axis: 'x',
    center: az,
    fromCoord: Math.min(ax, bx),
    toCoord: Math.max(ax, bx),
  };
}

const PROBE = syntheticSegment('frontage_isolation_probe', -60, -200, 60, 160);

interface Built {
  buildings: Array<{ cx: number; cz: number }>;
  buildings_count: number;
  digest: string;
}

/** Build the world with `extra` installed, restoring graph and index afterwards. */
async function buildWith(extra: RoadSegment[]): Promise<Built> {
  const [{ buildCity }, { SignAtlas }] = await Promise.all([
    import('../../src/world/city'),
    import('../../src/world/textures'),
  ]);
  const original = [...ROAD_SEGMENTS];
  try {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...original, ...extra);
    // Without this the installed road is invisible to every corridor query.
    rebuildRoadSpatialIndex();
    const city = buildCity(new SignAtlas() as never, { shadows: true } as never) as unknown as {
      colliders: Array<{ kind: string; cx: number; cz: number }>;
    };
    const buildings = city.colliders
      .filter((c) => c.kind === 'building' && Number.isFinite(c.cx) && Number.isFinite(c.cz))
      .map((c) => ({ cx: c.cx, cz: c.cz }));
    const snapshot = buildWorldSnapshot(city as never);
    return { buildings, buildings_count: snapshot.counts.buildings, digest: worldDigest(snapshot) };
  } finally {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...original);
    rebuildRoadSpatialIndex();
  }
}

/** Position key at millimetre resolution: a re-placed building cannot collide with another. */
function keyOf(b: { cx: number; cz: number }): string {
  return `${b.cx.toFixed(3)},${b.cz.toFixed(3)}`;
}

/** Distance from `p` to the probe's centreline, and its arc position / lateral offset. */
function probeFrame(p: { cx: number; cz: number }): { u: number; v: number; d: number } {
  const dx = p.cx - PROBE.ax;
  const dz = p.cz - PROBE.az;
  const u = dx * PROBE.ux + dz * PROBE.uz;
  const v = dx * PROBE.leftX + dz * PROBE.leftZ;
  const clamped = Math.max(0, Math.min(PROBE.length, u));
  return { u, v, d: Math.hypot(dx - clamped * PROBE.ux, dz - clamped * PROBE.uz) };
}

const BASE = await buildWith([]);
const PERTURBED = await buildWith([PROBE]);

describe('frontage accept/reject isolation', () => {
  it('replays the shipped accept/reject pattern from the frozen table', () => {
    const ids = Object.keys(LEGACY_FRONTAGE_DECISIONS);
    expect(ids).toHaveLength(140);

    let steps = 0;
    let accepted = 0;
    for (const id of ids) {
      const segId = id.slice(0, id.lastIndexOf('/'));
      const side = Number(id.slice(id.lastIndexOf('/') + 1)) as 1 | -1;
      const count = legacyFrontageStepCount(segId, side);
      expect(count).toBe(LEGACY_FRONTAGE_DECISIONS[id].length);
      for (let step = 0; step < count; step++) {
        const decision = legacyFrontageDecision(segId, side, step);
        expect(decision).toBe(LEGACY_FRONTAGE_DECISIONS[id][step]);
        if (decision === 'a') accepted++;
      }
      steps += count;
    }
    expect(steps).toBe(1210);
    expect(accepted).toBe(564);
  });

  it('leaves the shipped world untouched', () => {
    // Byte-identical to the world the coupled walk produced: the fix changes how
    // rejections are handled, not which buildings the shipped map contains.
  // The shipped world is now **848 / 49d542e1**: the authored Town Hall Market
  // (`src/world/townHall.ts`) occupies verified OSM way 223068917, so 5 generated
  // blocks inside that envelope are suppressed and 8 authored market buildings are
  // added. The other 840 buildings are byte-identical (see `town-hall.test.ts`,
  // which pins that delta exactly). Before the market it was 845 / c60e15b5.
    expect(BASE.digest).toBe('49d542e1');
    expect(BASE.buildings_count).toBe(848);
  });

  it('removes only buildings inside the new road and re-places no neighbour', () => {
    const baseKeys = new Set(BASE.buildings.map(keyOf));
    const pertKeys = new Set(PERTURBED.buildings.map(keyOf));

    const lost = BASE.buildings.filter((b) => !pertKeys.has(keyOf(b)));
    const strays = PERTURBED.buildings.filter((b) => !baseKeys.has(keyOf(b)));

    // A road across the mapped blocks genuinely conflicts with the buildings it
    // runs through; the pre-fix walk lost 54, the post-fix walk 19.
    expect(lost.length).toBeLessThanOrEqual(20);
    expect(lost.length).toBeGreaterThan(0);

    // Every removal is caused by the road itself: no building is lost from a
    // frontage the road never reaches. Pre-fix, losses reached 70.9 m out.
    for (const b of lost) {
      const frame = probeFrame(b);
      const why = `${b.cx.toFixed(2)},${b.cz.toFixed(2)} lost ${frame.d.toFixed(2)} m from the probe`;
      expect(frame.d, why).toBeLessThanOrEqual(12.5);
    }

    // Any new building must belong to the probe's own frontage. Pre-fix, 39
    // buildings appeared and most sat on legacy frontages the probe never
    // touched — neighbours shifted, which is exactly the defect.
    for (const b of strays) {
      const frame = probeFrame(b);
      const why = `${b.cx.toFixed(2)},${b.cz.toFixed(2)} appeared ${frame.d.toFixed(2)} m from the probe`;
      expect(frame.u, why).toBeGreaterThanOrEqual(-1);
      expect(frame.u, why).toBeLessThanOrEqual(PROBE.length + 1);
      expect(Math.abs(frame.v), why).toBeGreaterThanOrEqual(4);
      expect(Math.abs(frame.v), why).toBeLessThanOrEqual(26);
    }
  });
});
