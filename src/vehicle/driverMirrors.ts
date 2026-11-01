/** Two deliberately tiny rear/side render targets, sampled only from cockpit view.
 * No per-frame resource creation; the overlay is a canvas-space scene, never a
 * camera-facing world object that could mislead a driver in other views.
 */
import * as THREE from 'three';

export class DriverMirrors {
  private readonly targets = [new THREE.WebGLRenderTarget(160, 88), new THREE.WebGLRenderTarget(160, 88)];
  private readonly cameras = [new THREE.PerspectiveCamera(54, 160 / 88, 0.18, 105), new THREE.PerspectiveCamera(54, 160 / 88, 0.18, 105)];
  private readonly overlay = new THREE.Scene();
  private readonly overlayCamera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.01, 5);
  private readonly frames: THREE.Mesh[] = [];
  private readonly displays: THREE.Mesh[] = [];
  private readonly mirrorGeo = new THREE.PlaneGeometry(0.36, 0.20);
  private readonly frameGeo = new THREE.PlaneGeometry(0.38, 0.22);
  private lastUpdate = -Infinity;
  renderCount = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly world: THREE.Scene) {
    this.overlayCamera.position.z = 2;
    for (let i = 0; i < 2; i++) {
      const frame = new THREE.Mesh(this.frameGeo, new THREE.MeshBasicMaterial({ color: 0x293436, depthTest: false, depthWrite: false }));
      const display = new THREE.Mesh(this.mirrorGeo, new THREE.MeshBasicMaterial({ map: this.targets[i].texture, toneMapped: false, depthTest: false, depthWrite: false }));
      frame.position.z = -0.05;
      display.position.z = 0;
      this.overlay.add(frame, display);
      this.frames.push(frame);
      this.displays.push(display);
    }
  }

  /** Must be called before the main scene render; false means zero mirror draws. */
  update(nowMs: number, active: boolean, x: number, y: number, z: number, yaw: number, playerRoot: THREE.Object3D): boolean {
    if (!active) { this.lastUpdate = -Infinity; return false; }
    if (nowMs - this.lastUpdate < 115) return true;
    this.lastUpdate = nowMs;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const lx = Math.cos(yaw), lz = -Math.sin(yaw);
    const previousVisible = playerRoot.visible;
    playerRoot.visible = false; // own canopy must not obscure the rear corridor
    try {
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 1 : -1;
        const camera = this.cameras[i];
        camera.position.set(x + side * lx * 0.57 - fx * 0.2, y + 1.52, z + side * lz * 0.57 - fz * 0.2);
        camera.up.set(0, 1, 0);
        camera.lookAt(camera.position.x - fx * 13 + side * lx * 5, camera.position.y - 0.4, camera.position.z - fz * 13 + side * lz * 5);
        this.renderer.setRenderTarget(this.targets[i]);
        this.renderer.clear();
        this.renderer.render(this.world, camera);
        this.renderCount++;
      }
    } finally {
      this.renderer.setRenderTarget(null);
      playerRoot.visible = previousVisible;
    }
    return true;
  }

  /** Draw after the main scene. Does not touch HUD DOM or clear its color buffer. */
  draw(aspect: number): void {
    this.overlayCamera.left = -aspect / 2;
    this.overlayCamera.right = aspect / 2;
    this.overlayCamera.updateProjectionMatrix();
    for (let i = 0; i < 2; i++) {
      const x = aspect < 1 ? (i === 0 ? -1 : 1) * aspect * 0.25
        : i === 0 ? -aspect / 2 + 0.21 : aspect / 2 - 0.43;
      const scale = Math.min(1, aspect / 1.1);
      this.frames[i].scale.setScalar(scale);
      this.displays[i].scale.setScalar(scale);
      this.frames[i].position.x = this.displays[i].position.x = x;
      this.frames[i].position.y = this.displays[i].position.y = -0.08;
    }
    const previous = this.renderer.autoClear;
    this.renderer.autoClear = false;
    try {
      this.renderer.clearDepth();
      this.renderer.render(this.overlay, this.overlayCamera);
    } finally {
      this.renderer.autoClear = previous;
    }
  }

  dispose(): void {
    for (const target of this.targets) target.dispose();
    this.mirrorGeo.dispose(); this.frameGeo.dispose();
    for (const mesh of [...this.frames, ...this.displays]) (mesh.material as THREE.Material).dispose();
  }
}
