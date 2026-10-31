/**
 * Sky, sunlight, fog, day phases, weather (rain + wet roads) and street lamps.
 * All settings are quality-aware and change the visuals immediately.
 */

import * as THREE from 'three';
import type { DayPhase, QualitySettings, WeatherKind } from '../core/config';
import { clamp, damp } from '../core/mathx';
import { radialSprite } from './textures';
import { targetBlendFor, type WeatherBlend } from './weatherDirector';

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

/** Interpolated 24-hour light keyframes; the last key joins the first across midnight. */
const DAY_KEYS: { minute: number; phase: DayPhase; night: number }[] = [
  { minute: 0, phase: 'night', night: 1 },
  { minute: 295, phase: 'night', night: 1 },
  { minute: 450, phase: 'morning', night: 0 },
  { minute: 750, phase: 'noon', night: 0 },
  { minute: 1005, phase: 'golden', night: 0 },
  { minute: 1105, phase: 'blue', night: 0.35 },
  { minute: 1275, phase: 'night', night: 1 },
  { minute: 1440, phase: 'night', night: 1 },
];

/** Pooled rain draw budget continuously follows the actual weather blend. */
export function rainDrawCount(amount: number, budget: number,
  density: 'low' | 'medium' | 'high', mode: 'normal' | 'dynamic', capacity = 700): number {
  const rain = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  if (rain <= 0.02) return 0;
  const multiplier = (density === 'low' ? 0.55 : density === 'high' ? 1.25 : 1) *
    (mode === 'dynamic' ? 1.2 : 0.8);
  return clamp(Math.round(Math.max(0, budget) * multiplier * rain), 0, capacity);
}

// Reused palette samples avoid allocating Color objects at each clock tick.
const phaseColors = Object.fromEntries(Object.entries(PHASES).map(([phase, cfg]) => [phase, {
  zenith: new THREE.Color(cfg.zenith), horizon: new THREE.Color(cfg.horizon),
  sunColor: new THREE.Color(cfg.sunColor), fog: new THREE.Color(cfg.fog),
}])) as Record<DayPhase, Record<'zenith' | 'horizon' | 'sunColor' | 'fog', THREE.Color>>;
const dayColorScratch = new THREE.Color();

export function sampleDayLighting(raw: number): { cfg: PhaseConfig; night: number } {
  const minute = ((raw % 1440) + 1440) % 1440;
  let index = 0;
  while (index + 2 < DAY_KEYS.length && DAY_KEYS[index + 1].minute < minute) index++;
  const a = DAY_KEYS[index], b = DAY_KEYS[index + 1];
  const t = clamp((minute - a.minute) / (b.minute - a.minute), 0, 1);
  const first = PHASES[a.phase], second = PHASES[b.phase];
  const mix = (x: number, y: number) => x + (y - x) * t;
  const color = (key: 'zenith' | 'horizon' | 'sunColor' | 'fog') =>
    `#${dayColorScratch.copy(phaseColors[a.phase][key]).lerp(phaseColors[b.phase][key], t).getHexString()}`;
  return { night: mix(a.night, b.night), cfg: {
    zenith: color('zenith'),
    horizon: color('horizon'),
    sunColor: color('sunColor'),
    sunIntensity: mix(first.sunIntensity, second.sunIntensity),
    elevation: mix(first.elevation, second.elevation),
    azimuth: mix(first.azimuth, second.azimuth),
    ambient: mix(first.ambient, second.ambient),
    fog: color('fog'),
    fogDensity: mix(first.fogDensity, second.fogDensity),
    lamps: mix(first.lamps, second.lamps),
    exposure: mix(first.exposure, second.exposure),
  } };
}

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  // A camera-following sky must use its LOCAL direction; world position
  // changes whenever the player or cockpit mirror camera moves.
  vWorld = normalize(position);
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
  private clockMinutes: number | null = null;
  private appliedLamps = 0;
  private appliedNight = 0;
  private appliedElevation = PHASES.morning.elevation;
  private appliedAzimuth = PHASES.morning.azimuth;
  private weather: WeatherKind = 'sunny';
  private rain: THREE.Points | null = null;
  private rainMode: 'normal' | 'dynamic' = 'normal';
  private rainDensity: 'low' | 'medium' | 'high' = 'medium';
  private wetRoadEnabled = true;
  private lightningEnabled = true;
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

  /** Live weather blend (vNext §4) — damped toward state targets, never snapped. */
  private blend: WeatherBlend = { overcast: 0, wet: 0, wind: 0.15, rain: 0, lightning: 0 };
  private blendDirty = false;
  private applyAccum = 0;
  private lightningFlash = 0;
  private readonly flashTint = new THREE.Color('#b5cafa');
  private readonly hemiNight = new THREE.Color('#2b3a52');
  private readonly groundNight = new THREE.Color('#0f1518');
  private readonly cloudFog = new THREE.Color('#9aa8ac');
  private readonly rainFog = new THREE.Color('#7d8f94');
  private readonly midnightFog = new THREE.Color('#203448');
  private readonly stormFog = new THREE.Color('#98a7c3');
  private readonly fogScratch = new THREE.Color();
  private rainFocusX = Number.NaN;
  private rainFocusZ = Number.NaN;

  /** Set by the world so the road can darken and shimmer when wet. */
  onWetnessChange: ((wet: number) => void) | null = null;
  onPhaseChange: ((phase: DayPhase) => void) | null = null;
  /** Lightning strike visuals: DOM overlay + thunder scheduling (no new lights!). */
  onLightningFlash?: (strength: number, flashAllowed: boolean) => void;

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
      // Inside both the 360 m gameplay camera and the 105 m mirror cameras.
      // The old 420 m sphere crossed the camera far plane, drawing a huge
      // circular edge against scene.background in daylight and at night.
      new THREE.SphereGeometry(90, 24, 16),
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
    // Draw before opaque world geometry: distant buildings remain visible
    // through the sky without a depth write, even beyond the sky radius.
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.sky.onBeforeRender = (_renderer, _scene, camera) => {
      this.sky.position.copy(camera.position);
      this.sky.updateMatrixWorld();
    };
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

    this.initRainPool();
    this.setQuality(quality);
    this.setPhase('morning');
  }

  private initRainPool(): void {
    const maxDrops = 700;
    const positions = new Float32Array(maxDrops * 6);
    this.rainDrops = new Float32Array(maxDrops * 3);
    this.rainVel = new Float32Array(maxDrops);
    for (let i = 0; i < maxDrops; i++) {
      const x = (Math.random() - 0.5) * 44;
      const y = Math.random() * 26;
      const z = (Math.random() - 0.5) * 44;
      this.rainDrops[i * 3] = x;
      this.rainDrops[i * 3 + 1] = y;
      this.rainDrops[i * 3 + 2] = z;
      this.rainVel[i] = 17 + Math.random() * 11;
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
    lines.visible = false;
    this.rain = lines as unknown as THREE.Points;
    this.rainGeo = geo;
    this.scene.add(lines);
  }

  setLampPositions(positions: THREE.Vector3[]): void {
    this.lampPositions = positions;
    for (const l of this.lamps) this.scene.remove(l);
    for (const s of this.glowSprites) {
      this.scene.remove(s);
      s.material.dispose();
    }
    const spriteTex = radialSprite('rgba(255,214,150,0.85)', 'rgba(255,190,90,0)');
    this.lamps = [];
    this.glowSprites = [];
    // Constant 1 dynamic street PointLight (+ playerFill = 2 invariant PointLights across all presets!)
    // paired with 6 warm volumetric halo sprites + ground light pools for rich Dhaka night atmosphere
    // without forcing 6 per-pixel PointLight BRDF loops on Mali-G72 MP3 during daytime or night.
    const keyLamp = new THREE.PointLight(0xffcf94, 0, 28, 1.5);
    keyLamp.castShadow = false;
    this.scene.add(keyLamp);
    this.lamps.push(keyLamp);

    for (let i = 0; i < 6; i++) {
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
      sprite.scale.set(2.7, 2.7, 1);
      sprite.visible = false;
      this.scene.add(sprite);
      this.glowSprites.push(sprite);
    }
  }

  setRainGraphics(mode: 'normal' | 'dynamic', density: 'low' | 'medium' | 'high', wetRoad: boolean, lightning: boolean): void {
    this.rainMode = mode;
    this.rainDensity = density;
    this.wetRoadEnabled = wetRoad;
    this.lightningEnabled = lightning;
    this.rebuildRain();
  }

  setQuality(quality: QualitySettings): void {
    this.quality = quality;
    const prevSize = this.sun.shadow.mapSize.x;
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
    if (this.sun.shadow.map && prevSize !== quality.shadowMapSize) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.rebuildRain();
    // A graphics-preset change must keep the *current* clock and weather fog,
    // not briefly replace it with the named phase's dry preset.
    this.apply();
  }

  /** Explicit overrides (photo/intro/debug) use null; active clock is smoothed. */
  setClockMinutes(minutes: number | null): void {
    if (minutes === null || Number.isFinite(minutes)) {
      if (minutes === null || this.clockMinutes === null || Math.abs(minutes - this.clockMinutes) >= 0.025) {
        this.clockMinutes = minutes;
        this.blendDirty = true;
      }
    }
  }

  setPhase(phase: DayPhase, overrideClock = false): void {
    if (overrideClock) this.clockMinutes = null;
    this.phase = phase;
    this.apply();
    this.onPhaseChange?.(phase);
  }

  setWeather(weather: WeatherKind): void {
    this.weather = weather;
    this.blend = { ...targetBlendFor(weather) };
    this.targetWetness = this.blend.wet;
    this.rebuildRain();
    this.apply();
  }

  /**
   * Gradual weather-blend input from the WeatherDirector (vNext §4). Visuals are
   * recomputed on a bounded throttle (~8 Hz) inside `update`, never per-frame.
   */
  setWeatherBlend(blend: WeatherBlend, wetTarget: number): void {
    this.blend = {
      overcast: blend.overcast,
      wet: blend.wet,
      wind: blend.wind,
      rain: blend.rain,
      lightning: blend.lightning,
    };
    this.targetWetness = wetTarget;
    this.blendDirty = true;
    this.rebuildRain();
  }

  /** Bounded lightning strike: brief world/sky illumination WITHOUT new lights. */
  strike(intensity: number, flashAllowed: boolean): void {
    this.lightningFlash = this.lightningEnabled ? (flashAllowed ? 0.62 : 0.13) * clamp(intensity, 0, 1) : 0;
    this.applyAccum = 1; // force immediate visual response
    this.blendDirty = true;
    this.onLightningFlash?.(this.lightningFlash, flashAllowed);
  }

  /** 0..1.35 wind strength for litter/canopy sway and wind ambience. */
  getWindStrength(): number {
    return this.blend.wind;
  }

  /** Latest lightning flash level (for screen overlay decay tests). */
  get lightningLevel(): number {
    return this.lightningFlash;
  }

  get weatherBlend(): Readonly<WeatherBlend> {
    return this.blend;
  }

  /** Continuously sampled 0..1 night lighting, shared by lamps, facades and vehicle. */
  get nightFactor(): number {
    return this.appliedNight;
  }

  getPhase(): DayPhase {
    return this.phase;
  }

  getWeather(): WeatherKind {
    return this.weather;
  }

  private apply(): void {
    const sampled = this.clockMinutes === null ? null : sampleDayLighting(this.clockMinutes);
    const cfg = sampled?.cfg ?? PHASES[this.phase];
    const nightWeight = sampled?.night ?? (this.phase === 'night' ? 1 : this.phase === 'blue' ? 0.35 : 0);
    this.appliedNight = nightWeight;
    this.appliedLamps = cfg.lamps;
    this.appliedElevation = cfg.elevation;
    this.appliedAzimuth = cfg.azimuth;
    // Blend-driven sun/sky multipliers: sunny 1.0, overcast ~0.55, rain ~0.41, storm ~0.18.
    const overcast = clamp(1 - 0.82 * this.blend.overcast, 0.14, 1.05);
    const wetFog = 1 + 0.55 * this.blend.rain + 0.2 * this.blend.overcast + 0.12 * this.blend.wind;
    const flash = this.lightningFlash;
    this.skyUniforms.uZenith.value.set(cfg.zenith).multiplyScalar((overcast * 0.96 + 0.04) * (1 + flash * 0.18));
    this.skyUniforms.uHorizon.value.set(cfg.horizon).multiplyScalar((overcast * 0.9 + 0.1) * (1 + flash * 0.15));
    this.skyUniforms.uSunColor.value.set(cfg.sunColor).multiplyScalar(overcast);
    this.skyUniforms.uNight.value = nightWeight;

    const el = THREE.MathUtils.degToRad(cfg.elevation);
    const az = THREE.MathUtils.degToRad(cfg.azimuth);
    this.skyUniforms.uSunDir.value.copy(this.tmpSunDir.set(
      Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az),
    ).normalize());

    // Lightning comes from the existing world lights, not a white fullscreen wipe.
    this.sun.color.set(cfg.sunColor).lerp(this.flashTint, clamp(flash * 1.5, 0, 1));
    this.sun.intensity = cfg.sunIntensity * overcast;
    // Night keeps a cool moonlight key so silhouettes never read as black cards.
    this.sun.intensity = this.sun.intensity * (1 - nightWeight) + 0.22 * nightWeight;
    this.hemi.intensity = cfg.ambient * (this.blend.overcast > 0.35 ? 1.1 + this.blend.overcast * 0.3 : 1);
    this.hemi.intensity = this.hemi.intensity * (1 - nightWeight) + 0.16 * nightWeight;
    // Lightning: bounded sun/hemi/exposure surge (zero new lights, zero shader variants).
    this.ambient.intensity = 0.3 - 0.22 * nightWeight;
    if (flash > 0.002) {
      this.sun.intensity += flash * 2.4;
      this.hemi.intensity += flash * 0.65;
      this.ambient.intensity += flash * 0.16;
    }
    this.hemi.color.set('#bcd6ee').lerp(this.hemiNight, nightWeight);
    this.hemi.groundColor.set('#6b5a44').lerp(this.groundNight, nightWeight);

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.set(cfg.fog);
      if (this.blend.overcast > 0.3) {
        this.scene.fog.color.lerp(this.fogScratch.copy(this.cloudFog).lerp(this.midnightFog, nightWeight),
          Math.min(0.62, this.blend.overcast * 0.62));
      }
      if (this.blend.rain > 0.25) {
        this.scene.fog.color.lerp(this.fogScratch.copy(this.rainFog).lerp(this.midnightFog, nightWeight),
          Math.min(0.62, this.blend.rain * 0.62));
      }
      if (flash > 0.002) this.scene.fog.color.lerp(this.stormFog, flash * 0.12);
      this.scene.fog.density =
        cfg.fogDensity * wetFog * (this.quality.viewDistance < 140 ? 1.45 : 1) + (this.lightningFlash > 0.02 ? -0.0006 : 0);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.skyUniforms.uHorizon.value);
    }
    // Image-based ambient from the room probe is very bright; dim it at night so
    // the street actually reads as night instead of a grey overcast afternoon.
    this.scene.environmentIntensity =
      0.5 - 0.4 * nightWeight - Math.max(0, cfg.lamps - nightWeight * 1.6) * 0.18;
    this.tmpSunDir.set(Math.cos(el) * Math.sin(az), Math.max(0.22, Math.sin(el)),
      Math.cos(el) * Math.cos(az)).normalize();
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.tmpSunDir, 60);
    // Keep directional light & shadow topology CONSTANT across day/night transitions
    // so Three.js NEVER recompiles NUM_DIR_LIGHTS / NUM_DIR_LIGHT_SHADOWS mid-drive!
    this.sun.visible = true;
    this.sun.castShadow = this.quality.shadows;
  }

  private activeRainDrops = 0;

  private rebuildRain(): void {
    if (!this.rain || !this.rainGeo) return;
    // Use the actual weather director blend, not the previous named weather:
    // during a rain→sun transition the named state remains Rain until the
    // blend finishes, and a state fallback held 60+ drops then cut them off.
    const rainAmt = clamp(this.blend.rain, 0, 1);
    const count = rainDrawCount(rainAmt, this.quality.rainParticles,
      this.rainDensity, this.rainMode, this.rainVel.length);
    this.activeRainDrops = count;
    this.rainGeo.setDrawRange(0, count * 2);
    (this.rain.material as THREE.LineBasicMaterial).opacity = Math.min(0.55, rainAmt * 0.55);
    this.rain.visible = count > 0;
  }

  /** Temporarily reveal pooled weather/glow objects so `renderer.compile()` prewarms them at boot. */
  withPrewarmState(run: () => void): void {
    const prevRain = this.rain ? this.rain.visible : false;
    const prevSprite = this.glowSprites[0] ? this.glowSprites[0].visible : false;
    if (this.rain) this.rain.visible = true;
    if (this.glowSprites[0]) this.glowSprites[0].visible = true;
    try {
      run();
    } finally {
      if (this.rain) this.rain.visible = prevRain;
      if (this.glowSprites[0]) this.glowSprites[0].visible = prevSprite;
    }
  }

  /** Per-frame update: rain follows the player, lamp intensities interpolate. */
  private tmpSunDir = new THREE.Vector3();
  private nearestLampIdx = new Int32Array(8);
  private nearestLampDist = new Float32Array(8);

  update(dt: number, focus: THREE.Vector3): void {
    const previousWet = this.wetness;
    this.wetness = damp(this.wetness, this.wetRoadEnabled ? this.targetWetness : 0, 0.8, dt);
    // Do not skip the final visibility threshold when drying slows below the
    // usual material-update epsilon: otherwise puddles linger in clear sun.
    if (Math.abs(this.wetness - previousWet) > 0.0008 ||
      (previousWet > 0.03 && this.wetness <= 0.03)) this.onWetnessChange?.(this.wetness);

    // Lightning flash decay (brief, bounded) + throttled blend application (~8 Hz max)
    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 2.35);
      // Reapply while decaying, including the final zero frame: otherwise the
      // last bright world-light intensity persists until the next weather tick.
      this.blendDirty = true;
    }
    this.applyAccum += dt;
    if (this.blendDirty && (this.lightningFlash > 0 || this.applyAccum >= 0.12)) {
      this.applyAccum = 0;
      this.blendDirty = false;
      this.apply();
    }

    // Storm-dark afternoons may light a few shop/street halos; night remains
    // anchored to the clock, never dimmed merely because it is raining.
    const weatherDark = clamp((this.blend.overcast - 0.55) * 0.35, 0, 0.16);
    const lampTarget = Math.max(this.appliedLamps, weatherDark * 1.2);

    if (this.lampPositions.length > 0 && this.glowSprites.length > 0) {
      if (lampTarget <= 0.02) {
        for (let i = 0; i < this.lamps.length; i++) this.lamps[i].intensity = 0;
        for (let i = 0; i < this.glowSprites.length; i++) this.glowSprites[i].visible = false;
      } else {
        const k = Math.min(this.glowSprites.length, 6);
        for (let j = 0; j < k; j++) {
          this.nearestLampIdx[j] = -1;
          this.nearestLampDist[j] = Infinity;
        }
        for (let i = 0; i < this.lampPositions.length; i++) {
          if (this.lampPositions[i].y < -100) continue;
          const d = this.lampPositions[i].distanceToSquared(focus);
          if (d >= this.nearestLampDist[k - 1]) continue;
          let ins = k - 1;
          while (ins > 0 && d < this.nearestLampDist[ins - 1]) {
            this.nearestLampDist[ins] = this.nearestLampDist[ins - 1];
            this.nearestLampIdx[ins] = this.nearestLampIdx[ins - 1];
            ins--;
          }
          this.nearestLampDist[ins] = d;
          this.nearestLampIdx[ins] = i;
        }
        if (this.lamps[0]) {
          const p0 = this.nearestLampIdx[0];
          if (p0 >= 0) {
            this.lamps[0].position.copy(this.lampPositions[p0]);
            this.lamps[0].intensity = 58 * lampTarget;
          } else {
            this.lamps[0].intensity = 0;
          }
        }
        for (let idx = 0; idx < this.glowSprites.length; idx++) {
          const pIdx = idx < k ? this.nearestLampIdx[idx] : -1;
          const sprite = this.glowSprites[idx];
          if (pIdx < 0) {
            sprite.visible = false;
            continue;
          }
          sprite.position.copy(this.lampPositions[pIdx]);
          sprite.material.opacity = lampTarget * 0.75;
          sprite.visible = lampTarget > 0.03;
        }
      }
    }

    // keep a little warm light on the hero vehicle after dusk
    const dusk = this.appliedNight;
    this.playerFill.intensity = dusk * 14;
    this.playerFill.position.set(focus.x, 3.0, focus.z + 0.6);

    this.sun.target.position.set(focus.x, 0, focus.z);
    const el = THREE.MathUtils.degToRad(this.appliedElevation);
    const az = THREE.MathUtils.degToRad(this.appliedAzimuth);
    this.tmpSunDir.set(Math.cos(el) * Math.sin(az), Math.max(0.22, Math.sin(el)), Math.cos(el) * Math.cos(az)).normalize();
    this.sun.position.set(focus.x, 0, focus.z).addScaledVector(this.tmpSunDir, 55);
    this.sun.target.updateMatrixWorld();

    if (this.rain && this.rain.visible && this.rainGeo && this.activeRainDrops > 0) {
      const pos = this.rainGeo.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const drops = this.rainDrops;
      const count = this.activeRainDrops;
      // Advect the bounded local rain volume against the moving rickshaw. A
      // teleport resets the origin instead of spraying particles across town.
      const movedX = focus.x - this.rainFocusX, movedZ = focus.z - this.rainFocusZ;
      const riding = Number.isFinite(movedX) && Math.abs(movedX) < 12 && Math.abs(movedZ) < 12;
      const windX = (this.rainMode === 'dynamic' ? this.blend.wind * 5 : 1) * dt;
      const windZ = (this.rainMode === 'dynamic' ? this.blend.wind * 1.8 : 0) * dt;
      for (let i = 0; i < count; i++) {
        const fx = drops[i * 3] + windX - (riding ? movedX * 0.55 : 0);
        const fy = drops[i * 3 + 1] - this.rainVel[i] * dt;
        const fz = drops[i * 3 + 2] + windZ - (riding ? movedZ * 0.55 : 0);
        if (fy < 0) {
          drops[i * 3] = (Math.random() - 0.5) * 44;
          drops[i * 3 + 1] = 22 + Math.random() * 6;
          drops[i * 3 + 2] = (Math.random() - 0.5) * 44;
        } else {
          drops[i * 3] = fx > 22 ? fx - 44 : fx < -22 ? fx + 44 : fx;
          drops[i * 3 + 1] = fy;
          drops[i * 3 + 2] = fz > 22 ? fz - 44 : fz < -22 ? fz + 44 : fz;
        }
        const x = drops[i * 3];
        const y = drops[i * 3 + 1];
        const z = drops[i * 3 + 2];
        const len = 0.42 + this.rainVel[i] * 0.022;
        arr[i * 6] = x;
        arr[i * 6 + 1] = y;
        arr[i * 6 + 2] = z;
        arr[i * 6 + 3] = x + windX * 0.7 - (riding ? movedX * 0.2 : 0);
        arr[i * 6 + 4] = y - len;
        arr[i * 6 + 5] = z + windZ * 0.7 - (riding ? movedZ * 0.2 : 0);
      }
      pos.needsUpdate = true;
      this.rain.position.set(focus.x, 0, focus.z);
    }
    this.rainFocusX = focus.x;
    this.rainFocusZ = focus.z;
  }

  dispose(): void {
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    if (this.rain) {
      this.scene.remove(this.rain);
      this.rainGeo?.dispose();
      (this.rain.material as THREE.Material).dispose();
      this.rain = null;
    }
    for (const light of this.lamps) this.scene.remove(light);
    for (const sprite of this.glowSprites) {
      this.scene.remove(sprite);
      sprite.material.dispose();
    }
    this.scene.remove(this.playerFill);
  }
}
