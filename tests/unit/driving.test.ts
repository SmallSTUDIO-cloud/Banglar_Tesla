import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { RickshawController } from '../../src/vehicle/rickshawController';
import { CAMERA_MODES, RIDE, type CameraMode } from '../../src/core/config';
import { buildTrafficRoutes, getLaneGraph, sampleRoute } from '../../src/ai/routes';
import { ChaseCamera, nextCameraMode } from '../../src/vehicle/chaseCamera';
import { generateMission, roadDistance, dailySeed, dateKey } from '../../src/missions/mission';
import { PLACES, ROAD_SEGMENTS, findRoute, isClearOfRoads, placeById } from '../../src/world/layout';
import { mulberry32 } from '../../src/core/mathx';

const noColliders: never[] = [];
const flat = (): number => 0;
const road = (): 'road' => 'road';

function makeController(): RickshawController {
  return new RickshawController(noColliders, flat, road);
}

function drive(
  controller: RickshawController,
  input: { throttle?: number; brake?: number; steer?: number },
  seconds: number,
): void {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    controller.step(
      dt,
      {
        throttle: input.throttle ?? 0,
        brake: input.brake ?? 0,
        steer: input.steer ?? 0,
        handbrake: false,
      },
      1,
      0,
    );
  }
}

describe('rickshaw driving model & Priority-1 steering direction', () => {
  it('accelerates progressively, not instantly', () => {
    const c = makeController();
    c.reset(0, 0, 0);
    drive(c, { throttle: 1 }, 0.1);
    const early = c.speed;
    drive(c, { throttle: 1 }, 1.9);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.5);
    expect(c.speed).toBeGreaterThan(early);
  });

  it('never exceeds the rickshaw speed cap', () => {
    const c = makeController();
    c.reset(0, 0, 0);
    drive(c, { throttle: 1 }, 30);
    expect(c.speed).toBeLessThanOrEqual(RIDE.maxSpeed * 1.01);
    expect(c.speed).toBeGreaterThan(3);
  });

  it('coasts down to a stop when the pedal is released', () => {
    const c = makeController();
    c.reset(0, 0, 0);
    drive(c, { throttle: 1 }, 4);
    const rolling = c.speed;
    drive(c, {}, 14);
    expect(c.speed).toBe(0);
    expect(rolling).toBeGreaterThan(1);
  });

  it('brakes to a stop and only reverses after a deliberate hold', () => {
    const c = makeController();
    c.reset(0, 0, 0);
    drive(c, { throttle: 1 }, 3);
    drive(c, { brake: 1 }, 1.2);
    expect(c.speed).toBeLessThanOrEqual(0.001);
    expect(c.speed).toBeGreaterThanOrEqual(0);
    drive(c, { brake: 1 }, RIDE.reverseHold + 0.8);
    expect(c.speed).toBeLessThan(0);
    expect(c.speed).toBeGreaterThanOrEqual(-RIDE.maxReverse - 0.01);
  });

  it('turns truly RIGHT on steer=+1 and truly LEFT on steer=-1 across all 4 cardinal headings (Three.js right-handed space)', () => {
    // In Three.js (+Y up), forward = (sin(yaw), 0, cos(yaw)),
    // vehicle RIGHT = forward x up = (-cos(yaw), 0, sin(yaw)),
    // vehicle LEFT  = up x forward = ( cos(yaw), 0, -sin(yaw)).
    for (const startYaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const rightX = -Math.cos(startYaw);
      const rightZ = Math.sin(startYaw);

      const rightTurn = makeController();
      rightTurn.reset(0, 0, startYaw);
      drive(rightTurn, { throttle: 1, steer: 1 }, 2.0);
      const rightLateral = rightTurn.x * rightX + rightTurn.z * rightZ;

      const leftTurn = makeController();
      leftTurn.reset(0, 0, startYaw);
      drive(leftTurn, { throttle: 1, steer: -1 }, 2.0);
      const leftLateral = leftTurn.x * rightX + leftTurn.z * rightZ;

      expect(rightLateral).toBeGreaterThan(0.6);
      expect(leftLateral).toBeLessThan(-0.6);
      expect(rightTurn.steerAngle).toBeGreaterThan(0);
      expect(leftTurn.steerAngle).toBeLessThan(0);
    }
  });

  it('turns handlebar while stationary without translating, and reverses cleanly with front wheel steered', () => {
    const stat = makeController();
    stat.reset(5, -3, 0);
    drive(stat, { throttle: 0, steer: 1 }, 0.6);
    expect(stat.steerAngle).toBeGreaterThan(0.2);
    expect(Math.hypot(stat.x - 5, stat.z + 3)).toBeLessThan(1e-4);

    // Reverse with front wheel steered right: rear swings toward driver's right (-X at yaw=0)
    const rev = makeController();
    rev.reset(0, 0, 0);
    drive(rev, { brake: 1, steer: 1 }, RIDE.reverseHold + 1.8);
    expect(rev.speed).toBeLessThan(-0.2);
    expect(rev.z).toBeLessThan(-0.3);
    expect(rev.x).toBeLessThan(-0.05);
  });

  it('keeps front and rear wheels grounded on flat road, uphill slope, and speed humps (YXZ Euler)', () => {
    // Uphill ramp along +Z: height increases with +Z.
    const slope = (_x: number, z: number): number => Math.max(0, z * 0.08);
    const c = new RickshawController(noColliders, slope, road);
    c.reset(0, 5, 0);
    drive(c, { throttle: 1, steer: 0 }, 1.2);

    // Root uses YXZ order; negative pitch lifts local +Z nose UP!
    const root = new THREE.Object3D();
    root.rotation.order = 'YXZ';
    root.position.set(c.x, c.y, c.z);
    root.rotation.set(c.pitch, c.yaw, c.roll);
    root.updateMatrixWorld(true);

    const frontBottomWorld = new THREE.Vector3(0, 0, RIDE.frontAxleZ).applyMatrix4(root.matrixWorld);
    const rearBottomWorld = new THREE.Vector3(0, 0, RIDE.rearAxleZ).applyMatrix4(root.matrixWorld);

    expect(c.pitch).toBeLessThan(-0.04);
    expect(Math.abs(frontBottomWorld.y - slope(frontBottomWorld.x, frontBottomWorld.z))).toBeLessThan(0.035);
    expect(Math.abs(rearBottomWorld.y - slope(rearBottomWorld.x, rearBottomWorld.z))).toBeLessThan(0.035);
  });

  it('has a tighter turning circle at low speed than at high speed', () => {
    const slow = makeController();
    slow.reset(0, 0, 0);
    drive(slow, { throttle: 0.32, steer: 1 }, 2.0);
    const slowRadius = Math.abs(slow.speed / ((slow.speed / RIDE.wheelbase) * Math.tan(slow.steerAngle)));

    const fast = makeController();
    fast.reset(0, 0, 0);
    drive(fast, { throttle: 1 }, 8);
    drive(fast, { throttle: 1, steer: 1 }, 2.0);
    const fastRadius = Math.abs(fast.speed / ((fast.speed / RIDE.wheelbase) * Math.tan(fast.steerAngle)));

    expect(Math.abs(slow.steerAngle)).toBeGreaterThan(Math.abs(fast.steerAngle));
    expect(slowRadius).toBeLessThan(fastRadius);
    expect(fastRadius).toBeGreaterThan(8);
  });

  it('drains and regenerates battery in electric rickshaw mode while never stranding the player', () => {
    const c = makeController();
    c.setTuning({
      maxSpeed: 8.8,
      accel: 3.6,
      brakeDecel: 4.9,
      steerMaxLow: RIDE.maxSteerLow,
      steerMaxHigh: RIDE.maxSteerHigh,
      grip: 0.72,
      isElectric: true,
      batteryDrainMultiplier: 1.0,
      regenFactor: 0.25,
    });
    c.reset(0, 0, 0);
    drive(c, { throttle: 1 }, 12);
    const drained = c.battery;
    expect(drained).toBeLessThan(100);
    drive(c, { brake: 1 }, 1.0);
    expect(c.battery).toBeGreaterThanOrEqual(drained);
  });

  it('records collisions and pushes the rickshaw out of a wall', () => {
    const collider = { minX: -2, maxX: 2, minZ: 4, maxZ: 8, height: 6 };
    const c = new RickshawController([collider], flat, road);
    c.reset(0, 0, 0);
    let impact = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 6; i++) {
      const ev = c.step(dt, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1, 0);
      impact = Math.max(impact, ev.impact);
    }
    expect(impact).toBeGreaterThan(0);
    const inside = c.x > collider.minX && c.x < collider.maxX && c.z > collider.minZ && c.z < collider.maxZ;
    expect(inside).toBe(false);
    expect(c.z).toBeLessThan(collider.minZ + 0.5);
  });

  it('flags being stuck when pedal is held against a wall', () => {
    const collider = { minX: -3, maxX: 3, minZ: 1.2, maxZ: 4, height: 5 };
    const c = new RickshawController([collider], flat, road);
    c.reset(0, 0, 0);
    let stuck = false;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 5; i++) {
      const ev = c.step(dt, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1, 0);
      stuck = stuck || ev.stuck;
    }
    expect(stuck).toBe(true);
  });

  it('follows speed humps without launching', () => {
    const heightAt = (x: number, z: number): number => {
      const d = Math.abs(z - 10);
      if (d > 1.5 || Math.abs(x) > 5) return 0;
      return 0.17 * Math.sin(((1 - d / 1.5) * Math.PI) / 2) ** 1.2;
    };
    const c = new RickshawController(noColliders, heightAt, road);
    c.reset(0, 0, 0);
    let maxY = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 6; i++) {
      c.step(dt, { throttle: 1, brake: 0, steer: 0, handbrake: false }, 1, 0);
      maxY = Math.max(maxY, c.y);
    }
    expect(maxY).toBeGreaterThan(0.02);
    expect(maxY).toBeLessThan(0.3);
  });

  it('is deterministic for identical input sequences', () => {
    const a = makeController();
    const b = makeController();
    a.reset(1, 2, 0.5);
    b.reset(1, 2, 0.5);
    for (let i = 0; i < 300; i++) {
      const input = { throttle: 0.8, brake: 0, steer: Math.sin(i / 20), handbrake: false };
      a.step(1 / 60, input, 1, 0);
      b.step(1 / 60, input, 1, 0);
    }
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
    expect(a.yaw).toBeCloseTo(b.yaw, 6);
  });
});

describe('7-mode NFS Most Wanted camera system', () => {
  it('cycles cleanly through all 7 camera modes and wraps back to chase', () => {
    expect(CAMERA_MODES.length).toBe(7);
    let cur: CameraMode = CAMERA_MODES[0];
    const visited: string[] = [];
    for (let i = 0; i < CAMERA_MODES.length; i++) {
      visited.push(cur);
      cur = nextCameraMode(cur);
    }
    expect(visited).toEqual(['chase', 'close', 'wide', 'low', 'front', 'cockpit', 'side']);
    expect(cur).toBe('chase');
  });

  it('updates smoothly in every camera mode without NaN and never affects controller physics', () => {
    const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.15, 360);
    const rig = new ChaseCamera(cam);
    rig.snapTo(0, 0, 0, 0);
    for (const mode of CAMERA_MODES) {
      rig.setMode(mode);
      for (let i = 0; i < 30; i++) {
        rig.update(1 / 60, 0, i * 0.1, 0.2, 4.2, [], false, 0, []);
      }
      expect(Number.isFinite(cam.position.x)).toBe(true);
      expect(Number.isFinite(cam.position.y)).toBe(true);
      expect(Number.isFinite(cam.position.z)).toBe(true);
      expect(cam.position.y).toBeGreaterThan(0.3);
    }
  });
});

describe('Mohammadpur OSM road network, left-hand lanes & jam detour routing', () => {
  it('builds a connected left-hand lane graph over real Mohammadpur road segments', () => {
    expect(ROAD_SEGMENTS.length).toBeGreaterThanOrEqual(40);
    const graph = getLaneGraph();
    expect(graph.lanes.length).toBe(ROAD_SEGMENTS.length * 2);
    for (const lane of graph.lanes) {
      expect(lane.length).toBeGreaterThan(1);
      expect(lane.nextLaneIds.length).toBeGreaterThan(0);
      // Left-hand traffic rule: lane offset along left normal is positive!
      const seg = ROAD_SEGMENTS.find((s) => s.id === lane.segmentId)!;
      expect(isClearOfRoads(seg.ax, seg.az, 0)).toBe(false);
    }
  });

  it('builds closed route loops and wraps without NaN', () => {
    const routes = buildTrafficRoutes();
    expect(routes.length).toBe(3);
    for (const route of routes) {
      expect(route.length).toBeGreaterThan(50);
      for (const d of [-100, 0, route.length * 0.5, route.length + 10]) {
        const s = sampleRoute(route, d, { x: 0, z: 0, yaw: 0 });
        expect(Number.isFinite(s.x)).toBe(true);
        expect(Number.isFinite(s.z)).toBe(true);
        expect(Number.isFinite(s.yaw)).toBe(true);
      }
    }
  });

  it('reroutes around congested Mohammadpur segments when jammed', () => {
    const stand = placeById('stand')!;
    const iqbal = placeById('iqbal') ?? PLACES[PLACES.length - 1];
    const clearPlan = findRoute(stand.x, stand.z, iqbal.x, iqbal.z);
    expect(clearPlan.segmentIds.length).toBeGreaterThan(1);
    const jammedSeg = clearPlan.segmentIds[Math.floor(clearPlan.segmentIds.length / 2)];
    const detourPlan = findRoute(stand.x, stand.z, iqbal.x, iqbal.z, (segId) =>
      segId === jammedSeg ? 8.0 : 1.0,
    );
    expect(detourPlan.points.length).toBeGreaterThanOrEqual(2);
    expect(detourPlan.avoidedJam).toBe(true);
  });
});

describe('mission generation (passenger & market delivery)', () => {
  it('produces valid passenger and market delivery offers with distinct pickup and drop-off', () => {
    const rng = mulberry32(12345);
    let sawMarket = false;
    let sawPassenger = false;
    for (let i = 0; i < 30; i++) {
      const offer = generateMission({ rng, wet: false });
      expect(offer.pickupId).not.toBe(offer.dropId);
      expect(placeById(offer.pickupId)).toBeTruthy();
      expect(placeById(offer.dropId)).toBeTruthy();
      expect(offer.distance).toBeGreaterThan(0);
      expect(offer.fareEstimate).toBeGreaterThan(0);
      expect(offer.targetTime).toBeGreaterThan(15);
      if (offer.kind === 'market') sawMarket = true;
      if (offer.kind === 'passenger') sawPassenger = true;
    }
    expect(sawMarket).toBe(true);
    expect(sawPassenger).toBe(true);
  });

  it('is deterministic given the same seed', () => {
    const a = generateMission({ rng: mulberry32(999), wet: false, seed: 999 });
    const b = generateMission({ rng: mulberry32(999), wet: false, seed: 999 });
    expect(a.dropId).toBe(b.dropId);
    expect(a.pickupId).toBe(b.pickupId);
    expect(a.fareEstimate).toBe(b.fareEstimate);
  });

  it('daily seeds are stable per calendar day and derived from the date', () => {
    const d1 = new Date(2026, 9, 23);
    const d2 = new Date(2026, 9, 23, 23, 59);
    const d3 = new Date(2026, 9, 24);
    expect(dailySeed(d1)).toBe(dailySeed(d2));
    expect(dailySeed(d1)).not.toBe(dailySeed(d3));
    expect(dateKey(d1)).toBe('2026-10-23');
  });

  it('every place is reachable from every other place by the distance model', () => {
    for (const a of PLACES) {
      for (const b of PLACES) {
        if (a === b) continue;
        expect(roadDistance(a, b)).toBeGreaterThan(0);
      }
    }
  });

  it('daily offers pay a multiplier', () => {
    const normal = generateMission({ rng: mulberry32(7), wet: false });
    const daily = generateMission({ rng: mulberry32(7), wet: false, daily: true });
    expect(daily.multiplier).toBeGreaterThan(normal.multiplier);
    expect(daily.daily).toBe(true);
  });
});
