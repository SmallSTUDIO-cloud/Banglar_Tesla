/**
 * Gameplay reference snapshot for road-geometry changes.
 *
 * Road geometry feeds races, missions, traffic, pickups and place markers. Before
 * changing a segment, dump every derived value, change the geometry, dump again,
 * and diff. That is the only way to prove a road edit did not silently move a
 * race gate, shrink a shortcut or shift a shop marker.
 *
 * Run: npx vite-node tools/snapshot-gameplay.ts > before.json
 */
import { ROAD_SEGMENTS, PLACES, GRAPH_NODES } from '../src/world/layout';
import { BLACKLIST_RIVALS, OPEN_STREET_EVENTS } from '../src/blacklist/blacklistCatalog';
import { buildRaceCourse } from '../src/blacklist/raceRoutes';
import { LANDMARKS } from '../src/world/landmarks';

const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

const segments = ROAD_SEGMENTS.map((s) => ({
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

const nodes = GRAPH_NODES.map((n) => ({ id: n.id, x: round(n.x), z: round(n.z) }));

const places = PLACES.map((p) => ({
  id: p.id,
  segmentId: p.segmentId,
  x: round(p.x),
  z: round(p.z),
}));

const landmarks = LANDMARKS.map((l) => ({
  id: l.id,
  frontageSegmentId: l.frontageSegmentId ?? null,
  x: round(l.x),
  z: round(l.z),
}));

// Exactly the event set the race-map test validates (17 blueprints).
const EVENTS = [...BLACKLIST_RIVALS.map((r) => r.bossEvent), ...OPEN_STREET_EVENTS];

const courses = EVENTS.map((event) => {
  try {
    const course = buildRaceCourse(event);
    return {
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
    };
  } catch (error) {
    return { eventId: event.id, error: String(error).slice(0, 160) };
  }
});

const out = {
  counts: {
    segments: ROAD_SEGMENTS.length,
    nodes: GRAPH_NODES.length,
    places: PLACES.length,
    courses: courses.length,
  },
  segments,
  nodes,
  places,
  landmarks,
  courses,
};

console.log(JSON.stringify(out, null, 1));
