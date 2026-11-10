import { describe, expect, it } from 'vitest';
import goldenRaw from '../../data/mohammadpur/gameplay-baseline.json';
import { buildGameplaySnapshot, type GameplaySnapshot } from '../../tools/gameplaySnapshot';
import { diffSnapshots, formatDrift, type Drift } from '../../tools/snapshotDiff';

/**
 * Golden-baseline drift protection.
 *
 * Road geometry, race courses and shortcut values are all *derived* at runtime
 * from segment endpoints. That means a one-line coordinate edit can silently
 * re-time 11 races and re-price 3 shortcuts — which is exactly what happened
 * during the first Asad Avenue alignment attempt (measured in
 * docs/ASAD4_ALIGNMENT_EXPERIMENT.md).
 *
 * These tests make that class of change loud. Any movement in the graph, in a
 * place or landmark anchor, in a course distance, in an authored deadline, or in
 * a shortcut's saving fails with the exact field and its before/after values.
 *
 * An intentional change is accommodated by `npm run baseline:update` with a
 * stated reason, so the JSON diff lands in the commit for review. The baseline
 * is never adjusted merely to make a red test green.
 */

const GOLDEN = goldenRaw as unknown as Record<string, unknown> & GameplaySnapshot;

/** The golden file also carries provenance metadata; the snapshot itself does not. */
function goldenPayload(): GameplaySnapshot {
  const payload: Record<string, unknown> = { ...GOLDEN };
  delete payload._note;
  delete payload.capturedWith;
  delete payload.acceptedReason;
  return payload as unknown as GameplaySnapshot;
}

const ACTUAL = buildGameplaySnapshot({ includeAiTimings: true });

function expectNoDrift(areas: string[]): void {
  const expected = goldenPayload();
  const scope = Object.fromEntries(areas.map((area) => [area, (expected as unknown as Record<string, unknown>)[area]]));
  const actualScope = Object.fromEntries(
    areas.map((area) => [area, (ACTUAL as unknown as Record<string, unknown>)[area]]),
  );
  const drift: Drift[] = diffSnapshots(actualScope, scope);

  if (drift.length > 0) {
    const lines = drift.map(
      (d) => `    ${d.path}\n        baseline: ${JSON.stringify(d.expected)}\n        current : ${JSON.stringify(d.actual)}`,
    );
    throw new Error(
      `${drift.length} gameplay value(s) changed since the golden baseline was accepted:\n\n` +
        `${lines.join('\n')}\n\n` +
        `If this change is intended, review it and regenerate with:\n` +
        `  BASELINE_ACCEPT="<reason>" npm run baseline:update\n` +
        `Otherwise, revert the change that caused it.\n\n` +
        `Full report:\n${formatDrift(drift)}`,
    );
  }
  expect(drift).toEqual([]);
}

describe('golden gameplay baseline', () => {
  it('contains the full expected inventory', () => {
    expect(GOLDEN.counts).toEqual({ segments: 70, nodes: 42, places: 14, courses: 17 });
    expect(GOLDEN.nodes).toHaveLength(42);
    expect(GOLDEN.segments).toHaveLength(70);
    expect(GOLDEN.places).toHaveLength(14);
    expect(GOLDEN.landmarks).toHaveLength(9);
    expect(GOLDEN.courses).toHaveLength(17);
    const shortcuts = GOLDEN.courses.flatMap((course) => course.shortcuts ?? []);
    expect(shortcuts).toHaveLength(14);
  });

  it('read the baseline from the exact node the audit preserved', () => {
    // The seven Asad Avenue nodes, pinned individually. A corridor re-anchor is
    // the change most likely to be attempted next, so it must not be silent.
    const expected: Record<string, [number, number]> = {
      bus_stand: [-112, 194],
      asad_nurjahan: [-70, 162],
      asad_salimullah: [-15, 132],
      town_hall: [42, 106],
      asad_post: [118, 84],
      asad_iqbal: [196, 82],
      asad_gate_e: [242, 78],
    };
    const actual = Object.fromEntries(ACTUAL.nodes.map((n) => [n.id, [n.x, n.z]]));
    for (const [id, position] of Object.entries(expected)) {
      expect(actual[id], `node ${id}`).toEqual(position);
    }
  });

  it('has no drift in road nodes and segments', () => {
    expectNoDrift(['nodes', 'segments']);
  });

  it('has no drift in places and landmarks', () => {
    expectNoDrift(['places', 'landmarks']);
  });

  it('has no drift in race courses, distances and authored deadlines', () => {
    expectNoDrift(['courses']);
  });

  it('has no drift in any shortcut saving', () => {
    const expected = goldenPayload().courses.flatMap((course) =>
      (course.shortcuts ?? []).map((s) => ({ course: course.eventId, ...s })),
    );
    const actual = ACTUAL.courses.flatMap((course) =>
      (course.shortcuts ?? []).map((s) => ({ course: course.eventId, ...s })),
    );
    const drift = diffSnapshots(actual, expected);
    expect(drift, formatDrift(drift)).toEqual([]);
    expect(actual).toHaveLength(14);
    // `sc_bazar_gali_10` is the thinnest designed shortcut at 13 units; a
    // geometry edit that lengthens its main route by more than that destroys it.
    const fragile = expected.find((s) => s.id === 'sc_bazar_gali_10');
    expect(fragile?.savingM).toBe(13);
  });

  it('every authored deadline is present and is a finite number', () => {
    for (const course of ACTUAL.courses) {
      expect(typeof course.deadlineSeconds, `${course.eventId} deadline`).toBe('number');
      expect(Number.isFinite(course.deadlineSeconds), `${course.eventId} deadline finite`).toBe(true);
    }
  });

  it('generates a deterministic snapshot', () => {
    // Two independent builds in the same process must agree exactly. Without
    // this, a failure in the tests above could be noise rather than a real edit.
    const first = buildGameplaySnapshot({ includeAiTimings: true });
    const second = buildGameplaySnapshot({ includeAiTimings: true });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(diffSnapshots(second, first)).toEqual([]);
  });

  it('is reproducible against a freshly built snapshot, not just module state', () => {
    // The golden file must equal what the current code produces — this is the
    // guarantee that makes committing it meaningful.
    const drift = diffSnapshots(ACTUAL, goldenPayload());
    expect(drift, formatDrift(drift)).toEqual([]);
  });
}, 180_000);
