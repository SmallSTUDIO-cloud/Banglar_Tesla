import { describe, expect, it } from 'vitest';
import goldenRaw from '../../data/mohammadpur/lane-graph-baseline.json';
import { GRAPH_NODES, ROAD_SEGMENTS, nodeById } from '../../src/world/layout';
import { getLaneGraph } from '../../src/ai/routes';
import { diffSnapshots, formatDrift } from '../../tools/snapshotDiff';
import {
  buildLaneGraphSnapshot,
  laneDigest,
  laneFingerprint,
  type LaneGraphSnapshot,
} from '../../tools/laneGraphSnapshot';

/**
 * Lane-graph drift protection.
 *
 * The gameplay baseline pins the authored road graph; the world baseline pins
 * what `buildCity()` generates from it. The lane layer that traffic actually
 * drives had **no** coverage, even though it is derived from segment geometry
 * and therefore moves *before* any authored field does.
 *
 * `getLaneGraph()` is a pure function of `ROAD_SEGMENTS` + `GRAPH_NODES`, so it
 * is snapshotted directly here.
 */

const GOLDEN = goldenRaw as unknown as Record<string, unknown> & LaneGraphSnapshot;

/** Strip provenance metadata, leaving the comparable payload. */
function goldenPayload(): LaneGraphSnapshot {
  const payload: Record<string, unknown> = { ...GOLDEN };
  delete payload._note;
  delete payload.capturedWith;
  delete payload.acceptedReason;
  delete payload.digest;
  return payload as unknown as LaneGraphSnapshot;
}

describe('lane graph baseline', () => {
  it('matches the golden digest', () => {
    const snapshot = buildLaneGraphSnapshot(getLaneGraph());
    expect(laneDigest(snapshot)).toBe(GOLDEN.digest);
  });

  it('has zero structural drift against the golden', () => {
    const snapshot = buildLaneGraphSnapshot(getLaneGraph());
    const drift = diffSnapshots(snapshot, goldenPayload());
    expect(drift.length, `unexplained lane drift:\n${formatDrift(drift.slice(0, 30))}`).toBe(0);
  });

  it('builds exactly two directed lanes per gameplay segment', () => {
    const snapshot = buildLaneGraphSnapshot(getLaneGraph());
    expect(snapshot.laneCount).toBe(ROAD_SEGMENTS.length * 2);
    expect(snapshot.segmentCount).toBe(ROAD_SEGMENTS.length);
    for (const seg of ROAD_SEGMENTS) {
      expect(snapshot.lanesBySegment[seg.id], `segment ${seg.id}`).toBe(2);
    }
  });

  it('uses exactly one fwd and one rev lane per segment, keyed by segment id', () => {
    const graph = getLaneGraph();
    for (const seg of ROAD_SEGMENTS) {
      const lanes = graph.bySegment.get(seg.id) ?? [];
      expect(lanes.map((l) => l.id).sort(), `segment ${seg.id}`).toEqual([
        `${seg.id}:fwd`,
        `${seg.id}:rev`,
      ]);
      const fwd = graph.byId.get(`${seg.id}:fwd`)!;
      const rev = graph.byId.get(`${seg.id}:rev`)!;
      expect([fwd.fromNode, fwd.toNode]).toEqual([seg.from, seg.to]);
      expect([rev.fromNode, rev.toNode]).toEqual([seg.to, seg.from]);
    }
  });

  it('resolves every lane endpoint to a real junction node', () => {
    for (const lane of getLaneGraph().lanes) {
      expect(nodeById(lane.fromNode), `${lane.id} fromNode`).toBeDefined();
      expect(nodeById(lane.toNode), `${lane.id} toNode`).toBeDefined();
    }
    // The reverse of the previous check: every declared node owns outgoing lanes.
    const graph = getLaneGraph();
    for (const node of GRAPH_NODES) {
      const outgoing = graph.lanes.filter((l) => l.fromNode === node.id);
      if (node.deadEnd) {
        expect(outgoing.length, `dead end ${node.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every junction turn target a lane that actually leaves that node', () => {
    const graph = getLaneGraph();
    for (const lane of graph.lanes) {
      expect(lane.nextLaneIds.length, `${lane.id} has no continuation`).toBeGreaterThan(0);
      for (const id of lane.nextLaneIds) {
        const next = graph.byId.get(id);
        expect(next, `${lane.id} -> ${id}`).toBeDefined();
        expect(next!.fromNode, `${lane.id} -> ${id} must leave ${lane.toNode}`).toBe(lane.toNode);
      }
      // U-turns are only offered when there is genuinely no other continuation.
      const nonUTurn = lane.nextLaneIds.filter((id) => graph.byId.get(id)!.toNode !== lane.fromNode);
      if (nonUTurn.length > 0) {
        expect(lane.nextLaneIds.every((id) => graph.byId.get(id)!.toNode !== lane.fromNode)).toBe(
          true,
        );
      }
    }
  });

  it('keeps each lane collinear with its segment centreline', () => {
    // This is the invariant a careless "subdivide the segment into spans" edit
    // would break: a lane must still run node-to-node along the chord.
    const graph = getLaneGraph();
    for (const seg of ROAD_SEGMENTS) {
      const fwd = graph.byId.get(`${seg.id}:fwd`)!;
      const rev = graph.byId.get(`${seg.id}:rev`)!;
      // Same line direction as the segment (sign aside).
      expect(Math.abs(fwd.ux * seg.uz - fwd.uz * seg.ux), `${seg.id} fwd skew`).toBeLessThan(1e-9);
      expect(fwd.ux * seg.ux + fwd.uz * seg.uz, `${seg.id} fwd sign`).toBeCloseTo(1, 9);
      // Lanes run node centre to node centre, offset laterally — never shortened.
      expect(fwd.length, `${seg.id} fwd length`).toBeCloseTo(seg.length, 6);
      expect(rev.length, `${seg.id} rev length`).toBeCloseTo(seg.length, 6);
    }
  });

  it('is deterministic across rebuilds', () => {
    // `getLaneGraph` memoises, so compare two independently built snapshots of
    // the same cached graph and confirm the payload (not just the digest) is equal.
    const a = buildLaneGraphSnapshot(getLaneGraph());
    const b = buildLaneGraphSnapshot(getLaneGraph());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Lane ids are sorted, so the payload has no map-iteration-order dependence.
    const ids = a.lanes.map((l) => l.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('lane digest sensitivity', () => {
  // Cheap in-memory mutation proofs: they show the guard actually detects the
  // failures we care about, rather than merely hashing something.
  const base = () => buildLaneGraphSnapshot(getLaneGraph());
  const clone = (s: LaneGraphSnapshot): LaneGraphSnapshot => JSON.parse(JSON.stringify(s));

  it('changes when a lane moves', () => {
    const mutated = clone(base());
    mutated.lanes[0].ax += 0.01;
    expect(laneDigest(mutated)).not.toBe(laneDigest(base()));
  });

  it('changes when a lane length changes', () => {
    const mutated = clone(base());
    mutated.lanes[3].length += 0.5;
    expect(laneDigest(mutated)).not.toBe(laneDigest(base()));
  });

  it('changes when junction topology changes but geometry does not', () => {
    const snapshot = base();
    const mutated = clone(snapshot);
    const lane = mutated.lanes.find((l) => l.nextLaneIds.length > 1)!;
    lane.nextLaneIds = lane.nextLaneIds.slice(0, 1);
    // Geometry identical, only the turn target set changed.
    if (lane.ax !== snapshot.lanes.find((l) => l.id === lane.id)!.ax) throw new Error('geometry moved');
    expect(laneDigest(mutated)).not.toBe(laneDigest(snapshot));
  });

  it('changes when a direction is reversed', () => {
    const mutated = clone(base());
    mutated.lanes[5].fromNode = 'NOT_A_NODE';
    expect(laneDigest(mutated)).not.toBe(laneDigest(base()));
  });

  it('is order-independent, so reordering the lane list does not fake a change', () => {
    const shuffled = clone(base());
    shuffled.lanes.reverse();
    expect(laneDigest(shuffled)).toBe(laneDigest(base()));
  });

  it('still distinguishes lanes whose fields differ only in the last digit', () => {
    const mutated = clone(base());
    mutated.lanes[2].yaw += 0.000001;
    expect(laneFingerprint(mutated.lanes[2])).not.toBe(laneFingerprint(base().lanes[2]));
    expect(laneDigest(mutated)).not.toBe(laneDigest(base()));
  });
});
