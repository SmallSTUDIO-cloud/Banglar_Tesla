/**
 * A compact, road-connected interpretation of DRMC. The primary portal and
 * low white blocks use the viewed Commons photos as visual references. The
 * second entrance and the internal layout are provisional (see drmcGeo.ts).
 * Static primitives are merged by material; gate openings remain driveable.
 */
import * as THREE from 'three';
import type { Collider } from './city';
import { Bucket } from './geo';
import {
  DRMC_GATE, DRMC_GATE_ROAD_POINT, DRMC_SIDE_GATE, DRMC_SIDE_GATE_ROAD_POINT,
  DRMC_MAIN_BLOCK, DRMC_SECOND_BLOCK, DRMC_SPORTS_GROUND,
  drmcBoundaryPolygon, type GamePoint,
} from './drmcGeo';
import { makeTexture } from './textures';

export interface DrmcCampusResult {
  group: THREE.Group;
  colliders: Collider[];
  gate: GamePoint;
  campusPolygon: GamePoint[];
}

function obbCollider(x: number, z: number, halfX: number, halfZ: number, yaw: number, height: number, kind: 'wall' | 'building'): Collider {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ex = c * halfX + s * halfZ;
  const ez = s * halfX + c * halfZ;
  return {
    minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez,
    cx: x, cz: z, halfX, halfZ, yaw, height, cameraBlocking: true, kind,
  };
}

/** A wall/line runs in local +Z. */
function linePose(a: GamePoint, b: GamePoint): { x: number; z: number; length: number; yaw: number } {
  return {
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    length: Math.hypot(b.x - a.x, b.z - a.z),
    yaw: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

export function buildDrmcCampus(heightAt: (x: number, z: number) => number): DrmcCampusResult {
  const group = new THREE.Group();
  group.name = 'drmc-campus';
  const colliders: Collider[] = [];
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const walls = new Bucket('drmc.masonry', material, true);
  const details = new Bucket('drmc.details', material, false);
  const grounds = new Bucket('drmc.grounds', material, false);

  // A continuous green site beneath the paths and sports areas, not an empty
  // asphalt void. The road mesh and sidewalks stay outside this polygon.
  const boundary = drmcBoundaryPolygon();
  const outline = new THREE.Shape();
  outline.moveTo(boundary[0].x, -boundary[0].z);
  for (const p of boundary.slice(1)) outline.lineTo(p.x, -p.z);
  outline.closePath();
  const siteGeometry = new THREE.ShapeGeometry(outline);
  siteGeometry.rotateX(-Math.PI / 2);
  const site = new THREE.Mesh(siteGeometry, new THREE.MeshLambertMaterial({ color: '#a3b881' }));
  site.name = 'drmc.site';
  site.position.y = 0.008;
  site.receiveShadow = true;
  group.add(site);

  const openings = [
    { gate: DRMC_GATE, half: 7.15 },
    { gate: DRMC_SIDE_GATE, half: 5.3 },
  ];
  const drawWall = (a: GamePoint, b: GamePoint): void => {
    const pose = linePose(a, b);
    if (pose.length < 0.25) return;
    const y = heightAt(pose.x, pose.z);
    walls.box({ x: pose.x, y: y + 0.9, z: pose.z }, { x: 0.34, y: 1.8, z: pose.length }, '#eae8dd', { y: pose.yaw });
    details.box({ x: pose.x, y: y + 1.84, z: pose.z }, { x: 0.42, y: 0.12, z: pose.length }, '#d2d0c5', { y: pose.yaw });
    colliders.push(obbCollider(pose.x, pose.z, 0.17, pose.length / 2, pose.yaw, 1.8, 'wall'));
  };
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    let start = 0;
    const cuts = openings.map(({ gate, half }) => {
      const t = ((gate.x - a.x) * dx + (gate.z - a.z) * dz) / (len * len);
      const distance = Math.hypot(gate.x - (a.x + t * dx), gate.z - (a.z + t * dz));
      return { t, half, distance };
    }).filter((cut) => cut.t > 0 && cut.t < 1 && cut.distance < 0.25).sort((p, q) => p.t - q.t);
    for (const cut of cuts) {
      const end = Math.max(start, cut.t - cut.half / len);
      drawWall({ x: a.x + dx * start, z: a.z + dz * start }, { x: a.x + dx * end, z: a.z + dz * end });
      start = Math.min(1, cut.t + cut.half / len);
    }
    drawWall({ x: a.x + dx * start, z: a.z + dz * start }, b);
  }

  const path = (a: GamePoint, b: GamePoint, width: number, colour = '#b9b5a2', thickness = 0.035, top = 0.06): void => {
    const pose = linePose(a, b);
    grounds.box({ x: pose.x, y: top - thickness / 2, z: pose.z }, { x: width, y: thickness, z: pose.length + 0.25 }, colour, { y: pose.yaw });
  };

  /** Build a portal with local +Z pointing out to its public road. */
  const portal = (gate: GamePoint, road: GamePoint, primary: boolean): void => {
    const yaw = Math.atan2(road.x - gate.x, road.z - gate.z);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const at = (x: number, z: number): GamePoint => ({ x: gate.x + c * x + s * z, z: gate.z - s * x + c * z });
    const groundY = heightAt(gate.x, gate.z);
    const xCol = primary ? 5.9 : 4.2;
    const colWidth = primary ? 2 : 1.5;
    const topY = primary ? 7.25 : 5.25;
    const beamHeight = primary ? 1.55 : 0.8;
    // The photographed front entrance has a broad, deep white portico, red
    // inner piers and small grilled pedestrian openings in its side supports.
    // The second entrance remains a related but provisional interpretation.
    for (const side of [-1, 1]) {
      const col = at(side * xCol, 0);
      if (primary) {
        for (const edge of [-1, 1]) {
          const post = at(side * xCol + edge * (colWidth / 2 - 0.27), 0);
          walls.box({ x: post.x, y: groundY + topY / 2, z: post.z }, { x: 0.54, y: topY, z: 2.2 }, '#eeeae1', { y: yaw });
        }
        const doorHeight = 2.5;
        walls.box({ x: col.x, y: groundY + (topY + doorHeight) / 2, z: col.z }, { x: colWidth, y: topY - doorHeight, z: 2.2 }, '#eeeae1', { y: yaw });
        for (let j = -2; j <= 2; j++) {
          const bar = at(side * xCol + j * 0.17, 1.11);
          details.box({ x: bar.x, y: groundY + 1.18, z: bar.z }, { x: 0.045, y: 2.30, z: 0.05 }, '#273333', { y: yaw });
        }
      } else {
        walls.box({ x: col.x, y: groundY + topY / 2, z: col.z }, { x: colWidth, y: topY, z: 1.75 }, '#eeeae1', { y: yaw });
      }
      // The small pedestrian openings are grilled and closed; the vehicle
      // opening between the supports remains unobstructed.
      colliders.push(obbCollider(col.x, col.z, colWidth / 2, primary ? 1.1 : 0.875, yaw, topY, 'wall'));
      const brick = at(side * (xCol - colWidth * 0.45), primary ? 1.11 : 0.91);
      details.box({ x: brick.x, y: groundY + (primary ? 2.1 : 2.65), z: brick.z }, { x: primary ? 0.85 : 0.55, y: primary ? 4.2 : 5.3, z: 0.12 }, '#995b4c', { y: yaw });
      // Folded-open metal leaves along the driveway, not across the opening.
      for (let j = 0; j < 7; j++) {
        const bar = at(side * (xCol - colWidth * 0.55), 0.65 + j * 0.43);
        details.box({ x: bar.x, y: groundY + 1.12, z: bar.z }, { x: 0.07, y: 2.1, z: 0.07 }, '#273333', { y: yaw });
      }
      for (const y of [0.35, 1.9]) {
        const rail = at(side * (xCol - colWidth * 0.55), 1.95);
        details.box({ x: rail.x, y: groundY + y, z: rail.z }, { x: 0.08, y: 0.09, z: 3.0 }, '#273333', { y: yaw });
      }
    }
    const beamDepth = primary ? 2.8 : 1.75;
    walls.box({ x: gate.x, y: groundY + topY - beamHeight / 2, z: gate.z }, { x: xCol * 2 + colWidth, y: beamHeight, z: beamDepth }, '#f0eee8', { y: yaw });
    details.box({ x: gate.x, y: groundY + topY + 0.1, z: gate.z }, { x: xCol * 2 + colWidth + 0.3, y: 0.2, z: beamDepth + 0.2 }, '#d3d1c8', { y: yaw });

    if (primary) {
      const sign = makeTexture('drmc.portal.lettering.vnext', 1024, 160, (ctx, w, h) => {
        ctx.fillStyle = '#eeece5';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#263331';
        ctx.textAlign = 'center';
        ctx.font = 'bold 48px "Hind Siliguri", sans-serif';
        ctx.fillText('ঢাকা রেসিডেনসিয়াল মডেল কলেজ', w / 2, 62);
        ctx.font = 'bold 31px sans-serif';
        ctx.fillText('DHAKA RESIDENTIAL MODEL COLLEGE', w / 2, 119);
      });
      const label = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 1.18), new THREE.MeshLambertMaterial({ map: sign }));
      const front = at(0, beamDepth / 2 + 0.01);
      label.position.set(front.x, groundY + topY - beamHeight / 2, front.z);
      label.rotation.y = yaw;
      label.name = 'drmc.gate.sign';
      group.add(label);
    }
    // The apron overlays the existing sidewalk to meet the carriageway, and
    // continues a little into campus. There are no raised blocking curbs here.
    path(road, at(0, -7), primary ? 8.2 : 6.2, '#b4b2a9', 0.055, 0.105);
  };
  portal(DRMC_GATE, DRMC_GATE_ROAD_POINT, true);
  portal(DRMC_SIDE_GATE, DRMC_SIDE_GATE_ROAD_POINT, false);

  // Connected internal circulation. These are walk/drive surfaces, not traffic
  // lanes: ambient agents never route through this private site.
  path({ x: 41, z: -66 }, { x: 57, z: -88 }, 5.2);
  path({ x: 57, z: -88 }, { x: 43, z: -126 }, 4.0);
  path({ x: 43, z: -126 }, { x: 43, z: -151 }, 3.2);
  path({ x: 57, z: -88 }, { x: 90, z: -75 }, 3.0);
  path({ x: 95, z: -114 }, { x: 92, z: -91 }, 3.0);

  /** White low-rise academic façades with red plinth and a shaded colonnade. */
  const block = (centre: GamePoint, width: number, length: number, height: number, yaw: number, columnCount: number): void => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const at = (x: number, z: number): GamePoint => ({ x: centre.x + c * x + s * z, z: centre.z - s * x + c * z });
    const y = heightAt(centre.x, centre.z);
    walls.box({ x: centre.x, y: y + height / 2 + 0.5, z: centre.z }, { x: width, y: height, z: length }, '#edece4', { y: yaw });
    details.box({ x: centre.x, y: y + 0.3, z: centre.z }, { x: width + 0.25, y: 0.6, z: length + 0.25 }, '#a76455', { y: yaw });
    walls.box({ x: centre.x, y: y + height + 0.62, z: centre.z }, { x: width + 0.55, y: 0.24, z: length + 0.55 }, '#d9d8cf', { y: yaw });
    for (const side of [-1, 1]) {
      for (let i = 0; i < columnCount; i++) {
        const along = -length * 0.42 + (length * 0.84 * i) / Math.max(1, columnCount - 1);
        const p = at(side * (width / 2 + 0.015), along);
        for (let floor = 0; floor < (height > 6 ? 2 : 1); floor++) {
          details.box({ x: p.x, y: y + 2.2 + floor * 3, z: p.z }, { x: 0.07, y: 1.6, z: 0.95 }, '#34494e', { y: yaw });
        }
      }
    }
    const porch = at(-width / 2 - 0.75, 0);
    walls.box({ x: porch.x, y: y + 3.1, z: porch.z }, { x: 1.8, y: 0.22, z: length * 0.72 }, '#efede4', { y: yaw });
    for (let i = 0; i < 5; i++) {
      const p = at(-width / 2 - 1.45, -length * 0.34 + i * length * 0.17);
      walls.box({ x: p.x, y: y + 1.55, z: p.z }, { x: 0.2, y: 3.1, z: 0.2 }, '#e1dfd4', { y: yaw });
    }
    colliders.push(obbCollider(centre.x, centre.z, width / 2, length / 2, yaw, height + 0.7, 'building'));
  };
  block(DRMC_MAIN_BLOCK, 9, 30, 7.2, -0.28, 10);
  block(DRMC_SECOND_BLOCK, 8, 23, 6.0, -0.28, 8);
  block({ x: 99, z: -68 }, 7.5, 13, 5.8, -0.22, 5);

  // Football green and court with readable, flush markings. Their positions and
  // exact dimensions are intentionally approximate, not surveyed claims.
  const field = DRMC_SPORTS_GROUND;
  grounds.box({ x: field.x, y: 0.025, z: field.z }, { x: 33, y: 0.035, z: 34 }, '#669d57');
  const stripe = (x: number, z: number, w: number, d: number, colour = '#e2e5c9'): void => {
    grounds.box({ x, y: 0.047, z }, { x: w, y: 0.006, z: d }, colour);
  };
  for (const x of [field.x - 15, field.x + 15]) stripe(x, field.z, 0.10, 31);
  for (const z of [field.z - 15.5, field.z, field.z + 15.5]) stripe(field.x, z, 30, 0.10);
  grounds.cylinder({ x: field.x, y: 0.048, z: field.z }, 0.26, 0.01, '#e2e5c9');
  for (const side of [-1, 1]) {
    const z = field.z + side * 15.5;
    for (const x of [field.x - 3, field.x + 3]) details.box({ x, y: 1.05, z }, { x: 0.1, y: 2.1, z: 0.1 }, '#eeeede');
    details.box({ x: field.x, y: 2.1, z }, { x: 6.1, y: 0.1, z: 0.1 }, '#eeeede');
  }
  grounds.box({ x: 73, y: 0.027, z: -67 }, { x: 20, y: 0.04, z: 13 }, '#a77e6b');
  for (const x of [64, 82]) stripe(x, -67, 0.09, 11, '#eee1c7');
  for (const z of [-72.5, -61.5]) stripe(73, z, 18, 0.09, '#eee1c7');
  stripe(73, -67, 0.09, 11, '#eee1c7');

  // Mature campus greenery follows the perimeter, leaving both gates, paths,
  // classrooms and fields unobstructed.
  for (const [x, z] of [[13,-117], [21,-145], [30,-157], [65,-164], [75,-152], [88,-139], [104,-97], [106,-82], [111,-58], [90,-53], [55,-47], [31,-74]]) {
    const y = heightAt(x, z);
    details.cylinder({ x, y: y + 2.0, z }, 0.3, 4, '#71523b');
    details.cone({ x, y: y + 5.0, z }, 2.5, 3.1, '#467c45');
    details.cone({ x: x + 0.5, y: y + 4.4, z: z - 0.4 }, 2.0, 2.3, '#386b3b');
  }

  for (const bucket of [walls, details, grounds]) {
    const mesh = bucket.build({ cast: bucket === walls, receive: true });
    if (mesh) group.add(mesh);
  }
  return { group, colliders, gate: { ...DRMC_GATE }, campusPolygon: boundary.map((p) => ({ ...p })) };
}
