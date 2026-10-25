/**
 * Static-geometry & shared vehicle-wheel helpers.
 * Keeps draw calls mobile-friendly by merging primitives per material family
 * and caching reusable spoked-wheel geometries with exact outer tyre radii.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface VertexSlice {
  mesh: THREE.Mesh;
  startVertex: number;
  vertexCount: number;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false);
const UNIT_CONE = new THREE.ConeGeometry(0.5, 1, 10);
const UNIT_TORUS = new THREE.TorusGeometry(0.5, 0.08, 8, 24);

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpVec = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

/** Merge bucket: collects transformed primitives and emits one mesh. */
export class Bucket {
  private parts: THREE.BufferGeometry[] = [];
  private partXZ: { x: number; z: number }[] = [];
  private partTags: number[] = [];
  private currentTag = -1;
  private tagSlices = new Map<number, VertexSlice[]>();
  private material: THREE.Material;
  private bakeGroundAO: boolean;
  readonly name: string;

  constructor(name: string, material: THREE.Material, bakeGroundAO = false) {
    this.name = name;
    this.material = material;
    this.bakeGroundAO = bakeGroundAO;
  }

  setTag(tag: number): void {
    this.currentTag = tag;
  }

  get currentTagId(): number {
    return this.currentTag;
  }

  getTagSlices(): Map<number, VertexSlice[]> {
    return this.tagSlices;
  }

  get count(): number {
    return this.parts.length;
  }

  /** Add a primitive with a TRS transform and a tint (vertex colour + optional baked ground/overhang AO). */
  add(
    source: THREE.BufferGeometry,
    pos: THREE.Vector3 | { x: number; y: number; z: number },
    scale: THREE.Vector3 | { x: number; y: number; z: number },
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
    uv?: UvRect,
  ): void {
    const px = pos instanceof THREE.Vector3 ? pos.x : pos.x;
    const py = pos instanceof THREE.Vector3 ? pos.y : pos.y;
    const pz = pos instanceof THREE.Vector3 ? pos.z : pos.z;
    const geo = source.clone();
    tmpEuler.set(rotation?.x ?? 0, rotation?.y ?? 0, rotation?.z ?? 0, 'YXZ');
    tmpQuat.setFromEuler(tmpEuler);
    tmpMatrix.compose(
      tmpVec.set(px, py, pz),
      tmpQuat,
      tmpScale.set(
        scale instanceof THREE.Vector3 ? scale.x : scale.x,
        scale instanceof THREE.Vector3 ? scale.y : scale.y,
        scale instanceof THREE.Vector3 ? scale.z : scale.z,
      ),
    );
    geo.applyMatrix4(tmpMatrix);

    if (uv) {
      const attr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (attr) {
        for (let i = 0; i < attr.count; i++) {
          const u = attr.getX(i);
          const v = attr.getY(i);
          attr.setXY(i, uv.u0 + (uv.u1 - uv.u0) * u, uv.v0 + (uv.v1 - uv.v0) * v);
        }
        attr.needsUpdate = true;
      }
    }

    const c = new THREE.Color(color);
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const vertCount = posAttr.count;
    const colors = new Float32Array(vertCount * 3);
    if (this.bakeGroundAO) {
      for (let v = 0; v < vertCount; v++) {
        const wy = posAttr.getY(v);
        const t = wy <= 0 ? 0 : wy >= 1.35 ? 1 : wy / 1.35;
        let ao = 0.78 + 0.22 * (t * t * (3 - 2 * t));
        if (normAttr) {
          const ny = normAttr.getY(v);
          if (ny < -0.35) ao *= 0.82;
          else if (ny > 0.55) ao = Math.min(1.04, ao * 1.03);
        }
        const i3 = v * 3;
        colors[i3] = Math.min(1, c.r * ao);
        colors[i3 + 1] = Math.min(1, c.g * ao);
        colors[i3 + 2] = Math.min(1, c.b * ao);
      }
    } else {
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = c.r;
        colors[i + 1] = c.g;
        colors[i + 2] = c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!geo.getAttribute('uv')) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertCount * 2), 2));
    }
    this.parts.push(geo);
    this.partXZ.push({ x: px, z: pz });
    this.partTags.push(this.currentTag);
  }

  box(
    pos: { x: number; y: number; z: number },
    size: { x: number; y: number; z: number },
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
  ): void {
    this.add(UNIT_BOX, pos, size, color, rotation);
  }

  boxMinMax(min: THREE.Vector3, max: THREE.Vector3, color: THREE.ColorRepresentation): void {
    this.box(
      { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
      { x: Math.abs(max.x - min.x), y: Math.abs(max.y - min.y), z: Math.abs(max.z - min.z) },
      color,
    );
  }

  cylinder(
    pos: { x: number; y: number; z: number },
    radius: number,
    height: number,
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
  ): void {
    this.add(UNIT_CYL, pos, { x: radius * 2, y: height, z: radius * 2 }, color, rotation);
  }

  cone(
    pos: { x: number; y: number; z: number },
    radius: number,
    height: number,
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
  ): void {
    this.add(UNIT_CONE, pos, { x: radius * 2, y: height, z: radius * 2 }, color, rotation);
  }

  torus(
    pos: { x: number; y: number; z: number },
    radius: number,
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
  ): void {
    const s = radius * 2;
    this.add(UNIT_TORUS, pos, { x: s, y: s, z: s }, color, rotation);
  }

  /** A vertical quad facing +Z by default; rotate to face a direction. */
  quad(
    pos: { x: number; y: number; z: number },
    width: number,
    height: number,
    color: THREE.ColorRepresentation,
    rotation?: { x?: number; y?: number; z?: number },
    uv?: UvRect,
  ): void {
    this.add(UNIT_PLANE, pos, { x: width, y: height, z: 1 }, color, rotation, uv);
  }

  build(
    shadows: { cast: boolean; receive: boolean } = { cast: true, receive: true },
    autoUpdate = false,
  ): THREE.Mesh | null {
    if (this.parts.length === 0) return null;
    const partVertCounts = this.parts.map((g) => (g.getAttribute('position') as THREE.BufferAttribute).count);
    const savedTags = this.partTags.slice();
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    this.partXZ = [];
    this.partTags = [];
    if (!merged) {
      console.warn(`[geo] merge failed for bucket ${this.name}`);
      return null;
    }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, this.material);
    mesh.name = this.name;
    mesh.castShadow = shadows.cast;
    mesh.receiveShadow = shadows.receive;
    mesh.matrixAutoUpdate = autoUpdate;
    if (!autoUpdate) mesh.updateMatrix();
    let runningVert = 0;
    for (let p = 0; p < partVertCounts.length; p++) {
      const tag = savedTags[p];
      const vc = partVertCounts[p];
      if (tag >= 0 && vc > 0) {
        let list = this.tagSlices.get(tag);
        if (!list) {
          list = [];
          this.tagSlices.set(tag, list);
        }
        const prev = list[list.length - 1];
        if (prev && prev.mesh === mesh && prev.startVertex + prev.vertexCount === runningVert) {
          prev.vertexCount += vc;
        } else {
          list.push({ mesh, startVertex: runningVert, vertexCount: vc });
        }
      }
      runningVert += vc;
    }
    return mesh;
  }

  /**
   * Partition primitives spatially into `cols x cols` merged static sector meshes
   * sharing `this.material`, enabling automatic frustum + shadow culling across
   * large urban districts without altering a single vertex or pixel.
   */
  buildChunked(
    cols = 4,
    halfExtent = 270,
    shadows: { cast: boolean; receive: boolean } = { cast: true, receive: true },
  ): THREE.Mesh[] {
    if (this.parts.length === 0) return [];
    const span = (halfExtent * 2) / cols;
    const cells: THREE.BufferGeometry[][] = Array.from({ length: cols * cols }, () => []);
    const cellTags: number[][] = Array.from({ length: cols * cols }, () => []);
    for (let i = 0; i < this.parts.length; i++) {
      const xz = this.partXZ[i];
      const cx = Math.max(0, Math.min(cols - 1, Math.floor((xz.x + halfExtent) / span)));
      const cz = Math.max(0, Math.min(cols - 1, Math.floor((xz.z + halfExtent) / span)));
      const cellIdx = cz * cols + cx;
      cells[cellIdx].push(this.parts[i]);
      cellTags[cellIdx].push(this.partTags[i]);
    }
    const out: THREE.Mesh[] = [];
    for (let k = 0; k < cells.length; k++) {
      if (cells[k].length === 0) continue;
      const partVertCounts = cells[k].map((g) => (g.getAttribute('position') as THREE.BufferAttribute).count);
      const merged = mergeGeometries(cells[k], false);
      for (const p of cells[k]) p.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, this.material);
      mesh.name = `${this.name}.c${k}`;
      mesh.castShadow = shadows.cast;
      mesh.receiveShadow = shadows.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

      let runningVert = 0;
      for (let p = 0; p < partVertCounts.length; p++) {
        const tag = cellTags[k][p];
        const vc = partVertCounts[p];
        if (tag >= 0 && vc > 0) {
          let list = this.tagSlices.get(tag);
          if (!list) {
            list = [];
            this.tagSlices.set(tag, list);
          }
          const prev = list[list.length - 1];
          if (prev && prev.mesh === mesh && prev.startVertex + prev.vertexCount === runningVert) {
            prev.vertexCount += vc;
          } else {
            list.push({ mesh, startVertex: runningVert, vertexCount: vc });
          }
        }
        runningVert += vc;
      }

      out.push(mesh);
    }
    this.parts = [];
    this.partXZ = [];
    this.partTags = [];
    return out;
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
    this.parts = [];
    this.partXZ = [];
    this.partTags = [];
  }
}

/** Shared PBR material for glossy/metallic tinted merged geometry. */
export function tintedMaterial(
  map: THREE.Texture | null,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map,
    roughness: 0.86,
    metalness: 0.02,
    ...opts,
  });
  if (map) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
  }
  return mat;
}

/**
 * Shared mobile-optimized Lambertian diffuse material for matte architectural
 * plaster, concrete, brick, foliage, cloth, and painted signs.
 * Evaluates full sun/moon shadows, hemisphere sky/ground bounce, ambient, and
 * headlamp/street lights WITHOUT expensive per-pixel GGX specular or PMREM
 * octahedral CubeUV dual-mip fetches on Mali-G72 MP3.
 */
export function matteMaterial(
  map: THREE.Texture | null,
  opts: Partial<THREE.MeshLambertMaterialParameters> = {},
): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    map,
    ...opts,
  });
  if (map) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
  }
  return mat;
}

interface CachedWheelTemplate {
  rubberGeo: THREE.BufferGeometry;
  metalGeo: THREE.BufferGeometry;
}

const wheelCache = new Map<string, CachedWheelTemplate>();
const sharedRubberMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.9,
  metalness: 0.04,
});
const sharedWheelChromeMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.26,
  metalness: 0.84,
});

/**
 * Build a crisp spoked cycle/rickshaw wheel whose OUTER rubber contact radius
 * is EXACTLY `outerRadius` (so placing the hub at `y = outerRadius` touches
 * `y = 0.000m` with zero sinking and zero floating).
 * Cached across all rickshaws; marked `userData.shared = true` so vehicle
 * disposal does not destroy shared wheel buffers.
 */
export function createWheel(
  outerRadius: number,
  tireColor = '#1a1c1f',
  rimColor = '#d8dee4',
  spokes = 18,
): THREE.Group {
  const key = `${outerRadius.toFixed(3)}:${tireColor}:${rimColor}:${spokes}`;
  let tpl = wheelCache.get(key);
  if (!tpl) {
    const tube = Math.max(0.026, outerRadius * 0.088);
    const torusCenterR = outerRadius - tube;

    const rubberBucket = new Bucket('wheel.rubber', sharedRubberMat);
    const tireSrc = new THREE.TorusGeometry(torusCenterR, tube, 8, 28);
    rubberBucket.add(tireSrc, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, tireColor, { y: Math.PI / 2 });
    // Subtle cream sidewall ring typical of Dhaka heavy-duty rickshaw tyres
    const wallSrc = new THREE.TorusGeometry(torusCenterR - tube * 0.15, tube * 0.34, 6, 24);
    rubberBucket.add(wallSrc, { x: 0.014, y: 0, z: 0 }, { x: 0.35, y: 1, z: 1 }, '#cfc7b2', { y: Math.PI / 2 });
    rubberBucket.add(wallSrc, { x: -0.014, y: 0, z: 0 }, { x: 0.35, y: 1, z: 1 }, '#cfc7b2', { y: Math.PI / 2 });
    tireSrc.dispose();
    wallSrc.dispose();

    const metalBucket = new Bucket('wheel.metal', sharedWheelChromeMat);
    const rimR = torusCenterR - tube * 0.62;
    const rimSrc = new THREE.TorusGeometry(rimR, Math.max(0.012, outerRadius * 0.03), 6, 26);
    metalBucket.add(rimSrc, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, rimColor, { y: Math.PI / 2 });
    rimSrc.dispose();

    // Central barrel hub + flanges + axle nuts
    metalBucket.cylinder({ x: 0, y: 0, z: 0 }, outerRadius * 0.085, 0.085, '#b6bec6', { z: Math.PI / 2 });
    metalBucket.cylinder({ x: 0.032, y: 0, z: 0 }, outerRadius * 0.13, 0.01, '#dce3ea', { z: Math.PI / 2 });
    metalBucket.cylinder({ x: -0.032, y: 0, z: 0 }, outerRadius * 0.13, 0.01, '#dce3ea', { z: Math.PI / 2 });
    metalBucket.cylinder({ x: 0, y: 0, z: 0 }, outerRadius * 0.04, 0.125, '#8c949e', { z: Math.PI / 2 });

    // Criss-crossed steel wire spokes alternating left/right hub flange
    const spokeLen = rimR * 0.96;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const flangeX = i % 2 === 0 ? 0.016 : -0.016;
      const cy = Math.cos(a) * spokeLen * 0.5;
      const cz = Math.sin(a) * spokeLen * 0.5;
      metalBucket.cylinder(
        { x: flangeX, y: cy, z: cz },
        0.0038,
        spokeLen,
        '#d4dbe2',
        { x: a, z: (i % 2 === 0 ? -1 : 1) * 0.03 },
      );
    }
    // Brass valve stem inside rim
    metalBucket.cylinder({ x: 0, y: -(rimR - 0.022), z: 0 }, 0.005, 0.036, '#d9b24c');

    const rMesh = rubberBucket.build({ cast: true, receive: false });
    const mMesh = metalBucket.build({ cast: false, receive: false });
    tpl = {
      rubberGeo: rMesh!.geometry,
      metalGeo: mMesh!.geometry,
    };
    tpl.rubberGeo.userData.shared = true;
    tpl.metalGeo.userData.shared = true;
    sharedRubberMat.userData.shared = true;
    sharedWheelChromeMat.userData.shared = true;
    wheelCache.set(key, tpl);
  }

  const group = new THREE.Group();
  const tireMesh = new THREE.Mesh(tpl.rubberGeo, sharedRubberMat);
  tireMesh.castShadow = true;
  tireMesh.userData.shared = true;
  const chromeMesh = new THREE.Mesh(tpl.metalGeo, sharedWheelChromeMat);
  chromeMesh.userData.shared = true;
  group.add(tireMesh, chromeMesh);
  return group;
}
