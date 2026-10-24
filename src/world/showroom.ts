/**
 * Lazy-initialised, memory-lean Dhaka Rickshaw Workshop showroom for Garage &
 * Dokan (`store`).
 *
 * Performance optimizations (Sections 4 & 5):
 *   - Scene geometry & textures are built lazily on first Garage/Dokan open so
 *     street gameplay pays 0 bytes of showroom GPU/CPU overhead.
 *   - Uses compact DataTextures (512x256 backdrop + 256x256 floor, releasing
 *     scratch canvas memory immediately) instead of a 2048x1024 CanvasTexture.
 *   - Merges workshop props (stacked tyres, workbench, paint cans, lamp shades)
 *     into 2 static Bucket meshes and lights with Hemisphere + Directional key/rim
 *     lights (avoiding costly multi-PointLight + shadow-map shader recompilation).
 */

import * as THREE from 'three';
import { damp } from '../core/mathx';
import type { VehicleDef } from '../economy/catalog';
import { RickshawVisual, type RickshawLook } from '../vehicle/rickshawModel';
import { Bucket, createWheel } from './geo';
import { FONT_FAMILY, radialSprite, releaseScratchCanvas } from './textures';

function makeDataTex(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.DataTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  draw(ctx, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  c.width = 1;
  c.height = 1;
  releaseScratchCanvas();
  const tex = new THREE.DataTexture(new Uint8Array(img.data.buffer), w, h, THREE.RGBAFormat);
  tex.flipY = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class Showroom {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 60);
  private turntable = new THREE.Group();
  private wheelsOnWall = new THREE.Group();
  private visual: RickshawVisual | null = null;
  private built = false;
  private yaw = 0.62;
  private dragYaw = 0.62;
  private autoRotate = 0;
  private dragging = false;
  private subjectVec = new THREE.Vector3();
  private desiredCamVec = new THREE.Vector3();

  constructor() {
    this.updateCamera(0, true);
  }

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;

    this.scene.background = new THREE.Color('#1a241f');
    this.scene.fog = new THREE.FogExp2('#1a241f', 0.042);

    const wallTex = makeDataTex(512, 256, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#46584d');
      g.addColorStop(0.5, '#2f3f36');
      g.addColorStop(1, '#1b2621');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 3; i++) {
        const cx = 85 + i * 170;
        const glow = ctx.createRadialGradient(cx, 52, 4, cx, 52, 118);
        glow.addColorStop(0, 'rgba(255,210,135,0.48)');
        glow.addColorStop(1, 'rgba(255,190,100,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - 120, 0, 240, 200);
      }

      ctx.fillStyle = '#123a2c';
      ctx.fillRect(160, 28, 192, 56);
      ctx.strokeStyle = '#e8b25a';
      ctx.lineWidth = 3;
      ctx.strokeRect(165, 33, 182, 46);
      ctx.fillStyle = '#fff3cf';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 24px ${FONT_FAMILY}`;
      ctx.fillText('মোহাম্মদপুর রিকশা দোকান', 256, 50);
      ctx.fillStyle = '#f2c14e';
      ctx.font = `600 12px ${FONT_FAMILY}`;
      ctx.fillText('মেরামত · আপগ্রেড · সাজসজ্জা', 256, 68);
    });

    const floorTex = makeDataTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#383833';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) {
        for (let x = 0; x < w; x += 32) {
          const v = 58 + ((x * 7 + y * 13) % 22);
          ctx.fillStyle = `rgb(${v},${v - 2},${v - 5})`;
          ctx.fillRect(x + 1, y + 1, 30, 30);
        }
      }
    });
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(5, 5);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.78, metalness: 0.08 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 7.5),
      new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.88 }),
    );
    backWall.position.set(0, 3.6, -6.8);
    this.scene.add(backWall);

    // Merged static workshop props + plinth (2 draw calls instead of 24!)
    const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.14 });
    const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.72 });
    const bSolid = new Bucket('showroom.solid', solidMat);
    const bMetal = new Bucket('showroom.metal', metalMat);

    // Turntable concrete/brass ring plinth (top surface flush at y = 0.00 so tyres kiss the turntable!)
    bSolid.cylinder({ x: 0, y: -0.04, z: 0 }, 1.88, 0.08, '#2b3530');
    bMetal.cylinder({ x: 0, y: -0.035, z: 0 }, 1.94, 0.06, '#d9a441');

    // Stacked spare tyres, hardwood workbench & paint tins
    for (let i = 0; i < 4; i++) {
      bSolid.torus({ x: -3.5, y: 0.12 + i * 0.2, z: -2.6 }, 0.38, '#1b1e22', { x: Math.PI / 2 });
    }
    bSolid.box({ x: 3.3, y: 0.45, z: -4.2 }, { x: 3.0, y: 0.9, z: 0.7 }, '#6b4a2a');
    for (let i = 0; i < 6; i++) {
      bMetal.cylinder(
        { x: 2.2 + i * 0.24, y: 1.01, z: -4.1 + (i % 2) * 0.18 },
        0.085,
        0.22,
        i % 2 ? '#c4452b' : '#1f6b4f',
      );
    }
    for (const [lx, lz] of [
      [-2.4, -1.2],
      [2.4, -1.2],
    ]) {
      bMetal.cone({ x: lx, y: 4.85, z: lz }, 0.34, 0.34, '#2f3a34');
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: radialSprite('rgba(255,214,150,0.78)', 'rgba(255,190,90,0)'),
          color: 0xffd6a0,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.65,
        }),
      );
      glow.scale.set(2.1, 2.1, 1);
      glow.position.set(lx, 4.65, lz);
      this.scene.add(glow);
    }

    const mSolid = bSolid.build({ cast: false, receive: false });
    const mMetal = bMetal.build({ cast: false, receive: false });
    if (mSolid) this.scene.add(mSolid);
    if (mMetal) this.scene.add(mMetal);

    for (let i = 0; i < 2; i++) {
      const wheel = createWheel(0.4, '#1a1c1f', '#cfd6de', 14);
      wheel.position.set(2.3 + i * 1.08, 3.05, -6.55);
      this.wheelsOnWall.add(wheel);
    }
    this.scene.add(this.wheelsOnWall);
    this.scene.add(this.turntable);

    // Fast, warm 3-point directional + hemisphere studio lighting (0 shadow maps, 0 point-light shader permutations!)
    this.scene.add(new THREE.HemisphereLight(0xffe9c8, 0x26332b, 1.85));
    const key = new THREE.DirectionalLight(0xffdfa8, 3.2);
    key.position.set(3.4, 6.2, 4.8);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x9fd4ff, 1.45);
    rim.position.set(-4.2, 3.8, -3.6);
    this.scene.add(rim);
  }

  setRickshaw(vehicle: VehicleDef, look: RickshawLook): void {
    this.ensureBuilt();
    if (this.visual) {
      this.turntable.remove(this.visual.root);
      this.visual.dispose();
    }
    this.visual = new RickshawVisual(vehicle, look, true);
    this.visual.setNightLighting(true, 0.7);
    this.turntable.add(this.visual.root);
  }

  drag(dx: number): void {
    this.dragging = true;
    this.dragYaw -= dx * 0.012;
  }

  endDrag(): void {
    this.dragging = false;
  }

  update(dt: number): void {
    if (!this.built) return;
    this.autoRotate += dt * (this.dragging ? 0 : 0.24);
    this.yaw = damp(this.yaw, this.dragYaw + this.autoRotate, 6, dt);
    this.turntable.rotation.y = this.yaw;
    this.visual?.updateVisual(dt, 0, 0, 0, 0, 0);
    this.wheelsOnWall.rotation.z = Math.sin(performance.now() * 0.0004) * 0.02;
    this.updateCamera(dt, false);
  }

  private updateCamera(dt: number, immediate: boolean): void {
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    this.subjectVec.set(portrait ? 0 : 1.22, 1.02, 0);
    if (portrait) this.desiredCamVec.set(2.1, 3.35, 7.2);
    else this.desiredCamVec.set(5.2, 2.85, 6.4);

    if (immediate) this.camera.position.copy(this.desiredCamVec);
    else this.camera.position.lerp(this.desiredCamVec, 1 - Math.exp(-4 * dt));
    this.camera.lookAt(this.subjectVec);
    const targetFov = portrait ? 52 : 44;
    if (this.camera.fov !== targetFov) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
  }

  attachPointer(el: HTMLElement): void {
    let lastX = 0;
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      lastX = e.clientX;
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      this.dragYaw -= dx * 0.011;
    });
    const end = (): void => {
      this.dragging = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.updateCamera(0, true);
  }
}
