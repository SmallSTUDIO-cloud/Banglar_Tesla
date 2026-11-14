/**
 * Field-level diff for gameplay snapshots.
 *
 * A road edit must never be described as "tests still pass" — it must be
 * described as "these 11 numbers moved, here they are". This walks two snapshots
 * and emits one entry per changed leaf, keyed by a readable path, so the drift
 * test's failure message *is* the review document.
 *
 * Shared by `tests/unit/gameplay-baseline.test.ts` and
 * `scripts/update-gameplay-baseline.ts` so the reported and the applied diff are
 * the same text.
 */

export interface Drift {
  /** Dotted path, e.g. `courses[ev_street_asad].deadlineSeconds`. */
  path: string;
  expected: unknown;
  actual: unknown;
}

const STABLE_KEYS = ['id', 'eventId'] as const;

type Json = unknown;

function isPlainObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stable identity for an array element, so records are matched by id not index. */
function identityOf(value: Json): string | null {
  if (!isPlainObject(value)) return null;
  for (const key of STABLE_KEYS) {
    const candidate = value[key];
    if (typeof candidate === 'string') return candidate;
  }
  return null;
}

export function formatValue(value: Json): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') {
    // Show enough precision to see a sub-millimetre move without printing noise.
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 10000) / 10000);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  return JSON.stringify(value);
}

function walk(actual: Json, expected: Json, path: string, out: Drift[]): void {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    const actualArr = Array.isArray(actual) ? actual : [];
    const expectedArr = Array.isArray(expected) ? expected : [];

    const actualIds = actualArr.map(identityOf);
    const expectedIds = expectedArr.map(identityOf);
    const keyed = expectedArr.length > 0 && expectedIds.every((k) => k !== null);

    if (keyed) {
      const actualByKey = new Map<string, Json>();
      actualArr.forEach((item, i) => actualByKey.set(actualIds[i] as string, item));
      const expectedKeys = new Set(expectedIds as string[]);
      for (let i = 0; i < expectedArr.length; i++) {
        const key = expectedIds[i] as string;
        if (!actualByKey.has(key)) {
          out.push({ path: `${path}[${key}]`, expected: 'present', actual: 'MISSING' });
          continue;
        }
        walk(actualByKey.get(key), expectedArr[i], `${path}[${key}]`, out);
      }
      for (const key of actualByKey.keys()) {
        if (!expectedKeys.has(key)) {
          out.push({ path: `${path}[${key}]`, expected: 'absent', actual: 'UNEXPECTED' });
        }
      }
      return;
    }

    if (actualArr.length !== expectedArr.length) {
      out.push({ path: `${path}.length`, expected: expectedArr.length, actual: actualArr.length });
    }
    const max = Math.max(actualArr.length, expectedArr.length);
    for (let i = 0; i < max; i++) {
      walk(actualArr[i], expectedArr[i], `${path}[${i}]`, out);
    }
    return;
  }

  if (isPlainObject(expected) || isPlainObject(actual)) {
    const expectedObj = isPlainObject(expected) ? expected : {};
    const actualObj = isPlainObject(actual) ? actual : {};
    const keys = new Set<string>([...Object.keys(expectedObj), ...Object.keys(actualObj)]);
    for (const key of [...keys].sort()) {
      const childPath = path ? `${path}.${key}` : key;
      walk(actualObj[key], expectedObj[key], childPath, out);
    }
    return;
  }

  if (!Object.is(actual, expected)) {
    out.push({ path: path || '(root)', expected, actual });
  }
}

/**
 * Compare `actual` (current code) against `expected` (golden baseline).
 * Returns one entry per changed leaf; empty means no drift.
 */
export function diffSnapshots(actual: Json, expected: Json): Drift[] {
  const out: Drift[] = [];
  walk(actual, expected, '', out);
  return out;
}

/** Human-readable report, one line per changed field. */
export function formatDrift(drift: Drift[]): string {
  return drift
    .map((d) => `  ${d.path}\n      baseline: ${formatValue(d.expected)}\n      current : ${formatValue(d.actual)}`)
    .join('\n');
}
