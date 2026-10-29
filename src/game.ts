/**
 * Game orchestration: renderer, Mohammadpur world, player rickshaw, traffic,
 * pedestrians, missions, procedural WebAudio, Dokan/Garage showroom and UI.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import {
  QUALITY,
  RIDE,
  TURBO,
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
import { getLocale, setLocale, t } from './core/i18n';
import { audio } from './audio/audio';
import { BanglaSpeechService } from './audio/speech';
import { dialogueLine, dialogueText, ttsPitchRate } from './audio/dialogueManifest';

import { buildCity, type CityResult } from './world/city';
import { buildProps, type VendorSpot } from './world/props';
import { buildDrmcCampus, type DrmcCampusResult } from './world/drmc';
import { drmcOverlayReport } from './world/drmcGeo';
import { DestructionSystem } from './world/destruction';
import { EnvironmentSystem } from './world/environment';
import { WeatherDirector } from './world/weatherDirector';
import { Scrapbook } from './career/scrapbook';
import { EventDirector, type SpawnedEvent } from './events/eventDirector';
import { ScoreSystem, type StuntEvent } from './gameplay/scoreSystem';
import { GameTimeSystem } from './world/timeSystem';
import { ArcadeVfxSystem, classifyCrashTier } from './world/arcadeVfx';
import { DevColliderDebugView } from './world/colliderDebug';
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
import { RickshawController, testRickshawCapsuleVsObb } from './vehicle/rickshawController';
import { ChaseCamera, nextCameraMode } from './vehicle/chaseCamera';

import { TrafficSystem } from './ai/traffic';
import { PedestrianSystem } from './ai/pedestrians';
import { ROADRAGE_ESCAPED_TEXT, RoadRageSystem } from './ai/roadRage';
import { RoadblockSystem } from './ai/roadblocks';
import { PolicePursuitSystem } from './ai/police';
import {
  BLACKLIST_RIVALS,
  eventById,
  rivalByRank,
} from './blacklist/blacklistCatalog';
import { BlacklistIntroCinematic } from './blacklist/cinematic';
import { RivalRaceSystem } from './blacklist/raceSystem';

import { MissionSystem } from './missions/missionSystem';
import { PassengerActor, archetypeById } from './missions/actors';
import { FareNegotiation, roadsideStopKey, shouldCallForRide, type RoadsideStop } from './missions/roadside';
import { dailySeed, dateKey, generateMission, type MissionOffer } from './missions/mission';
import { computeFare, deriveVehicle } from './economy/economy';
import { cosmeticById, vehicleById, type CosmeticCategory } from './economy/catalog';

import { AppUI, type HudState, type UIBridge } from './ui/ui';
import { DevPerfOverlay } from './ui/perfOverlay';

export type Mode = 'menu' | 'duty' | 'free' | 'daily';

interface RoadsideRequest {
  offer: MissionOffer;
  /** Stable crowd-pool identity until this actor is released. */
  pedestrianId: number;
  actor: PassengerActor;
  stop: RoadsideStop;
  negotiation: FareNegotiation;
  expiresAt: number;
  offering: boolean;
}

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
  private drmc: DrmcCampusResult;
  private env: EnvironmentSystem;
  readonly gameTime: GameTimeSystem;
  private weatherDirector: WeatherDirector;
  private weatherBlendAccum = 0;
  private sunGlareAccum = 0;
  private stormToastAt = -999;
  readonly scrapbook: Scrapbook;
  readonly eventDirector: EventDirector;
  readonly score: ScoreSystem;
  private rivalEncounterAt = -999;
  private stuntChipUntil = 0;
  private slowmoScale = 1;
  private impactZoom = 0;
  private arcadeVfx: ArcadeVfxSystem;
  private colliderDebug: DevColliderDebugView;
  private destruction: DestructionSystem;
  private vendorSpots: VendorSpot[];
  private speech: BanglaSpeechService;
  private roadRage: RoadRageSystem;
  readonly roadblocks: RoadblockSystem;
  readonly police: PolicePursuitSystem;
  readonly raceSystem: RivalRaceSystem;
  readonly cinematic: BlacklistIntroCinematic;
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
  private simClockSec = 0;
  private nearMissCooldown = 0;
  private lastEventId: string | null = null;
  private pendingBlacklistFrom: 'menu' | 'hud' | 'pause' = 'menu';
  private activeBlacklistEscapeRank: number | null = null;
  private phaseLockedForDebug = false;
  private winnerPhotoActive = false;
  private winnerPhotoTimer = 0;
  private lastRaceTargetX = 0;
  private lastRaceTargetZ = 0;
  private pendingOffer: MissionOffer | null = null;
  private currentOffer: MissionOffer | null = null;
  private roadsideRequest: RoadsideRequest | null = null;
  private roadsideNextAt = 20;
  private roadsideStopCooldowns = new Map<string, number>();
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
  private debugInput: { throttle: number; steer: number; brake: number; turbo?: boolean } | null = null;
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
    this.gameTime = new GameTimeSystem(this.state.clockMinutes);
    this.gameTime.onPhaseChange = (phase) => {
      if (!this.phaseLockedForDebug) {
        this.env.setPhase(phase);
        this.state.progress.dayPhase = phase;
      }
    };
    this.signAtlas = new SignAtlas();
    this.city = buildCity(this.signAtlas, initialQuality);
    this.scene.add(this.city.group);
    this.env.setLampPositions(this.city.lampPositions);
    this.weatherDirector = new WeatherDirector(this.state.progress.weather);
    this.weatherDirector.onWeatherChange = (w) => {
      this.env.setWeather(w);
      this.state.progress.weather = w;
      this.ui.setRainDrops(w === 'rain' || w === 'storm');
      if (w === 'storm' && this.simClockSec - this.stormToastAt > 120) {
        this.stormToastAt = this.simClockSec;
        this.speakLine('weather.storm.1', 3);
      }
    };
    this.weatherDirector.onLightning = (intensity, flashAllowed) => {
      this.env.strike(intensity, flashAllowed);
    };
    this.env.onLightningFlash = (strength, flashAllowed) => {
      this.ui.triggerLightningFlash(strength, flashAllowed);
      // Spatially plausible delayed thunder (1.2–4.6 s) at bounded gain
      this.audio.playThunder(1.2 + strength * 3.4, 0.45 + strength * 0.55);
    };
    // vNext §10 permanent scrapbook (deduplicated, bounded) + §7 event director + §9 score
    this.scrapbook = Scrapbook.fromJSON(this.state.progress.scrapbook);
    this.eventDirector = new EventDirector();
    this.score = new ScoreSystem();
    this.state.on('beforeSave', () => {
      this.state.progress.scrapbook = this.scrapbook.toJSON();
    });
    this.eventDirector.onSpawn = (ev) => this.realizeDirectorEvent(ev);
    this.eventDirector.onWeatherNudge = (suggestStorm) => {
      if (suggestStorm) this.weatherDirector.setWeatherImmediate('storm');
    };
    this.score.onStunt = (ev) => this.handleStunt(ev);
    this.state.onTransaction = (kind, id, level) => {
      this.scrapbook.recordPurchase(`${kind}:${id}`, level, {
        minutesOfDay: this.gameTime.minutesOfDay,
        vehicleId: this.state.selectedVehicleId,
        takaDelta: kind === 'repair' ? 0 : 1,
      });
    };
    this.score.onComboEnd = (best) => {
      this.scrapbook.recordBestCombo(best);
    };
    this.env.onWetnessChange = (wet) => this.city.setWetness(wet);
    this.env.onPhaseChange = (phase) => this.city.setNight(phase === 'night' || phase === 'blue');
    this.env.setPhase(this.gameTime.phase);

    this.colliderDebug = new DevColliderDebugView(this.scene);

    // DRMC campus exterior (vNext §1) — attached to the verified Shahjahan Road approach
    this.drmc = buildDrmcCampus((x, z) => this.city.heightAt(x, z));
    this.scene.add(this.drmc.group);
    this.city.registerShadowCasters(this.drmc.group);

    const props = buildProps(this.signAtlas);
    this.scene.add(props.group);
    this.city.registerShadowCasters(props.group);
    this.city.colliders.push(...props.colliders);
    this.city.colliders.push(...this.drmc.colliders);
    this.vendorSpots = props.vendorSpots;
    this.audio.setVendorSpots(props.vendorSpots);
    releaseScratchCanvas();

    this.destruction = new DestructionSystem((x, z) => this.city.heightAt(x, z));
    this.destruction.registerProps(this.city.breakableLamps, this.city.lampPositions);
    this.destruction.registerProps(props.breakableStalls);
    this.scene.add(this.destruction.group);
    this.destruction.onBreak = (prop, impactSpeed) => {
      this.audio.playBreakableCrash(prop.kind === 'lamp' ? 'lamp' : 'stall');
      this.arcadeVfx?.triggerCrash(
        'medium',
        prop.x,
        this.city.heightAt(prop.x, prop.z) + 0.5,
        prop.z,
        Math.sin(this.controller.yaw),
        Math.cos(this.controller.yaw),
        this.env.wetness,
      );
      this.chase.addTrauma(clamp(impactSpeed * 0.045, 0.14, 0.42));
      if (this.mode === 'free' && !this.raceSystem?.isActive && this.missions.state === 'none') {
        this.police?.recordInfraction(
          0.95,
          this.controller.x,
          this.controller.z,
          this.controller.yaw,
          this.roadRage.isActive,
        );
      }
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
    this.controller.turboCharge = this.state.turboCharge;
    this.controller.onBreakableHit = (id, impactSpeed, x, z, yaw) =>
      this.destruction.tryBreak(id, impactSpeed, x, z, yaw);
    this.controller.onTanAutoStop = (reason) => {
      this.audio.setTanBoost(false);
      this.ui.toast(t(reason === 'battery' ? 'toast.tanLowBattery' : 'toast.tanEmpty'), 'bad');
    };
    this.controller.onTurboStateChange = (active) => {
      if (!active) {
        this.audio.setTurboBoostAudio(false, 0);
      }
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
        this.scrapbook.addRecord({
          id: `rival:rage:${Math.floor(this.simClockSec / 45)}`,
          category: 'rival',
          titleBn: 'রাস্তার রাগ এড়ানো',
          titleEn: 'Road-rage escaped',
          detailBn: 'ব্যক্তিগত গাড়ির চালককে পেছনে ফেলে পালানো হলো!',
          detailEn: 'Left the angry private-car driver behind!',
          minutesOfDay: this.gameTime.minutesOfDay,
          vehicleId: this.state.selectedVehicleId,
        });
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
    this.arcadeVfx = new ArcadeVfxSystem(this.player.root, this.scene);

    // Pooled dynamic Roadblocks, 5-Heat Police Pursuit, Rival Race & Cinematic systems (v0.5.0)
    this.roadblocks = new RoadblockSystem((x, z) => this.city.heightAt(x, z));
    this.roadblocks.onBarrierSmashed = (x, z, speed) => {
      this.audio.playBreakableCrash('stall');
      this.arcadeVfx.triggerCrash(
        'medium',
        x,
        this.city.heightAt(x, z) + 0.45,
        z,
        Math.sin(this.controller.yaw),
        Math.cos(this.controller.yaw),
        this.env.wetness,
      );
      this.chase.addTrauma(clamp(speed * 0.035, 0.12, 0.35));
      this.state.addRep(15);
      this.controller.addTurboCharge(TURBO.checkpointGain);
      this.ui.toast(t('toast.roadblockSmashed'), 'good');
    };
    this.scene.add(this.roadblocks.group);

    this.police = new PolicePursuitSystem(this.roadblocks, {
      heightAt: (x, z) => this.city.heightAt(x, z),
      onDispatchRadio: () => {
        const s = this.settings.get();
        const loc = getLocale();
        const heat = this.police.heatLevel;
        const lineKey = heat >= 3 ? 'police.line.escalate' : 'police.line.start';
        const lineText = t(lineKey);
        this.speech.speak({
          speaker: 'police',
          text: lineText,
          locale: loc,
          priority: 2,
          volume: s.dialogue * s.master,
          muted: s.muted || !s.sfxEnabled,
        });
        if (s.subtitles) {
          this.ui.showRoadRageSubtitle('police.speaker', lineText);
        }
      },
      onHeatEscalated: (newHeat) => {
        this.state.setHeat(newHeat);
      },
      onPursuitEscaped: (maxHeat, repReward) => {
        this.state.setHeat(0);
        this.state.addRep(repReward);
        if (this.activeBlacklistEscapeRank !== null) {
          const rank = this.activeBlacklistEscapeRank;
          this.activeBlacklistEscapeRank = null;
          if (this.state.recordBlacklistTask('escape', rank)) this.ui.toast(t('blacklist.escapeComplete'), 'good');
        }
        this.scrapbook.recordStat('policeEscapes');
        this.scrapbook.recordHeat(maxHeat);
        this.scrapbook.addRecord({
          id: `police:escape:${Math.floor(this.simClockSec / 45)}`,
          category: 'police',
          titleBn: 'পুলিশের তাড়া এড়ানো!',
          titleEn: 'Police pursuit escaped!',
          detailBn: `সর্বোচ্চ হিট ${maxHeat} থেকে পালানো সম্পন্ন।`,
          detailEn: `Escaped cleanly from Heat ${maxHeat}.`,
          minutesOfDay: this.gameTime.minutesOfDay,
          vehicleId: this.state.selectedVehicleId,
          repDelta: repReward,
        });
        void maxHeat;
        this.controller.addTurboCharge(TURBO.escapeGain);
        this.audio.setPoliceSirenAudio(false, 0, 0);
        this.audio.successStinger();
        this.ui.toast(t('police.escapedToast', { rep: repReward }), 'good');
        this.state.saveNow();
      },
      onPlayerBusted: (_heat, finePaid) => {
        this.activeBlacklistEscapeRank = null;
        const paid = this.state.deductPenalty(finePaid);
        this.state.setHeat(0);
        this.controller.speed = 0;
        this.controller.setTanActive(false);
        this.audio.setTanBoost(false);
        this.audio.setTurboBoostAudio(false, 0);
        this.audio.setPoliceSirenAudio(false, 0, 0);
        this.ui.toast(t('police.bustedToast', { fine: formatTaka(paid) }), 'bad');
        if (this.raceSystem.isActive && this.raceSystem.currentEvent) {
          const ev = this.raceSystem.currentEvent;
          const rv = this.raceSystem.currentRival;
          const standings = this.raceSystem.getStandings(this.controller.x, this.controller.z);
          const laps = this.raceSystem.lapCount;
          this.stopWinnerPhoto();
          this.raceSystem.cancel();
          this.paused = true;
          this.input.clearAllHolds();
          this.ui.openRaceResult({
            won: false,
            event: ev,
            rival: rv,
            timeSeconds: 0,
            topSpeedKmh: 0,
            playerPosition: standings.find((entry) => entry.isPlayer)?.position ?? (ev.blacklistRank ? 2 : 4),
            totalRacers: ev.blacklistRank ? 2 : 4,
            laps,
            standings,
            cashDelta: -paid,
            repEarned: 0,
            unlockedNextRank: null,
            reasonKey: 'race.bustedReason',
          });
        } else {
          this.recoverRickshawFreeAfterBust();
        }
        this.state.saveNow();
      },
    });
    this.police.setSavedHeat(this.state.progress.heat);
    this.scene.add(this.police.group);

    this.raceSystem = new RivalRaceSystem((x, z) => this.city.heightAt(x, z));
    this.scene.add(this.raceSystem.group);
    this.raceSystem.onCountdownTick = () => this.audio.uiTap();
    this.raceSystem.onRaceGo = () => {
      this.audio.uiConfirm();
      this.speakLine('race.start.1', 3);
    };
    this.raceSystem.onCheckpointPassed = () => {
      this.audio.coin();
      this.controller.addTurboCharge(TURBO.checkpointGain * 0.45);
    };
    this.raceSystem.onLapCompleted = (lap, tot) => {
      this.audio.successStinger();
      this.ui.toast(t('toast.lapComplete', { cur: lap, tot }), 'good');
    };
    this.raceSystem.onRaceFinished = (summary) => this.handleRaceFinished(summary);

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
    this.input.onBlacklistOpen = () => {
      if (this.mode !== 'menu' && !this.paused && !this.cinematic.isPlaying) {
        this.openBlacklist('hud');
      }
    };
    this.input.onTeaInteract = () => {
      if (this.isTeaRestAvailable(this.state.vehicle().kind === 'electric')) {
        this.buyRoadsideTea();
      }
    };

    this.ui = new AppUI(this, this.state, this.settings);
    this.cinematic = new BlacklistIntroCinematic(
      this.scene,
      this.camera,
      this.player,
      (x, z) => this.city.heightAt(x, z),
      this.audio,
      this.speech,
      () => {
        const s = this.settings.get();
        return { volume: s.dialogue * s.master, muted: s.muted || !s.sfxEnabled };
      },
      (uiState) => this.ui.updateCinematicUi(uiState),
    );
    this.devPerf = new DevPerfOverlay();
    this.input.onDevPerf = () => {
      this.devPerf.toggle();
    };
    this.input.onDevColliders = () => {
      this.colliderDebug.toggle();
    };
    (window as unknown as { __btToggleDevPerf?: () => boolean }).__btToggleDevPerf = () => this.devPerf.toggle();
    (window as unknown as { __btToggleColliderDebug?: () => boolean }).__btToggleColliderDebug = () =>
      this.colliderDebug.toggle();
    (window as unknown as { __btToggleDrmcOverlay?: () => boolean }).__btToggleDrmcOverlay = () =>
      this.toggleDrmcOverlay();

    // Pedestrian near-miss & bump Bengali reactions
    this.peds.onReaction = (ev) => {
      this.tmpProjVec.set(ev.x, ev.y, ev.z).project(this.camera);
      if (this.tmpProjVec.z < 1) {
        const sx = (this.tmpProjVec.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-this.tmpProjVec.y * 0.5 + 0.5) * window.innerHeight;
        this.ui.showPedestrianCallout(sx, sy, ev.textKey);
      }
      this.audio.pedestrianShout();
      this.speakLine(ev.textKey, 1);
      if (ev.kind === 'bump') {
        this.controller.speed *= 0.68;
        this.chase.addTrauma(0.14);
        this.missions.registerImpact(0.75);
      }
    };

    this.missions.on('started', (offer) => {
      this.currentOffer = offer;
      const pk = this.missions.zone ?? placeById(offer.pickupId) ?? null;
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
                    this.arcadeVfx.withPrewarmState(() => {
                      this.roadblocks.withPrewarmState(() => {
                        this.police.withPrewarmState(() => {
                          this.raceSystem.withPrewarmState(() => {
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
    else {
      this.audio.setVehicleSpeed(0, 0);
      this.audio.setTurboBoostAudio(false, 0);
      if (this.winnerPhotoActive) {
        this.updateWinnerPhotoCamera(dt);
      }
    }

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
    if (this.paused) {
      this.audio.setVehicleSpeed(0, 0);
      this.audio.setTurboBoostAudio(false, 0);
      return;
    }
    // §9 brief cinematic slow-motion on major crashes (reduced-motion: never).
    if (this.slowmoScale < 1) {
      this.slowmoScale = Math.min(1, this.slowmoScale + dt * 0.85);
    }
    dt *= this.slowmoScale;
    this.menuTime += dt;
    this.detourToastCooldown = Math.max(0, this.detourToastCooldown - dt);
    this.teaCooldown = Math.max(0, this.teaCooldown - dt);
    this.nearMissCooldown = Math.max(0, this.nearMissCooldown - dt);
    const settings = this.settings.get();

    if (this.showroomVisible) {
      this.audio.setSceneMode('menu');
      this.audio.setTurboBoostAudio(false, 0);
      this.showroom.update(dt);
      return;
    }

    if (this.cinematic.isPlaying) {
      this.audio.setSceneMode('driving');
      this.audio.setTurboBoostAudio(false, 0);
      this.audio.update(dt, this.controller.x, this.controller.z);
      this.tmpPlayerVec.set(this.controller.x, 0, this.controller.z);
      this.env.update(dt, this.tmpPlayerVec);
      this.traffic.update(dt);
      this.cinematic.update(dt);
      return;
    }

    const q = QUALITY[settings.quality];
    this.audio.setSceneMode(this.mode === 'menu' ? 'menu' : 'driving');
    this.audio.update(dt, this.controller.x, this.controller.z);
    this.tmpPlayerVec.set(this.controller.x, 0, this.controller.z);
    // vNext §4 dynamic weather director — bounded transitions, gradual blends
    this.weatherDirector.update(dt, {
      timeMinutes: this.gameTime.minutesOfDay,
      inRace: this.raceSystem.isActive,
      raceFinalStretch:
        this.raceSystem.isActive &&
        this.raceSystem.hudSnap.checkpointTotal > 0 &&
        this.raceSystem.hudSnap.checkpointIndex / this.raceSystem.hudSnap.checkpointTotal > 0.65,
      eventOverride: this.raceSystem.isActive && !!this.raceSystem.currentEvent?.weatherOverride,
      reduceEffects: settings.reduceEffects,
      lowFlash: settings.lowFlash,
    });
    this.weatherBlendAccum += dt;
    if (this.weatherBlendAccum >= 0.12) {
      this.weatherBlendAccum = 0;
      const wb = this.weatherDirector.weatherBlend;
      this.env.setWeatherBlend(wb, wb.wet);
      this.audio.setWindAudio(wb.wind);
    }
    this.env.update(dt, this.tmpPlayerVec);
    const windStrength = this.weatherDirector.weatherBlend.wind;
    this.city.updateStreetLitter(dt, windStrength, this.controller.x, this.controller.z);
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
      this.audio.setTurboBoostAudio(false, 0);
      this.arcadeVfx.update(dt, this.controller.x, 0, this.controller.z, this.controller.yaw, 0, false, 0, 0);
      if (!this.debugFreeCamera) this.updateMenuCamera(dt);
      const menuGround = this.city.heightAt(this.controller.x, this.controller.z);
      this.player.root.position.set(this.controller.x, menuGround, this.controller.z);
      this.player.updateVisual(dt, 0, 0, 0, 0, menuGround, 0);
      this.player.setNightLighting(false);
      this.ui.setMinimapPlayer(this.controller.x, this.controller.z, this.controller.yaw);
      return;
    }

    // Advance Dynamic In-Game Clock only during active unpaused gameplay!
    this.simClockSec += dt;
    this.gameTime.update(dt);
    this.state.setClockMinutes(this.gameTime.minutesOfDay);

    const sampled = this.input.sample();
    const rawInput = this.debugInput
      ? {
          ...sampled,
          ...this.debugInput,
          turbo: this.debugInput.turbo ?? sampled.turbo,
          horn: false,
        }
      : sampled;
    const lockedByRage = this.roadRage.isControlLocked;
    const lockedByStart = this.raceSystem.isStartLocked;
    const lockedByBoarding = this.missions.state === 'boarding';
    const input = lockedByRage || lockedByStart || lockedByBoarding
      ? { throttle: 0, brake: 1, steer: 0, horn: false, turbo: false }
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
      turboDrainMultiplier: derived.turboDrainMultiplier,
      turboRechargeMultiplier: derived.turboRechargeMultiplier,
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
        {
          throttle: input.throttle,
          brake: input.brake,
          steer: input.steer,
          handbrake: false,
          turbo: input.turbo,
        },
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
    if (lockedByRage || lockedByStart) {
      this.controller.speed = 0;
      if (this.roadRage.currentState === 'scuffling') {
        this.chase.addTrauma(0.06);
      }
    }
    this.state.progress.stamina = this.controller.stamina;
    this.state.turboCharge = this.controller.turboCharge;

    const trafficImpact = this.resolveTrafficCollisions();
    if (trafficImpact > totalImpact) totalImpact = trafficImpact;

    // Roadblock & Police & Rival OBB contacts
    const rbHit = this.roadblocks.resolvePlayerCollision(
      this.controller.x,
      this.controller.z,
      this.controller.yaw,
      this.controller.speed,
    );
    if (rbHit.hit) {
      this.controller.x += rbHit.pushX;
      this.controller.z += rbHit.pushZ;
      this.controller.speed *= rbHit.speedScale;
      if (!rbHit.smashed) {
        totalImpact = Math.max(totalImpact, 1.35);
      }
    }

    const polHit = this.police.resolvePlayerCollision(
      this.controller.x,
      this.controller.z,
      this.controller.yaw,
      this.controller.speed,
    );
    if (polHit.hit) {
      this.controller.x += polHit.pushX;
      this.controller.z += polHit.pushZ;
      this.controller.speed *= 0.55;
      totalImpact = Math.max(totalImpact, 0.9 + polHit.closingSpeed * 0.22);
    }

    const rivHit = this.raceSystem.resolvePlayerVsRival(
      this.controller.x,
      this.controller.z,
      this.controller.yaw,
    );
    if (rivHit.hit) {
      this.controller.x += rivHit.pushX;
      this.controller.z += rivHit.pushZ;
      totalImpact = Math.max(totalImpact, 0.8);
    }

    if (onSidewalk && steppedDistance > 0) this.chase.addTrauma(0.03);

    this.handleImpact(totalImpact, lastImpactX, lastImpactZ);
    this.roadRage.update(dt, this.controller.x, this.controller.z);
    this.police.update(
      dt,
      this.controller.x,
      this.controller.z,
      this.controller.yaw,
      this.controller.speed,
      this.roadRage.isActive,
    );
    if (this.police.isActive) {
      const prox = clamp01(1 - this.police.nearestDistance / 95);
      this.audio.setPoliceSirenAudio(true, prox, this.police.heatLevel);
    } else {
      this.audio.setPoliceSirenAudio(false, 0, 0);
    }

    this.raceSystem.recordPlayerSpeed(this.controller.speed);
    const raceSnap = this.raceSystem.update(
      dt,
      this.controller.x,
      this.controller.z,
      this.controller.hits,
      this.simClockSec,
      this.traffic.obstacles(),
      this.roadblocks.getActiveObbs(),
    );
    if (
      raceSnap.active &&
      (Math.abs(raceSnap.targetX - this.lastRaceTargetX) > 1.5 ||
        Math.abs(raceSnap.targetZ - this.lastRaceTargetZ) > 1.5)
    ) {
      this.lastRaceTargetX = raceSnap.targetX;
      this.lastRaceTargetZ = raceSnap.targetZ;
      this.recomputeRoute({ x: raceSnap.targetX, z: raceSnap.targetZ });
    }

    // Reckless ultra-high-speed driving in Free Ride gradually attracts police attention!
    if (
      this.mode === 'free' &&
      !this.raceSystem.isActive &&
      this.missions.state === 'none' &&
      this.controller.speed > 13.8
    ) {
      this.police.recordInfraction(
        dt * 0.25,
        this.controller.x,
        this.controller.z,
        this.controller.yaw,
        this.roadRage.isActive,
      );
    }

    // -------- pooled `টান` + `টার্বো` motion streaks, rear flames & FOV surge
    const tanVisual =
      this.controller.tanActive && this.controller.speed > derived.maxSpeed * 0.72
        ? clamp01((this.controller.speed - derived.maxSpeed * 0.72) / Math.max(1, derived.maxSpeed * 0.9))
        : 0;
    const turboVisual = this.controller.turboActive
      ? clamp01(0.45 + this.controller.speed / Math.max(12, derived.maxSpeed * TURBO.speedMultiplier))
      : 0;
    this.chase.setBoostAmount(tanVisual);
    this.chase.setTurboAmount(turboVisual);
    this.chase.setLongitudinalAccel(this.controller.acceleration, dt);
    this.audio.setTurboBoostAudio(this.controller.turboActive, turboVisual);

    const streakIntensity = Math.max(tanVisual, turboVisual * 1.15);
    if (!settings.reduceEffects && streakIntensity > 0.08) {
      this.tanWindLines.visible = true;
      this.tanWindLines.rotation.z = (this.menuTime * (this.controller.turboActive ? 14.5 : 9.5)) % (Math.PI * 2);
    } else {
      this.tanWindLines.visible = false;
    }

    this.arcadeVfx.setReduceEffects(settings.reduceEffects);
    this.arcadeVfx.update(
      dt,
      this.controller.x,
      this.controller.y,
      this.controller.z,
      this.controller.yaw,
      this.controller.speed,
      this.controller.turboActive,
      this.controller.turboBlend,
      wetness,
    );

    if (this.colliderDebug.isEnabled()) {
      this.colliderDebug.update(
        this.controller.x,
        this.controller.y,
        this.controller.z,
        this.controller.yaw,
        this.city.colliders,
        this.traffic.obstacles(),
        this.controller.lastContact,
        this.roadblocks.getActiveObbs(),
      );
    }

    // -------- visuals (YXZ Euler order + true steerAngle & slope + weight-transfer pitch!)
    const lateral = this.controller.lateralAccel;
    this.player.root.position.set(this.controller.x, this.controller.y, this.controller.z);
    this.player.root.rotation.y = this.controller.yaw;
    this.player.root.rotation.x = this.controller.pitch + this.controller.bodyPitchOffset;
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
      const routeTarget = raceSnap.active
        ? { x: raceSnap.targetX, z: raceSnap.targetZ }
        : this.missions.zone;
      this.recomputeRoute(routeTarget);
    }

    if (
      (this.mode === 'duty' || this.mode === 'daily') &&
      !this.raceSystem.isActive &&
      this.missions.state === 'none' &&
      !this.pendingOffer
    ) {
      this.idleTimer += dt;
      if (this.idleTimer > 1.6) {
        this.idleTimer = 0;
        this.requestJob(this.mode === 'daily');
      }
    } else {
      this.idleTimer = 0;
    }
    if (this.roadsideRequest && (this.mode !== 'free' || this.raceSystem.isActive || this.police.isActive ||
        this.roadRage.isActive || this.cinematic.isPlaying || this.missions.state !== 'none' || this.pendingOffer)) {
      this.clearRoadsideRequest();
    }
    if (this.mode === 'free' && this.currentOffer === null && !this.raceSystem.isActive && this.ui.currentScreen === 'hud') {
      this.freeRideInteractions(dt);
      this.updateRoadsideRequest();
      // Other encounters must not interrupt a waiting roadside passenger.
      if (!this.roadsideRequest && !this.pendingOffer) {
      this.eventDirector.update(
        dt,
        {
          x: this.controller.x,
          z: this.controller.z,
          timeMinutes: this.gameTime.minutesOfDay,
          heat: this.police.heatLevel,
          trafficDensity: clamp01(this.jammedList.length / 5 + (this.env.getWeather() === 'rain' ? 0.3 : 0)),
          raining: this.weatherDirector.weatherBlend.rain > 0.3,
          inMission: false,
          inRace: false,
          policeActive: this.police.isActive,
          roadRageActive: this.roadRage.isActive,
          cinematicActive: this.cinematic.isPlaying,
          paused: false,
          reduceEffects: settings.reduceEffects,
        },
      );
      this.maybeTriggerRivalEncounter();
      }
    }
    this.score.update(dt, {
      tilt: Math.abs(this.controller.roll ?? 0),
      lateral: this.controller.lateralAccel ?? 0,
      speed: Math.abs(this.controller.speed),
    });
    if (input.horn) this.ringBell();

    // -------- §9 impact zoom (chase resets fov each frame; apply a bounded additive punch)
    if (this.impactZoom > 0.001) {
      this.impactZoom = Math.max(0, this.impactZoom - dt * 0.85);
      this.camera.fov = clamp(this.camera.fov + this.impactZoom * 26, 35, 92);
      this.camera.updateProjectionMatrix();
    }

    // -------- sun glare (sunny states only; event-driven dirty DOM writes ≤6 Hz)
    this.sunGlareAccum += dt;
    if (this.sunGlareAccum >= 0.16) {
      this.sunGlareAccum = 0;
      const glareStrength = this.computeSunGlare();
      if (glareStrength > 0.02) {
        this.tmpProjVec.set(
          this.camera.position.x + Math.sin(this.camera.rotation.y) * 60 + glareStrength,
          60,
          this.camera.position.z + Math.cos(this.camera.rotation.y) * 60,
        ).project(this.camera);
        const sx = (this.tmpProjVec.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-this.tmpProjVec.y * 0.5 + 0.5) * window.innerHeight;
        this.ui.setSunGlare(glareStrength, sx, sy);
      } else {
        this.ui.setSunGlare(0, 0, 0);
      }
    }

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
    this.clearRoadsideRequest();
    this.activeBlacklistEscapeRank = null;
    void this.audio.init();
    this.phaseLockedForDebug = false;
    this.stopWinnerPhoto();
    this.cinematic.stop(false);
    this.raceSystem.cancel();
    this.police.stopPursuit(true);
    this.roadblocks.clearAll();
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
    let weather: WeatherKind = rides > 0 && rides % 5 === 4 ? 'overcast' : 'sunny';
    if (mode === 'daily') {
      const seed = dailySeed(new Date());
      weather = seed % 2 === 0 ? 'rain' : 'overcast';
    }
    const phase = this.gameTime.phase;
    this.env.setPhase(phase);
    this.weatherDirector.setWeatherImmediate(weather);
    this.env.setWeather(weather);
    const wNow = this.env.getWeather();
    this.ui.setRainDrops(wNow === 'rain' || wNow === 'storm');
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
    this.clearRoadsideRequest();
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

  private clearRoadsideRequest(walkAway = false): void {
    const request = this.roadsideRequest;
    if (!request) return;
    if (walkAway) this.missions.dismissWaitingActor(request.actor, request.stop.departure.x, request.stop.departure.z);
    else request.actor.dispose();
    this.roadsideRequest = null;
    if (request.offering) this.ui.hideJobOffer();
    this.roadsideNextAt = Math.max(this.roadsideNextAt, this.simClockSec + 40);
  }

  private updateRoadsideRequest(): void {
    if (this.police.isActive || this.roadRage.isActive || this.cinematic.isPlaying ||
        this.missions.state !== 'none' || this.pendingOffer || this.ui.currentScreen !== 'hud' || this.eventDirector.activeCount > 0) return;
    const request = this.roadsideRequest;
    if (request) {
      const distance = Math.hypot(this.controller.x - request.stop.pickup.x, this.controller.z - request.stop.pickup.z);
      if (this.simClockSec > request.expiresAt || distance > 72) {
        this.clearRoadsideRequest();
      } else if (!request.offering && distance < 3.5 && Math.abs(this.controller.speed) < 0.95) {
        request.offering = true;
        this.input.clearAllHolds();
        this.controller.forceStopTurbo();
        this.audio.setTurboBoostAudio(false, 0);
        this.paused = true;
        this.showRoadsideOffer(request);
      }
      return;
    }
    if (this.simClockSec < this.roadsideNextAt) return;
    // One probabilistic attempt per ten eligible seconds. This is deliberately
    // separate from the single, exactly-50% bargaining roll.
    this.roadsideNextAt = this.simClockSec + 10;
    if (!shouldCallForRide()) return;
    for (const [key, until] of this.roadsideStopCooldowns) {
      if (until <= this.simClockSec) this.roadsideStopCooldowns.delete(key);
    }
    // Borrow a real nearby crowd identity, rather than conjuring a second
    // pedestrian at an arbitrary point. The slot has its own cooldown and is
    // hidden until the mission actor walks away or the trip is cleaned up.
    const caller = this.peds.reserveRoadsideCaller(
      this.controller.x, this.controller.z, this.controller.yaw, this.simClockSec, Math.random, (candidate) => {
        const { x, z } = candidate.actor;
        return !this.roadsideStopCooldowns.has(roadsideStopKey(candidate)) &&
          !this.city.colliders.some((c) => !c.disabled && x > c.minX - 0.6 && x < c.maxX + 0.6 && z > c.minZ - 0.6 && z < c.maxZ + 0.6);
      },
    );
    if (!caller) {
      this.roadsideNextAt = this.simClockSec + 10;
      return;
    }
    const stop = caller.stop;
    const seed = Math.floor(Math.random() * 1e9);
    const offer = generateMission({ rng: mulberry32(seed), fromPlaceId: this.nearestPlaceId(), wet: this.env.getWeather() === 'rain', seed });
    const drop = placeById(offer.dropId);
    if (!drop) {
      this.peds.releaseRoadsideCaller(caller.id, stop.actor.x, stop.actor.z);
      this.roadsideNextAt = this.simClockSec + 10;
      return;
    }
    offer.kind = 'passenger';
    offer.pickupPosition = stop.pickup;
    offer.distance = findRoute(stop.pickup.x, stop.pickup.z, drop.x, drop.z).distance;
    offer.targetTime = clamp(Math.round(offer.distance / 4.6 * 1.65 + 16), 28, 280);
    offer.multiplier = 1;
    offer.fareEstimate = computeFare({ distance: offer.distance, timeTaken: 0, targetTime: offer.targetTime, mood: 88, damage: 0 }).total;
    offer.agreedFare = offer.fareEstimate;
    const look = caller.appearance;
    const actor = new PassengerActor({
      ...archetypeById(offer.archetype),
      colors: { shirt: look.shirt, lower: look.lower, skin: look.skin, accent: look.accent },
      skirt: look.hasSkirt ? 1 : 0,
      bag: look.hasBag,
    }, {
      hairColor: look.hair,
      bagColor: look.bag,
      onDispose: (x, z) => this.peds.releaseRoadsideCaller(caller.id, x, z),
    });
    actor.group.scale.setScalar(look.heightScale);
    actor.place(stop.actor.x, stop.actor.z, stop.actor.yaw);
    this.scene.add(actor.group);
    this.roadsideRequest = { offer, pedestrianId: caller.id, actor, stop, negotiation: new FareNegotiation(offer.fareEstimate), expiresAt: this.simClockSec + 38, offering: false };
    this.roadsideStopCooldowns.set(roadsideStopKey(stop), this.simClockSec + 180);
    this.roadsideNextAt = this.simClockSec + 45;
    this.audio.roadsideCallCue();
    this.speakLine('mission.roadside.call', 1);
  }

  private showRoadsideOffer(request: RoadsideRequest): void {
    this.ui.showRoadsideOffer(t(request.offer.dropName), request.negotiation.fare, request.negotiation.attempted,
      () => {
        if (this.roadsideRequest !== request) return;
        this.roadsideRequest = null; // ownership transfers to MissionSystem
        this.ui.hideJobOffer();
        this.paused = false;
        request.offer.agreedFare = request.negotiation.fare;
        request.offer.fareEstimate = request.negotiation.fare;
        this.missions.start(request.offer, request.actor);
      },
      () => {
        if (this.roadsideRequest !== request) return;
        this.clearRoadsideRequest(true);
        this.paused = false;
        this.speakLine('mission.roadside.cancel', 2);
      },
      () => {
        if (this.roadsideRequest !== request) return;
        const result = request.negotiation.attempt();
        if (result === 'rejected') {
          this.clearRoadsideRequest(true);
          this.paused = false;
          this.speakLine('mission.roadside.reject', 2);
          this.ui.toast(t('roadside.bargainRejected'), 'bad');
        } else if (result === 'accepted') {
          request.offer.agreedFare = request.negotiation.fare;
          request.offer.fareEstimate = request.negotiation.fare;
          this.showRoadsideOffer(request);
          this.speakLine('mission.roadside.accept', 2);
          this.ui.toast(t('roadside.bargainAccepted'), 'good');
        }
      },
    );
  }

  private acceptOffer(offer: MissionOffer): void {
    this.pendingOffer = null;
    this.missions.start(offer);
    this.ui.hideJobOffer();
    this.speakLine('mission.start.1', 2);
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
    if (this.roadRage.isControlLocked || this.cinematic.isPlaying) return;
    const next = force ?? !this.paused;
    if (next === this.paused) return;
    this.paused = next;
    this.input.clearAllHolds();
    if (this.paused) {
      this.controller.forceStopTurbo();
      this.audio.setTurboBoostAudio(false, 0);
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
    const free = this.mode === 'free' || this.raceSystem.isActive;
    const fee = free ? 0 : 45;
    if (fee > 0) this.state.spend(fee);

    const raceRespawn = this.raceSystem.isActive ? this.raceSystem.getSafeRespawnPose() : null;
    const snapped = snapToNearestRoad(
      raceRespawn ? raceRespawn.x : this.controller.x,
      raceRespawn ? raceRespawn.z : this.controller.z,
      false,
    );
    let rx = raceRespawn ? raceRespawn.x : snapped.x;
    let rz = raceRespawn ? raceRespawn.z : snapped.z;
    const targetYaw = raceRespawn ? raceRespawn.yaw : snapped.yaw;
    const seg = snapped.segment;
    const fx = Math.sin(targetYaw);
    const fz = Math.cos(targetYaw);
    const baseAlong = (rx - seg.ax) * seg.ux + (rz - seg.az) * seg.uz;
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
    this.controller.reset(rx, rz, targetYaw);
    this.chase.snapTo(rx, rz, targetYaw, this.controller.y);
    this.player.root.position.set(rx, this.controller.y, rz);
    this.ui.toast(t('toast.recovered'), 'good');
    this.audio.uiConfirm();
    if (this.paused) {
      this.paused = false;
      this.ui.show('hud');
    }
  }

  private recoverRickshawFreeAfterBust(): void {
    const snapped = snapToNearestRoad(this.controller.x, this.controller.z, false);
    this.controller.reset(snapped.x, snapped.z, snapped.yaw);
    this.chase.snapTo(snapped.x, snapped.z, snapped.yaw, this.controller.y);
    this.player.root.position.set(snapped.x, this.controller.y, snapped.z);
  }

  returnToMenu(): void {
    this.clearRoadsideRequest();
    this.activeBlacklistEscapeRank = null;
    this.stopWinnerPhoto();
    this.cinematic.stop(false);
    this.raceSystem.cancel();
    this.police.stopPursuit(true);
    this.roadblocks.clearAll();
    this.roadRage.cancel();
    this.input.clearAllHolds();
    this.tanWindLines.visible = false;
    this.controller.setTanActive(false);
    this.controller.forceStopTurbo();
    this.audio.setTanBoost(false);
    this.audio.setTurboBoostAudio(false, 0);
    this.audio.setPoliceSirenAudio(false, 0, 0);
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
  private garageGreetAt = -99;

  openGarage(from: 'menu' | 'pause' | 'result'): void {
    void from;
    this.stopWinnerPhoto();
    this.refreshShowroom();
    this.showroomVisible = true;
    if (this.simClockSec - this.garageGreetAt > 25) {
      this.garageGreetAt = this.simClockSec;
      this.speakLine('garage.ready.1', 1);
    }
  }

  openShowroomFromMenu(): void {
    this.stopWinnerPhoto();
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

    const tier = classifyCrashTier(magnitude) ?? 'minor';
    // §9 cinematic crash feedback: brief optional slow-mo + impact zoom (pooled,
    // reduced-motion aware, fast recovery — physics always keeps simulating).
    if (tier === 'major' && !this.settings.get().reduceEffects) {
      this.slowmoScale = 0.42;
      this.impactZoom = 0.22;
    } else if (tier === 'medium' && !this.settings.get().reduceEffects) {
      this.impactZoom = 0.12;
    }
    this.chase.addTrauma(
      tier === 'major'
        ? clamp(magnitude * 0.25, 0.28, 0.62)
        : tier === 'medium'
          ? clamp(magnitude * 0.2, 0.14, 0.42)
          : clamp(magnitude * 0.14, 0.05, 0.24),
    );
    this.audio.playArcadeCrash(tier, magnitude);
    if (!this.settings.get().reduceEffects) {
      this.arcadeVfx.triggerCrash(
        tier,
        this.controller.x,
        this.controller.y + 0.55,
        this.controller.z,
        nx || Math.sin(this.controller.yaw),
        nz || Math.cos(this.controller.yaw),
        this.env.wetness,
      );
    }
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
    this.state.damageFromImpact(
      magnitude * RIDE.conditionLossPerHit * durabilityReduction,
      this.simClockSec,
    );
    if (
      tier === 'major' &&
      this.mode === 'free' &&
      !this.raceSystem.isActive &&
      this.missions.state === 'none'
    ) {
      this.police.recordInfraction(
        0.85,
        this.controller.x,
        this.controller.z,
        this.controller.yaw,
        this.roadRage.isActive,
      );
    }
    if (this.controller.hardBrakes > 0) {
      this.missions.registerHardBrake();
      this.controller.hardBrakes = 0;
    }
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
      const broadR = ob.radius + 1.85;
      const distSq = dx * dx + dz * dz;
      if (distSq > broadR * broadR) continue;

      // Exact 2-circle rickshaw capsule vs rotated vehicle OBB (zero phantom air hits!)
      const hit = testRickshawCapsuleVsObb(
        this.controller.x,
        this.controller.z,
        this.controller.yaw,
        ob.x,
        ob.z,
        ob.halfWidth,
        ob.halfLength,
        ob.yaw,
      );
      if (hit.hit) {
        const oVx = Math.sin(ob.yaw) * ob.speed;
        const oVz = Math.cos(ob.yaw) * ob.speed;
        const relSpeed = Math.hypot(pVx - oVx, pVz - oVz);

        this.controller.x += hit.pushX;
        this.controller.z += hit.pushZ;

        // Tangential scrape vs direct impact: glancing passes preserve momentum!
        const pFwdX = Math.sin(this.controller.yaw);
        const pFwdZ = Math.cos(this.controller.yaw);
        const headOn = Math.abs(pFwdX * hit.nx + pFwdZ * hit.nz);
        const retain = 0.72 - headOn * 0.42;
        const speedLoss = Math.abs(this.controller.speed) * (1 - retain);
        this.controller.speed *= retain;
        const hitImpact = Math.max(speedLoss * 0.45 + 0.18, relSpeed * (0.14 + headOn * 0.16));
        impact = Math.max(impact, hitImpact);
        this.controller.hits++;

        // Milestone 2: High-impact collision with a private passenger car (`car` ONLY)
        if (ob.kind === 'car' && (Math.abs(preSpeed) >= 4.0 || relSpeed >= 4.2)) {
          this.roadRage.tryStart(ob.agentIndex, this.controller.x, this.controller.z);
        }
      } else if (
        this.nearMissCooldown <= 0 &&
        Math.abs(preSpeed) >= 5.2 &&
        distSq < (ob.halfWidth + 1.35) * (ob.halfWidth + 1.35)
      ) {
        // Clean high-speed near miss rewards Turbo charge!
        this.nearMissCooldown = 2.6;
        this.controller.addTurboCharge(TURBO.nearMissGain);
        this.state.turboCharge = this.controller.turboCharge;
        this.ui.toast(t('toast.nearMiss', { pct: TURBO.nearMissGain }), 'good');
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
    this.speakLine('vendor.tea.1', 1);
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

  // ------------------------------------------------ Blacklist, Cinematic & Rival Races (v0.5.0)
  /** §10 UI bridge — open the permanent career scrapbook from the menu. */
  openCareerScrapbook(): void {
    this.ui.openScrapbook(this.scrapbook.snapshot, this.scrapbook.snapshot.records);
  }

  openBlacklist(from: 'menu' | 'hud' | 'pause'): void {
    void this.audio.init();
    this.input.clearAllHolds();
    this.audio.setTurboBoostAudio(false, 0);
    this.pendingBlacklistFrom = from;
    if (from === 'hud' && this.mode !== 'menu') {
      this.paused = true;
    }

    // First-time entry triggers the skippable 18s Mohammadpur Blacklist intro cinematic!
    if (!this.state.blacklistIntroSeen) {
      this.state.markBlacklistIntroSeen();
      this.state.saveNow();
      this.playBlacklistIntro(() => {
        this.ui.openBlacklistView(this.pendingBlacklistFrom);
      });
      return;
    }
    this.ui.openBlacklistView(from);
  }

  replayBlacklistIntro(): void {
    this.playBlacklistIntro(() => {
      this.ui.openBlacklistView(this.pendingBlacklistFrom);
    });
  }

  private playBlacklistIntro(onDone: () => void): void {
    this.showroomVisible = false;
    this.paused = false;
    this.ui.show(null);
    const prevPhase = this.env.getPhase();
    this.env.setPhase('blue');
    this.cinematic.start(
      {
        x: this.controller.x,
        y: this.controller.y,
        z: this.controller.z,
        yaw: this.controller.yaw,
      },
      () => {
        if (!this.phaseLockedForDebug) {
          this.env.setPhase(this.mode === 'menu' ? prevPhase : this.gameTime.phase);
        }
        if (this.pendingBlacklistFrom === 'hud' && this.mode !== 'menu') {
          this.paused = true;
        }
        onDone();
      },
    );
  }

  playRivalIntro(rank: number, launchRaceAfter = false): void {
    const rival = rivalByRank(rank);
    if (!rival) return;
    void this.audio.init();
    this.stopWinnerPhoto();
    this.showroomVisible = false;
    this.paused = false;
    this.ui.show(null);
    const prevPhase = this.env.getPhase();
    this.env.setPhase('golden');
    this.cinematic.startRivalIntro(
      rival,
      {
        x: this.controller.x,
        y: this.controller.y,
        z: this.controller.z,
        yaw: this.controller.yaw,
      },
      () => {
        if (!this.phaseLockedForDebug) {
          this.env.setPhase(this.mode === 'menu' ? prevPhase : this.gameTime.phase);
        }
        if (launchRaceAfter) {
          this.startRivalEvent(rival.bossEvent.id);
        } else {
          if (this.pendingBlacklistFrom === 'hud' && this.mode !== 'menu') {
            this.paused = true;
          }
          this.ui.openBlacklistView(this.pendingBlacklistFrom);
        }
      },
    );
  }

  stopWinnerPhoto(): void {
    if (!this.winnerPhotoActive) return;
    this.winnerPhotoActive = false;
    this.winnerPhotoTimer = 0;
    this.player.setCharacterPose('riding', 0);
    this.player.setCockpitVisibility(this.mode !== 'menu' && this.settings.get().cameraMode === 'cockpit');
    this.chase.snapTo(this.controller.x, this.controller.z, this.controller.yaw, this.controller.y);
  }

  private startWinnerPhoto(): void {
    this.winnerPhotoActive = true;
    this.winnerPhotoTimer = 0;
    // Compose the actual victory scene before capture, so the saved image and
    // on-screen celebration show the same pose, vehicle and camera framing.
    const snapped = snapToNearestRoad(this.controller.x, this.controller.z, false);
    const gx = snapped.x;
    const gz = snapped.z;
    const gy = this.city.heightAt(gx, gz);
    this.controller.x = gx;
    this.controller.z = gz;
    this.controller.y = gy;
    this.player.root.position.set(gx, gy, gz);
    this.player.root.rotation.set(0, this.controller.yaw, 0, 'YXZ');
    this.player.setCockpitVisibility(false);
    this.player.setCharacterPose('victory', 0.25);
    this.player.updateVisual(1 / 60, 0, 0.14, 0, 0, gy, 0);
    this.updateWinnerPhotoCamera(0);
    this.renderer.render(this.scene, this.camera);
    const thumb = this.capturePhotoThumb();
    const evId = this.lastEventId ?? 'race';
    this.scrapbook.addRecord({
      id: `photo:win:${evId}`,
      category: 'photo',
      titleBn: 'বিজয়ের স্মারক ছবি',
      titleEn: 'Victory Photo',
      detailBn: `রেস জয়ের স্মারক — ${evId}`,
      detailEn: `Winner snapshot — ${evId}`,
      minutesOfDay: this.gameTime.minutesOfDay,
      vehicleId: this.state.selectedVehicleId,
      photoThumb: thumb,
    });
  }

  private updateWinnerPhotoCamera(dt: number): void {
    this.winnerPhotoTimer += dt;
    const px = this.player.root.position.x;
    const py = this.player.root.position.y;
    const pz = this.player.root.position.z;
    // Low three-quarter front-side hero angle showcasing rickshaw wheels, art, celebratory driver & Dhaka street!
    const sway = Math.sin(this.winnerPhotoTimer * 0.65) * 0.12;
    const heroAngle = this.controller.yaw + 0.72 + sway;
    const dist = 3.85;
    const camX = px + Math.sin(heroAngle) * dist;
    const camZ = pz + Math.cos(heroAngle) * dist;
    const camY = py + 1.44;
    this.camera.position.set(camX, camY, camZ);
    // Aim slightly below center so the rickshaw + driver sit right inside the upper-middle photo window!
    this.camera.lookAt(px, py + 0.78, pz);
    if (this.camera.fov !== 40) {
      this.camera.fov = 40;
      this.camera.updateProjectionMatrix();
    }
    this.player.setCharacterPose('victory', this.winnerPhotoTimer);
    this.player.updateVisual(Math.max(1 / 120, dt), 0, 0.14, 0, 0, py, 0);
  }

  skipBlacklistIntro(): void {
    this.cinematic.skip();
  }

  // ---------------------------------------------- DRMC map-accuracy overlay (DEV)
  private drmcOverlayGroup: THREE.Group | null = null;

  /**
   * DEV-only overlay comparing the OSM campus polygon projected through the
   * validated similarity fit (red) against the in-game campus placement (green),
   * with gate markers (gold). Used for the §1 accuracy screenshot evidence.
   */
  toggleDrmcOverlay(): boolean {
    if (this.drmcOverlayGroup) {
      this.scene.remove(this.drmcOverlayGroup);
      this.drmcOverlayGroup.clear();
      this.drmcOverlayGroup = null;
      return false;
    }
    const report = drmcOverlayReport();
    const g = new THREE.Group();
    g.name = 'drmc-accuracy-overlay';
    const line = (pts: Array<{ x: number; z: number }>, hex: number, yOff: number): void => {
      const geo = new THREE.BufferGeometry().setFromPoints(
        pts.map((p) => new THREE.Vector3(p.x, this.city.heightAt(p.x, p.z) + yOff, p.z)),
      );
      const m = new THREE.LineBasicMaterial({ color: hex, depthTest: false, transparent: true, opacity: 0.95 });
      const l = new THREE.LineLoop(geo, m);
      l.renderOrder = 2000;
      g.add(l);
    };
    line(report.projectedOsmPolygon, 0xff3b30, 0.5); // OSM ground truth (fitted)
    line(this.drmc.campusPolygon, 0x34c759, 0.85); // game placement
    // Gate markers
    const marker = (pt: { x: number; z: number }, hex: number, size: number): void => {
      const geo = new THREE.SphereGeometry(size, 10, 8);
      const m = new THREE.MeshBasicMaterial({ color: hex, depthTest: false, transparent: true, opacity: 0.95 });
      const s = new THREE.Mesh(geo, m);
      s.position.set(pt.x, this.city.heightAt(pt.x, pt.z) + 1.2, pt.z);
      s.renderOrder = 2001;
      g.add(s);
    };
    marker(report.projectedGate, 0xffd452, 1.1); // fitted OSM gate point
    marker(this.drmc.gate, 0x22d3ee, 0.85); // in-game gate structure
    this.drmcOverlayGroup = g;
    this.scene.add(g);
    return true;
  }

  /** DEV/report helper: geographic fit + placement comparison numbers. */
  debugDrmcReport(): Record<string, unknown> {
    const report = drmcOverlayReport();
    return {
      fitScale: +report.fit.scale.toFixed(4),
      fitRotationDeg: +report.fit.rotationDeg.toFixed(2),
      fitRms: +report.fit.rms.toFixed(1),
      fitMaxResidual: +report.fit.maxResidual.toFixed(1),
      projectedGate: {
        x: +report.projectedGate.x.toFixed(1),
        z: +report.projectedGate.z.toFixed(1),
      },
      gameGate: { x: this.drmc.gate.x, z: this.drmc.gate.z },
      gateToWallDistance: +report.gateToWallDistance.toFixed(1),
      campusPolygon: this.drmc.campusPolygon,
    };
  }

  /** Route guidance to the verified DRMC public entrance (connected-road path). */
  debugDrmcRoute(fromX: number, fromZ: number): { ok: boolean; distance: number; steps: number } {
    const plan = findRoute(fromX, fromZ, this.drmc.gate.x, this.drmc.gate.z);
    return {
      ok: plan.segmentIds.length > 0,
      distance: plan.distance,
      steps: plan.points.length,
    };
  }

  startBlacklistEscape(rank: number): void {
    const rival = rivalByRank(rank);
    if (!rival || rank !== this.state.blacklistRank || rank > 7 ||
        this.state.checklistForRival(rank, rival.repRequired).tasks.find((task) => task.task === 'escape')?.complete) return;
    if (this.raceSystem.isActive || this.police.isActive || this.roadRage.isActive ||
        this.cinematic.isPlaying || this.missions.state !== 'none' || this.pendingOffer || this.roadsideRequest) {
      this.ui.toast(t('blacklist.taskBusy'), 'bad');
      return;
    }
    if (this.mode === 'menu') this.startMode('free');
    this.paused = false;
    this.audio.setSceneMode('driving');
    this.ui.show('hud');
    this.activeBlacklistEscapeRank = rank;
    this.police.startPursuit(Math.min(5, 2 + Math.floor((7 - rank) / 2)), this.controller.x, this.controller.z, this.controller.yaw);
    this.ui.toast(t('blacklist.escapeStarted'), 'good');
  }

  startRivalEvent(eventId: string): void {
    const ev = eventById(eventId);
    if (!ev) return;
    const rival = ev.blacklistRank ? rivalByRank(ev.blacklistRank) ?? null : null;
    if (ev.blacklistRank && (!rival || !this.state.checklistForRival(rival.rank, rival.repRequired).ready)) {
      this.ui.toast(t('blacklist.tasksIncomplete'), 'bad');
      return;
    }
    this.clearRoadsideRequest();
    this.activeBlacklistEscapeRank = null;
    void this.audio.init();
    this.lastEventId = eventId;
    this.stopWinnerPhoto();
    this.cinematic.stop(false);
    this.roadRage.cancel();
    this.missions.cancel();
    this.pendingOffer = null;
    this.currentOffer = null;
    this.ui.hideJobOffer();
    this.police.stopPursuit(true);
    this.roadblocks.clearAll();
    this.showroomVisible = false;

    this.mode = 'free';
    this.paused = false;
    this.audio.setSceneMode('driving');

    if (ev.weatherOverride) {
      this.weatherDirector.setWeatherImmediate(ev.weatherOverride);
      this.env.setWeather(ev.weatherOverride);
      const wEv = this.env.getWeather();
      this.ui.setRainDrops(wEv === 'rain' || wEv === 'storm');
    }

    const grid = this.raceSystem.startEvent(ev, rival, this.controller.hits);
    this.traffic.clearStartZone(grid.x, grid.z, 19);
    this.controller.reset(grid.x, grid.z, grid.yaw);
    this.controller.restoreStamina(100);
    this.controller.addTurboCharge(100);
    this.player.setCharacterPose('riding', 0);
    this.player.root.position.set(grid.x, this.controller.y, grid.z);
    this.chase.snapTo(grid.x, grid.z, grid.yaw, this.controller.y);
    this.ui.show('hud');
    this.ui.applyControlLayout();

    // Speak the rival's exact manifest taunt line + their distinct intro sting!
    if (rival) {
      this.audio.playIntroSting(rival.id);
      this.speakLine(`rival.${rival.id}.taunt`, 3);
    }

    // Spawn event roadblocks & police pursuit if specified (well ahead of the 4-racer grid!)
    if (ev.roadblockCount && ev.roadblockCount > 0) {
      for (let i = 0; i < ev.roadblockCount; i++) {
        this.roadblocks.trySpawnAhead(
          grid.x + Math.sin(grid.yaw) * (24 + i * 38),
          grid.z + Math.cos(grid.yaw) * (24 + i * 38),
          Math.sin(grid.yaw),
          Math.cos(grid.yaw),
          ev.heatLevel ?? 2,
        );
      }
    }
    if (ev.heatLevel && ev.heatLevel > 0) {
      this.police.startPursuit(ev.heatLevel, grid.x, grid.z, grid.yaw);
    }

    const snap = this.raceSystem.update(
      0,
      grid.x,
      grid.z,
      this.controller.hits,
      this.simClockSec,
      this.traffic.obstacles(),
      this.roadblocks.getActiveObbs(),
    );
    if (snap.active) {
      this.lastRaceTargetX = snap.targetX;
      this.lastRaceTargetZ = snap.targetZ;
      this.recomputeRoute({ x: snap.targetX, z: snap.targetZ });
    }
    this.hudTick = 1;
    this.updateHud(this.state.vehicle().kind === 'electric');
  }

  retryLastEvent(): void {
    this.stopWinnerPhoto();
    if (this.lastEventId) {
      this.startRivalEvent(this.lastEventId);
    } else {
      this.exitRaceToFreeRide();
    }
  }

  exitRaceToFreeRide(): void {
    this.stopWinnerPhoto();
    this.raceSystem.cancel();
    this.police.stopPursuit(true);
    this.roadblocks.clearAll();
    this.activeRoute = null;
    this.paused = false;
    this.mode = 'free';
    this.audio.setSceneMode('driving');
    this.ui.show('hud');
  }

  private handleRaceFinished(summary: import('./blacklist/raceSystem').RaceResultSummary): void {
    this.input.clearAllHolds();
    this.controller.speed = 0;
    this.controller.setTanActive(false);
    this.audio.setTanBoost(false);
    this.audio.setTurboBoostAudio(false, 0);
    this.police.stopPursuit(true);
    this.roadblocks.clearAll();
    this.activeRoute = null;

    if (summary.won) {
      const paid = this.state.recordEventVictory({
        eventId: summary.event.id,
        cashReward: summary.cashDelta,
        repReward: summary.repEarned,
        blacklistRank: summary.rival?.rank,
      });
      if (!paid) {
        summary.cashDelta = 0;
        summary.repEarned = 0;
        summary.unlockedNextRank = null;
      }
      this.audio.successStinger();
      this.speakLine('race.win.1', 3);
      if (summary.event.blacklistRank) {
        this.scrapbook.addRecord({
          id: `blacklist:rank:${summary.event.blacklistRank}`,
          category: 'blacklist',
          titleBn: `ব্ল্যাকলিস্ট র‍্যাঙ্ক #${summary.event.blacklistRank} জয়`,
          titleEn: `Blacklist rank #${summary.event.blacklistRank} defeated`,
          detailBn: `র‍্যাঙ্ক #${summary.event.blacklistRank} পরাজিত!`,
          detailEn: `Rank #${summary.event.blacklistRank} defeated!`,
          minutesOfDay: this.gameTime.minutesOfDay,
          vehicleId: this.state.selectedVehicleId,
          repDelta: summary.repEarned,
        });
      }
      this.scrapbook.addRecord({
        id: `win:${summary.event.id}`,
        category: 'race',
        titleBn: 'রেস জয়',
        titleEn: 'Race Victory',
        detailBn: summary.event.titleBn,
        detailEn: summary.event.titleEn,
        minutesOfDay: this.gameTime.minutesOfDay,
        vehicleId: this.state.selectedVehicleId,
        takaDelta: summary.cashDelta,
        repDelta: summary.repEarned,
        placement: summary.playerPosition,
        topSpeedKmh: summary.topSpeedKmh,
        timeSeconds: summary.timeSeconds,
      });
      this.controller.addTurboCharge(TURBO.escapeGain);
      this.startWinnerPhoto();
    } else if (summary.cashDelta < 0) {
      this.stopWinnerPhoto();
      this.audio.failStinger();
      this.speakLine('race.lose.1', 3);
      this.scrapbook.recordRaceLoss(summary.event.id, {
        minutesOfDay: this.gameTime.minutesOfDay,
        vehicleId: this.state.selectedVehicleId,
        topSpeedKmh: summary.topSpeedKmh,
        timeSeconds: summary.timeSeconds,
        placement: summary.playerPosition,
      });
      const actualPaid = this.state.deductPenalty(Math.abs(summary.cashDelta));
      summary.cashDelta = -actualPaid;
    } else {
      this.stopWinnerPhoto();
      this.audio.failStinger();
    }

    this.state.setSpawn(this.controller.x, this.controller.z, this.controller.yaw);
    this.state.saveNow();
    this.paused = true;
    this.ui.openRaceResult(summary);
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
        if (place.id === 'drmc') {
          this.scrapbook.addRecord({
            id: 'landmark:drmc',
            category: 'milestone',
            titleBn: 'ঢাকা রেসিডেনশিয়াল মডেল কলেজ সফর',
            titleEn: 'Visited Dhaka Residential Model College',
            detailBn: 'DRMC-এর গেট পর্যন্ত পৌঁছেছেন!',
            detailEn: 'Reached the DRMC campus gate!',
            minutesOfDay: this.gameTime.minutesOfDay,
            vehicleId: this.state.selectedVehicleId,
          });
        }
        break;
      }
    }
  }

  /**
   * Cheap angle-dependent sun glare (Sunny state): strength peaks when the
   * camera looks toward the sun direction of the current day phase.
   */
  private computeSunGlare(): number {
    const wb = this.weatherDirector.weatherBlend;
    if (wb.overcast > 0.42 || wb.rain > 0.3) return 0;
    const phase = this.gameTime.phase;
    if (phase === 'night') return 0;
    // Sun azimuth from the current phase (radians); facing factor from camera yaw.
    const sunAz = phase === 'noon' ? 0.49 : phase === 'morning' ? 1.08 : phase === 'golden' ? 1.67 : 2.06;
    const camYaw = this.camera.rotation.y;
    const facing = Math.cos(camYaw - sunAz);
    const elevationGain = phase === 'golden' ? 1.15 : phase === 'morning' ? 1.0 : 0.72;
    return clamp01((facing - 0.62) * 1.55) * (1 - wb.overcast * 1.2) * elevationGain;
  }

  /** Realize a director event in-world with guaranteed cleanup semantics (§7). */
  private realizeDirectorEvent(ev: SpawnedEvent): void {
    const loc = getLocale();
    const fx = Math.sin(this.controller.yaw);
    const fz = Math.cos(this.controller.yaw);
    switch (ev.kind) {
      case 'traffic_accident':
      case 'broken_vehicle': {
        this.traffic.induceCongestionNear(ev.x, ev.z, ev.kind === 'traffic_accident' ? 1.9 : 1.35, 24);
        this.ui.toast(
          loc === 'en'
            ? ev.kind === 'traffic_accident'
              ? 'Traffic accident ahead — slow down!'
              : 'A broken vehicle is blocking part of the road!'
            : ev.kind === 'traffic_accident'
              ? 'সামনে ট্রাফিক দুর্ঘটনা — গতি কমান!'
              : 'রাস্তায় একটি নষ্ট গাড়ি আটকে আছে!',
          'bad',
        );
        ev.cleanup = () => undefined; // congestion decays exponentially — guaranteed cleanup
        break;
      }
      case 'construction': {
        for (let i = 0; i < 2; i++) {
          this.roadblocks.trySpawnAhead(
            ev.x + fx * (6 + i * 22),
            ev.z + fz * (6 + i * 22),
            fx,
            fz,
            1,
          );
        }
        this.ui.toast(loc === 'en' ? 'Road works ahead!' : 'সামনে সড়ক মেরামত চলছে!', 'bad');
        ev.cleanup = () => {
          this.roadblocks.despawnNear(ev.x, ev.z, 26);
        };
        break;
      }
      case 'police_checkpoint': {
        this.roadblocks.trySpawnAhead(ev.x, ev.z, fx, fz, 1);
        this.ui.toast(
          loc === 'en' ? 'Police checkpoint ahead — ride carefully!' : 'সামনে পুলিশ চেকপোস্ট — সাবধানে চালান!',
          'bad',
        );
        ev.cleanup = () => {
          this.roadblocks.despawnNear(ev.x, ev.z, 18);
        };
        break;
      }
      case 'vendor_blockage': {
        this.peds.alertBell(ev.x, ev.z);
        this.ui.toast(loc === 'en' ? 'A street vendor has narrowed the road!' : 'রাস্তা সরে দাগালে বিক্রেতা — ধীরে যান!', 'bad');
        ev.cleanup = () => undefined;
        break;
      }
      case 'weather_shift': {
        this.ui.toast(loc === 'en' ? 'The weather is changing over Mohammadpur!' : 'মোহাম্মদপুরের আবহাওয়া বদলাচ্ছে!', 'good');
        ev.cleanup = () => undefined;
        break;
      }
      case 'street_challenge': {
        this.ui.toast(loc === 'en' ? 'Street challenge spotted — check the Blacklist menu!' : 'স্ট্রিট চ্যালেঞ্জ দেখা যাচ্ছে — ব্ল্যাকলিস্ট মেনু দেখুন!', 'good');
        ev.cleanup = () => undefined;
        break;
      }
      case 'rare_photo': {
        this.ui.toast(loc === 'en' ? 'Rare photo moment! Strike a pose!' : 'বিরল মুহূর্ত! ছবির পোজ দিন!', 'good');
        this.score.register('impact');
        this.scrapbook.addRecord({
          id: `event:rare:${Math.floor(this.simClockSec / 30)}`,
          category: 'event',
          titleBn: 'বিরল রাস্তার মুহূর্ত',
          titleEn: 'Rare Street Moment',
          detailBn: 'মোহাম্মদপুরের রাস্তায় একটি বিরল মুহূর্ত তোলা হলো!',
          detailEn: 'A rare street moment captured in Mohammadpur!',
          minutesOfDay: this.gameTime.minutesOfDay,
          vehicleId: this.state.selectedVehicleId,
        });
        this.scrapbook.recordStat('rareEvents');
        ev.cleanup = () => undefined;
        break;
      }
      case 'rival_challenge': {
        ev.cleanup = () => undefined;
        break;
      }
    }
  }

  /**
   * §8 rival recognition in free roam: a Blacklist rival recognizes the player
   * near their territory, delivers a genuine voiced Bangla taunt + subtitle and
   * offers a spontaneous challenge (cooldown-gated; never interrupts missions,
   * modals, races, road-rage, police pursuits or active cinematics).
   */
  private maybeTriggerRivalEncounter(): void {
    if (this.simClockSec - this.rivalEncounterAt < 150) return;
    if (
      this.police.isActive ||
      this.roadRage.isActive ||
      this.cinematic.isPlaying ||
      this.missions.state !== 'none' ||
      this.ui.currentScreen !== 'hud'
    ) {
      return;
    }
    const anchors: Array<[string, string]> = [
      ['bl_10_raju', 'zakir'],
      ['bl_09_sumon', 'stand'],
      ['bl_08_tarek', 'school'],
      ['bl_07_nabila', 'library'],
      ['bl_06_halim', 'bazaar'],
      ['bl_05_faisal', 'garage'],
      ['bl_04_badol', 'humayun'],
      ['bl_03_sakib', 'launch'],
      ['bl_02_ranga', 'market'],
      ['bl_01_samrat', 'pharmacy'],
    ];
    for (const [rivalId, placeId] of anchors) {
      const place = placeById(placeId);
      if (!place) continue;
      const d = Math.hypot(place.x - this.controller.x, place.z - this.controller.z);
      if (d > 17) continue;
      const rival = BLACKLIST_RIVALS.find((r) => r.id === rivalId);
      if (!rival || !this.state.checklistForRival(rival.rank, rival.repRequired).ready) continue;
      this.rivalEncounterAt = this.simClockSec;
      const loc = getLocale();
      const name = loc === 'en' ? rival.nameEn : rival.nameBn;
      this.speakLine(`rival.${rival.id}.intro`, 3);
      this.scrapbook.addRecord({
        id: `rival:encounter:${rivalId}:${Math.floor(this.simClockSec / 90)}`,
        category: 'rival',
        titleBn: `রাইভাল সাক্ষাৎ — ${name}`,
        titleEn: `Rival encounter — ${name}`,
        detailBn: `${terr(rival, loc)} এলাকায় ${name} আপনাকে চিনতে পেরেছেন!`,
        detailEn: `${name} recognized you near ${terr(rival, loc)}!`,
        minutesOfDay: this.gameTime.minutesOfDay,
        vehicleId: this.state.selectedVehicleId,
      });
      this.ui.showRivalChallenge(
        name,
        terr(rival, loc),
        () => {
          this.startRivalEvent(rival.bossEvent.id);
        },
        () => {
          this.ui.toast(loc === 'en' ? 'Maybe next time!' : 'পরেরবার হয়তো!', 'good');
        },
      );
      return;
    }

    function terr(rival: { territoryBn: string; territoryEn: string }, loc: 'bn' | 'en'): string {
      return loc === 'en' ? rival.territoryEn : rival.territoryBn;
    }
  }

  /** §9 stunt/score feedback (bounded HUD chip; optional first-time scrapbook record). */
  private handleStunt(ev: StuntEvent): void {
    const loc = getLocale();
    this.stuntChipUntil = this.simClockSec + 2.2;
    this.ui.showStuntChip(loc === 'en' ? ev.labelEn : ev.labelBn, ev.points, ev.combo);
    this.scrapbook.recordStat(ev.kind === 'near_miss' ? 'nearMisses' : 'stunts');
    this.scrapbook.recordBestCombo(ev.combo);
    const firstId = `stunt:first:${ev.kind}`;
    if (!this.scrapbook.findRecord(firstId)) {
      this.scrapbook.addRecord({
        id: firstId,
        category: 'stunt',
        titleBn: `প্রথম ${ev.labelBn}`,
        titleEn: `First ${ev.labelEn}`,
        detailBn: `নতুন স্কিল আনলক: ${ev.labelBn}`,
        detailEn: `New skill unlocked: ${ev.labelEn}`,
        minutesOfDay: this.gameTime.minutesOfDay,
        vehicleId: this.state.selectedVehicleId,
      });
    }
  }

  /**
   * Capture a small JPEG thumbnail of the live winner-photo composition (called
   * synchronously right after a render so the drawing buffer is still valid).
   * Bounded size; failure simply leaves the record without a thumbnail (the
   * scrapbook then shows a designed framed card instead of a broken button).
   */
  private capturePhotoThumb(): string | undefined {
    try {
      const srcCanvas = this.renderer.domElement;
      const w = 240;
      const h = Math.max(120, Math.round((w * srcCanvas.height) / Math.max(1, srcCanvas.width)));
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const ctx = off.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(srcCanvas, 0, 0, w, h);
      const url = off.toDataURL('image/jpeg', 0.62);
      return url.length <= 18_500 ? url : undefined;
    } catch {
      return undefined;
    }
  }

  /** Speak one exact manifest dialogue line with per-character voice identity. */
  private speakLine(lineId: string, priority: 1 | 2 | 3 = 2): void {
    const line = dialogueLine(lineId);
    if (!line) return;
    const loc = getLocale();
    const s = this.settings.get();
    const spec = loc === 'en' ? line.voiceEn ?? line.voice : line.voice;
    const tr = ttsPitchRate(spec);
    this.speech.speak({
      speaker: line.category === 'police' ? 'police' : line.category === 'road_rage' || line.character === 'roadside.speaker' ? 'driver' : line.character === 'player' ? 'player' : 'rival',
      text: dialogueText(lineId, loc) ?? line.bn,
      locale: loc,
      priority,
      volume: s.dialogue * s.master,
      muted: s.muted || !s.sfxEnabled,
      lineId,
      voicePitch: tr.pitch,
      voiceRate: tr.rate,
    });
    if (s.subtitles) {
      this.ui.showRoadRageSubtitle(line.character, dialogueText(lineId, loc) ?? line.bn);
    }
  }

  // ------------------------------------------------------------------ HUD
  private updateHud(isElectric = false): void {
    if (this.hudTick < 0.05) return;
    this.hudTick = 0;
    const mission = this.missions;
    const offer = this.currentOffer;
    const zone = mission.zone;
    const waiting = this.roadsideRequest;
    const marker = zone ?? waiting?.stop.pickup ?? null;
    let markerX: number | null = null;
    let markerY: number | null = null;
    let distance = 0;
    if (marker) {
      this.tmpProjVec.set(marker.x, zone?.marker ?? 2, marker.z).project(this.camera);
      if (this.tmpProjVec.z < 1) {
        markerX = (this.tmpProjVec.x * 0.5 + 0.5) * window.innerWidth;
        markerY = (-this.tmpProjVec.y * 0.5 + 0.5) * window.innerHeight;
      }
      distance = Math.hypot(marker.x - this.controller.x, marker.z - this.controller.z);
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
    } else if (waiting) {
      label = t('roadside.speaker');
      title = t('roadside.nearby');
      sub = `${t('roadside.stopPrompt')} · ${formatDistance(distance)}`;
    } else if (this.mode === 'free') {
      label = t('hud.free');
      title = t('place.bazaar');
      sub = t('menu.freeRideDesc');
    } else if (this.pendingOffer) {
      label = this.pendingOffer.kind === 'market' ? t('mission.market') : t('mission.standard');
      title = t(this.pendingOffer.pickupName);
      sub = t('mission.negotiate', { fare: formatTaka(this.pendingOffer.fareEstimate) });
    }

    const raceSnap = this.raceSystem.isActive
      ? this.raceSystem.update(0, this.controller.x, this.controller.z, this.controller.hits, this.simClockSec)
      : null;

    if (raceSnap && raceSnap.active) {
      const loc = getLocale();
      label = t(`event.kind.${this.raceSystem.currentEvent?.kind ?? 'street_race'}`);
      title = loc === 'en' ? raceSnap.eventTitleEn : raceSnap.eventTitleBn;
      distance = Math.hypot(raceSnap.targetX - this.controller.x, raceSnap.targetZ - this.controller.z);
      sub = `${t('race.cp', { cur: raceSnap.checkpointIndex, tot: raceSnap.checkpointTotal })} · ${formatDistance(distance)}`;
      this.tmpProjVec.set(raceSnap.targetX, 3.0, raceSnap.targetZ).project(this.camera);
      if (this.tmpProjVec.z < 1) {
        markerX = (this.tmpProjVec.x * 0.5 + 0.5) * window.innerWidth;
        markerY = (-this.tmpProjVec.y * 0.5 + 0.5) * window.innerHeight;
      }
    }

    const pState = this.police.currentPhase;
    const pProg =
      pState === 'losingSight' || pState === 'cooldown'
        ? this.police.evadeRatio
        : this.police.bustedRatio;

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
      markerLabel: raceSnap?.active ? 'CP' : zone ? t(zone.nameKey) : waiting ? t('roadside.speaker') : null,
      cameraMode: this.settings.get().cameraMode,
      isElectric,
      battery: this.controller.battery,
      stamina: this.controller.stamina,
      tanActive: this.controller.tanActive,
      teaAvailable: this.isTeaRestAvailable(isElectric),
      routePoints: this.activeRoute ? this.activeRoute.points : null,
      jammedSegments: this.jammedList,
      detourActive: !!this.activeRoute?.avoidedJam,
      clockText: this.gameTime.formatted,
      turboCharge: this.controller.turboCharge,
      turboActive: this.controller.turboActive,
      rep: this.state.rep,
      condition: this.state.progress.condition,
      conditionLow: this.state.progress.condition < 35,
      policeState: pState,
      policeHeat: this.police.heatLevel,
      policeProgress: pProg,
      policeUnits: this.police.getActiveSnapshots().map((u) => ({ active: true, x: u.x, z: u.z })),
      roadblocks: this.roadblocks.getMinimapMarkers().map((m) => ({ active: true, smashed: false, x: m.x, z: m.z })),
      race:
        raceSnap && raceSnap.active
          ? {
              active: true,
              countdownText: raceSnap.countdownText,
              title,
              pos: raceSnap.playerRank,
              total: raceSnap.totalRacers,
              cpCur: raceSnap.checkpointIndex,
              cpTot: raceSnap.checkpointTotal,
              lapCur: raceSnap.lapIndex,
              lapTot: raceSnap.lapTotal,
              remSec: raceSnap.remainingSeconds,
              targetX: raceSnap.targetX,
              targetZ: raceSnap.targetZ,
              rivalX: raceSnap.rivalX,
              rivalZ: raceSnap.rivalZ,
              hasRival: raceSnap.hasRival,
              rivals: raceSnap.rivals,
            }
          : null,
    };
    this.ui.updateHud(hudState);
    this.ui.setMinimapPlayer(this.controller.x, this.controller.z, this.controller.yaw);
    this.ui.setMinimapMarker(marker ? { x: marker.x, z: marker.z } : null);
  }

  private hintForState(): string | null {
    if (this.controller.stuck) return 'hud.stuck';
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
    return this.roadsideRequest ? 'roadside.stopPrompt' : null;
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
    setTextureQuality(
      s.quality === 'pc_high' ? 16 : s.quality === 'high' ? 8 : s.quality === 'balanced' ? 4 : 1,
    );
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
    const spDiag = this.speech.getDiagnostics();
    this.devPerf.update(
      dt,
      this.renderer,
      this.traffic.vehicleCount,
      this.peds.activePedestrianCount,
      this.jammedList.length,
      {
        speechMode: spDiag.engine,
        voiceName: spDiag.selectedVoice,
        voiceLang: spDiag.locale,
        fallbackReason: spDiag.fallbackReason,
        colliderDebug: this.colliderDebug.isEnabled(),
        clockText: this.gameTime.formatted,
      },
    );
  }

  // --------------------------------------------------------- test & debug hooks
  debugSnapshot(): Record<string, unknown> {
    const spDiag = this.speech.getDiagnostics();
    return {
      audio: this.audio.ready,
      audioUnlocked: this.audio.unlocked,
      audioScene: this.audio.currentSceneMode,
      audioAssets: this.audio.loadedAssetCount,
      audioActiveSources: this.audio.activeSourceCount,
      speechBackend: this.speech.activeBackend,
      speechCount: this.speech.spokenCount,
      speechLastText: this.speech.lastSpokenText,
      speechDiagnostics: spDiag,
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
      turboCharge: this.controller.turboCharge,
      turboActive: this.controller.turboActive,
      clockText: this.gameTime.formatted,
      clockMinutes: this.gameTime.minutesOfDay,
      dayPhase: this.env.getPhase(),
      rep: this.state.rep,
      blacklistRank: this.state.blacklistRank,
      blacklistIntroSeen: this.state.blacklistIntroSeen,
      cinematicPlaying: this.cinematic.isPlaying,
      raceActive: this.raceSystem.isActive,
      policeState: this.police.currentPhase,
      policeHeat: this.police.heatLevel,
      policeUnits: this.police.activeUnitCount,
      roadblocksActive: this.roadblocks.activeCount,
      activeVfxParticles: this.arcadeVfx.getActiveParticleCount(),
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
      weatherBlend: { ...this.weatherDirector.weatherBlend },
      scrapbookRecords: this.scrapbook.recordCount,
      scrapbookWins: this.scrapbook.snapshot.raceWins,
      scrapbookTopSpeed: this.scrapbook.snapshot.topSpeedKmh,
      scrapbookPhotos: this.scrapbook.photoCount,
      scoreCombo: this.score.currentCombo,
      stuntChipActive: this.simClockSec < this.stuntChipUntil,
      scoreBest: this.score.best,
      activeDirectorEvents: this.eventDirector.activeCount,
      rivalEncounterCooldown: Math.max(0, 150 - (this.simClockSec - this.rivalEncounterAt)),
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
    this.phaseLockedForDebug = true;
    this.env.setPhase(phase);
    this.env.setWeather(weather);
  }

  debugSetTimeForTest(hour24: number, minute = 0): string {
    this.phaseLockedForDebug = false;
    this.gameTime.setMinutes(hour24 * 60 + minute);
    this.state.setClockMinutes(this.gameTime.minutesOfDay);
    this.env.setPhase(this.gameTime.phase);
    this.hudTick = 1;
    this.updateHud(this.state.vehicle().kind === 'electric');
    return this.gameTime.formatted;
  }

  debugStartPursuitForTest(heat = 2): void {
    this.police.startPursuit(heat, this.controller.x, this.controller.z, this.controller.yaw);
    this.hudTick = 1;
    this.updateHud(this.state.vehicle().kind === 'electric');
  }

  debugStartEventForTest(eventId: string): void {
    this.startRivalEvent(eventId);
  }

  debugOpenBlacklistForTest(): void {
    this.openBlacklist('menu');
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
      this.debugStepSim(0.32);
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
