/**
 * Print the derived lane-graph snapshot as JSON (CLI).
 *
 * Run: npx vite-node tools/snapshot-lanegraph.ts > lanes.json
 */
import { getLaneGraph } from '../src/ai/routes';
import { buildLaneGraphSnapshot, laneDigest } from './laneGraphSnapshot';

const snapshot = buildLaneGraphSnapshot(getLaneGraph());
console.error(
  `[lanes] ${snapshot.laneCount} lanes across ${snapshot.segmentCount} segments, ` +
    `digest ${laneDigest(snapshot)}`,
);
console.log(JSON.stringify(snapshot, null, 1));
