/**
 * Regenerate the golden gameplay baseline — deliberately, with review.
 *
 * The drift test fails when the live graph disagrees with the golden file. That
 * is correct behaviour, and it must not be silenced by "just update the
 * baseline". This script therefore has a hard approval gate:
 *
 *   1. It prints the exact field-level diff it is about to accept.
 *   2. It refuses to write unless BASELINE_ACCEPT is set to a reason.
 *   3. The resulting JSON diff is committed alongside that reason, so the
 *      change is reviewable in the pull request like any other artwork or code.
 *
 * Usage:
 *   npm run baseline:update                          # dry run: prints the diff
 *   BASELINE_ACCEPT="re-anchored Asad corridor, deadline re-authored" \
 *     npm run baseline:update                        # applies, prints the reason
 *
 * Never run this to make a red test green without reading the diff first.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGameplaySnapshot } from '../tools/gameplaySnapshot';
import { diffSnapshots, formatDrift } from '../tools/snapshotDiff';

const GOLDEN_PATH = resolve(process.cwd(), 'data/mohammadpur/gameplay-baseline.json');

const NOTE =
  'Golden gameplay reference. Compared field-by-field by ' +
  'tests/unit/gameplay-baseline.test.ts. Regenerate only via ' +
  '`npm run baseline:update` with BASELINE_ACCEPT set to a reason. ' +
  'Values are GAME UNITS (1 unit = 2.778 real m) except segments[].width, which is ' +
  'authored in real metres. aiReferenceTimesS are deterministic unobstructed ' +
  'simulation values, NOT device or human measurements.';

const next = buildGameplaySnapshot({ includeAiTimings: true });

let previous: Record<string, unknown> | null = null;
try {
  previous = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, unknown>;
} catch {
  previous = null;
}

if (!previous) {
  console.log('[baseline] no existing golden file — creating one.');
} else {
  const payload: Record<string, unknown> = { ...previous };
  // Provenance metadata is not part of the snapshot the test compares.
  delete payload._note;
  delete payload.capturedWith;
  delete payload.acceptedReason;
  const drift = diffSnapshots(next, payload);
  if (drift.length === 0) {
    console.log('[baseline] no drift: current code already matches the golden baseline.');
    process.exit(0);
  }
  console.log(`[baseline] ${drift.length} field(s) would change:\n`);
  console.log(formatDrift(drift));
  console.log('');
}

const reason = (process.env.BASELINE_ACCEPT || '').trim();
if (!reason) {
  console.error(
    '[baseline] REFUSED — no approval reason.\n' +
      '          Review the diff above, then re-run with:\n' +
      '            BASELINE_ACCEPT="<why this change is intended>" npm run baseline:update',
  );
  process.exit(1);
}

const file = {
  _note: NOTE,
  capturedWith: 'npx vite-node tools/snapshot-gameplay.ts',
  acceptedReason: reason,
  ...next,
};

writeFileSync(GOLDEN_PATH, `${JSON.stringify(file, null, 1)}\n`, 'utf8');
console.log(`[baseline] wrote ${GOLDEN_PATH}`);
console.log(`[baseline] reason: ${reason}`);
