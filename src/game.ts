/**
 * Game orchestration: renderer, Mohammadpur world, player rickshaw, traffic,
 * pedestrians, missions, procedural WebAudio, Dokan/Garage showroom and UI.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import {
  QUALITY,
  RIDE,
  WORLD,
  type CameraMode,
  type DayPhase,
  type QualityPreset,
  type WeatherKind,
} from './core/config';
import { clamp, clamp01, formatDistance, formatTaka, mulberry32 } from './core/mathx';
import { InputManager } from './core/input';
import { SettingsStore } from './core/settings';
import { GameState } from './core/gameState';
import { setLocale, t } from './core/i18n';
import { audio } from './audio/audio';
import { BanglaSpeechService } from './audio/speech';

import { buildCity, type CityResult } from './world/city';
import { buildProps, type VendorSpot } from './world/props';
import { DestructionSystem } from './world/destruction';
import { EnvironmentSystem } from './world/environment';
import { Showroom } from './world/showroom';
import { SignAtlas, releaseScratchCanvas, setTextureQuality } from './world/textures';
import {
  PLACES,
  findRoute,
  placeById,
  segmentById,
  snapToNearestRoad,
  surfaceAtWorld,
  type RoutePlan,
} from './world/layout';

import { RickshawVisual, lookFrom, type RickshawLook } from './vehicle/rickshawModel';
import { RickshawController } from './vehicle/rickshawController';
import { ChaseCamera, nextCameraMode } from './vehicle/chaseCamera';

import { TrafficSystem } from './ai/traffic';
import { PedestrianSystem } from './ai/pedestrians';
import { ROADRAGE_ESCAPED_TEXT, RoadRageSystem } from './ai/roadRage';

import { MissionSystem } from './missions/missionSystem';
import { dailySeed, dateKey, generateMission, type MissionOffer } from './missions/mission';
import { deriveVehicle } from './economy/economy';
import { cosmeticById, vehicleById, type CosmeticCategory } from './economy/catalog';

import { AppUI, type HudState, type UIBridge } from './ui/ui';
import { DevPerfOverlay } from './ui/perfOverlay';

export type Mode = 'menu' | 'duty' | 'free' | 'daily';

const PHASE_CYCLE: DayPhase[] = ['morning', 'noon', 'golden', 'blue', 'night'];

export class Game implements UIBridge {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: InputManager;
  readonly audio = audio;
  readonly settings: SettingsStore;
  readonly state: GameState;
  readonly ui: AppUI;
  readonly devPerf: DevPerfOverlay;

  private city: CityResult;
  private env: EnvironmentSystem;
  private destruction: DestructionSystem;
  private vendorSpots: VendorSpot[];
  private speech: BanglaSpeechService;
  private roadRage: RoadRageSystem;
  private tanWindLines: THREE.LineSegments;
  private traffic: TrafficSystem;
  private peds: PedestrianSystem;
  private player: RickshawVisual;
  private controller: RickshawController;
  private chase: ChaseCamera;
  private missions: MissionSystem;
  private showroom: Showroom;
  private signAtlas: SignAtlas;

  private mode: Mode = 'menu';
  private paused = false;
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private menuTime = 0;
  private pendingOffer: MissionOffer | null = null;
  private currentOffer: MissionOffer | null = null;
  private frameCount = 0;
  private lastSave = 0;
  private lastImpactAt = 0;
  private bellCooldown = 0;
  private teaCooldown = 0;
  private freeRidePoiCooldown = 0;
  private showroomVisible = false;
  private envMap: THREE.Texture | null = null;
  private hudTick = 0;
  private routeTick = 0;
  private activeRoute: RoutePlan | null = null;
  private jammedList: string[] = [];
  private detourToastCooldown = 0;
  private idleTimer = 0;
  private debugInput: { throttle: number; steer: number; brake: number } | null = null;
  private debugFreeCamera = false;

  // Pre-allocated scratch vectors for zero per-frame GC churn
  private tmpPlayerVec = new THREE.Vector3();
  private tmpProjVec = new THREE.Vector3();
  private tmpMenuTarget = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    const storage = safeStorage();
    this.settings = new SettingsStore(storage);
    this.state = new GameState(storage);
    setLocale(this.settings.get().language);

    const initialQuality = QUALITY[this.settings.get().quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: initialQuality.antialias && this.settings.get().quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = initialQuality.shadows && this.settings.get().shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.15, 360);
    this.scene.add(this.camera);

    this.env = new EnvironmentSystem(this.scene, initialQuality);
    this.signAtlas = new SignAtlas();
    this.city = buildCity(this.signAtlas, initialQuality);
    this.scene.add(this.city.group);
    this.env.setLampPositions(this.city.lampPositions);
    this.env.onWetnessChange = (wet) => this.city.setWetness(wet);
    this.env.onPhaseChange = (phase) => this.city.setNight(phase === 'night' || phase === 'blue');

    const props = buildProps(this.signAtlas);
    this.scene.add(props.group);
    this.city.registerShadowCasters(props.group);
    this.city.colliders.push(...props.colliders);
    this.vendorSpots = props.vendorSpots;
    this.audio.setVendorSpots(props.vendorSpots);
    releaseScratchCanvas();

    this.destruction = new DestructionSystem((x, z) => this.city.heightAt(x, z));
    this.destruction.registerProps(this.city.breakableLamps, this.city.lampPositions);
    this.destruction.registerProps(props.breakableStalls);
    this.scene.add(this.destruction.group);
    this.destruction.onBreak = (prop, impactSpeed) => {
      this.audio.playBreakableCrash(prop.kind === 'lamp' ? 'lamp' : 'stall');
      this.chase.addTrauma(clamp(impactSpeed * 0.045, 0.14, 0.42));
      if (this.settings.get().haptics && navigator.vibrate) {
        navigator.vibrate(35);
      }
    };

    // Pooled 1-draw-call radial motion-streak lines attached to camera for `টান` speed boost
    this.tanWindLines = buildTanWindLines();
    this.camera.add(this.tanWindLines);

    this.traffic = new TrafficSystem(initialQuality, (x, z) => this.city.heightAt(x, z));
    this.scene.add(this.traffic.group);
    this.traffic.onHorn = (x, z, kind) =>
      this.audio.trafficHorn(x - this.controller.x, z - this.controller.z, kind);

    this.peds = new PedestrianSystem(initialQuality);
    this.scene.add(this.peds.group);

    this.controller = new RickshawController(
      this.city.colliders,
      (x, z) => this.city.heightAt(x, z),
      (x, z) => surfaceAtWorld(x, z),
    );
    this.controller.stamina = this.state.progress.stamina;
    this.controller.onBreakableHit = (id, impactSpeed, x, z, yaw) =>
      this.destruction.tryBreak(id, impactSpeed, x, z, yaw);
    this.controller.onTanAutoStop = (reason) => {
      this.audio.setTanBoost(false);
      this.ui.toast(t(reason === 'battery' ? 'toast.tanLowBattery' : 'toast.tanEmpty'), 'bad');
    };

    this.speech = new BanglaSpeechService(this.audio);
    this.roadRage = new RoadRageSystem(this.scene, this.traffic, this.speech, this.audio, {
      heightAt: (x, z) => this.city.heightAt(x, z),
      getDialogueSettings: () => {
        const s = this.settings.get();
        return {
          volume: s.dialogue * s.master,
          muted: s.muted || !s.sfxEnabled,
          subtitles: s.subtitles,
        };
      },
      onAlertBanner: (head, sub, sec) => this.ui.setRoadRageBanner(head, sub, sec),
      onSubtitle: (speakerKey, banglaLine) => this.ui.showRoadRageSubtitle(speakerKey, banglaLine),
      onEscaped: () => {
        this.ui.toast(ROADRAGE_ESCAPED_TEXT, 'good');
        this.audio.successStinger();
      },
      onOpenConfrontation: () => {
        this.controller.speed = 0;
        this.controller.setTanActive(false);
        this.audio.setTanBoost(false);
        this.ui.openRoadRageConfrontation();
      },
      onCloseConfrontation: () => {
        this.ui.closeRoadRageConfrontation();
      },
      onScuffleStart: () => {
        this.audio.playScuffle();
        this.chase.addTrauma(0.58);
        this.ui.toast(t('roadrage.scuffleAlert'), 'bad');
      },
      onScuffleComplete: () => {
        this.controller.applyScufflePenalty();
        this.state.progress.stamina = this.controller.stamina;
        this.state.damageCondition(6);
        if (this.missions.state === 'toDropoff') this.missions.registerImpact(1.1);
        this.state.saveNow();
      },
    });

    this.player = new RickshawVisual(this.state.vehicle(), this.currentLook());
    this.scene.add(this.player.root);

    this.chase = new ChaseCamera(this.camera);
    this.missions = new MissionSystem({
      scene: this.scene,
      rickshaw: this.player.root,
      seatAnchor: this.player.seatAnchor,
      playerX: () => this.controller.x,
      playerZ: () => this.controller.z,
      playerSpeed: () => this.controller.speed,
      wet: false,
    });

    // Showroom is lazy-built on first Garage/Dokan open (0 MB cost during street play!)
    this.showroom = new Showroom();

    this.input = new InputManager();
    this.input.attach();
    this.input.setSensitivity(this.settings.get().sensitivity);
    this.input.setDeadzone(this.settings.get().deadzone);
    this.input.onPause = () => this.togglePause();
    this.input.onCamera = () => this.toggleCamera();
    this.input.onRecover = () => this.recoverRickshaw();
    this.input.onHorn = () => this.ringBell();
    this.input.onTanToggle = () => this.toggleTanBoost();
    this.input.onTeaInteract = () => {
      if (this.isTeaRestAvailable(this.state.vehicle().kind === 'electric')) {
        this.buyRoadsideTea();
      }
    };

    this.ui = new AppUI(this, this.state, this.settings);
    this.devPerf = new DevPerfOverlay();
    this.input.onDevPerf = () => {
      this.devPerf.toggle();
    };
    (window as unknown as { __btToggleDevPerf?: () => boolean }).__btToggleDevPerf = () => this.devPerf.toggle();

    // Pedestrian near-miss & bump Bengali reactions
    this.peds.onReaction = (ev) => {
      this.tmpProjVec.set(ev.x, ev.y, ev.z).project(this.camera);
      if (this.tmpProjVec.z < 1) {
        const sx = (this.tmpProjVec.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-this.tmpProjVec.y * 0.5 + 0.5) * window.innerHeight;
        this.ui.showPedestrianCallout(sx, sy, ev.textKey);
      }
      this.audio.pedestrianShout();
      if (ev.kind === 'bump') {
        this.controller.speed *= 0.68;
        this.chase.addTrauma(0.14);
        this.missions.registerImpact(0.75);
      }
    };

    this.missions.on('started', (offer) => {
      this.currentOffer = offer;
      const pk = placeById(offer.pickupId) ?? null;
      this.ui.setMinimapMarker(pk);
      this.recomputeRoute(pk);
      this.ui.hideJobOffer();
    });
    this.missions.on('boarded', (offer) => {
      this.ui.toast(t('toast.pickup'), 'good');
      const dp = placeById(offer.dropId) ?? null;
      this.ui.setMinimapMarker(dp);
      this.recomputeRoute(dp);
      this.state.progress.weather = this.env.getWeather();
    });
    this.missions.on('completed', (result) => {
      this.currentOffer = null;
      this.activeRoute = null;
      this.finishRide(result);
    });
    this.missions.on('dialogue', (d) => {
      this.ui.showDialogue(d.who, d.key);
      this.audio.setVolumes({ dialogue: this.settings.get().dialogue });
    });
    this.missions.on('hint', () => undefined);
    this.missions.on('mood', () => undefined);

    this.state.on('saved', () => undefined);
    this.state.on('achievement', (id) => {
      this.ui.toast(`${t('toast.unlock', { name: t(id) })}`, 'good');
      this.audio.uiConfirm();
    });
    this.state.on('unlock', (id) => {
      this.ui.toast(
        t('toast.tape', {
          name: t(id === 'radio' ? 'tape.radio' : id === 'brishti' ? 'tape.brishti' : 'tape.cassette'),
        }),
        'good',
      );
      this.audio.setTrack(id === 'brishti' ? 'brishti' : id === 'radio' ? 'radio' : 'cassette');
    });

    this.applySettings();
    this.placeForMenu();

    this.showroom.attachPointer(this.renderer.domElement);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => window.setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode !== 'menu' && !this.paused) this.togglePause();
      if (document.hidden) this.state.saveNow();
    });

    this.resize();
  }

  // ------------------------------------------------------------- lifecycle
  async init(): Promise<void> {
    await document.fonts.ready;
    try {
      await document.fonts.load('700 24px "Hind Siliguri"');
      await document.fonts.load('600 16px "Hind Siliguri"');
    } catch {
      /* font loading is best-effort */
    }
    this.signAtlas.redrawAll();

    if (this.settings.get().quality !== 'low') {
      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const room = new RoomEnvironment();
        const envTex = pmrem.fromScene(room, 0.04).texture;
        this.envMap = envTex;
        this.scene.environment = envTex;
        this.scene.environmentIntensity = 0.52;
        pmrem.dispose();
        room.dispose?.();
      } catch (err) {
        console.warn('[game] environment map unavailable', err);
      }
    }
    this.prewarmStreetShaders();
    this.ui.hideLoading();
  }

  /**
   * Compile and warm all street, instanced-vehicle, pedestrian, mission-beacon,
   * passenger, night-glow, and monsoon-rain GPU pipelines once behind the boot
   * loading screen so turning the camera, starting missions, or entering dusk/rain
   * never stalls gameplay on ARM Mali Bifrost or Vulkan/ANGLE drivers!
   */
  private prewarmStreetShaders(): void {
    try {
      const culledRestore: THREE.Object3D[] = [];
      this.scene.traverse((obj) => {
        if (obj.frustumCulled) {
          obj.frustumCulled = false;
          culledRestore.push(obj);
        }
      });
      this.renderer.setSize(64, 64, false);
      try {
        this.env.withPrewarmState(() => {
          this.city.withPrewarmState(() => {
            this.missions.withPrewarmState(() => {
              this.traffic.withPrewarmState(() => {
                this.destruction.withPrewarmState(() => {
                  this.roadRage.withPrewarmState(() => {
                    this.tanWindLines.visible = true;
                    this.player.setNightLighting(true);
                    try {
                      this.renderer.compile(this.scene, this.camera);
                      this.renderer.render(this.scene, this.camera);
                    } finally {
                      this.tanWindLines.visible = false;
                      this.player.setNightLighting(false);
                    }
                  });
                });
              });
            });
          });
        });
      } finally {
        for (let i = 0; i < culledRestore.length; i++) {
          culledRestore[i].frustumCulled = true;
        }
        this.resize();
      }
    } catch (err) {
      console.warn('[game] shader prewarm skipped', err);
      this.resize();
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.settings.get().quality].pixelRatioCap);
    const scale = this.settings.get().renderScale;
    this.renderer.setPixelRatio(clamp(dpr * scale, 0.5, 2.25));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.showroom.resize(width / Math.max(1, height));
  }

  private frame(time: number): void {
    const rawDt = (time - this.lastTime) / 1000;
    this.lastTime = time;
    const dt = clamp(rawDt, 0, 0.1);
    this.frameCount++;

    const frameBudget = 1 / this.settings.get().fpsTarget;
    if (this.settings.get().fpsTarget === 30 && rawDt < frameBudget * 0.82) {
      this.render();
      return;
    }

    if (!this.paused) this.update(dt);
    else this.audio.setVehicleSpeed(0, 0);

    this.render();
    this.updatePerf(dt);
  }

  private render(): void {
    this.devPerf.beginGpuSample(this.renderer);
    if (this.showroomVisible) {
      const prevExp = this.renderer.toneMappingExposure;
      this.renderer.toneMappingExposure = 1.18;
      this.renderer.render(this.showroom.scene, this.showroom.camera);
      this.renderer.toneMappingExposure = prevExp;
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.devPerf.endGpuSample(this.renderer);
  }

  private update(dt: number): void {
    this.menuTime += dt;
    this.detourToastCooldown = Math.max(0, this.detourToastCooldown - dt);
    this.teaCooldown = Math.max(0, this.teaCooldown - dt);
    const settings = this.settings.get();

    if (this.showroomVisible) {
      this.audio.setSceneMode('menu');
      this.showroom.update(dt);
      return;
    }

    const q = QUALITY[settings.quality];
    this.audio.setSceneMode(this.mode === 'menu' ? 'menu' : 'driving');
    this.audio.update(dt, this.controller.x, this.controller.z);
    this.tmpPlayerVec.set(this.controller.x, 0, this.controller.z);
    this.env.update(dt, this.tmpPlayerVec);
    this.destruction.update(dt);
    this.city.updateShadowFocus(
      this.controller.x,
      this.controller.z,
      q.shadowDistance,
      settings.shadows && q.shadows,
    );
    this.traffic.setPlayer(this.controller.x, this.controller.z, this.controller.speed);
    this.traffic.update(dt);
    this.peds.update(dt, this.controller.x, this.controller.z, this.controller.speed, this.controller.yaw);

    if (this.mode === 'menu') {
      this.tanWindLines.visible = false;
      if (!this.debugFreeCamera) this.updateMenuCamera(dt);
      const menuGround = this.city.heightAt(this.controller.x, this.controller.z);
      this.player.root.position.set(this.controller.x, menuGround, this.controller.z);
      this.player.updateVisual(dt, 0, 0, 0, 0, menuGround, 0);
      this.player.setNightLighting(false);
      this.ui.setMinimapPlayer(this.controller.x, this.controller.z, this.controller.yaw);
      return;
    }

    const sampled = this.input.sample();
    const rawInput = this.debugInput ? { ...sampled, ...this.debugInput, horn: false } : sampled;
    const lockedByRage = this.roadRage.isControlLocked;
    const input = lockedByRage
      ? { throttle: 0, brake: 1, steer: 0, horn: false }
      : rawInput;
    const wetness = this.env.wetness;
    const derived = deriveVehicle(
      this.state.vehicle(),
      this.state.progress.upgrades,
      this.state.progress.condition,
      wetness,
    );
    this.controller.setTuning({
      maxSpeed: derived.maxSpeed,
      accel: derived.accel,
      brakeDecel: derived.brakeDecel,
      steerMaxLow: derived.steerMaxLow,
      steerMaxHigh: derived.steerMaxHigh,
      steerRateMultiplier: derived.steerRateMultiplier,
      grip: derived.grip,
      roughSurfaceKeep: derived.roughSurfaceKeep,
      rollingDragScale: derived.rollingDragScale,
      isElectric: derived.isElectric,
      batteryDrainMultiplier: derived.batteryDrainMultiplier,
      regenFactor: derived.regenFactor,
    });
    this.audio.setElectricMode(derived.isElectric);
    this.audio.setTanBoost(this.controller.tanActive);

    // -------- fixed-step 60 Hz vehicle physics
    this.accumulator += dt;
    const stepSize = 1 / 60;
    let steps = 0;
    let totalImpact = 0;
    let lastImpactX = 0;
    let lastImpactZ = 0;
    let steppedDistance = 0;
    let onSidewalk = false;
    while (this.accumulator >= stepSize && steps < 4) {
      const events = this.controller.step(
        stepSize,
        { throttle: input.throttle, brake: input.brake, steer: input.steer, handbrake: false },
        settings.sensitivity,
        settings.deadzone,
      );
      if (events.impact > 0.35) {
        totalImpact = Math.max(totalImpact, events.impact);
        lastImpactX = events.impactX;
        lastImpactZ = events.impactZ;
      }
      steppedDistance += events.distance;
      onSidewalk = events.onSidewalk;
      this.accumulator -= stepSize;
      steps++;
    }
    if (lockedByRage) {
      this.controller.speed = 0;
      if (this.roadRage.currentState === 'scuffling') {
        this.chase.addTrauma(0.06);
      }
    }
    this.state.progress.stamina = this.controller.stamina;

    const trafficImpact = this.resolveTrafficCollisions();
    if (trafficImpact > totalImpact) totalImpact = trafficImpact;
    if (onSidewalk && steppedDistance > 0) this.chase.addTrauma(0.03);

    this.handleImpact(totalImpact, lastImpactX, lastImpactZ);
    this.roadRage.update(dt, this.controller.x, this.controller.z);

    // -------- pooled `টান` motion streaks + FOV surge
    const boostVisual =
      this.controller.tanActive && this.controller.speed > derived.maxSpeed * 0.72
        ? clamp01((this.controller.speed - derived.maxSpeed * 0.72) / Math.max(1, derived.maxSpeed * 0.9))
        : 0;
    this.chase.setBoostAmount(boostVisual);
    if (!settings.reduceEffects && boostVisual > 0.08) {
      this.tanWindLines.visible = true;
      this.tanWindLines.rotation.z = (this.menuTime * 9.5) % (Math.PI * 2);
    } else {
      this.tanWindLines.visible = false;
    }

    // -------- visuals (YXZ Euler order + true steerAngle & slope pitch!)
    const lateral = this.controller.lateralAccel;
    this.player.root.position.set(this.controller.x, this.controller.y, this.controller.z);
    this.player.root.rotation.y = this.controller.yaw;
    this.player.root.rotation.x = this.controller.pitch;
    this.player.root.rotation.z = this.controller.roll;
    this.player.setCockpitVisibility(settings.cameraMode === 'cockpit');
    this.player.updateVisual(
      dt,
      this.controller.speed,
      this.controller.steerAngle,
      input.throttle,
      lateral,
      this.controller.y,
      this.controller.pitch,
    );
    this.player.setNightLighting(this.env.getPhase() === 'night' || this.env.getPhase() === 'blue', 1);

    // -------- 7-mode NFS MW camera
    this.chase.setMode(settings.cameraMode);
    this.chase.setShakeEnabled(settings.cameraShake);
    this.chase.setReduceMotion(settings.reduceEffects);
    if (!this.debugFreeCamera) {
      this.chase.update(
        dt,
        this.controller.x,
        this.controller.z,
        this.controller.yaw,
        this.controller.speed,
        this.city.colliders,
        this.controller.speed < -0.35,
        this.controller.y,
        this.traffic.obstacles(),
      );
    }

    // -------- missions & live jam-aware route guidance
    this.missions.update(dt, this.controller.speed);
    this.routeTick += dt;
    if (this.routeTick >= 1.0) {
      this.routeTick = 0;
      this.jammedList = this.traffic.getJammedSegments();
      this.recomputeRoute(this.missions.zone);
    }

    if ((this.mode === 'duty' || this.mode === 'daily') && this.missions.state === 'none' && !this.pendingOffer) {
      this.idleTimer += dt;
      if (this.idleTimer > 1.6) {
        this.idleTimer = 0;
        this.requestJob(this.mode === 'daily');
      }
    } else {
      this.idleTimer = 0;
    }
    if (this.mode === 'free' && this.currentOffer === null) this.freeRideInteractions(dt);
    if (input.horn) this.ringBell();

    // -------- audio
    this.audio.setVehicleSpeed(this.controller.speed, input.throttle);
    this.audio.setRain(this.env.getWeather() === 'rain' ? 1 : 0, wetness);
    this.audio.setCrowd(clamp01(this.peds.activePedestrianCount / 75));

    // -------- HUD
    this.hudTick += dt;
    this.updateHud(derived.isElectric);

    // -------- persistence
    this.lastSave += dt;
    if (this.lastSave > 20) {
      this.lastSave = 0;
      this.state.setSpawn(this.controller.x, this.controller.z, this.controller.yaw);
      this.state.saveNow();
    }
    this.state.progress.distanceTravelled += steppedDistance;
  }

  private lastRouteKey = '';

  private recomputeRoute(target: { x: number; z: number } | null): void {
    if (!target) {
      this.activeRoute = null;
      this.lastRouteKey = '';
      return;
    }
    const startSnap = snapToNearestRoad(this.controller.x, this.controller.z);
    const key = `${startSnap.segment.id}|${Math.round(target.x)}|${Math.round(target.z)}|${this.traffic.congestionEpoch}`;
    if (key === this.lastRouteKey && this.activeRoute) return;
    this.lastRouteKey = key;

    const plan = findRoute(this.controller.x, this.controller.z, target.x, target.z, (segId) =>
      this.traffic.getCongestionMultiplier(segId),
    );
    if (plan.avoidedJam && !this.activeRoute?.avoidedJam && this.detourToastCooldown <= 0) {
      this.detourToastCooldown = 18;
      this.missions.detourBonusEarned = true;
      this.ui.toast(t('hud.detour'), 'good');
    }
    this.activeRoute = plan;
  }

  private updateMenuCamera(dt: number): void {
    const focus = this.player.root.position;
    const tNow = this.menuTime;
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    const angle = 0.55 + Math.sin(tNow * 0.085) * 0.5;
    const radius = portrait ? 8.2 : 7.0;
    this.tmpMenuTarget.set(
      focus.x + Math.sin(angle) * radius,
      focus.y + (portrait ? 3.4 : 2.15) + Math.sin(tNow * 0.31) * 0.08,
      focus.z + Math.cos(angle) * radius,
    );
    this.camera.position.lerp(this.tmpMenuTarget, 1 - Math.exp(-2.4 * dt));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(focus.x, focus.y + (portrait ? 1.55 : 1.0), focus.z);
    const shift = portrait ? 0 : 0.2;
    this.camera.rotateY(shift * 0.9);
    this.camera.rotateX(portrait ? -0.11 : -0.04);
    const targetFov = portrait ? 54 : 48;
    if (this.camera.fov !== targetFov) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }
  }

  // --------------------------------------------------------------- actions
  startMode(mode: 'duty' | 'free' | 'daily'): void {
    void this.audio.init();
    this.roadRage.cancel();
    if (this.showroomVisible) this.showroomVisible = false;
    this.mode = mode;
    this.paused = false;
    this.audio.setSceneMode('driving');
    this.state.setMode(mode);
    this.chooseAtmosphere(mode);
    this.respawnPlayer();
    this.ui.show('hud');
    this.ui.applyControlLayout();
    this.ui.setResultReturnTo('game');
    this.currentOffer = null;
    this.activeRoute = null;
    if (mode === 'free') {
      this.ui.toast(t('toast.freeRide'));
      this.missions.cancel();
      this.state.setMode('free');
    } else {
      this.requestJob(mode === 'daily');
    }
    this.state.saveNow();
  }

  private chooseAtmosphere(mode: Mode): void {
    const rides = this.state.progress.rides;
    let phase: DayPhase = PHASE_CYCLE[rides % PHASE_CYCLE.length];
    let weather: WeatherKind = rides > 0 && rides % 5 === 4 ? 'overcast' : 'clear';
    if (mode === 'daily') {
      const seed = dailySeed(new Date());
      phase = PHASE_CYCLE[seed % PHASE_CYCLE.length];
      weather = seed % 2 === 0 ? 'rain' : 'overcast';
    }
    this.env.setPhase(phase);
    this.env.setWeather(weather);
    this.state.progress.dayPhase = phase;
    this.state.progress.weather = weather;
  }

  private respawnPlayer(): void {
    const spawn = this.state.progress.spawn ?? {
      x: WORLD.playerSpawn.x,
      z: WORLD.playerSpawn.z,
      yaw: WORLD.playerSpawn.yaw,
    };
    const snapped = snapToNearestRoad(spawn.x, spawn.z, false);
    const yaw = Number.isFinite(spawn.yaw) ? spawn.yaw : snapped.yaw;
    this.controller.reset(snapped.x, snapped.z, yaw);
    this.player.root.position.set(snapped.x, this.controller.y, snapped.z);
    this.chase.snapTo(snapped.x, snapped.z, yaw, this.controller.y);
    this.ui.setMinimapPlayer(snapped.x, snapped.z, yaw);
  }

  requestJob(daily = false): void {
    const seed = daily ? dailySeed(new Date()) : Math.floor(Math.random() * 1e9);
    const rng = mulberry32(seed);
    const nearest = this.nearestPlaceId();
    const nearestPlace = placeById(nearest);
    const tooClose = nearestPlace
      ? Math.hypot(nearestPlace.x - this.controller.x, nearestPlace.z - this.controller.z) < 22
      : true;
    const offer = generateMission({
      rng,
      fromPlaceId: tooClose ? undefined : nearest,
      wet: this.env.getWeather() === 'rain',
      daily,
      seed,
      maxDistance: daily ? 540 : 620,
    });
    this.pendingOffer = offer;
    const pickup = placeById(offer.pickupId) ?? null;
    this.ui.setMinimapMarker(pickup);
    this.recomputeRoute(pickup);
    this.ui.showJobOffer(
      offer,
      t(offer.pickupName),
      t(offer.dropName),
      () => {
        this.acceptOffer(offer);
      },
      () => {
        this.pendingOffer = null;
        this.activeRoute = null;
        this.ui.hideJobOffer();
        this.ui.setMinimapMarker(null);
      },
    );
  }

  private acceptOffer(offer: MissionOffer): void {
    this.pendingOffer = null;
    this.missions.start(offer);
    this.ui.hideJobOffer();
  }

  nextJob(): void {
    this.mode = this.mode === 'daily' ? 'daily' : 'duty';
    this.ui.show('hud');
    this.requestJob(this.mode === 'daily');
  }

  enterFreeRide(): void {
    this.mode = 'free';
    this.missions.cancel();
    this.activeRoute = null;
    this.ui.show('hud');
    this.ui.toast(t('toast.freeRide'));
  }

  pauseGame(): void {
    if (this.paused || this.mode === 'menu') return;
    this.togglePause(true);
  }

  handleBackButton(): boolean {
    return this.ui.handleBackAction();
  }

  private togglePause(force?: boolean): void {
    if (this.mode === 'menu') return;
    if (this.roadRage.isControlLocked) return;
    const next = force ?? !this.paused;
    if (next === this.paused) return;
    this.paused = next;
    if (this.paused) {
      this.ui.showPause(0);
      this.audio.setSceneMode('paused');
      this.audio.setVehicleSpeed(0, 0);
    } else {
      this.audio.setSceneMode('driving');
      this.ui.show('hud');
    }
  }

  resumeGame(): void {
    if (!this.paused) {
      this.ui.show('hud');
      return;
    }
    this.paused = false;
    this.audio.setSceneMode('driving');
    this.ui.show('hud');
  }

  restartMission(): void {
    this.paused = false;
    this.roadRage.cancel();
    this.audio.setSceneMode('driving');
    this.missions.cancel();
    this.respawnPlayer();
    this.ui.show('hud');
    this.requestJob(this.mode === 'daily');
  }

  recoverRickshaw(): void {
    if (this.roadRage.isControlLocked) return;
    this.roadRage.cancel(8);
    const free = this.mode === 'free';
    const fee = free ? 0 : 45;
    if (fee > 0) this.state.spend(fee);
    const snapped = snapToNearestRoad(this.controller.x, this.controller.z, false);
    let rx = snapped.x;
    let rz = snapped.z;
    const seg = snapped.segment;
    const fx = Math.sin(snapped.yaw);
    const fz = Math.cos(snapped.yaw);
    const baseAlong = (snapped.x - seg.ax) * seg.ux + (snapped.z - seg.az) * seg.uz;
    // Ensure recovery places the player well inside the road segment and clear of traffic
    for (const shift of [0, -8, 8, -16, 16, -24, 24, -32, 32]) {
      const along = clamp(baseAlong + shift, Math.min(12, seg.length * 0.3), Math.max(seg.length - 12, seg.length * 0.7));
      const cx = seg.ax + seg.ux * along;
      const cz = seg.az + seg.uz * along;
      if (this.traffic.isClearForRecovery(cx, cz, fx, fz)) {
        rx = cx;
        rz = cz;
        break;
      }
    }
    this.controller.reset(rx, rz, snapped.yaw);
    this.chase.snapTo(rx, rz, snapped.yaw, this.controller.y);
    this.player.root.position.set(rx, this.controller.y, rz);
    this.ui.toast(t('toast.recovered'), 'good');
    this.audio.uiConfirm();
    if (this.paused) {
      this.paused = false;
      this.ui.show('hud');
    }
  }

  returnToMenu(): void {
    this.roadRage.cancel();
    this.tanWindLines.visible = false;
    this.controller.setTanActive(false);
    this.audio.setTanBoost(false);
    this.audio.setSceneMode('menu');
    this.state.setSpawn(this.controller.x, this.controller.z, this.controller.yaw);
    this.state.saveNow();
    this.missions.cancel();
    this.pendingOffer = null;
    this.activeRoute = null;
    this.ui.hideJobOffer();
    this.ui.setMinimapMarker(null);
    this.mode = 'menu';
    this.paused = false;
    this.player.setCockpitVisibility(false);
    this.ui.show('menu');
    this.showroomVisible = false;
    this.placeForMenu();
  }

  private placeForMenu(): void {
    this.mode = 'menu';
    const stand = placeById('stand');
    const x = stand ? stand.x : WORLD.playerSpawn.x;
    const z = stand ? stand.z : WORLD.playerSpawn.z;
    const yaw = stand ? stand.heading : WORLD.playerSpawn.yaw;
    this.controller.reset(x, z, yaw);
    this.player.root.position.set(x, this.controller.y, z);
    this.player.root.rotation.set(this.controller.pitch, yaw, 0, 'YXZ');
    this.player.setCockpitVisibility(false);
    this.player.setNightLighting(false);
    this.camera.position.set(x + 4.2, this.controller.y + 2.5, z + 4.2);
    this.camera.lookAt(x, this.controller.y + 1.1, z);
  }

  // --------------------------------------------------- garage & Dokan showroom
  openGarage(from: 'menu' | 'pause' | 'result'): void {
    void from;
    this.refreshShowroom();
    this.showroomVisible = true;
  }

  openShowroomFromMenu(): void {
    this.refreshShowroom();
    this.showroomVisible = true;
  }

  previewVehicleInShowroom(vehicleId: string): void {
    const v = vehicleById(vehicleId);
    const look = lookFrom(v, this.state.progress.cosmetics, undefined, this.state.progress.upgrades);
    this.showroom.setRickshaw(v, look);
  }

  closeGarage(): void {
    this.showroomVisible = false;
    this.refreshPlayerLook();
    if (this.mode === 'menu') this.ui.show('menu');
    else this.ui.show(this.paused ? 'pause' : 'hud');
  }

  setShowroomVisible(visible: boolean): void {
    if (visible) {
      this.refreshShowroom();
      this.showroomVisible = true;
    } else {
      this.showroomVisible = false;
      this.refreshPlayerLook();
    }
  }

  rotateShowroom(dx: number): void {
    this.showroom.drag(dx);
  }

  setTrack(track: 'cassette' | 'radio' | 'brishti'): void {
    this.audio.setTrack(track);
  }

  private showroomWarmed = false;

  private refreshShowroom(): void {
    if (this.envMap && !this.showroom.scene.environment) {
      this.showroom.scene.environment = this.envMap;
      this.showroom.scene.environmentIntensity = 0.85;
    }
    this.showroom.setRickshaw(this.state.vehicle(), this.currentLook());
    if (!this.showroomWarmed) {
      this.showroomWarmed = true;
      try {
        this.renderer.setSize(64, 64, false);
        this.renderer.compile(this.showroom.scene, this.showroom.camera);
        this.renderer.render(this.showroom.scene, this.showroom.camera);
      } finally {
        this.resize();
      }
    }
  }

  private refreshPlayerLook(): void {
    this.player.applyLook(this.currentLook(), this.state.vehicle());
  }

  private currentLook(): RickshawLook {
    return lookFrom(
      this.state.vehicle(),
      this.state.progress.cosmetics as Record<CosmeticCategory, string>,
      undefined,
      this.state.progress.upgrades,
    );
  }

  // ---------------------------------------------------------------- rides
  private finishRide(result: {
    offer: MissionOffer;
    fare: ReturnType<typeof import('./economy/economy').computeFare>;
    distance: number;
    time: number;
    mood: number;
  }): void {
    const damage = this.controller.hits;
    this.state.recordRide({
      earned: result.fare.total,
      distance: result.distance,
      mood: result.mood,
      damage,
      mode: this.mode === 'free' ? 'free' : this.mode === 'daily' ? 'daily' : 'duty',
      wet: this.env.getWeather() === 'rain',
    });
    if (result.offer.daily) {
      this.state.progress.dailyDoneDate = dateKey(new Date());
    }
    this.state.setSpawn(this.controller.x, this.controller.z, this.controller.yaw);
    this.state.saveNow();
    this.ui.setMinimapMarker(null);
    this.ui.setResultReturnTo('game');
    this.ui.showResult({
      fare: result.fare,
      offer: result.offer,
      distance: result.distance,
      time: result.time,
      daily: result.offer.daily,
      unlock: this.state.progress.tapes.length > 1 ? t('tape.radio') : null,
      onNext: () => this.nextJob(),
      onFree: () => this.enterFreeRide(),
      onGarage: () => {
        this.ui.setResultReturnTo('menu');
        this.ui.openGarage('result');
      },
    });
    this.controller.hits = 0;
  }

  dailyAvailable(): boolean {
    return this.state.progress.dailyDoneDate !== dateKey(new Date());
  }

  // --------------------------------------------------------------- impact & bell
  private handleImpact(magnitude: number, nx: number, nz: number): void {
    if (magnitude <= 0.35) return;
    const now = performance.now();
    if (now - this.lastImpactAt < 220) return;
    this.lastImpactAt = now;
    this.chase.addTrauma(clamp(magnitude * 0.22, 0.05, 0.65));
    this.audio.bump(magnitude);
    if (this.settings.get().haptics && navigator.vibrate) {
      navigator.vibrate(Math.round(clamp(magnitude * 28, 10, 65)));
    }
    this.missions.registerImpact(magnitude);
    const durabilityReduction = deriveVehicle(
      this.state.vehicle(),
      this.state.progress.upgrades,
      this.state.progress.condition,
      this.env.wetness,
    ).damageMultiplier;
    this.state.damageCondition(magnitude * RIDE.conditionLossPerHit * durabilityReduction);
    if (this.controller.hardBrakes > 0) {
      this.missions.registerHardBrake();
      this.controller.hardBrakes = 0;
    }
    void nx;
    void nz;
  }

  private ringBell(): void {
    if (performance.now() - this.bellCooldown < 240) return;
    this.bellCooldown = performance.now();
    const bell = this.currentLook().bell;
    this.audio.bell(bell);
    this.peds.alertBell(this.controller.x, this.controller.z);
    this.traffic.reactToBell(this.controller.x, this.controller.z);
  }

  private resolveTrafficCollisions(): number {
    const obstacles = this.traffic.obstacles();
    let impact = 0;
    const preSpeed = this.controller.speed;
    const pVx = Math.sin(this.controller.yaw) * preSpeed;
    const pVz = Math.cos(this.controller.yaw) * preSpeed;

    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      const dx = this.controller.x - ob.x;
      const dz = this.controller.z - ob.z;
      const dist = Math.hypot(dx, dz);
      const minDist = ob.radius + RIDE.bodyRadius * 0.84;
      if (dist < minDist && dist > 0.0001) {
        const oVx = Math.sin(ob.yaw) * ob.speed;
        const oVz = Math.cos(ob.yaw) * ob.speed;
        const relSpeed = Math.hypot(pVx - oVx, pVz - oVz);

        const push = (minDist - dist) / dist;
        this.controller.x += dx * push;
        this.controller.z += dz * push;
        const speedLoss = Math.min(Math.abs(this.controller.speed), 2.2);
        this.controller.speed *= 0.35;
        const hitImpact = Math.max(speedLoss * 0.5 + 0.2, relSpeed * 0.26);
        impact = Math.max(impact, hitImpact);

        // Milestone 2: High-impact collision with a private passenger car (`car` ONLY)
        if (ob.kind === 'car' && (Math.abs(preSpeed) >= 4.0 || relSpeed >= 4.2)) {
          this.roadRage.tryStart(ob.agentIndex, this.controller.x, this.controller.z);
        }
      }
    }
    return impact;
  }

  // ------------------------------------------------ টান boost, tea rest & road rage
  toggleTanBoost(): void {
    if (this.mode === 'menu' || this.paused || this.roadRage.isControlLocked) return;
    const next = !this.controller.tanActive;
    const isElectric = this.state.vehicle().kind === 'electric';
    if (next) {
      const ok = this.controller.setTanActive(true);
      if (!ok) {
        this.audio.uiError();
        this.ui.toast(t(isElectric ? 'toast.tanLowBattery' : 'toast.tanLowRecovering'), 'bad');
        return;
      }
      this.audio.setTanBoost(true);
      this.audio.playTanBoost();
    } else {
      this.controller.setTanActive(false);
      this.audio.setTanBoost(false);
      this.audio.uiTap();
    }
    this.hudTick = 1;
    this.updateHud(isElectric);
  }

  private isTeaRestAvailable(isElectric: boolean): boolean {
    if (this.mode === 'menu' || this.paused || this.roadRage.isActive || this.teaCooldown > 0) return false;
    if (Math.abs(this.controller.speed) > 0.95) return false;
    if (!isElectric && this.controller.stamina >= 95) return false;
    if (isElectric && this.controller.battery >= 95) return false;
    for (let i = 0; i < this.vendorSpots.length; i++) {
      const s = this.vendorSpots[i];
      if (s.broken || s.kind !== 'tea') continue;
      const dx = s.x - this.controller.x;
      const dz = s.z - this.controller.z;
      if (dx * dx + dz * dz <= 6.2 * 6.2) return true;
    }
    return false;
  }

  buyRoadsideTea(): void {
    if (this.mode === 'menu' || this.paused || this.roadRage.isActive) return;
    if (!this.state.spend(10)) {
      this.audio.uiError();
      this.ui.toast(t('toast.teaNoMoney'), 'bad');
      return;
    }
    this.controller.restoreStamina(100);
    if (this.state.vehicle().kind === 'electric') {
      this.controller.rechargeBattery(18);
    }
    this.state.progress.stamina = this.controller.stamina;
    this.teaCooldown = 8;
    this.audio.playTeaSip();
    this.ui.toast(t('toast.teaRested'), 'good');
    this.state.saveNow();
    this.hudTick = 1;
    this.updateHud(this.state.vehicle().kind === 'electric');
  }

  settleRoadRagePay(): void {
    const ok = this.roadRage.settleWithPayment((amt) => this.state.spend(amt));
    if (!ok) {
      this.audio.uiError();
      this.ui.toast(t('roadrage.noMoney'), 'bad');
      return;
    }
    this.audio.coin();
    this.ui.toast(t('roadrage.paidToast'), 'good');
    this.state.saveNow();
    this.hudTick = 1;
    this.updateHud(this.state.vehicle().kind === 'electric');
  }

  refuseRoadRagePay(): void {
    this.roadRage.refusePayment();
  }

  isAndroidApp(): boolean {
    return this.speech.isAndroidApp();
  }

  private freeRideInteractions(dt: number): void {
    this.freeRidePoiCooldown = Math.max(0, this.freeRidePoiCooldown - dt);
    if (this.freeRidePoiCooldown > 0) return;
    for (const place of PLACES) {
      const d = Math.hypot(this.controller.x - place.x, this.controller.z - place.z);
      if (d < 8) {
        this.ui.toast(`${t(place.nameKey)}`, 'good');
        this.freeRidePoiCooldown = 8;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ HUD
  private updateHud(isElectric = false): void {
    if (this.hudTick < 0.05) return;
    this.hudTick = 0;
    const mission = this.missions;
    const offer = this.currentOffer;
    const zone = mission.zone;
    let markerX: number | null = null;
    let markerY: number | null = null;
    let distance = 0;
    if (zone) {
      this.tmpProjVec.set(zone.x, zone.marker ?? 3, zone.z).project(this.camera);
      if (this.tmpProjVec.z < 1) {
        markerX = (this.tmpProjVec.x * 0.5 + 0.5) * window.innerWidth;
        markerY = (-this.tmpProjVec.y * 0.5 + 0.5) * window.innerHeight;
      }
      distance = Math.hypot(zone.x - this.controller.x, zone.z - this.controller.z);
    }

    let label = t('hud.none');
    let title = '';
    let sub = '';
    if (mission.state === 'toPickup' && offer) {
      label = offer.kind === 'market' ? t('mission.market') : t('hud.pickup');
      title = t(offer.pickupName);
      sub = `${t('mission.negotiate', { fare: formatTaka(offer.fareEstimate) })} · ${formatDistance(distance)}`;
    } else if (mission.state === 'toDropoff' && offer) {
      const elapsed = mission.elapsed - mission.boardedAt;
      const remain = Math.max(0, offer.targetTime - elapsed);
      label = t('hud.drop');
      title = t(offer.dropName);
      sub = `${formatDistance(distance)} · ${t('hud.timeLeft', { n: formatClock(remain) })}`;
    } else if (this.mode === 'free') {
      label = t('hud.free');
      title = t('place.bazaar');
      sub = t('menu.freeRideDesc');
    } else if (this.pendingOffer) {
      label = this.pendingOffer.kind === 'market' ? t('mission.market') : t('mission.standard');
      title = t(this.pendingOffer.pickupName);
      sub = t('mission.negotiate', { fare: formatTaka(this.pendingOffer.fareEstimate) });
    }

    const hudState: HudState = {
      speed: this.controller.speed,
      money: this.state.balance,
      objectiveLabel: label,
      objectiveTitle: title,
      objectiveSub: sub,
      distance,
      timeLeft:
        mission.state === 'toDropoff' && offer
          ? Math.max(0, offer.targetTime - (mission.elapsed - mission.boardedAt))
          : null,
      mood: mission.mood,
      hint: this.hintForState(),
      stuck: this.controller.stuck,
      passengerAboard: mission.state === 'toDropoff',
      markerX,
      markerY,
      markerLabel: zone ? t(zone.nameKey) : null,
      cameraMode: this.settings.get().cameraMode,
      isElectric,
      battery: this.controller.battery,
      stamina: this.controller.stamina,
      tanActive: this.controller.tanActive,
      teaAvailable: this.isTeaRestAvailable(isElectric),
      routePoints: this.activeRoute ? this.activeRoute.points : null,
      jammedSegments: this.jammedList,
      detourActive: !!this.activeRoute?.avoidedJam,
    };
    this.ui.updateHud(hudState);
    this.ui.setMinimapPlayer(this.controller.x, this.controller.z, this.controller.yaw);
    this.ui.setMinimapMarker(zone ? { x: zone.x, z: zone.z } : null);
  }

  private hintForState(): string | null {
    if (this.mode === 'free') {
      if (this.controller.stuck) return 'hud.stuck';
      return null;
    }
    const zone = this.missions.zone;
    const dist = zone ? Math.hypot(zone.x - this.controller.x, zone.z - this.controller.z) : Infinity;
    if (this.missions.state === 'toPickup' || this.missions.state === 'boarding') {
      if (dist > 16) return null;
      return Math.abs(this.controller.speed) < 1.1 ? 'hud.hintPickup' : 'hud.hintArrived';
    }
    if (this.missions.state === 'toDropoff') {
      if (dist > 16) return null;
      return Math.abs(this.controller.speed) < 1.1 ? 'hud.hintDrop' : 'hud.hintArrived';
    }
    return null;
  }

  // -------------------------------------------------------------- settings & camera
  applySettings(): void {
    const s = this.settings.get();
    const quality = QUALITY[s.quality as QualityPreset];
    setLocale(s.language);
    this.renderer.shadowMap.enabled = s.shadows && quality.shadows;
    this.env.setQuality({ ...quality, shadows: s.shadows && quality.shadows });
    this.traffic.setQuality(quality);
    this.peds.setQuality(quality);
    this.audio.setVolumes({
      master: s.master,
      music: s.music,
      sfx: s.sfx,
      ambience: s.ambience,
      traffic: s.traffic,
      vehicle: s.vehicle,
      dialogue: s.dialogue,
      ui: s.ui,
      muted: s.muted,
      musicEnabled: s.musicEnabled && s.radioMode !== 'street',
      sfxEnabled: s.sfxEnabled,
      reduceNoisyAmbience: s.reduceNoisyAmbience,
    });
    this.audio.setMusicEnabled(s.musicEnabled && s.radioMode !== 'street' && !s.muted);
    this.input.setSensitivity(s.sensitivity);
    this.input.setDeadzone(s.deadzone);
    this.chase.setShakeEnabled(s.cameraShake);
    this.chase.setReduceMotion(s.reduceEffects);
    this.chase.setMode(s.cameraMode);
    this.player.setCockpitVisibility(this.mode !== 'menu' && s.cameraMode === 'cockpit');
    this.ui.updateCameraBadge(s.cameraMode);
    this.renderer.toneMappingExposure = s.reduceEffects ? 0.98 : 1.04;
    setTextureQuality(s.quality === 'high' ? 8 : s.quality === 'balanced' ? 4 : 1);
    if (s.quality === 'low' && this.scene.environment) this.scene.environment = null;
    else if (this.envMap && !this.scene.environment) this.scene.environment = this.envMap;
    this.city.updateShadowFocus(
      this.controller.x,
      this.controller.z,
      quality.shadowDistance,
      s.shadows && quality.shadows,
      true,
    );
    document.documentElement.style.setProperty('--text-scale', String(s.textScale));
    document.documentElement.style.setProperty('--ui-scale', String(s.hudScale));
    this.ui.applyControlLayout();
    this.resize();
    this.refreshPlayerLook();
    if (this.showroomVisible) this.refreshShowroom();
  }

  toggleCamera(): void {
    const next = nextCameraMode(this.settings.get().cameraMode);
    this.settings.set({ cameraMode: next });
    this.chase.setMode(next);
    this.player.setCockpitVisibility(this.mode !== 'menu' && next === 'cockpit');
    this.ui.updateCameraBadge(next);
    this.audio.uiTap();
    this.ui.toast(t('cam.switched', { mode: t(`cam.mode.${next}`) }));
  }

  setCameraMode(mode: CameraMode): void {
    this.settings.set({ cameraMode: mode });
    this.chase.setMode(mode);
    this.player.setCockpitVisibility(this.mode !== 'menu' && mode === 'cockpit');
    this.ui.updateCameraBadge(mode);
  }

  hasSave(): boolean {
    return this.state.progress.rides > 0 || this.state.progress.balance !== 500 || this.state.progress.tutorialDone;
  }

  private nearestPlaceId(): string {
    let best = PLACES[0];
    let bestD = Infinity;
    for (const place of PLACES) {
      const d = Math.hypot(place.x - this.controller.x, place.z - this.controller.z);
      if (d < bestD) {
        bestD = d;
        best = place;
      }
    }
    return best.id;
  }

  private updatePerf(dt: number): void {
    if (!this.devPerf.isEnabled()) return;
    this.devPerf.update(
      dt,
      this.renderer,
      this.traffic.vehicleCount,
      this.peds.activePedestrianCount,
      this.jammedList.length,
    );
  }

  // --------------------------------------------------------- test & debug hooks
  debugSnapshot(): Record<string, unknown> {
    return {
      audio: this.audio.ready,
      audioUnlocked: this.audio.unlocked,
      audioScene: this.audio.currentSceneMode,
      audioAssets: this.audio.loadedAssetCount,
      audioActiveSources: this.audio.activeSourceCount,
      speechBackend: this.speech.activeBackend,
      speechCount: this.speech.spokenCount,
      speechLastText: this.speech.lastSpokenText,
      tutorialDone: this.state.progress.tutorialDone,
      mode: this.mode,
      paused: this.paused,
      x: this.controller.x,
      y: this.controller.y,
      z: this.controller.z,
      yaw: this.controller.yaw,
      pitch: this.controller.pitch,
      steerAngle: this.controller.steerAngle,
      speed: this.controller.speed,
      battery: this.controller.battery,
      stamina: this.controller.stamina,
      tanActive: this.controller.tanActive,
      vehicleId: this.state.selectedVehicleId,
      cameraMode: this.settings.get().cameraMode,
      missionState: this.missions.state,
      balance: this.state.balance,
      rides: this.state.progress.rides,
      condition: this.state.progress.condition,
      traffic: this.traffic.obstacles().length,
      trafficTotal: this.traffic.vehicleCount,
      pedestrians: this.peds.activePedestrianCount,
      jammedSegments: this.jammedList.length,
      roadRageState: this.roadRage.currentState,
      roadRageEscapeLeft: this.roadRage.escapeSecondsRemaining,
      roadRageDistance: this.roadRage.currentDistance,
      breakableTotal: this.destruction.totalRegistered,
      breakableBroken: this.destruction.brokenCount,
      activeDebrisPieces: this.destruction.activePieceCount,
      screen: this.ui.currentScreen,
      quality: this.settings.get().quality,
      weather: this.env.getWeather(),
    };
  }

  debugTeleport(x: number, z: number, yaw = this.controller.yaw): void {
    this.controller.reset(x, z, yaw);
    this.player.root.position.set(x, this.controller.y, z);
    this.player.root.rotation.set(this.controller.pitch, yaw, 0, 'YXZ');
    this.chase.snapTo(x, z, yaw, this.controller.y);
  }

  debugAcceptOffer(): void {
    if (this.pendingOffer) this.acceptOffer(this.pendingOffer);
  }

  debugStartMode(mode: 'duty' | 'free' | 'daily'): void {
    this.startMode(mode);
  }

  debugHoldInput(input: { throttle?: number; steer?: number; brake?: number }, ms: number): void {
    const release = Date.now() + ms;
    this.debugInput = {
      throttle: input.throttle ?? 0,
      steer: input.steer ?? 0,
      brake: input.brake ?? 0,
    };
    const tick = (): void => {
      if (Date.now() < release) {
        window.setTimeout(tick, 60);
      } else {
        this.debugInput = null;
      }
    };
    tick();
  }

  debugStepSim(seconds: number): void {
    const steps = Math.min(60 * 240, Math.round(seconds * 60));
    for (let i = 0; i < steps; i++) {
      this.update(1 / 60);
    }
  }

  debugStepUntil(predicate: () => boolean, maxSeconds = 20): boolean {
    const steps = Math.round(maxSeconds * 60);
    for (let i = 0; i < steps; i++) {
      if (predicate()) return true;
      this.update(1 / 60);
    }
    return predicate();
  }

  debugMission(): { pickup: string; drop: string; state: string } | null {
    if (!this.currentOffer) return null;
    return {
      pickup: this.currentOffer.pickupId,
      drop: this.currentOffer.dropId,
      state: this.missions.state,
    };
  }

  private placeApproachPose(placeId: string): { x: number; z: number; yaw: number } | null {
    const place = placeById(placeId);
    if (!place) return null;
    const seg = segmentById(place.segmentId);
    if (seg) {
      return {
        x: place.x - seg.ux * 2.2,
        z: place.z - seg.uz * 2.2,
        yaw: place.heading,
      };
    }
    return { x: place.x, z: place.z, yaw: place.heading };
  }

  debugTeleportToPickup(): void {
    if (!this.currentOffer) return;
    const pose = this.placeApproachPose(this.currentOffer.pickupId);
    if (!pose) return;
    this.debugTeleport(pose.x, pose.z, pose.yaw);
  }

  debugTeleportToDropoff(): void {
    if (!this.currentOffer) return;
    const pose = this.placeApproachPose(this.currentOffer.dropId);
    if (!pose) return;
    this.debugTeleport(pose.x, pose.z, pose.yaw);
  }

  debugHeroShot(): void {
    const p = this.player.root.position;
    this.camera.position.set(p.x + 3.4, p.y + 1.85, p.z + 3.9);
    this.camera.lookAt(p.x, p.y + 1.0, p.z);
    this.camera.fov = 40;
    this.camera.updateProjectionMatrix();
    this.debugFreeCamera = true;
  }

  debugRickshawShot(angle = 0.9, dist = 4.2, height = 1.6, fov = 42): void {
    const p = this.player.root.position;
    this.camera.position.set(p.x + Math.sin(angle) * dist, p.y + height, p.z + Math.cos(angle) * dist);
    this.camera.lookAt(p.x, p.y + 0.95, p.z);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.debugFreeCamera = true;
  }

  debugSetPhase(phase: DayPhase, weather: WeatherKind): void {
    this.env.setPhase(phase);
    this.env.setWeather(weather);
  }

  debugOpenGarageForTest(): void {
    this.ui.openGarage('menu');
  }

  debugOpenStoreForTest(): void {
    this.ui.openStore();
  }

  debugOpenSettingsForTest(): void {
    this.ui.openSettings(() => this.ui.show('hud'));
  }

  debugBuyFirstCosmetic(): { ok: boolean; id?: string; reason?: string } {
    const candidates = ['tassel.red', 'mirror.round', 'flowers.marigold', 'paint.blue', 'art.bird'];
    for (const id of candidates) {
      if (this.state.ownsCosmetic(id)) continue;
      const cost = cosmeticById(id)?.price ?? 0;
      if (this.state.balance < cost) return { ok: false, reason: 'insufficient' };
      const res = this.state.buyCosmetic(id);
      if (res.ok) {
        this.refreshPlayerLook();
        return { ok: true, id };
      }
      return { ok: false, reason: res.ok ? 'unknown' : res.reason };
    }
    return { ok: true, id: 'already-owned' };
  }

  debugSetQuality(quality: QualityPreset): { quality: string; shadows: boolean } {
    this.settings.set({ quality, shadows: QUALITY[quality].shadows });
    this.applySettings();
    const s = this.settings.get();
    return { quality: s.quality, shadows: s.shadows };
  }

  debugSetLanguage(language: 'bn' | 'en'): { language: string } {
    this.settings.set({ language });
    this.applySettings();
    return { language: this.settings.get().language };
  }

  debugSaveNow(): void {
    this.state.setSpawn(this.controller.x, this.controller.z, this.controller.yaw);
    this.state.saveNow();
  }

  debugOwnedCosmeticsCount(): number {
    return this.state.progress.ownedCosmetics.length;
  }

  /**
   * Positions an instanced traffic vehicle of `kind` directly in front of the player
   * and rams into it through real vehicle physics + collision resolution.
   */
  debugCollideWithTrafficKindForTest(kind: 'car' | 'rickshaw' | 'cng' | 'bus', speed = 6.8): boolean {
    const road = snapToNearestRoad(0, 0);
    this.debugTeleport(road.x, road.z, road.yaw);
    const fx = Math.sin(road.yaw);
    const fz = Math.cos(road.yaw);
    const idx = this.traffic.debugPositionAgentForTest(
      kind,
      road.x + fx * 2.1,
      road.z + fz * 2.1,
      road.yaw,
      0,
    );
    if (idx < 0) return false;
    const pose = this.traffic.getAgentPose(idx);
    if (pose) {
      this.debugTeleport(pose.x - fx * 2.0, pose.z - fz * 2.0, road.yaw);
    }
    this.controller.speed = speed;
    this.debugInput = { throttle: 1, brake: 0, steer: 0 };
    this.debugStepSim(0.45);
    this.debugInput = null;
    return true;
  }

  /**
   * Teleports player onto the clear road adjacent to an intact breakable prop (`lamp` or `stall`)
   * and drives straight into it at real speed to exercise physics + DestructionSystem.
   */
  debugSmashBreakableForTest(kind: 'lamp' | 'stall', speed = 6.8): boolean {
    const candidates = this.destruction.findIntactProps(kind, 12);
    for (let i = 0; i < candidates.length; i++) {
      const prop = candidates[i];
      const road = snapToNearestRoad(prop.x, prop.z);
      const dx = prop.x - road.x;
      const dz = prop.z - road.z;
      const yaw = Math.atan2(dx, dz);
      const ux = Math.sin(yaw);
      const uz = Math.cos(yaw);
      this.debugTeleport(prop.x - ux * 1.4, prop.z - uz * 1.4, yaw);
      this.controller.speed = speed;
      this.debugInput = { throttle: 1, brake: 0, steer: 0 };
      this.debugStepSim(0.25);
      this.debugInput = null;
      if (prop.broken) return true;
    }
    return false;
  }

  debugSetBalanceForTest(amount: number): void {
    this.state.progress.balance = Math.max(0, Math.round(amount));
    this.hudTick = 1;
    this.updateHud(this.state.vehicle().kind === 'electric');
  }

  debugSelectVehicleForTest(id: 'classic' | 'electric'): void {
    if (!this.state.ownsVehicle(id)) {
      this.state.progress.ownedVehicles.push(id);
    }
    this.state.selectVehicle(id);
    this.refreshPlayerLook();
    this.hudTick = 1;
    this.updateHud(this.state.vehicle().kind === 'electric');
  }

  debugMoveNearTeaStallForTest(): boolean {
    for (let i = 0; i < this.vendorSpots.length; i++) {
      const s = this.vendorSpots[i];
      if (s.broken || s.kind !== 'tea') continue;
      this.debugTeleport(s.x + 2.4, s.z, 0);
      this.controller.speed = 0;
      this.controller.stamina = Math.min(this.controller.stamina, 55);
      this.teaCooldown = 0;
      this.hudTick = 1;
      this.updateHud(this.state.vehicle().kind === 'electric');
      return true;
    }
    return false;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get currentMode(): Mode {
    return this.mode;
  }
}

function buildTanWindLines(): THREE.LineSegments {
  const count = 14;
  const positions = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.14;
    const r0 = 0.72 + (i % 3) * 0.11;
    const r1 = r0 + 0.36 + (i % 2) * 0.12;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const base = i * 6;
    positions[base] = c * r0;
    positions[base + 1] = s * r0 * 0.68;
    positions[base + 2] = -1.65;
    positions[base + 3] = c * r1;
    positions[base + 4] = s * r1 * 0.68;
    positions[base + 5] = -1.15;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xfff0c2,
    transparent: true,
    opacity: 0.42,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.visible = false;
  lines.frustumCulled = false;
  lines.renderOrder = 20;
  return lines;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function safeStorage(): Storage | null {
  try {
    const key = '__bt_probe__';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return window.localStorage;
  } catch {
    return null;
  }
}

export type { QualityPreset };
