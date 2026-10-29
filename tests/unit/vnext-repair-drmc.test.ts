import { describe, expect, it } from 'vitest';
import { getLaneGraph } from '../../src/ai/routes';
import { PED_PATHS } from '../../src/ai/pedestrians';
import { EventDirector, type EventContext } from '../../src/events/eventDirector';
import { buildDrmcCampus } from '../../src/world/drmc';
import { crossesDrmcCampus, DRMC_GATE, DRMC_GATE_ROAD_POINT, DRMC_SIDE_GATE, DRMC_SIDE_GATE_ROAD_POINT, isInsideDrmcCampus } from '../../src/world/drmcGeo';
import { findRoute, placeById, ROAD_SEGMENTS } from '../../src/world/layout';
import type { Collider } from '../../src/world/city';

function blocksPoint(c: Collider, x: number, z: number, radius = 0): boolean {
  if (c.cx === undefined || c.cz === undefined || c.yaw === undefined || c.halfX === undefined || c.halfZ === undefined) return false;
  const dx = x - c.cx, dz = z - c.cz;
  const lx = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw);
  const lz = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw);
  return Math.abs(lx) < c.halfX + radius && Math.abs(lz) < c.halfZ + radius;
}

describe('DRMC road integration and ambient exclusion', () => {
  it('leaves every existing road centerline outside the private boundary', () => {
    expect(ROAD_SEGMENTS.filter((s) => crossesDrmcCampus(s.ax, s.az, s.bx, s.bz))).toEqual([]);
  });
  it('preserves road-width clearance and vehicle-sized collision paths along both edges', () => {
    const campus = buildDrmcCampus(() => 0);
    for (const road of ROAD_SEGMENTS) {
      expect(crossesDrmcCampus(road.ax, road.az, road.bx, road.bz, road.halfWidth), road.id).toBe(false);
      for (let n = 0; n <= Math.ceil(road.length); n++) {
        const t = Math.min(1, n / road.length);
        for (const side of [-1, 0, 1]) {
          const offset = side * Math.max(0, road.halfWidth - 1.2);
          const x = road.ax + (road.bx - road.ax) * t - road.uz * offset;
          const z = road.az + (road.bz - road.az) * t + road.ux * offset;
          expect(campus.colliders.some((c) => blocksPoint(c, x, z, 1)), `${road.id} ${n} ${side}`).toBe(false);
        }
      }
    }
  });
  it('keeps the complete public sidewalk envelope outside the perimeter and gate colliders', () => {
    const campus = buildDrmcCampus(() => 0);
    for (const road of ROAD_SEGMENTS) {
      for (let n = 0; n <= Math.ceil(road.length); n++) {
        const along = Math.min(n, road.length);
        for (const side of [-1, 1]) for (const width of [0, 0.5, 1]) {
          const offset = side * (road.halfWidth + road.sidewalk * width);
          const x = road.ax + road.ux * along + road.leftX * offset;
          const z = road.az + road.uz * along + road.leftZ * offset;
          expect(isInsideDrmcCampus(x, z, 0.08), `${road.id} ${n} ${side} ${width}`).toBe(false);
          if (width === 0.5) {
            expect(campus.colliders.some((c) => blocksPoint(c, x, z, 0.15)), `${road.id} sidewalk ${n} ${side}`).toBe(false);
          }
        }
      }
    }
  });
  it('keeps every ambient lane and pedestrian path, including avoidance margins, outside', () => {
    const lanes = getLaneGraph().lanes;
    expect(lanes.length).toBeGreaterThan(100);
    expect(lanes.filter((l) => crossesDrmcCampus(l.ax, l.az, l.bx, l.bz, 2.3))).toEqual([]);
    expect(PED_PATHS.length).toBeGreaterThan(80);
    expect(PED_PATHS.filter((p) => crossesDrmcCampus(p.ax, p.az, p.bx, p.bz, 1.6))).toEqual([]);
  });
  it('leaves both gate driveways clear of wall and building colliders and linked to public roads', () => {
    const campus = buildDrmcCampus(() => 0);
    for (const [gate, road, placeId] of [[DRMC_GATE, DRMC_GATE_ROAD_POINT, 'drmc'], [DRMC_SIDE_GATE, DRMC_SIDE_GATE_ROAD_POINT, 'drmc_side']] as const) {
      expect(isInsideDrmcCampus(gate.x, gate.z, 0.2)).toBe(true);
      const place = placeById(placeId)!;
      expect(findRoute(-126, -136, place.x, place.z).segmentIds.length).toBeGreaterThan(0);
      for (let n = -8; n <= 8; n++) {
        const dx = gate.x - road.x, dz = gate.z - road.z, len = Math.hypot(dx, dz);
        const x = gate.x + dx / len * n, z = gate.z + dz / len * n;
        expect(campus.colliders.filter((c) => blocksPoint(c, x, z, 0.6)), `${placeId} at ${n}`).toEqual([]);
      }
    }
  });
  it('does not schedule random events from or into the grounds', () => {
    const ctx: EventContext = { x: 80, z: -105, timeMinutes: 720, heat: 0, trafficDensity: 0.5, raining: false,
      inMission: false, inRace: false, policeActive: false, roadRageActive: false, cinematicActive: false, paused: false, reduceEffects: false };
    const director = new EventDirector();
    expect(director.update(50, ctx, () => 0)).toBeNull();
    const values = [0, 0, 0.5, 0.4];
    expect(director.update(50, { ...ctx, x: 80, z: -10 }, () => values.shift() ?? 0)).toBeNull();
    expect(director.activeCount).toBe(0);
  });
});

import { PolicePursuitSystem } from '../../src/ai/police';
import { RoadblockSystem } from '../../src/ai/roadblocks';

it('keeps patrol SUVs out of the campus through pursuit, separation and player contacts', () => {
  const roadblocks = new RoadblockSystem(() => 0);
  const police = new PolicePursuitSystem(roadblocks, {
    heightAt: () => 0,
    onDispatchRadio: () => {}, onPursuitEscaped: () => {}, onPlayerBusted: () => {}, onHeatEscalated: () => {},
  });
  const dx = DRMC_GATE.x - DRMC_GATE_ROAD_POINT.x, dz = DRMC_GATE.z - DRMC_GATE_ROAD_POINT.z;
  const length = Math.hypot(dx, dz), nx = dx/length, nz = dz/length;
  police.startPursuit(2, DRMC_GATE_ROAD_POINT.x, DRMC_GATE_ROAD_POINT.z, 0);
  // Two real pooled units are staged close together by the gate so their
  // separation pushes one toward the campus; the target is deliberately inside.
  const units = (police as unknown as { units: { active:boolean; x:number; z:number; yaw:number; speed:number }[] }).units.filter((u) => u.active);
  expect(units.length).toBeGreaterThanOrEqual(2);
  for (let i=0; i<units.length; i++) {
    units[i].x = DRMC_GATE.x - nx * (2.31 + i*0.4);
    units[i].z = DRMC_GATE.z - nz * (2.31 + i*0.4);
    units[i].yaw = Math.atan2(nx,nz); units[i].speed = 0;
  }
  const tx = DRMC_GATE.x + nx * 8, tz = DRMC_GATE.z + nz * 8;
  for (let i=0; i<600 && police.isActive; i++) {
    police.update(1/60,tx,tz,0,2,false);
    police.resolvePlayerCollision(DRMC_GATE.x - nx*3.5, DRMC_GATE.z - nz*3.5, Math.atan2(nx,nz), 2);
    for (const u of police.getActiveSnapshots()) expect(isInsideDrmcCampus(u.x,u.z,2.3)).toBe(false);
  }
  police.stopPursuit(true);
  police.dispose(); roadblocks.dispose();
});
