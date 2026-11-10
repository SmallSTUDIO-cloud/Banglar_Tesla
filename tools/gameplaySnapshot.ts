/**
 * Gameplay reference snapshot — the single source of truth for drift detection.
 *
 * Road geometry feeds races, missions, traffic, pickups and place markers. Every
 * one of those is *derived* from segment endpoints at runtime, so a geometry
 * edit silently re-times races and re-prices shortcuts. This module dumps every
 * derived value so a change can be proven rather than assumed.
 *
 * Two consumers, deliberately sharing this one implementation:
 *   - `tools/snapshot-gameplay.ts` (CLI, writes the JSON)
 *   - `tests/unit/gameplay-baseline.test.ts` (drift test against the golden file)
 *
 * If they had separate implementations the test could pass while the CLI emitted
 * something different, which is exactly the failure mode this is meant to catch.
 *
 * Values are GAME UNITS (1 unit = 2.778 real m) except `segments[].width`, which
 * is authored in real metres — see docs/ASAD_AVENUE_ROAD_TOPOLOGY_AUDIT.md §0.2.
 */

import { ROAD_SEGMENTS, PLACES, GRAPH_NODES } from '../src/world/layout';
import {
  BLACKLIST_RIVALS,
  OPEN_STREET_EVENTS,
  type BlacklistRival,
  type RivalEventSpec,
} from '../src/blacklist/blacklistCatalog';
import { buildRaceCourse } from '../src/blacklist/raceRoutes';
import { RivalRaceSystem } from '../src/blacklist/raceSystem';
import { LANDMARKS } from '../src/world/landmarks';

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

export interface SnapshotNode {
  id: string;
  x: number;
  z: number;
}

export interface SnapshotSegment {
  id: string;
  from: string;
  to: string;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  length: number;
  width: number;
  kind: string;
}

export interface SnapshotPlace {
  id: string;
  segmentId: string;
  x: number;
  z: number;
}

export interface SnapshotLandmark {
  id: string;
  frontageSegmentId: string | null;
  x: number;
  z: number;
}

export interface SnapshotShortcut {
  id: string;
  mainDistanceM: number;
  shortcutDistanceM: number;
  savingM: number;
}

export interface SnapshotCourse {
  eventId: string;
  startSegmentId?: string;
  startBanner?: { x: number; z: number; yaw: number; width: number };
  gateCount?: number;
  gateSample?: { x: number; z: number }[];
  totalDistanceM?: number;
  gridSlots?: { x: number; z: number }[];
  shortcuts?: SnapshotShortcut[];
  /** Authored race deadline. Covered by the drift test: retuning must be approved. */
  deadlineSeconds: number;
  /** Deterministic unobstructed AI reference times. Simulation values, not device data. */
  aiReferenceTimesS?: number[];
  error?: string;
}

export interface GameplaySnapshot {
  counts: { segments: number; nodes: number; places: number; courses: number };
  segments: SnapshotSegment[];
  nodes: SnapshotNode[];
  places: SnapshotPlace[];
  landmarks: SnapshotLandmark[];
  courses: SnapshotCourse[];
}

export interface BuildOptions {
  /**
   * Also simulate each race to capture AI reference times. Off by default so
   * callers that only need geometry stay fast; the golden file and the drift
   * test both enable it.
   */
  includeAiTimings?: boolean;
}

interface EventEntry {
  event: RivalEventSpec;
  rival: BlacklistRival | null;
}

/** Exactly the event set the race-map tests validate (17 blueprints). */
const EVENTS: EventEntry[] = [
  ...BLACKLIST_RIVALS.map((rival): EventEntry => ({ event: rival.bossEvent, rival })),
  ...OPEN_STREET_EVENTS.map((event): EventEntry => ({ event, rival: null })),
];

/**
 * Simulate one race to completion at 60 fps with a zeroed RNG.
 *
 * Mirrors `tests/unit/vnext-race-timing.test.ts` so the two cannot disagree
 * about what a reference time means.
 */
function simulateAiTimes(event: RivalEventSpec, rival: BlacklistRival | null): number[] {
  const race = new RivalRaceSystem(() => 0);
  race.startEvent({ ...event, targetSeconds: 1000 }, rival, 0);
  let standings = race.getStandings(9999, 9999);
  for (let i = 0; i < 450 * 60; i++) {
    race.update(1 / 60, 9999, 9999, 0, i / 60);
    standings = race.getStandings(9999, 9999);
    const ai = standings.filter((entry) => !entry.isPlayer);
    if (ai.length && ai.every((entry) => entry.finished)) break;
  }
  const times = standings
    .filter((entry) => !entry.isPlayer)
    .map((entry) => round(entry.timeSeconds, 1));
  race.cancel();
  return times;
}

/**
 * Build the snapshot. Pure with respect to world state: reads the live graph and
 * returns a plain object. Deterministic — the same commit always yields the same
 * JSON, which is what makes it usable as a golden file.
 */
export function buildGameplaySnapshot(options: BuildOptions = {}): GameplaySnapshot {
  const { includeAiTimings = false } = options;

  const nodes: SnapshotNode[] = GRAPH_NODES.map((n) => ({ id: n.id, x: round(n.x), z: round(n.z) }));

  const segments: SnapshotSegment[] = ROAD_SEGMENTS.map((s) => ({
    id: s.id,
    from: s.from,
    to: s.to,
    ax: round(s.ax),
    az: round(s.az),
    bx: round(s.bx),
    bz: round(s.bz),
    length: round(s.length),
    width: s.width,
    kind: s.kind,
  }));

  const places: SnapshotPlace[] = PLACES.map((p) => ({
    id: p.id,
    segmentId: p.segmentId,
    x: round(p.x),
    z: round(p.z),
  }));

  const landmarks: SnapshotLandmark[] = LANDMARKS.map((l) => ({
    id: l.id,
    frontageSegmentId: l.frontageSegmentId ?? null,
    x: round(l.x),
    z: round(l.z),
  }));

  const courses: SnapshotCourse[] = EVENTS.map(({ event, rival }) => {
    const deadlineSeconds = event.targetSeconds;
    const aiReferenceTimesS = includeAiTimings ? simulateAiTimes(event, rival) : undefined;
    try {
      const course = buildRaceCourse(event);
      const entry: SnapshotCourse = {
        eventId: event.id,
        startSegmentId: course.startSegmentId,
        startBanner: {
          x: round(course.startBanner.x),
          z: round(course.startBanner.z),
          yaw: round(course.startBanner.yaw, 4),
          width: round(course.startBanner.width),
        },
        gateCount: course.allCheckpoints.length,
        gateSample: course.allCheckpoints.slice(0, 3).map((g) => ({ x: round(g.x), z: round(g.z) })),
        totalDistanceM: round(course.totalDistanceM),
        gridSlots: course.gridSlots.map((g) => ({ x: round(g.x), z: round(g.z) })),
        shortcuts: course.shortcuts.map((s) => ({
          id: s.id,
          mainDistanceM: s.mainDistanceM,
          shortcutDistanceM: s.shortcutDistanceM,
          savingM: s.mainDistanceM - s.shortcutDistanceM,
        })),
        deadlineSeconds,
      };
      if (aiReferenceTimesS) entry.aiReferenceTimesS = aiReferenceTimesS;
      return entry;
    } catch (error) {
      const entry: SnapshotCourse = {
        eventId: event.id,
        deadlineSeconds,
        error: String(error).slice(0, 160),
      };
      if (aiReferenceTimesS) entry.aiReferenceTimesS = aiReferenceTimesS;
      return entry;
    }
  });

  return {
    counts: {
      segments: segments.length,
      nodes: nodes.length,
      places: places.length,
      courses: courses.length,
    },
    segments,
    nodes,
    places,
    landmarks,
    courses,
  };
}

/** Stable serialisation, so byte-identity is a meaningful claim. */
export function serialiseSnapshot(snapshot: GameplaySnapshot): string {
  return JSON.stringify(snapshot, null, 1);
}
