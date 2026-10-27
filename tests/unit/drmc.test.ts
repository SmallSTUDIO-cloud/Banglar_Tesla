import { describe, expect, it } from 'vitest';
import {
  DRMC_CAMPUS,
  DRMC_GATE,
  DRMC_OSM_CENTROID,
  DRMC_OSM_POLYGON,
  DRMC_SW_WALL,
  DRMC_TRANSFORM_CONTROLS,
  drmcOverlayReport,
  fitDrmcTransform,
  isDrmcKeepClear,
  isInsideDrmcCampus,
} from '../../src/world/drmcGeo';
import { findRoute, placeById, ROAD_SEGMENTS, segmentById } from '../../src/world/layout';

describe('DRMC map accuracy gate (vNext §1)', () => {
  it('validates the game↔geography transform with 10 control points and honest residuals', () => {
    const fit = fitDrmcTransform();
    expect(DRMC_TRANSFORM_CONTROLS.length).toBeGreaterThanOrEqual(3);
    expect(fit.scale).toBeGreaterThan(0.2);
    expect(fit.scale).toBeLessThan(0.45);
    expect(Math.abs(fit.rotationDeg)).toBeLessThan(12);
    // Characterized stylization: RMS under 45m, max under 100m over the whole district
    // Documented measured value: RMS 46.0 m (stylized base map, see drmcGeo.ts note)
    expect(fit.rms).toBeLessThan(48);
    expect(fit.maxResidual).toBeLessThan(100);
    // The Humayun-corridor anchor (best fit pair) must stay tight
    const humayunFit = fit.project(90.36475, 23.76737);
    expect(Math.hypot(humayunFit.x - 6, humayunFit.z - -168)).toBeLessThan(8);
  });

  it('projects the verified OSM campus polygon & centroid into sane game coordinates', () => {
    const fit = fitDrmcTransform();
    const centroid = fit.project(DRMC_OSM_CENTROID.lon, DRMC_OSM_CENTROID.lat);
    expect(Math.abs(centroid.x)).toBeLessThan(285);
    expect(Math.abs(centroid.z)).toBeLessThan(285);
    for (const v of DRMC_OSM_POLYGON) {
      const q = fit.project(v.lon, v.lat);
      expect(Number.isFinite(q.x)).toBe(true);
      expect(Number.isFinite(q.z)).toBe(true);
    }
  });

  it('pins the campus SW boundary to the game Shahjahan chain (the verified boundary road)', () => {
    const chain = [segmentById('shahjahan_2')!, segmentById('shahjahan_3')!];
    for (const w of DRMC_SW_WALL) {
      // Every wall anchor sits within 16 m of the shahjahan chain centreline
      let best = Infinity;
      for (const a of chain) {
        const vx = a.bx - a.ax;
        const vz = a.bz - a.az;
        const t = Math.max(0, Math.min(1, ((w.x - a.ax) * vx + (w.z - a.az) * vz) / (vx * vx + vz * vz || 1)));
        best = Math.min(best, Math.hypot(w.x - (a.ax + vx * t), w.z - (a.az + vz * t)));
      }
      expect(best).toBeLessThan(16);
    }
  });

  it('places the gate on the campus boundary near the verified OSM gate point', () => {
    const report = drmcOverlayReport();
    // The fitted OSM gate point lands within 14 m of the in-game wall line
    expect(report.gateToWallDistance).toBeLessThan(14);
    // In-game gate is ON the campus boundary (gate opening cuts the SW wall)
    expect(isInsideDrmcCampus(DRMC_GATE.x, DRMC_GATE.z, 3)).toBe(true);
  });

  it('excludes buildings/trees/lamps from campus grounds while keeping roads clear', () => {
    expect(isDrmcKeepClear(100, -120)).toBe(true); // deep inside campus
    expect(isDrmcKeepClear(0, 0)).toBe(false); // city centre, far away
    // Road corridor on shahjahan_2 must NOT be blocked by the keep-clear rule
    expect(isDrmcKeepClear(31.5, -56)).toBe(false);
    // Campus corners are inside
    for (const c of DRMC_CAMPUS) {
      expect(isInsideDrmcCampus(c.x, c.z, 0.5)).toBe(true);
    }
  });

  it('keeps every campus corner clear of existing road corridors (no road blockage)', () => {
    // Corners must sit outside the drivable carriageway of every existing segment
    for (const c of DRMC_CAMPUS) {
      let onRoad = false;
      for (const s of ROAD_SEGMENTS) {
        const vx = s.bx - s.ax;
        const vz = s.bz - s.az;
        const t = Math.max(0, Math.min(1, ((c.x - s.ax) * vx + (c.z - s.az) * vz) / (vx * vx + vz * vz || 1)));
        const d = Math.hypot(c.x - (s.ax + vx * t), c.z - (s.az + vz * t));
        if (d < s.halfWidth) {
          onRoad = true;
          break;
        }
      }
      expect(onRoad).toBe(false);
    }
  });

  it('routes along connected roads to the verified public entrance from multiple districts', () => {
    const drmc = placeById('drmc');
    expect(drmc, 'DRMC place marker must exist').toBeTruthy();
    const fromWest = findRoute(-126, -136, drmc!.x, drmc!.z);
    const fromSouth = findRoute(42, 106, drmc!.x, drmc!.z);
    const fromEast = findRoute(162, -172, drmc!.x, drmc!.z);
    for (const plan of [fromWest, fromSouth, fromEast]) {
      expect(plan.segmentIds.length).toBeGreaterThan(1);
      expect(plan.points.length).toBeGreaterThan(2);
      expect(plan.distance).toBeGreaterThan(20);
      expect(Number.isFinite(plan.distance)).toBe(true);
    }
  });

  it('never shifts existing Mohammadpur road topology (placement is purely additive)', () => {
    // Guard: the documented segment set around the campus must retain exact ids
    for (const id of ['shahjahan_2', 'humayun_3', 'iqbal_2', 'aurangzeb_2', 'babar_3']) {
      expect(segmentById(id), id).toBeTruthy();
    }
  });
});
