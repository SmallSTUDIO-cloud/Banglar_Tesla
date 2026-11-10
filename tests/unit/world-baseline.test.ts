import { describe, expect, it } from 'vitest';
import goldenRaw from '../../data/mohammadpur/world-baseline.json';
import { diffSnapshots, formatDrift } from '../../tools/snapshotDiff';
import {
  buildWorldSnapshot,
  fingerprintOf,
  nearestSegmentId,
  worldDigest,
  type BuildingFingerprint,
  type CityLike,
  type ColliderLike,
  type WorldSnapshot,
} from '../../tools/worldSnapshot';
import { generateWorldSnapshot } from '../../tools/worldSnapshotGenerate';

/**
 * Generated-world drift protection.
 *
 * The gameplay baseline pins the road graph. This pins what is *generated from*
 * it. The gap was real: `city.ts` places buildings with
 * `while (along < seg.length - 9.5)`, so a segment length change silently
 * changes how many buildings exist. 845 buildings had no coverage at all before
 * this file.
 *
 * Generation runs the real `buildCity()` headless behind a no-op canvas shim
 * (`tools/domShim.ts`). Building placement reads only segment geometry and the
 * seeded RNG, never a pixel, so the shim cannot change the result — confirmed by
 * the 845 count matching the browser-based `tests/e2e/verify-geography.mjs`.
 */

const GOLDEN = goldenRaw as unknown as Record<string, unknown> & WorldSnapshot;

/** Strip provenance metadata, leaving the comparable payload. */
function goldenPayload(): WorldSnapshot {
  const payload: Record<string, unknown> = { ...GOLDEN };
  delete payload._note;
  delete payload.capturedWith;
  delete payload.acceptedReason;
  delete payload.digest;
  return payload as unknown as WorldSnapshot;
}

// One live build, shared by the assertions below. Generation takes a few
// seconds, so it is done once at module scope.
const LIVE = await generateWorldSnapshot();

// Synthetic fixtures for the comparison logic, so detection is proven without
// needing to mutate real geometry.
function cityFrom(buildings: ColliderLike[]): CityLike {
  return {
    colliders: buildings,
    treeCount: 0,
    utilityPoleSites: [],
    lampPositions: [],
    litterCount: 0,
    infillCount: 0,
    posterCount: 0,
    billboardCount: 0,
    groceryCount: 0,
    humps: [],
  };
}

function building(cx: number, cz: number, w = 8, d = 8, h = 10): ColliderLike {
  return {
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minZ: cz - d / 2,
    maxZ: cz + d / 2,
    height: h,
    kind: 'building',
    cx,
    cz,
  };
}

describe('generated world baseline', () => {
  it('matches the golden building count', () => {
    expect(LIVE.counts.buildings).toBe(GOLDEN.counts.buildings);
    expect(LIVE.counts.buildings).toBe(845);
  });

  it('matches the golden digest', () => {
    expect(worldDigest(LIVE)).toBe(GOLDEN.digest);
  });

  it('has no drift in counts', () => {
    const drift = diffSnapshots(LIVE.counts, GOLDEN.counts);
    expect(drift, formatDrift(drift)).toEqual([]);
  });

  it('has no drift in per-segment building distribution', () => {
    const drift = diffSnapshots(LIVE.buildingsBySegment, GOLDEN.buildingsBySegment);
    expect(drift, formatDrift(drift)).toEqual([]);
    // Every segment carries buildings at this commit; a zero would be a signal.
    const empties = Object.entries(LIVE.buildingsBySegment)
      .filter(([, n]) => n === 0)
      .map(([id]) => id);
    expect(empties).toEqual([]);
  });

  it('has no drift in building placements', () => {
    const drift = diffSnapshots(LIVE.buildings, goldenPayload().buildings);
    expect(drift.length, `${drift.length} building(s) moved; first: ${formatDrift(drift.slice(0, 5))}`).toBe(0);
  });

  it('is fully reproducible against the whole golden payload', () => {
    const drift = diffSnapshots(LIVE, goldenPayload());
    expect(drift, formatDrift(drift.slice(0, 20))).toEqual([]);
  });

  it('generates deterministically', async () => {
    // A second live build in the same process must be identical. Without this,
    // any failure above could be noise rather than a real change.
    const second = await generateWorldSnapshot();
    expect(worldDigest(second)).toBe(worldDigest(LIVE));
    expect(diffSnapshots(second, LIVE)).toEqual([]);
  });

  it('produces fingerprints independent of input order', () => {
    const a = buildWorldSnapshot(cityFrom([building(10, 10), building(20, 20), building(30, 30)]));
    const b = buildWorldSnapshot(cityFrom([building(30, 30), building(10, 10), building(20, 20)]));
    expect(worldDigest(a)).toBe(worldDigest(b));
    expect(a.buildings).toEqual(b.buildings);
  });

  it('attributes a building to its nearest segment deterministically', () => {
    // A building on top of a segment's own start node must attribute to that
    // segment (or a tie-broken neighbour), never drift with iteration order.
    const first = nearestSegmentId(LIVE.buildings[0].x, LIVE.buildings[0].z);
    const again = nearestSegmentId(LIVE.buildings[0].x, LIVE.buildings[0].z);
    expect(again).toEqual(first);
    expect(first.segmentId).toBe(LIVE.buildings[0].segmentId);
  });

  describe('detects changes (proven on synthetic data)', () => {
    const base = buildWorldSnapshot(cityFrom([building(10, 10), building(20, 20), building(30, 30)]));

    it('detects a building move', () => {
      const moved = buildWorldSnapshot(cityFrom([building(10, 10), building(20.5, 20), building(30, 30)]));
      expect(worldDigest(moved)).not.toBe(worldDigest(base));
      const drift = diffSnapshots(moved.buildings, base.buildings);
      expect(drift.length).toBeGreaterThan(0);
      // A move changes identity, so it reports as a vanished record plus a new
      // one rather than shifting every later index.
      const states = drift.map((d) => `${d.expected}|${d.actual}`);
      expect(states).toContain('present|MISSING');
      expect(states).toContain('absent|UNEXPECTED');
      expect(formatDrift(drift)).toMatch(/MISSING|UNEXPECTED/);
    });

    it('detects a building count change', () => {
      const fewer = buildWorldSnapshot(cityFrom([building(10, 10), building(20, 20)]));
      expect(fewer.counts.buildings).toBe(2);
      const drift = diffSnapshots(fewer.counts, base.counts);
      expect(drift.map((d) => d.path)).toContain('buildings');
      expect(worldDigest(fewer)).not.toBe(worldDigest(base));
    });

    it('detects a footprint change in place', () => {
      const resized = buildWorldSnapshot(cityFrom([building(10, 10, 12), building(20, 20), building(30, 30)]));
      const drift = diffSnapshots(resized.buildings, base.buildings);
      expect(drift.length).toBeGreaterThan(0);
      expect(drift.some((d) => d.path.endsWith('.width'))).toBe(true);
    });

    it('detects a per-segment distribution change', () => {
      // Move one building from wherever it was to a different segment: the
      // total stays the same, so only the per-segment counts can reveal it.
      const target = LIVE.buildings[0];
      const donorSegment = target.segmentId;
      const otherSegment = Object.keys(LIVE.buildingsBySegment).find((id) => id !== donorSegment)!;

      const shifted: Record<string, number> = { ...LIVE.buildingsBySegment };
      shifted[donorSegment] -= 1;
      shifted[otherSegment] += 1;

      const drift = diffSnapshots(
        { buildingsBySegment: shifted },
        { buildingsBySegment: LIVE.buildingsBySegment },
      );
      expect(drift.map((d) => d.path).sort()).toEqual(
        [`buildingsBySegment.${otherSegment}`, `buildingsBySegment.${donorSegment}`].sort(),
      );
      // Total unchanged, which is exactly why per-segment counts are required.
      const before = Object.values(LIVE.buildingsBySegment).reduce((a, b) => a + b, 0);
      const after = Object.values(shifted).reduce((a, b) => a + b, 0);
      expect(after).toBe(before);
    });

    it('fingerprints contain a stable identifier and position, nothing volatile', () => {
      const fp = fingerprintOf(LIVE.buildings[0]);
      expect(fp).toMatch(/^[a-z0-9_]+:-?\d+\.\d{2},-?\d+\.\d{2},\d+\.\d{2}x\d+\.\d{2}x\d+\.\d{2}$/);
      // No timestamps, indices or random content.
      expect(fp).not.toMatch(/\d{10,}/);
    });

    it('keeps the building list ordered by segment then position', () => {
      const list: BuildingFingerprint[] = LIVE.buildings;
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1];
        const b = list[i];
        const ordered =
          a.segmentId < b.segmentId ||
          (a.segmentId === b.segmentId &&
            (a.x < b.x || (a.x === b.x && (a.z < b.z || (a.z === b.z && a.width <= b.width)))));
        expect(ordered, `out of order at ${i}: ${a.id} then ${b.id}`).toBe(true);
      }
      // Identity must be unique, or position-keyed diffing would be ambiguous.
      expect(new Set(list.map((b) => b.id)).size).toBe(list.length);
    });
  });
}, 240_000);
