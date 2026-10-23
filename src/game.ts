/**
 * Game orchestration: renderer, world, player, AI, missions, audio and UI.
 * One place owns the frame loop; every subsystem stays independent.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { QUALITY, RIDE, WORLD, type DayPhase, type QualityPreset, type WeatherKind } from './core/config';
import { clamp, clamp01, damp, formatDistance, formatTaka, kmh, mulberry32 } from './core/mathx';
import { InputManager } from './core/input';
import { SettingsStore } from './core/settings';
import { GameState } from './core/gameState';
import { t, setLocale } from './core/i18n';
import { audio } from './audio/audio';

import { buildCity, type CityResult } from './world/city';
import { buildProps } from './world/props';
import { EnvironmentSystem } from './world/environment';
import { Showroom } from './world/showroom';
import { SignAtlas, setTextureQuality } from './world/textures';
import { PLACES, ROADS, placeById } from './world/layout';

import { RickshawVisual, lookFrom, type RickshawLook } from './vehicle/rickshawModel';
import { RickshawController } from './vehicle/rickshawController';
import { ChaseCamera } from './vehicle/chaseCamera';

import { TrafficSystem } from './ai/traffic';
import { PedestrianSystem } from './ai/pedestrians';

import { MissionSystem } from './missions/missionSystem';
import { generateMission, dailySeed, dateKey, type MissionOffer } from './missions/mission';
import { deriveVehicle } from './economy/economy';
import { cosmeticById } from './economy/catalog';
import type { CosmeticCategory } from './economy/catalog';

import { AppUI, type HudState, type UIBridge } from './ui/ui';

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

  private city: CityResult;
  private env: EnvironmentSystem;
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
  private perfEl: HTMLElement;
  private lastSave = 0;
  private lastImpactAt = 0;
  private bellCooldown = 0;
  private freeRidePoiCooldown = 0;
  private showroomVisible = false;
  private envMap: THREE.Texture | null = null;
  private lowFpsTimer = 0;
  private qualityDowngraded = false;
  private hudTick = 0;
  private idleTimer = 0;
  private debugInput: { throttle: number; steer: number; brake: number } | null = null;
  private debugFreeCamera = false;

  constructor(canvas: HTMLCanvasElement) {
    const storage = safeStorage();
    this.settings = new SettingsStore(storage);
    this.state = new GameState(storage);
    setLocale(this.settings.get().language);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.settings.get().quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.15, 400);
    this.scene.add(this.camera);

    const quality = QUALITY[this.settings.get().quality];
    this.env = new EnvironmentSystem(this.scene, quality);
    this.signAtlas = new SignAtlas();
    this.city = buildCity(this.signAtlas, quality);
    this.scene.add(this.city.group);
    this.env.onWetnessChange = (wet) => this.city.setWetness(wet);
    this.env.onPhaseChange = (phase) => this.city.setNight(phase === 'night' || phase === 'blue');
    const props = buildProps(this.signAtlas);
    this.scene.add(props.group);
    this.city.colliders.push(...props.colliders);

    this.traffic = new TrafficSystem(quality);
    this.scene.add(this.traffic.group);
    this.traffic.onHorn = (x, z, kind) => this.audio.trafficHorn(x, z, kind);

    this.peds = new PedestrianSystem(quality);
    this.scene.add(this.peds.group);

    this.controller = new RickshawController(
      this.city.colliders,
      (x, z) => this.city.heightAt(x, z),
      (x, z) => this.surfaceAt(x, z),
    );

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

    this.showroom = new Showroom();

    this.input = new InputManager();
    this.input.attach();
    this.input.setSensitivity(this.settings.get().sensitivity);
    this.input.setDeadzone(this.settings.get().deadzone);
    this.input.onPause = () => this.togglePause();
    this.input.onCamera = () => this.toggleCamera();
    this.input.onRecover = () => this.recoverRickshaw();
    this.input.onHorn = () => this.ringBell();

    this.ui = new AppUI(this, this.state, this.settings);

    this.perfEl = document.createElement('div');
    this.perfEl.style.cssText =
      'position:fixed;left:8px;top:calc(env(safe-area-inset-top) + 8px);z-index:60;font:11px monospace;color:#9ff0cd;background:rgba(0,0,0,.45);padding:3px 6px;border-radius:6px;pointer-events:none;display:none';
    document.body.append(this.perfEl);

    this.missions.on('started', (offer) => {
      this.currentOffer = offer;
      this.ui.setMinimapMarker(placeById(offer.pickupId) ?? null);
      this.ui.hideJobOffer();
    });
    this.missions.on('boarded', (offer) => {
      this.ui.toast(t('toast.pickup'), 'good');
      this.ui.setMinimapMarker(placeById(offer.dropId) ?? null);
      this.state.progress.weather = this.env.getWeather();
    });
    this.missions.on('completed', (result) => {
      this.currentOffer = null;
      this.finishRide(result);
    });
    this.missions.on('dialogue', (d) => {
      this.ui.showDialogue(d.who, d.key, this.settings.get().language === 'bn' ? undefined : undefined);
      this.audio.setVolumes({ dialogue: this.settings.get().dialogue });
    });
    this.missions.on('hint', (key) => {
      if (key === null) return;
      void key;
    });
    this.missions.on('mood', () => {
      /* the HUD polls the mood each frame */
    });

    this.state.on('saved', () => {
      /* silent: autosave should not nag the player */
    });
    this.state.on('achievement', (id) => {
      this.ui.toast(`${t('toast.unlock', { name: t(id) })}`, 'good');
      this.audio.uiConfirm();
    });
    this.state.on('unlock', (id) => {
      this.ui.toast(t('toast.tape', { name: t(id === 'radio' ? 'tape.radio' : id === 'brishti' ? 'tape.brishti' : 'tape.cassette') }), 'good');
      this.audio.setTrack(id === 'brishti' ? 'brishti' : id === 'radio' ? 'radio' : 'cassette');
    });

    this.applySettings();
    this.placeForMenu();

    // Drag the canvas to spin the rickshaw while the garage/store is open.
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
      await document.fonts.load('700 40px "Hind Siliguri"');
      await document.fonts.load('600 20px "Hind Siliguri"');
    } catch {
      /* font loading is best-effort */
    }
    this.signAtlas.texture.needsUpdate = true;
    // environment reflections (skipped on low quality to save bandwidth)
    if (this.settings.get().quality !== 'low') {
      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const room = new RoomEnvironment();
        const envTex = pmrem.fromScene(room, 0.04).texture;
        this.envMap = envTex;
        this.scene.environment = envTex;
        this.scene.environmentIntensity = 0.55;
        pmrem.dispose();
        room.dispose?.();
      } catch (err) {
        console.warn('[game] environment map unavailable', err);
      }
    }
    this.ui.hideLoading();
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
    this.renderer.setPixelRatio(clamp(dpr * scale, 0.5, 3));
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
    // simple frame limiter for the 30 fps target
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
    if (this.showroomVisible) {
      this.renderer.render(this.showroom.scene, this.showroom.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private update(dt: number): void {
    this.menuTime += dt;
    const settings = this.settings.get();
    this.audio.update(dt, this.controller.x, this.controller.z);
    this.env.update(dt, new THREE.Vector3(this.controller.x, 0, this.controller.z));
    this.traffic.setPlayer(this.controller.x, this.controller.z, this.controller.speed);
    this.traffic.update(dt);
    this.peds.update(dt, this.controller.x, this.controller.z, Math.abs(this.controller.speed));
    this.showroom.update(dt);

    if (this.mode === 'menu') {
      if (!this.debugFreeCamera) this.updateMenuCamera(dt);
      this.player.updateVisual(dt, 0, 0, 0, 0, 0);
      this.player.setNightLighting(false);
      this.ui.setMinimapPlayer(this.controller.x, this.controller.z, this.controller.yaw);
      return;
    }

    const sampled = this.input.sample();
    const input = this.debugInput ? { ...sampled, ...this.debugInput, horn: false } : sampled;
    const wetness = this.env.wetness;
    const derived = deriveVehicle(this.state.vehicle(), this.state.progress.upgrades, this.state.progress.condition, wetness);
    this.controller.setTuning({
      maxSpeed: derived.maxSpeed,
      accel: derived.accel,
      brakeDecel: derived.brakeDecel,
      steerMaxLow: derived.steerMaxLow,
      steerMaxHigh: derived.steerMaxHigh,
      grip: derived.grip,
    });

    // -------- fixed-step physics
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
    // traffic collisions (circle vs circle)
    const trafficImpact = this.resolveTrafficCollisions();
    if (trafficImpact > totalImpact) totalImpact = trafficImpact;
    if (onSidewalk && steppedDistance > 0) this.chase.addTrauma(0.035);

    this.handleImpact(totalImpact, lastImpactX, lastImpactZ);

    // -------- visuals
    const lateral = this.controller.lateralAccel;
    this.player.root.position.set(this.controller.x, this.controller.y, this.controller.z);
    this.player.root.rotation.y = this.controller.yaw;
    this.player.root.rotation.x = this.controller.pitch;
    this.player.root.rotation.z = this.controller.roll;
    this.player.updateVisual(dt, this.controller.speed, input.steer, input.throttle, lateral, this.controller.y);
    this.player.setNightLighting(this.env.getPhase() === 'night' || this.env.getPhase() === 'blue', 1);

    const camDist = settings.cameraMode === 'close' ? 4.4 : 6.1;
    void camDist;
    this.chase.setMode(settings.cameraMode);
    this.chase.setShakeEnabled(settings.cameraShake);
    this.chase.setReduceMotion(settings.reduceEffects);
    if (!this.debugFreeCamera) {
      this.chase.update(dt, this.controller.x, this.controller.z, this.controller.yaw, this.controller.speed, this.city.colliders, false, 0);
    }

    // -------- missions
    this.missions.update(dt, this.controller.speed);
    // If a duty/daily run has no active mission and no offer on screen (for
    // example after a completed ride or a declined offer), offer the next fare.
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
    this.audio.setRain(this.env.getWeather() === 'rain' ? 1 : 0);
    this.audio.setCrowd(Math.min(1, this.peds.group.children.length / 18));

    // -------- HUD
    this.hudTick += dt;
    this.updateHud();

    // -------- persistence
    this.lastSave += dt;
    if (this.lastSave > 20) {
      this.lastSave = 0;
      this.state.setSpawn(this.controller.x, this.controller.z, this.controller.yaw);
      this.state.saveNow();
    }
    this.state.progress.distanceTravelled += steppedDistance;
  }

  private updateMenuCamera(dt: number): void {
    const focus = this.player.root.position;
    const t = this.menuTime;
    const aspect = this.camera.aspect;
    // Landscape: hold the rickshaw in the right third of the frame, leaving the
    // left third clear for the menu panel. Portrait: keep it centred above the panel.
    const portrait = aspect < 1;
    const angle = 0.55 + Math.sin(t * 0.085) * 0.5;
    const radius = portrait ? 8.2 : 7.0;
    const target = new THREE.Vector3(
      focus.x + Math.sin(angle) * radius,
      (portrait ? 3.4 : 2.15) + Math.sin(t * 0.31) * 0.08,
      focus.z + Math.cos(angle) * radius,
    );
    this.camera.position.lerp(target, 1 - Math.exp(-2.4 * dt));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(focus.x, portrait ? 1.55 : 1.0, focus.z);
    // push the subject off-centre so it never sits under the panel
    const shift = portrait ? 0 : 0.2;
    this.camera.rotateY(shift * 0.9);
    this.camera.rotateX(portrait ? -0.11 : -0.04);
    this.camera.fov = portrait ? 54 : 48;
    this.camera.updateProjectionMatrix();
  }

  // --------------------------------------------------------------- actions
  startMode(mode: 'duty' | 'free' | 'daily'): void {
    void this.audio.init();
    // leaving the garage/store must always restore the street view
    if (this.showroomVisible) this.showroomVisible = false;
    this.mode = mode;
    this.paused = false;
    this.state.setMode(mode);
    this.chooseAtmosphere(mode);
    this.respawnPlayer();
    this.ui.show('hud');
    this.ui.applyControlLayout();
    this.ui.setResultReturnTo('game');
    this.currentOffer = null;
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
    const spawn = this.state.progress.spawn ?? { x: WORLD.playerSpawn.x, z: WORLD.playerSpawn.z, yaw: WORLD.playerSpawn.yaw };
    const point = this.nearestRoadPoint(spawn.x, spawn.z);
    this.controller.reset(point.x, point.z, spawn.yaw);
    this.player.root.position.set(point.x, 0, point.z);
    this.chase.snapTo(point.x, point.z, spawn.yaw);
    this.ui.setMinimapPlayer(point.x, point.z, spawn.yaw);
  }

  requestJob(daily = false): void {
    const seed = daily ? dailySeed(new Date()) : Math.floor(Math.random() * 1e9);
    const rng = mulberry32(seed);
    // Prefer a pickup the player still has to drive to — being handed a fare
    // that is already under the wheels skips the point of the mode.
    const nearest = this.nearestPlaceId();
    const nearestPlace = placeById(nearest);
    const tooClose = nearestPlace
      ? Math.hypot(nearestPlace.x - this.controller.x, nearestPlace.z - this.controller.z) < 18
      : true;
    const offer = generateMission({
      rng,
      fromPlaceId: tooClose ? undefined : nearest,
      wet: this.env.getWeather() === 'rain',
      daily,
      seed,
      maxDistance: daily ? 380 : 430,
    });
    this.pendingOffer = offer;
    const pickup = placeById(offer.pickupId);
    const drop = placeById(offer.dropId);
    this.ui.setMinimapMarker(pickup ?? null);
    this.ui.showJobOffer(offer, t(offer.pickupName), t(offer.dropName), () => {
      this.acceptOffer(offer);
    }, () => {
      this.pendingOffer = null;
      this.ui.hideJobOffer();
      this.ui.setMinimapMarker(null);
    });
    void drop;
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
    this.ui.show('hud');
    this.ui.toast(t('toast.freeRide'));
  }

  pauseGame(): void {
    if (this.paused || this.mode === 'menu') return;
    this.togglePause(true);
  }

  private togglePause(force?: boolean): void {
    if (this.mode === 'menu') return;
    const next = force ?? !this.paused;
    if (next === this.paused) return;
    this.paused = next;
    if (this.paused) {
      this.ui.showPause(0);
      this.audio.setVehicleSpeed(0, 0);
    } else {
      this.ui.show('hud');
    }
  }

  resumeGame(): void {
    if (!this.paused) {
      this.ui.show('hud');
      return;
    }
    this.paused = false;
    this.ui.show('hud');
  }

  restartMission(): void {
    this.paused = false;
    this.missions.cancel();
    this.respawnPlayer();
    this.ui.show('hud');
    this.requestJob(this.mode === 'daily');
  }

  recoverRickshaw(): void {
    const free = this.mode === 'free' && true;
    const fee = free ? 0 : 45;
    if (fee > 0) this.state.spend(fee);
    const target = this.nearestRoadPoint(this.controller.x, this.controller.z);
    this.controller.reset(target.x, target.z, this.controller.yaw);
    this.chase.snapTo(target.x, target.z, this.controller.yaw);
    this.player.root.position.set(target.x, 0, target.z);
    this.ui.toast(t('toast.recovered'), 'good');
    this.audio.uiConfirm();
    if (this.paused) {
      this.paused = false;
      this.ui.show('hud');
    }
  }

  returnToMenu(): void {
    this.state.setSpawn(this.controller.x, this.controller.z, this.controller.yaw);
    this.state.saveNow();
    this.missions.cancel();
    this.pendingOffer = null;
    this.ui.hideJobOffer();
    this.ui.setMinimapMarker(null);
    this.mode = 'menu';
    this.paused = false;
    this.ui.show('menu');
    this.showroomVisible = false;
    this.placeForMenu();
  }

  private placeForMenu(): void {
    this.mode = 'menu';
    const stand = placeById('stand');
    const x = stand ? stand.x + 1.2 : WORLD.playerSpawn.x;
    const z = stand ? stand.z - 1.5 : WORLD.playerSpawn.z;
    this.controller.reset(x, z, Math.PI * 0.86);
    this.player.root.position.set(x, 0, z);
    this.player.root.rotation.y = Math.PI * 0.86;
    this.player.setNightLighting(false);
    this.camera.position.set(x + 4, 2.6, z + 4);
    this.camera.lookAt(x, 1.1, z);
  }

  // ---------------------------------------------------------------- garage
  openGarage(from: 'menu' | 'pause' | 'result'): void {
    void from;
    this.refreshShowroom();
    this.showroomVisible = true;
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

  private refreshShowroom(): void {
    this.showroom.setRickshaw(this.state.vehicle(), this.currentLook());
  }

  private refreshPlayerLook(): void {
    const look = this.currentLook();
    this.player.applyLook(look);
  }

  private currentLook(): RickshawLook {
    const value = (category: CosmeticCategory): { value: string } | undefined => {
      const id = this.state.progress.cosmetics[category];
      return id ? cosmeticById(id) : undefined;
    };
    return lookFrom(this.state.vehicle(), this.state.progress.cosmetics, value);
  }

  // ---------------------------------------------------------------- rides
  private finishRide(result: { offer: MissionOffer; fare: ReturnType<typeof import('./economy/economy').computeFare>; distance: number; time: number; mood: number }): void {
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

  // --------------------------------------------------------------- impact
  private handleImpact(magnitude: number, nx: number, nz: number): void {
    if (magnitude <= 0.35) return;
    const now = performance.now();
    if (now - this.lastImpactAt < 220) return;
    this.lastImpactAt = now;
    this.chase.addTrauma(clamp(magnitude * 0.22, 0.05, 0.7));
    this.audio.bump(magnitude);
    if (this.settings.get().haptics && navigator.vibrate) navigator.vibrate(Math.round(clamp(magnitude * 30, 10, 70)));
    this.missions.registerImpact(magnitude);
    this.state.damageCondition(magnitude * RIDE.conditionLossPerHit);
    if (this.controller.hardBrakes > 0) {
      this.missions.registerHardBrake();
      this.controller.hardBrakes = 0;
    }
    void nx;
    void nz;
  }

  private ringBell(): void {
    if (performance.now() - this.bellCooldown < 260) return;
    this.bellCooldown = performance.now();
    const bell = this.currentLook().bell;
    this.audio.bell(bell);
  }

  private resolveTrafficCollisions(): number {
    const obstacles = this.traffic.obstacles();
    let impact = 0;
    for (const ob of obstacles) {
      const dx = this.controller.x - ob.x;
      const dz = this.controller.z - ob.z;
      const dist = Math.hypot(dx, dz);
      const minDist = ob.radius + RIDE.bodyRadius * 0.85;
      if (dist < minDist && dist > 0.0001) {
        const push = (minDist - dist) / dist;
        this.controller.x += dx * push;
        this.controller.z += dz * push;
        const speedLoss = Math.min(Math.abs(this.controller.speed), 2.2);
        this.controller.speed *= 0.35;
        impact = Math.max(impact, speedLoss * 0.5 + 0.2);
      }
    }
    return impact;
  }

  private freeRideInteractions(dt: number): void {
    this.freeRidePoiCooldown = Math.max(0, this.freeRidePoiCooldown - dt);
    if (this.freeRidePoiCooldown > 0) return;
    for (const place of PLACES) {
      const d = Math.hypot(this.controller.x - place.x, this.controller.z - place.z);
      if (d < 7) {
        this.ui.toast(`${t(place.nameKey)}`, 'good');
        this.freeRidePoiCooldown = 8;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ HUD
  private updateHud(): void {
    if (this.hudTick < 0.05) return;
    this.hudTick = 0;
    const mission = this.missions;
    const offer = this.currentOffer;
    const zone = mission.zone;
    const marker = zone ? new THREE.Vector3(zone.x, zone.marker ?? 3, zone.z) : null;
    let markerX: number | null = null;
    let markerY: number | null = null;
    let distance = 0;
    if (marker) {
      const projected = marker.clone().project(this.camera);
      if (projected.z < 1) {
        markerX = (projected.x * 0.5 + 0.5) * window.innerWidth;
        markerY = (-projected.y * 0.5 + 0.5) * window.innerHeight;
      }
      distance = Math.hypot(marker.x - this.controller.x, marker.z - this.controller.z);
    }

    let label = t('hud.none');
    let title = '';
    let sub = '';
    if (mission.state === 'toPickup' && offer) {
      label = t('hud.pickup');
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
      title = t('place.tea');
      sub = t('menu.freeRideDesc');
    } else if (this.pendingOffer) {
      label = t('mission.standard');
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
      timeLeft: mission.state === 'toDropoff' && offer ? Math.max(0, offer.targetTime - (mission.elapsed - mission.boardedAt)) : null,
      mood: mission.mood,
      hint: this.hintForState(),
      stuck: this.controller.stuck,
      passengerAboard: mission.state === 'toDropoff',
      markerX,
      markerY,
      markerLabel: zone ? t(zone.nameKey) : null,
    };
    this.ui.updateHud(hudState);
    this.ui.setMinimapPlayer(this.controller.x, this.controller.z, this.controller.yaw);
    this.ui.setMinimapMarker(zone ? { x: zone.x, z: zone.z } : null);
    void kmh;
  }

  private hintForState(): string | null {
    if (this.mode === 'free') {
      if (this.controller.stuck) return 'hud.stuck';
      return null;
    }
    const zone = this.missions.zone;
    const dist = zone ? Math.hypot(zone.x - this.controller.x, zone.z - this.controller.z) : Infinity;
    // Only prompt when the instruction is actually actionable.
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

  // -------------------------------------------------------------- settings
  applySettings(): void {
    const s = this.settings.get();
    const quality = QUALITY[s.quality as QualityPreset];
    setLocale(s.language);
    this.renderer.shadowMap.enabled = s.shadows;
    this.env.setQuality({ ...quality, shadows: s.shadows });
    this.traffic.setQuality(quality);
    this.peds.setQuality(quality);
    this.audio.setVolumes({
      music: s.music,
      ambience: s.ambience,
      traffic: s.traffic,
      vehicle: s.vehicle,
      dialogue: s.dialogue,
      ui: s.ui,
      muted: s.muted,
    });
    this.audio.setMusicEnabled(s.radioMode !== 'street' && !s.muted);
    this.input.setSensitivity(s.sensitivity);
    this.input.setDeadzone(s.deadzone);
    this.chase.setShakeEnabled(s.cameraShake);
    this.chase.setReduceMotion(s.reduceEffects);
    this.chase.setMode(s.cameraMode);
    this.renderer.toneMappingExposure = s.reduceEffects ? 0.98 : 1.04;
    setTextureQuality(s.quality === 'high' ? 8 : s.quality === 'balanced' ? 4 : 1);
    if (s.quality === 'low' && this.scene.environment) this.scene.environment = null;
    else if (this.envMap && !this.scene.environment) this.scene.environment = this.envMap;
    document.documentElement.style.setProperty('--text-scale', String(s.textScale));
    document.documentElement.style.setProperty('--ui-scale', String(s.hudScale));
    this.ui.applyControlLayout();
    this.perfEl.style.display = s.showPerformance ? 'block' : 'none';
    this.resize();
    this.refreshPlayerLook();
    if (this.showroomVisible) this.refreshShowroom();
  }

  toggleCamera(): void {
    const next = this.settings.get().cameraMode === 'chase' ? 'close' : 'chase';
    this.settings.set({ cameraMode: next });
    this.applySettings();
  }

  setCameraMode(mode: 'chase' | 'close'): void {
    this.settings.set({ cameraMode: mode });
    this.applySettings();
  }

  hasSave(): boolean {
    return this.state.progress.rides > 0 || this.state.progress.balance !== 500 || this.state.progress.tutorialDone;
  }

  // ------------------------------------------------------------- helpers
  private surfaceAt(x: number, z: number): 'road' | 'sidewalk' | 'offroad' {
    for (const road of ROADS) {
      const along = road.axis === 'z' ? z : x;
      const across = road.axis === 'z' ? x : z;
      if (along < road.from || along > road.to) continue;
      const half = road.width / 2;
      const d = Math.abs(across - road.center);
      if (d <= half) return 'road';
      if (d <= half + road.sidewalk) return 'sidewalk';
    }
    return 'offroad';
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

  private nearestRoadPoint(x: number, z: number): { x: number; z: number } {
    let best = { x, z };
    let bestD = Infinity;
    for (const road of ROADS) {
      if (road.kind === 'gali') continue;
      const along = clamp(road.axis === 'z' ? z : x, road.from + 2, road.to - 2);
      const px = road.axis === 'z' ? road.center : along;
      const pz = road.axis === 'z' ? along : road.center;
      const d = Math.hypot(px - x, pz - z);
      if (d < bestD) {
        bestD = d;
        best = { x: px, z: pz };
      }
    }
    return best;
  }

  private updatePerf(dt: number): void {
    if (this.frameCount % 30 !== 0) return;
    const fps = 1 / Math.max(dt, 1e-4);
    if (this.settings.get().showPerformance) {
      this.perfEl.textContent = `${Math.round(fps)} FPS · ${this.traffic.obstacles().length} vehicles · ${this.renderer.info.render.calls} calls · ${this.state.progress.condition.toFixed(0)}% condition`;
    }
    // dynamic quality fallback: if we are clearly missing the target for a while
    if (!this.qualityDowngraded && this.settings.get().quality !== 'low') {
      if (fps < 24) this.lowFpsTimer += 0.5;
      else this.lowFpsTimer = Math.max(0, this.lowFpsTimer - 0.5);
      if (this.lowFpsTimer > 6) {
        this.qualityDowngraded = true;
        this.settings.set({ quality: 'low', shadows: false });
        this.applySettings();
        this.ui.toast(t('settings.qualityNote'));
      }
    }
  }

  /** Used by tests to drive the game deterministically. */
  debugSnapshot(): Record<string, unknown> {
    return {
      audio: this.audio.ready,
      tutorialDone: this.state.progress.tutorialDone,
      mode: this.mode,
      paused: this.paused,
      x: this.controller.x,
      z: this.controller.z,
      speed: this.controller.speed,
      missionState: this.missions.state,
      balance: this.state.balance,
      rides: this.state.progress.rides,
      condition: this.state.progress.condition,
      traffic: this.traffic.obstacles().length,
      screen: this.ui.currentScreen,
      quality: this.settings.get().quality,
      weather: this.env.getWeather(),
    };
  }

  debugTeleport(x: number, z: number, yaw = this.controller.yaw): void {
    this.controller.reset(x, z, yaw);
    this.player.root.position.set(x, 0, z);
    this.chase.snapTo(x, z, yaw);
  }

  debugAcceptOffer(): void {
    if (this.pendingOffer) this.acceptOffer(this.pendingOffer);
  }

  debugStartMode(mode: 'duty' | 'free' | 'daily'): void {
    this.startMode(mode);
  }

  // --------------------------------------------------------- test harness
  /** Holds a synthetic input for N ms (used by the automated e2e run). */
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

  /**
   * Advances the whole simulation synchronously by `seconds` (fixed 60 Hz
   * steps, no rendering). Used by the automated smoke test because software
   * WebGL renders far below real time, which would otherwise make timing-based
   * assertions flaky rather than meaningful.
   */
  debugStepSim(seconds: number): void {
    const steps = Math.min(60 * 240, Math.round(seconds * 60));
    for (let i = 0; i < steps; i++) {
      if (this.debugInput) {
        // keep the synthetic input active while stepping
      }
      this.update(1 / 60);
    }
  }

  /** Steps the simulation until `predicate` is true or the budget runs out. */
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

  debugTeleportToPickup(): void {
    const offer = this.currentOffer;
    if (!offer) return;
    const place = placeById(offer.pickupId);
    if (!place) return;
    this.debugTeleport(place.x - 2.4, place.z, Math.atan2(0, 1));
  }

  debugTeleportToDropoff(): void {
    const offer = this.currentOffer;
    if (!offer) return;
    const place = placeById(offer.dropId);
    if (!place) return;
    this.debugTeleport(place.x - 2.2, place.z, Math.PI);
  }

  /** Puts the camera in a fixed 3/4 hero framing for art review. */
  debugHeroShot(): void {
    const p = this.player.root.position;
    this.camera.position.set(p.x + 3.4, 1.85, p.z + 3.9);
    this.camera.lookAt(p.x, 1.0, p.z);
    this.camera.fov = 40;
    this.camera.updateProjectionMatrix();
    this.debugFreeCamera = true;
  }

  /** Frames the rickshaw from a given angle for visual review. */
  debugRickshawShot(angle = 0.9, dist = 4.2, height = 1.6, fov = 42): void {
    const p = this.player.root.position;
    this.camera.position.set(p.x + Math.sin(angle) * dist, height, p.z + Math.cos(angle) * dist);
    this.camera.lookAt(p.x, 0.95, p.z);
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

  debugOpenSettingsForTest(): void {
    this.ui.openSettings(() => this.ui.show('hud'));
  }

  /** Buys the cheapest owned-less cosmetic via the real GameState path. */
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
    // mirror the real settings UI, which applies the preset's shadow flag
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

  get isPaused(): boolean {
    return this.paused;
  }

  get currentMode(): Mode {
    return this.mode;
  }
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

void clamp01;
void damp;
void formatDistance;
void formatTaka;
void THREE.Color;
export type { QualityPreset };
