/**
 * The garage/store showroom: a warm, lived-in rickshaw workshop with a
 * turntable displaying the player's rickshaw. Rendered instead of the street
 * while the garage or store is open.
 *
 * Framing is deliberately off-centre (subject on the left) so the UI sheet on
 * the right never covers the vehicle on phones in landscape.
 */

import * as THREE from 'three';
import { RickshawVisual, type RickshawLook } from '../vehicle/rickshawModel';
import type { VehicleDef } from '../economy/catalog';
import { damp } from '../core/mathx';
import { FONT_FAMILY, radialSprite } from './textures';
import { createWheel } from './geo';

function wallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  // aged plaster wall
  const g = ctx.createLinearGradient(0, 0, 0, 1024);
  g.addColorStop(0, '#4a5a50');
  g.addColorStop(0.45, '#33443b');
  g.addColorStop(1, '#1d2a24');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2048, 1024);
  // brick patches
  for (let p = 0; p < 5; p++) {
    const x = 120 + p * 380;
    const y = 260 + (p % 3) * 110;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 6; col++) {
        ctx.fillStyle = `rgba(${150 + ((row * 7 + col * 13) % 40)},${92 + ((row * 5) % 26)},${72},0.55)`;
        ctx.fillRect(x + col * 46 + (row % 2) * 23, y + row * 22, 42, 18);
      }
    }
  }
  // warm lamp pools
  for (let i = 0; i < 3; i++) {
    const cx = 340 + i * 680;
    const glow = ctx.createRadialGradient(cx, 210, 12, cx, 210, 460);
    glow.addColorStop(0, 'rgba(255,206,130,0.5)');
    glow.addColorStop(0.5, 'rgba(255,186,105,0.16)');
    glow.addColorStop(1, 'rgba(255,186,105,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 460, 0, 920, 760);
  }
  // hanging tools silhouettes
  ctx.strokeStyle = 'rgba(20,26,24,0.75)';
  ctx.lineWidth = 9;
  const tools = [
    [180, 470, 180, 650],
    [240, 470, 210, 700],
    [300, 470, 330, 640],
    [1180, 480, 1180, 700],
    [2060, 500, 2060, 660],
  ];
  for (const [x1, y1, x2, y2] of tools) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x2, y2 + 12, 20, 0, Math.PI * 2);
    ctx.stroke();
  }
  // hand-painted workshop sign
  ctx.fillStyle = '#123a2c';
  ctx.fillRect(700, 120, 660, 190);
  ctx.strokeStyle = '#e8b25a';
  ctx.lineWidth = 9;
  ctx.strokeRect(722, 142, 616, 146);
  ctx.fillStyle = '#f7e6b8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 96px ${FONT_FAMILY}`;
  ctx.fillText('রিকশা গ্যারেজ', 1030, 200);
  ctx.font = `500 44px ${FONT_FAMILY}`;
  ctx.fillStyle = '#f0c04a';
  ctx.fillText('মেরামত • রং • সাজসজ্জা', 1030, 258);
  // painted floral border along the bottom
  for (let i = 0; i < 26; i++) {
    const x = 40 + i * 78;
    ctx.fillStyle = i % 2 ? '#c0392b' : '#e8b25a';
    ctx.beginPath();
    ctx.arc(x, 880, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f6b4f';
    ctx.beginPath();
    ctx.ellipse(x + 26, 900, 22, 10, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function floorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#3a3a36';
  ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 64) {
    for (let x = 0; x < 512; x += 64) {
      const v = 62 + ((x * 7 + y * 13) % 26);
      ctx.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      ctx.fillRect(x + 2, y + 2, 60, 60);
    }
  }
  // oil stains
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = `rgba(20,18,16,${0.15 + (i % 4) * 0.08})`;
    ctx.beginPath();
    ctx.ellipse(40 + ((i * 97) % 430), 60 + ((i * 131) % 400), 26 + (i % 3) * 18, 16 + (i % 4) * 9, i, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

export class Showroom {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private turntable = new THREE.Group();
  private visual: RickshawVisual | null = null;
  private yaw = 0.55;
  private dragYaw = 0.55;
  private dragging = false;
  private autoRotate = 0;
  private backdrop!: THREE.Mesh;
  private wheelsOnWall: THREE.Group = new THREE.Group();

  constructor() {
    this.scene.background = new THREE.Color('#141d19');
    this.scene.fog = new THREE.Fog(0x1a2620, 22, 52);

    // floor
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(11, 48),
      new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.68, metalness: 0.16 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // back wall
    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 11),
      new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.92 }),
    );
    this.backdrop.position.set(0, 4.6, -7.5);
    this.scene.add(this.backdrop);

    // side walls (kept dark so the eye stays on the rickshaw)
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 11),
        new THREE.MeshStandardMaterial({ color: 0x27332d, roughness: 0.95 }),
      );
      wall.position.set(side * 10, 4.6, 0);
      wall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.scene.add(wall);
    }

    // turntable plinth
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(1.85, 2.0, 0.24, 40),
      new THREE.MeshStandardMaterial({ color: 0x2a3330, roughness: 0.42, metalness: 0.6 }),
    );
    plinth.position.y = 0.12;
    plinth.receiveShadow = true;
    this.scene.add(plinth);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.88, 0.04, 8, 56),
      new THREE.MeshStandardMaterial({ color: 0xe8b25a, roughness: 0.3, metalness: 0.9 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.25;
    this.scene.add(rim);

    // a second, smaller gold ring inset into the plinth top
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.24, 44),
      new THREE.MeshBasicMaterial({ color: 0xe8b25a, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.245;
    this.scene.add(inner);

    this.turntable.position.y = 0.24;
    this.scene.add(this.turntable);

    // workshop props: stacked tyres, hanging spare wheels, tool bench
    for (let i = 0; i < 4; i++) {
      const tyre = new THREE.Mesh(
        new THREE.TorusGeometry(0.38, 0.13, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.95 }),
      );
      tyre.rotation.x = Math.PI / 2;
      tyre.position.set(-3.6, 0.14 + i * 0.24, -2.6);
      this.scene.add(tyre);
    }
    for (let i = 0; i < 2; i++) {
      const wheel = createWheel(0.42, '#1a1a1a', '#c9c9c9', 12);
      wheel.position.set(2.4 + i * 1.1, 3.1, -6.6);
      this.wheelsOnWall.add(wheel);
    }
    this.scene.add(this.wheelsOnWall);

    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.9, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.86 }),
    );
    bench.position.set(3.4, 0.45, -4.2);
    bench.castShadow = true;
    this.scene.add(bench);
    for (let i = 0; i < 6; i++) {
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.22, 8),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0xb8452a : 0x2f6b4f, roughness: 0.6, metalness: 0.4 }),
      );
      can.position.set(2.2 + i * 0.24, 1.02, -4.1 + (i % 2) * 0.2);
      this.scene.add(can);
    }

    // ----------------------------------------------------------- lighting
    this.scene.add(new THREE.HemisphereLight(0xffe9c8, 0x243028, 1.5));
    this.scene.add(new THREE.AmbientLight(0xffe6c0, 0.55));

    const key = new THREE.DirectionalLight(0xffd9a6, 4.6);
    key.position.set(3.2, 6.4, 4.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4.5;
    key.shadow.camera.right = 4.5;
    key.shadow.camera.top = 4.5;
    key.shadow.camera.bottom = -4.5;
    key.shadow.bias = -0.0006;
    this.scene.add(key);

    const rimLight = new THREE.PointLight(0xffb56a, 90, 22, 1.6);
    rimLight.position.set(-1.6, 3.4, -4.4);
    this.scene.add(rimLight);

    const fill = new THREE.PointLight(0x9fd0ff, 55, 20, 1.7);
    fill.position.set(-4.4, 3.0, 3.2);
    this.scene.add(fill);

    const warmPool = new THREE.PointLight(0xffcf94, 60, 14, 1.8);
    warmPool.position.set(0, 4.6, 1.2);
    this.scene.add(warmPool);

    // lamp shades
    for (const [x, z] of [
      [-2.6, -1.2],
      [2.6, -1.2],
    ]) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.34, 0.34, 14, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x2f3a34, roughness: 0.7, side: THREE.DoubleSide }),
      );
      cone.position.set(x, 4.9, z);
      this.scene.add(cone);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: radialSprite('rgba(255,214,150,0.8)', 'rgba(255,190,90,0)'),
          color: 0xffd6a0,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.7,
        }),
      );
      glow.scale.set(2.2, 2.2, 1);
      glow.position.set(x, 4.7, z);
      this.scene.add(glow);
    }

    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 80);
    this.updateCamera(0, true);
  }

  setRickshaw(vehicle: VehicleDef, look: RickshawLook): void {
    if (this.visual) {
      this.turntable.remove(this.visual.root);
      this.visual.dispose();
    }
    this.visual = new RickshawVisual(vehicle, look);
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
    this.autoRotate += dt * (this.dragging ? 0 : 0.24);
    this.yaw = damp(this.yaw, this.dragYaw + this.autoRotate, 6, dt);
    this.turntable.rotation.y = this.yaw;
    this.visual?.updateVisual(dt, 0, 0, 0, 0, 0);
    this.wheelsOnWall.rotation.z = Math.sin(performance.now() * 0.0004) * 0.02;
    this.updateCamera(dt, false);
  }

  /**
   * The camera looks at the plinth from a 3/4 angle and the subject is offset
   * to the left third of the frame so the UI sheet never covers it.
   */
  private updateCamera(dt: number, immediate: boolean): void {
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    // Looking at a point to the RIGHT of the plinth pushes the rickshaw into
    // the LEFT third of the frame, clear of the docked UI sheet.
    const subject = new THREE.Vector3(portrait ? 0 : 1.25, 1.02, 0);
    const desired = portrait
      ? new THREE.Vector3(2.1, 3.4, 7.4)
      : new THREE.Vector3(5.4, 3.0, 6.6);
    if (immediate) this.camera.position.copy(desired);
    else this.camera.position.lerp(desired, 1 - Math.exp(-3 * dt));
    this.camera.lookAt(subject);
    this.camera.fov = portrait ? 52 : 44;
    this.camera.updateProjectionMatrix();
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
