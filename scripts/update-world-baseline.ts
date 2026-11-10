/**
 * Regenerate the golden world baseline — deliberately, with review.
 *
 * Mirrors `scripts/update-gameplay-baseline.ts`: prints the exact diff, refuses
 * to write without an approval reason, and records that reason in the file so
 * the commit carries its own justification.
 *
 * Usage:
 *   npm run baseline:update-world                        # dry run, prints diff
 *   BASELINE_ACCEPT="reason" npm run baseline:update-world
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateWorldSnapshot } from '../tools/worldSnapshotGenerate';
import { diffSnapshots, formatDrift } from '../tools/snapshotDiff';
import { worldDigest } from '../tools/worldSnapshot';

const GOLDEN_PATH = resolve(process.cwd(), 'data/mohammadpur/world-baseline.json');

const NOTE =
  'Golden generated-world reference. Compared field-by-field by ' +
  'tests/unit/world-baseline.test.ts. Regenerate only via ' +
  '`npm run baseline:update-world` with BASELINE_ACCEPT set to a reason. ' +
  'Building positions are world units (1 unit = 2.778 real m) rounded to 1 cm. ' +
  'segmentId is derived by nearest-centreline attribution, not recorded by the generator.';

const snapshot = await generateWorldSnapshot();
const digest = worldDigest(snapshot);

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
    console.log(`[world] no drift: ${snapshot.counts.buildings} buildings, digest ${digest}.`);
    process.exit(0);
  }
  console.log(`[world] ${drift.length} field(s) would change (digest ${String(previous.digest)} -> ${digest}):\n`);
  // Building lists are long; summarise per-segment before dumping everything.
  const perSegment = drift.filter((d) => d.path.startsWith('buildingsBySegment'));
  const other = drift.filter((d) => !d.path.startsWith('buildingsBySegment'));
  if (perSegment.length) {
    console.log(`  buildingsBySegment: ${perSegment.length} segment(s) changed`);
    for (const d of perSegment.slice(0, 40)) {
      console.log(`    ${d.path}  ${JSON.stringify(d.expected)} -> ${JSON.stringify(d.actual)}`);
    }
    if (perSegment.length > 40) console.log(`    ... ${perSegment.length - 40} more`);
  }
  if (other.length) console.log(formatDrift(other.slice(0, 60)));
  console.log('');
}

const reason = (process.env.BASELINE_ACCEPT ?? '').trim();
if (!reason) {
  console.error(
    '[world] REFUSED — no approval reason.\n' +
      '        Review the diff above, then re-run with:\n' +
      '          BASELINE_ACCEPT="<why this change is intended>" npm run baseline:update-world',
  );
  process.exit(1);
}

const file = {
  _note: NOTE,
  capturedWith: 'npx vite-node tools/snapshot-world.ts',
  acceptedReason: reason,
  digest,
  ...snapshot,
};

writeFileSync(GOLDEN_PATH, `${JSON.stringify(file, null, 1)}\n`, 'utf8');
console.log(`[world] wrote ${GOLDEN_PATH} (${snapshot.counts.buildings} buildings, digest ${digest})`);
console.log(`[world] reason: ${reason}`);
