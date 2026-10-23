/**
 * Traffic route graph. Routes are closed polylines built from road legs with
 * the correct **left-hand** lane offset for Bangladesh, with rounded corners.
 */

import * as THREE from 'three';
import { clamp } from '../core/mathx';

export interface Leg {
  axis: 'x' | 'z';
  /** +1 travels toward +axis, -1 toward -axis. */
  dir: 1 | -1;
  /** Centre line of the road on the perpendicular axis. */
  center: number;
  width: number;
  from: number;
  to: number;
}

export interface Route {
  id: string;
  points: THREE.Vector3[];
  /** Cumulative arc length at each point (last entry = total length). */
  arc: number[];
  length: number;
  speedFactor: number;
}

function laneValue(leg: Leg): number {
  const offset = clamp(leg.width * 0.24, 1.0, 2.25);
  if (leg.axis === 'x') {
    // travelling along X: left of +X is -Z, left of -X is +Z
    return leg.center - leg.dir * offset;
  }
  // travelling along Z: left of +Z is +X, left of -Z is -X
  return leg.center + leg.dir * offset;
}

function pointAt(leg: Leg, t: number): THREE.Vector3 {
  const along = leg.from + (leg.to - leg.from) * t;
  const lateral = laneValue(leg);
  return leg.axis === 'x' ? new THREE.Vector3(along, 0, lateral) : new THREE.Vector3(lateral, 0, along);
}

/** Build a closed route from legs, rounding each corner with a quadratic curve. */
export function buildRoute(id: string, legs: Leg[], cornerSteps = 5, speedFactor = 1): Route {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const next = legs[(i + 1) % legs.length];
    const a = pointAt(leg, 0);
    const b = pointAt(leg, 1);
    // corner control point: intersection of the two lane lines
    const corner = new THREE.Vector3(
      leg.axis === 'x' ? laneValue(next) : laneValue(leg),
      0,
      leg.axis === 'x' ? laneValue(leg) : laneValue(next),
    );
    if (i === 0) points.push(a);
    const p0 = b.clone().lerp(corner, 0.35);
    points.push(p0);
    for (let s = 1; s <= cornerSteps; s++) {
      const t = s / (cornerSteps + 1);
      const p = new THREE.Vector3()
        .copy(p0)
        .multiplyScalar((1 - t) * (1 - t))
        .addScaledVector(corner, 2 * (1 - t) * t)
        .addScaledVector(b.clone().lerp(corner, 0.2), t * t);
      points.push(p);
    }
    const c0 = b.clone().lerp(corner, 0.2);
    const n0 = pointAt(next, 0);
    for (let s = 1; s <= cornerSteps; s++) {
      const t = s / (cornerSteps + 1);
      const p = new THREE.Vector3()
        .copy(c0)
        .multiplyScalar((1 - t) * (1 - t))
        .addScaledVector(corner, 2 * (1 - t) * t)
        .addScaledVector(n0, t * t);
      points.push(p);
    }
  }
  // de-duplicate near-identical points
  const cleaned: THREE.Vector3[] = [];
  for (const p of points) {
    const last = cleaned[cleaned.length - 1];
    if (!last || last.distanceTo(p) > 0.35) cleaned.push(p);
  }
  if (cleaned.length > 2 && cleaned[0].distanceTo(cleaned[cleaned.length - 1]) < 0.6) cleaned.pop();

  const arc: number[] = [0];
  for (let i = 1; i < cleaned.length; i++) arc.push(arc[i - 1] + cleaned[i].distanceTo(cleaned[i - 1]));
  const closedLength = arc[arc.length - 1] + cleaned[0].distanceTo(cleaned[cleaned.length - 1]);
  arc.push(closedLength);
  return { id, points: cleaned, arc, length: closedLength, speedFactor };
}

export interface RouteSample {
  x: number;
  z: number;
  yaw: number;
}

/** Sample a route by arc length (wrapping). */
export function sampleRoute(route: Route, distance: number, out: RouteSample): RouteSample {
  const len = route.length;
  let d = distance % len;
  if (d < 0) d += len;
  let lo = 0;
  let hi = route.points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (route.arc[mid] <= d) lo = mid + 1;
    else hi = mid;
  }
  const idx = Math.max(0, lo - 1);
  const p0 = route.points[idx % route.points.length];
  const p1 = route.points[(idx + 1) % route.points.length];
  const segLen = Math.max(0.0001, route.arc[idx + 1] - route.arc[idx]);
  const t = clamp((d - route.arc[idx]) / segLen, 0, 1);
  out.x = p0.x + (p1.x - p0.x) * t;
  out.z = p0.z + (p1.z - p0.z) * t;
  out.yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
  return out;
}

/** Build the three traffic loops used by the neighbourhood. */
export function buildTrafficRoutes(): Route[] {
  const main = { width: 9.2 };
  const northLane = { center: -55, width: 5.2 };
  const southLane = { center: 55, width: 5.2 };
  const eastLane = { center: 52, width: 5.0 };
  const westLane = { center: -52, width: 5.0 };
  const cross = { center: 0, width: 7.4 };

  const outer: Leg[] = [
    { axis: 'z', dir: -1, center: 0, width: main.width, from: 50, to: -50 },
    { axis: 'x', dir: 1, center: northLane.center, width: northLane.width, from: -2.2, to: eastLane.center },
    { axis: 'z', dir: 1, center: eastLane.center, width: eastLane.width, from: -56, to: 56 },
    { axis: 'x', dir: -1, center: southLane.center, width: southLane.width, from: eastLane.center, to: -2.2 },
  ];

  const westLoop: Leg[] = [
    { axis: 'z', dir: -1, center: 0, width: main.width, from: 54, to: -46 },
    { axis: 'x', dir: -1, center: cross.center, width: cross.width, from: -2.2, to: westLane.center },
    { axis: 'z', dir: 1, center: westLane.center, width: westLane.width, from: 1.8, to: 54 },
    { axis: 'x', dir: 1, center: southLane.center, width: southLane.width, from: westLane.center, to: -2.2 },
  ];

  const eastLoop: Leg[] = [
    { axis: 'z', dir: 1, center: 0, width: main.width, from: -46, to: 50 },
    { axis: 'x', dir: 1, center: cross.center, width: cross.width, from: 2.2, to: eastLane.center },
    { axis: 'z', dir: -1, center: eastLane.center, width: eastLane.width, from: 1.8, to: -50 },
    { axis: 'x', dir: -1, center: northLane.center, width: northLane.width, from: eastLane.center, to: 2.2 },
  ];

  return [
    buildRoute('outer', outer, 5, 1),
    buildRoute('west', westLoop, 5, 0.92),
    buildRoute('east', eastLoop, 5, 0.96),
  ];
}
