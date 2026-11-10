/**
 * Regenerate the golden lane-graph baseline — deliberately, with review.
 *
 * Mirrors `scripts/update-world-baseline.ts`: prints the exact diff, refuses to
 * write without an approval reason, and records that reason in the file.
 *
 * Usage:
 *   npm run baseline:update-lanes                        # dry run, prints diff
 *   BASELINE_ACCEPT="reason" npm run baseline:update-lanes
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLaneGraph } from '../src/ai/routes';
import { buildLaneGraphSnapshot, laneDigest } from '../tools/laneGraphSnapshot';
import { diffSnapshots, formatDrift } from '../tools/snapshotDiff';

const GOLDEN_PATH = resolve(process.cwd(), 'data/mohammadpur/lane-graph-baseline.json');

const NOTE =
  'Golden lane-graph reference, derived from src/ai/routes.ts#getLaneGraph(). ' +
  'Compared field-by-field by tests/unit/lane-graph-baseline.test.ts. ' +
  'Regenerate only via `npm run baseline:update-lanes` with BASELINE_ACCEPT set to a reason. ' +
  'Pins lane identity, endpoints, tangent, yaw, length and nextLaneIds junction topology ' +
  'so a geometry change cannot silently reshape traffic before it is reviewed.';

const snapshot = buildLaneGraphSnapshot(getLaneGraph());
const digest = laneDigest(snapshot);

let previous: Record<string, unknown> | null = null;
try {
  previous = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, unknown>;
} catch {
  previous = null;
}

if (previous) {
  const payload: Record<string, unknown> = { ...previous };
  delete payload._note;
  delete payload.capturedWith;
  delete payload.acceptedReason;
  delete payload.digest;
  const drift = diffSnapshots(snapshot, payload);
  if (drift.length === 0 && previous.digest === digest) {
    console.log(`[lanes] no drift: ${snapshot.laneCount} lanes, digest ${digest}.`);
    process.exit(0);
  }
  console.log(
    `[lanes] ${drift.length} field(s) would change ` +
      `(digest ${String(previous.digest)} -> ${digest}):\n`,
  );
  console.log(formatDrift(drift.slice(0, 80)));
  if (drift.length > 80) console.log(`  ... ${drift.length - 80} more`);
  console.log('');
}

const reason = (process.env.BASELINE_ACCEPT ?? '').trim();
if (!reason) {
  console.error(
    '[lanes] REFUSED — no approval reason.\n' +
      '        Review the diff above, then re-run with:\n' +
      '          BASELINE_ACCEPT="<why this change is intended>" npm run baseline:update-lanes',
  );
  process.exit(1);
}

const file = {
  _note: NOTE,
  capturedWith: 'npx vite-node tools/snapshot-lanegraph.ts',
  acceptedReason: reason,
  digest,
  ...snapshot,
};

writeFileSync(GOLDEN_PATH, `${JSON.stringify(file, null, 1)}\n`, 'utf8');
console.log(`[lanes] wrote ${GOLDEN_PATH} (${snapshot.laneCount} lanes, digest ${digest})`);
console.log(`[lanes] reason: ${reason}`);
