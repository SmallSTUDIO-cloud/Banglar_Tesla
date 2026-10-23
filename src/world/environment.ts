/**
 * Sky, sunlight, fog, day phases, weather (rain + wet roads) and street lamps.
 * All settings are quality-aware and change the visuals immediately.
 */

import * as THREE from 'three';
import type { DayPhase, QualitySettings, WeatherKind } from '../core/config';
import { clamp, damp } from '../core/mathx';
import { radialSprite } from './textures';

interface PhaseConfig {
  zenith: string;
  horizon: string;
  sunColor: string;
  sunIntensity: number;
  elevation: number;
  azimuth: number;
  ambient: number;
  fog: string;
  fogDensity: number;
  lamps: number;
  exposure: number;
}

export const PHASES: Record<DayPhase, PhaseConfig> = {
  morning: {
    zenith: '#6f9dc4',
    horizon: '#f4dcc0',
    sunColor: '#ffdfb0',
    sunIntensity: 2.9,
    elevation: 22,
    azimuth: 62,
    ambient: 0.95,
    fog: '#d7ded6',
    fogDensity: 0.0032,
    lamps: 0,
    exposure: 1.02,
  },
  noon: {
    zenith: '#3f84bd',
    horizon: '#cfe1ea',
    sunColor: '#fff6e2',
    sunIntensity: 3.7,
    elevation: 64,
    azimuth: 28,
    ambient: 1.15,
    fog: '#dde5e4',
    fogDensity: 0.0042,
    lamps: 0,
    exposure: 1.0,
  },
  golden: {
    zenith: '#3f5f88',
    horizon: '#f0a568',
    sunColor: '#ffb069',
    sunIntensity: 3.0,
    elevation: 9,
    azimuth: 96,
    ambient: 0.78,
    fog: '#e2b795',
    fogDensity: 0.0050,
    lamps: 0.25,
    exposure: 1.04,
  },
  blue: {
    zenith: '#182844',
    horizon: '#4d5f80',
    sunColor: '#93a6cc',
    sunIntensity: 0.62,
    elevation: 3,
    azimuth: 118,
    ambient: 0.5,
    fog: '#3c4a66',
    fogDensity: 0.0085,
    lamps: 1.25,
    exposure: 1.16,
  },
  night: {
    zenith: '#04070d',
    horizon: '#0d1725',
    sunColor: '#52648c',
    sunIntensity: 0.16,
    elevation: -14,
    azimuth: 140,
    ambient: 0.3,
    fog: '#0d1822',
    fogDensity: 0.0105,
    lamps: 1.6,
    exposure: 1.16,
  },
};

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = normalize(world.xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uNight;
varying vec3 vWorld;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 dir = normalize(vWorld);
  float h = clamp(dir.y * 1.15 + 0.02, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.62));
  float sun = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sun, 220.0) * 1.4;
  col += uSunColor * pow(sun, 8.0) * 0.16;
  // subtle stars at night
  if (uNight > 0.01) {
    vec2 sp = dir.xz / max(abs(dir.y) + 0.15, 0.2) * 62.0;
    float s = hash(floor(sp));
    float star = step(0.9945, s) * uNight * clamp(dir.y * 2.2, 0.0, 1.0);
    col += vec3(star);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export class EnvironmentSystem {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly sky: THREE.Mesh;
  private scene: THREE.Scene;
  private quality: QualitySettings;
  private phase: DayPhase = 'morning';
  private weather: WeatherKind = 'clear';
  private rain: THREE.Points | null = null;
  private rainVel: Float32Array = new Float32Array(0);
  private rainDrops: Float32Array = new Float32Array(0);
  private rainGeo: THREE.BufferGeometry | null = null;
  private lamps: THREE.PointLight[] = [];
  private lampPositions: THREE.Vector3[] = [];
  private playerFill!: THREE.PointLight;
  private glowSprites: THREE.Sprite[] = [];
  private skyUniforms: {
    uZenith: { value: THREE.Color };
    uHorizon: { value: THREE.Color };
    uSunColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uNight: { value: number };
  };
  wetness = 0;
  targetWetness = 0;
  /** Set by the world so the road can darken and shimmer when wet. */
  onWetnessChange: ((wet: number) => void) | null = null;
  onPhaseChange: ((phase: DayPhase) => void) | null = null;

  constructor(scene: THREE.Scene, quality: QualitySettings) {
    this.scene = scene;
    this.quality = quality;

    this.skyUniforms = {
      uZenith: { value: new THREE.Color('#6f9dc4') },
      uHorizon: { value: new THREE.Color('#f4dcc0') },
      uSunColor: { value: new THREE.Color('#ffdfb0') },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.4) },
      uNight: { value: 0 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(420, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.name = 'sky';
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffdfb0, 2.2);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.035;
    const d = quality.shadowDistance;
    const cam = this.sun.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 1;
    cam.far = d * 5;
    cam.updateProjectionMatrix();
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Soft, warm fill that follows the camera focus so the player's rickshaw is
    // never a silhouette at night. Costs one non-shadowed point light.
    this.playerFill = new THREE.PointLight(0xffdfb8, 0, 12, 1.6);
    scene.add(this.playerFill);

    this.hemi = new THREE.HemisphereLight(0xcfe3f4, 0x7a6a52, 0.7);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(this.ambient);

    scene.fog = new THREE.FogExp2(new THREE.Color('#d7ded6').getHex(), 0.006);
    scene.background = new THREE.Color('#8fb4cf');

    this.setQuality(quality);
    this.setPhase('morning');
  }

  setLampPositions(positions: THREE.Vector3[]): void {
    this.lampPositions = positions;
    const spriteTex = radialSprite('rgba(255,214,150,0.85)', 'rgba(255,190,90,0)');
    this.lamps = [];
    this.glowSprites = [];
    const maxLights = this.quality.particles === 'minimal' ? 3 : this.quality.particles === 'moderate' ? 4 : 6;
    for (let i = 0; i < maxLights; i++) {
      const light = new THREE.PointLight(0xffcf94, 0, 26, 1.55);
      light.castShadow = false;
      this.scene.add(light);
      this.lamps.push(light);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: spriteTex,
          color: 0xffd9a0,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        }),
      );
      sprite.scale.set(2.6, 2.6, 1);
      this.scene.add(sprite);
      this.glowSprites.push(sprite);
    }
  }

  setQuality(quality: QualitySettings): void {
    this.quality = quality;
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const d = quality.shadowDistance;
    const cam = this.sun.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.far = d * 5;
    cam.updateProjectionMatrix();
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = PHASES[this.phase].fogDensity * (quality.viewDistance < 140 ? 1.4 : 1);
    }
    this.rebuildRain();
  }

  setPhase(phase: DayPhase): void {
    this.phase = phase;
    this.apply();
    this.onPhaseChange?.(phase);
  }

  setWeather(weather: WeatherKind): void {
    this.weather = weather;
    this.targetWetness = weather === 'rain' ? 1 : weather === 'overcast' ? 0.12 : 0;
    this.rebuildRain();
    this.apply();
  }

  getPhase(): DayPhase {
    return this.phase;
  }

  getWeather(): WeatherKind {
    return this.weather;
  }

  private apply(): void {
    const cfg = PHASES[this.phase];
    const overcast = this.weather === 'overcast' ? 0.55 : this.weather === 'rain' ? 0.42 : 1;
    const wetFog = this.weather === 'rain' ? 1.55 : 1;
    this.skyUniforms.uZenith.value.set(cfg.zenith).multiplyScalar(overcast * 0.96 + 0.04);
    this.skyUniforms.uHorizon.value.set(cfg.horizon).multiplyScalar(overcast * 0.9 + 0.1);
    this.skyUniforms.uSunColor.value.set(cfg.sunColor).multiplyScalar(overcast);
    this.skyUniforms.uNight.value = this.phase === 'night' ? 1 : this.phase === 'blue' ? 0.4 : 0;

    const el = THREE.MathUtils.degToRad(cfg.elevation);
    const az = THREE.MathUtils.degToRad(cfg.azimuth);
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    this.skyUniforms.uSunDir.value.copy(dir);

    this.sun.color.set(this.phase === 'night' ? '#7f9ad0' : cfg.sunColor);
    this.sun.intensity = cfg.sunIntensity * overcast;
    // Night keeps a cool moonlight key so silhouettes never read as black cards.
    if (this.phase === 'night') this.sun.intensity = 0.22;
    this.hemi.intensity = cfg.ambient * (this.weather === 'overcast' ? 1.25 : 1);
    if (this.phase === 'night') this.hemi.intensity = 0.16;
    if (this.phase === 'blue') this.hemi.intensity = 0.34;
    this.hemi.color.set(this.phase === 'night' ? '#2b3a52' : '#bcd6ee');
    this.hemi.groundColor.set(this.phase === 'night' ? '#0f1518' : '#6b5a44');
    this.ambient.intensity = this.phase === 'night' ? 0.08 : 0.3;

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.set(cfg.fog);
      if (this.weather === 'overcast') this.scene.fog.color.lerp(new THREE.Color('#9aa8ac'), 0.5);
      if (this.weather === 'rain') this.scene.fog.color.lerp(new THREE.Color('#7d8f94'), 0.55);
      this.scene.fog.density = cfg.fogDensity * wetFog * (this.quality.viewDistance < 140 ? 1.45 : 1);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.skyUniforms.uHorizon.value);
    }
    // Image-based ambient from the room probe is very bright; dim it at night so
    // the street actually reads as night instead of a grey overcast afternoon.
    this.scene.environmentIntensity =
      this.phase === 'night' ? 0.1 : this.phase === 'blue' ? 0.22 : this.phase === 'golden' ? 0.42 : 0.5;
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 60);
    this.sun.visible = cfg.sunIntensity > 0.05;
    this.sun.castShadow = this.quality.shadows && cfg.sunIntensity > 0.3;
    void this.sun.position;
  }

  private rebuildRain(): void {
    if (this.rain) {
      this.scene.remove(this.rain);
      this.rainGeo?.dispose();
      (this.rain.material as THREE.PointsMaterial).dispose();
      this.rain = null;
    }
    if (this.weather !== 'rain') return;
    const count = Math.max(90, this.quality.rainParticles);
    // Two vertices per drop → short bright streaks that read as heavy monsoon
    // rain even on a tiny phone screen, at the cost of one draw call.
    const positions = new Float32Array(count * 6);
    this.rainDrops = new Float32Array(count * 3);
    this.rainVel = new Float32Array(count);
    const rng = () => Math.random();
    for (let i = 0; i < count; i++) {
      const x = (rng() - 0.5) * 44;
      const y = rng() * 26;
      const z = (rng() - 0.5) * 44;
      this.rainDrops[i * 3] = x;
      this.rainDrops[i * 3 + 1] = y;
      this.rainDrops[i * 3 + 2] = z;
      this.rainVel[i] = 17 + rng() * 11;
      positions[i * 6] = x;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x + 0.07;
      positions[i * 6 + 4] = y - 0.62;
      positions[i * 6 + 5] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xd8ecf6,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: true,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 3;
    this.rain = lines as unknown as THREE.Points;
    this.rainGeo = geo;
    this.scene.add(lines);
  }

  /** Per-frame update: rain follows the player, lamp intensities interpolate. */
  update(dt: number, focus: THREE.Vector3): void {
    const previousWet = this.wetness;
    this.wetness = damp(this.wetness, this.targetWetness, 0.8, dt);
    if (Math.abs(this.wetness - previousWet) > 0.0008) this.onWetnessChange?.(this.wetness);
    const cfg = PHASES[this.phase];
    const lampTarget = cfg.lamps * (this.weather === 'rain' && this.phase !== 'night' ? 0.5 : 1);

    if (this.lampPositions.length > 0) {
      // choose the nearest lamps each frame (cheap: 6 candidates)
      const sorted = this.lampPositions
        .map((p, i) => ({ p, i, d: p.distanceToSquared(focus) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.lamps.length);
      this.lamps.forEach((light, idx) => {
        const entry = sorted[idx];
        if (!entry) return;
        light.position.copy(entry.p);
        light.intensity = lampTarget > 0.02 ? 58 * lampTarget : 0;
        const sprite = this.glowSprites[idx];
        if (sprite) {
          sprite.position.copy(entry.p);
          sprite.material.opacity = lampTarget * 0.75;
          sprite.visible = lampTarget > 0.03;
        }
      });
      for (let i = sorted.length; i < this.glowSprites.length; i++) {
        this.glowSprites[i].visible = false;
        this.lamps[i].intensity = 0;
      }
    }

    // keep a little warm light on the hero vehicle after dusk
    const dusk = this.phase === 'night' ? 1 : this.phase === 'blue' ? 0.55 : 0;
    this.playerFill.intensity = dusk * 14;
    this.playerFill.position.set(focus.x, 3.0, focus.z + 0.6);

    this.sun.target.position.set(focus.x, 0, focus.z);
    const el = THREE.MathUtils.degToRad(cfg.elevation);
    const az = THREE.MathUtils.degToRad(cfg.azimuth);
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.max(0.05, Math.sin(el)), Math.cos(el) * Math.cos(az));
    this.sun.position.set(focus.x, 0, focus.z).addScaledVector(dir.normalize(), 55);
    this.sun.target.updateMatrixWorld();

    if (this.rain && this.rainGeo) {
      const pos = this.rainGeo.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const drops = this.rainDrops;
      const count = this.rainVel.length;
      const windX = 2.2 * dt;
      for (let i = 0; i < count; i++) {
        const fx = drops[i * 3] + windX;
        const fy = drops[i * 3 + 1] - this.rainVel[i] * dt;
        const fz = drops[i * 3 + 2];
        if (fy < 0) {
          drops[i * 3] = (Math.random() - 0.5) * 44;
          drops[i * 3 + 1] = 22 + Math.random() * 6;
          drops[i * 3 + 2] = (Math.random() - 0.5) * 44;
        } else {
          drops[i * 3] = fx > 22 ? -22 : fx;
          drops[i * 3 + 1] = fy;
          drops[i * 3 + 2] = fz;
        }
        const x = drops[i * 3];
        const y = drops[i * 3 + 1];
        const z = drops[i * 3 + 2];
        const len = 0.42 + this.rainVel[i] * 0.022;
        arr[i * 6] = x;
        arr[i * 6 + 1] = y;
        arr[i * 6 + 2] = z;
        arr[i * 6 + 3] = x + 0.07;
        arr[i * 6 + 4] = y - len;
        arr[i * 6 + 5] = z;
      }
      pos.needsUpdate = true;
      this.rain.position.set(focus.x, 0, focus.z);
    }
    void clamp;
  }

  dispose(): void {
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.rebuildRain();
    for (const light of this.lamps) this.scene.remove(light);
    this.scene.remove(this.playerFill);
  }
}
