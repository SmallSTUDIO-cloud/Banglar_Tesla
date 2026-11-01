/**
 * Batch the articulated race opponents by compatible material without changing
 * their geometry, liveries or pose. Each source mesh supplies one rigid skin
 * bone, so wheels, steering and individual arm segments keep their independent
 * transforms while compatible parts share a draw call. The original rig stays
 * alive as the animation/inspection source; only its mesh rendering is muted.
 *
 * This is deliberately local to active race opponents. Player and traffic
 * rendering, collision, navigation and visual quality are unchanged.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface MaterialFields extends THREE.Material {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  map?: THREE.Texture | null;
  roughness?: number;
  metalness?: number;
  alphaTest: number;
}

interface Source {
  mesh: THREE.Mesh;
  bone: THREE.Bone;
  wasVisible: boolean;
}
interface Batch {
  mesh: THREE.SkinnedMesh;
  sources: Source[];
}

/** Only combine render-equivalent materials and matching shadow behavior. */
function materialKey(mesh: THREE.Mesh, m: MaterialFields): string {
  return JSON.stringify([
    m.type, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity,
    m.vertexColors, m.side, m.transparent, m.opacity, m.depthWrite, m.depthTest,
    m.alphaTest, m.roughness, m.metalness, m.map?.uuid ?? null,
    mesh.castShadow, mesh.receiveShadow,
  ]);
}

/** Convert to a common, non-indexed attribute layout and rigidly bind each
 * vertex to the source mesh's bone. Never mutates or disposes the source. */
function rigidPart(mesh: THREE.Mesh, boneIndex: number): THREE.BufferGeometry {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  const pos = src.getAttribute('position');
  const normal = src.getAttribute('normal');
  const uv = src.getAttribute('uv');
  const color = src.getAttribute('color');
  const count = pos.count;
  const out = new THREE.BufferGeometry();
  // Clone attributes, not geometry-owned references: source rigs can be
  // disposed independently and all temporary geometries are released below.
  out.setAttribute('position', pos.clone());
  out.setAttribute('normal', normal ? normal.clone() : new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  out.setAttribute('uv', uv ? uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  out.setAttribute('color', color ? color.clone() : new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    indices[i * 4] = boneIndex;
    weights[i * 4] = 1;
  }
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  src.dispose();
  return out;
}

export class RivalVisualBatch {
  private batches: Batch[] = [];

  constructor(parent: THREE.Group, roots: readonly THREE.Object3D[]) {
    const buckets = new Map<string, { material: THREE.Material; meshes: THREE.Mesh[] }>();
    for (const root of roots) {
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) || !obj.visible || Array.isArray(obj.material) || !obj.geometry.getAttribute('position')) return;
        // Transparent ordering and custom shaders can depend on individual mesh
        // depth/callbacks. Leave such unusual pieces unbatched and unmodified.
        if (obj.material.transparent || obj.material.type === 'ShaderMaterial' || obj.material.type === 'RawShaderMaterial') return;
        const key = materialKey(obj, obj.material as MaterialFields);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { material: obj.material, meshes: [] };
          buckets.set(key, bucket);
        }
        bucket.meshes.push(obj);
      });
    }
    for (const { material, meshes } of buckets.values()) {
      // A singleton gains no draw-call reduction and can remain untouched.
      if (meshes.length < 2) continue;
      const sources: Source[] = [];
      const parts: THREE.BufferGeometry[] = [];
      for (const mesh of meshes) {
        const bone = new THREE.Bone();
        bone.name = 'rival-batch-transform';
        mesh.add(bone);
        sources.push({ mesh, bone, wasVisible: mesh.visible });
        parts.push(rigidPart(mesh, sources.length - 1));
      }
      const merged = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!merged) {
        for (const source of sources) source.mesh.remove(source.bone);
        continue;
      }
      const skeleton = new THREE.Skeleton(sources.map((s) => s.bone), sources.map(() => new THREE.Matrix4()));
      const batch = new THREE.SkinnedMesh(merged, material);
      batch.name = 'rival-material-batch';
      // The attached inverse cancels the batch parent's world transform; the
      // bones already carry the source meshes' world transforms.
      batch.bind(skeleton, new THREE.Matrix4());
      batch.frustumCulled = false; // the source bones can move independently
      batch.castShadow = meshes[0].castShadow;
      batch.receiveShadow = meshes[0].receiveShadow;
      parent.add(batch);
      for (const source of sources) source.mesh.visible = false;
      this.batches.push({ mesh: batch, sources });
    }
  }

  dispose(): void {
    for (const { mesh, sources } of this.batches) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.skeleton.dispose();
      for (const source of sources) {
        source.mesh.visible = source.wasVisible;
        source.mesh.remove(source.bone);
      }
    }
    this.batches = [];
  }
}
