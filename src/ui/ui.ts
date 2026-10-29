/**
 * The full game UI: main menu, HUD, pause, results, garage, store, settings,
 * credits, tutorial, loading and toasts. DOM-based so Bangla text shapes
 * perfectly and the layout is genuinely responsive on phones.
 */

import { t, getLocale, setLocale, STRING_KEYS, type Locale } from '../core/i18n';
import { formatDistance, formatTaka, clamp, clamp01 } from '../core/mathx';
import { QUALITY, type CameraMode, type QualityPreset } from '../core/config';
import { APP_VERSION } from '../core/version';
import type { Settings, SettingsStore } from '../core/settings';
import type { GameState } from '../core/gameState';
import type { InputManager } from '../core/input';
import type { AudioEngine } from '../audio/audio';
import type { FareBreakdown, VehicleStatInfo } from '../economy/economy';
import { vehicleStats } from '../economy/economy';
import {
  COSMETICS,
  TAPES,
  UPGRADES,
  VEHICLES,
  cosmeticById,
  cosmeticsByCategory,
  vehicleById,
  type CosmeticCategory,
} from '../economy/catalog';
import { ROADS, PLACES, segmentById } from '../world/layout';
import { drmcGamePolygon, DRMC_GATE, DRMC_GATE_ROAD_POINT, DRMC_SIDE_GATE, DRMC_SIDE_GATE_ROAD_POINT } from '../world/drmcGeo';
import { h, button, slider, toggle, segmented, sheet, modal, statBar, clear } from './dom';
import { ICONS } from './icons';
import type { MissionOffer } from '../missions/mission';
import {
  BLACKLIST_RIVALS,
  OPEN_STREET_EVENTS,
  renderRivalPortraitSvg,
  type RivalEventSpec,
} from '../blacklist/blacklistCatalog';
import type { CinematicUiState } from '../blacklist/cinematic';
import type { RaceResultSummary } from '../blacklist/raceSystem';
import type { ScrapbookRecord, ScrapbookSnapshot } from '../career/scrapbook';

export interface HudState {
  speed: number;
  money: number;
  objectiveLabel: string;
  objectiveTitle: string;
  objectiveSub: string;
  distance: number;
  timeLeft: number | null;
  mood: number;
  hint: string | null;
  stuck: boolean;
  passengerAboard: boolean;
  markerX: number | null;
  markerY: number | null;
  markerLabel: string | null;
  cameraMode?: CameraMode;
  isElectric?: boolean;
  battery?: number;
  stamina?: number;
  tanActive?: boolean;
  teaAvailable?: boolean;
  routePoints?: { x: number; z: number }[] | null;
  jammedSegments?: string[];
  detourActive?: boolean;
  // v0.5.0 Dynamic Time, Turbo, REP, Condition, Police & Rival Race
  clockText?: string;
  turboCharge?: number;
  turboActive?: boolean;
  rep?: number;
  condition?: number;
  conditionLow?: boolean;
  policeState?: 'idle' | 'detecting' | 'pursuing' | 'losingSight' | 'cooldown';
  policeHeat?: number;
  policeProgress?: number;
  policeUnits?: readonly { active: boolean; x: number; z: number }[];
  roadblocks?: readonly { active: boolean; smashed: boolean; x: number; z: number }[];
  race?: {
    active: boolean;
    countdownText: string;
    title: string;
    pos: 1 | 2 | 3 | 4;
    total: 2 | 4;
    cpCur: number;
    cpTot: number;
    lapCur?: number;
    lapTot?: number;
    remSec: number;
    targetX: number;
    targetZ: number;
    rivalX: number;
    rivalZ: number;
    hasRival: boolean;
    rivals?: readonly { x: number; z: number; accentHex: string }[];
  } | null;
}

export interface UIBridge {
  input: InputManager;
  audio: AudioEngine;
  startMode(mode: 'duty' | 'free' | 'daily'): void;
  resumeGame(): void;
  pauseGame(): void;
  restartMission(): void;
  recoverRickshaw(): void;
  returnToMenu(): void;
  nextJob(): void;
  enterFreeRide(): void;
  openGarage(from: 'menu' | 'pause' | 'result'): void;
  closeGarage(): void;
  openShowroomFromMenu?(): void;
  previewVehicleInShowroom?(vehicleId: string): void;
  setShowroomVisible(visible: boolean): void;
  rotateShowroom(dx: number): void;
  setTrack(track: 'cassette' | 'radio' | 'brishti'): void;
  setCameraMode(mode: CameraMode): void;
  toggleCamera(): void;
  toggleTanBoost(): void;
  buyRoadsideTea(): void;
  settleRoadRagePay(): void;
  refuseRoadRagePay(): void;
  openBlacklist(from: 'menu' | 'hud' | 'pause'): void;
  openCareerScrapbook(): void;
  startRivalEvent(eventId: string): void;
  startBlacklistEscape(rank: number): void;
  playRivalIntro(rank: number, launchRaceAfter?: boolean): void;
  stopWinnerPhoto(): void;
  retryLastEvent(): void;
  exitRaceToFreeRide(): void;
  replayBlacklistIntro(): void;
  skipBlacklistIntro(): void;
  isAndroidApp(): boolean;
  applySettings(): void;
  dailyAvailable(): boolean;
  installPrompt?(): void;
  hasSave(): boolean;
}

/** Enabled in Milestone 5 once the stable release APK asset URL is published and verified. */
export const ENABLE_WEB_INSTALL_APK_BUTTON = true;
export const STABLE_APK_DOWNLOAD_URL =
  'https://github.com/SmallSTUDIO-cloud/Banglar_Tesla/releases/latest/download/Banglar-Tesla.apk';

export class AppUI {
  private root: HTMLElement;
  private toastStack: HTMLElement;
  private screens = new Map<string, HTMLElement>();
  private current: string | null = null;
  private overlays: { name: string; el: HTMLElement }[] = [];
  private hud!: HTMLElement;
  private menuEl!: HTMLElement;
  private pauseEl!: HTMLElement;
  private resultEl!: HTMLElement;
  private garageEl: HTMLElement | null = null;
  private storeEl: HTMLElement | null = null;
  private settingsEl: HTMLElement | null = null;
  private creditsEl: HTMLElement | null = null;
  private tutorialEl: HTMLElement | null = null;
  private blacklistEl: HTMLElement | null = null;
  private raceResultEl: HTMLElement | null = null;
  private cinematicEl!: HTMLElement;
  private cinematicBadgeEl!: HTMLElement;
  private cinematicHeadEl!: HTMLElement;
  private cinematicSubEl!: HTMLElement;
  private cinematicSkipBtn!: HTMLElement;
  private loadingEl!: HTMLElement;
  private dialogueEl!: HTMLElement;
  private dialogueTimer = 0;
  private miniCanvas: HTMLCanvasElement | null = null;
  private settingsReturn: (() => void) | null = null;
  private lastHintKey: string | null = null;
  private wheelActive = false;
  private wheelPointerId: number | null = null;
  private wheelStartX = 0;
  private touchReleaseCallbacks: Array<() => void> = [];
  private garageTab: 'paint' | 'upgrades' | 'accessories' | 'vehicles' = 'paint';
  private garageFrom: 'menu' | 'pause' | 'result' = 'menu';
  private storeTab: 'vehicles' | 'upgrades' | 'paint' | 'accessories' = 'vehicles';
  private blacklistTab: 'rivals' | 'events' = 'rivals';
  private blacklistFrom: 'menu' | 'hud' | 'pause' = 'menu';
  private toastLastAt = new Map<string, number>();
  // vNext §4 weather overlays: event-driven writes only (no per-frame DOM churn)
  private sunGlareEl: HTMLElement | null = null;
  private sunGlareState = '';
  private lightningEl: HTMLElement | null = null;
  private rainDropEls: HTMLElement[] = [];
  private rainDropsActive = false;
  private stuntChipEl: HTMLElement | null = null;
  private rivalChallengeEl: HTMLElement | null = null;
  private scrapbookEl: HTMLElement | null = null;
  private busy = false;
  private installEvent: Event | null = null;
  private currentTape: 'cassette' | 'radio' | 'brishti' = 'cassette';

  constructor(
    private bridge: UIBridge,
    private state: GameState,
    private settingsStore: SettingsStore,
  ) {
    this.root = document.getElementById('ui-root') ?? document.body;
    this.toastStack = h('div', { class: 'toast-stack' });
    this.root.append(this.toastStack);
    this.buildWeatherOverlays();
    this.buildMenu();
    this.buildHud();
    this.buildPause();
    this.buildResult();
    this.buildCinematicOverlay();
    this.buildLoading();
    this.show('menu');

    this.state.on('balance', () => {
      this.refreshMenuChrome();
    });
    this.state.on('rep', () => {
      this.refreshMenuChrome();
    });
    this.state.on('toast', (payload) => {
      // `toast.conditionLow` is displayed via the single persistent `#hud-condition-warn`
      // HUD element + edge-triggered single toast with 30s cooldown (zero spam!).
      if (payload.key === 'toast.conditionLow') {
        const now = performance.now();
        const prev = this.toastLastAt.get('__cond_low__') ?? -60000;
        if (now - prev < 30000) return;
        this.toastLastAt.set('__cond_low__', now);
      }
      this.toast(t(payload.key, payload.params), payload.tone);
    });
    this.bridge.audio.onUnlockChange(() => {
      this.syncSoundUnlockPrompts();
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installEvent = e;
      void this.installEvent;
      this.refreshMenuChrome();
    });
    window.addEventListener('blur', () => this.releaseTouchInputs());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseTouchInputs();
    });
  }

  releaseTouchInputs(): void {
    for (const release of this.touchReleaseCallbacks) release();
    this.bridge.input.setTouchSteer(0);
    this.bridge.input.setWheelSteer(0);
    this.bridge.input.setPedal(false);
    this.bridge.input.setBrake(false);
    this.bridge.input.setTurbo(false);
  }

  /** Handles Android hardware back / browser back navigation. Returns true if consumed. */
  handleBackAction(): boolean {
    if (!this.cinematicEl.classList.contains('hidden')) {
      this.bridge.skipBlacklistIntro();
      return true;
    }
    if (this.roadRageModalEl) {
      // Cannot bypass active road-rage confrontation via hardware back
      return true;
    }
    switch (this.current) {
      case 'hud':
        this.bridge.pauseGame();
        return true;
      case 'pause':
        this.bridge.resumeGame();
        return true;
      case 'blacklist':
        this.closeBlacklist();
        return true;
      case 'raceResult':
        this.bridge.exitRaceToFreeRide();
        return true;
      case 'settings':
        this.closeSettings();
        return true;
      case 'garage':
        this.closeGarage();
        return true;
      case 'store':
        this.closeStore();
        return true;
      case 'credits':
        this.show('menu');
        return true;
      case 'tutorial':
        this.finishTutorial();
        return true;
      case 'result':
        this.bridge.returnToMenu();
        return true;
      default:
        return false;
    }
  }

  // -------------------------------------------------------------- screens
  private register(name: string, el: HTMLElement): HTMLElement {
    this.screens.set(name, el);
    el.classList.add('hidden');
    this.root.append(el);
    return el;
  }

  show(name: string | null): void {
    if (name !== 'hud') this.releaseTouchInputs();
    for (const [, el] of this.screens) el.classList.add('hidden');
    this.current = name;
    if (name) this.screens.get(name)?.classList.remove('hidden');
    if (name === 'menu') this.refreshMenuChrome();
    if (name === 'garage' || name === 'store' || name === 'settings') {
      this.bridge.setShowroomVisible(name === 'garage' || name === 'store');
    }
  }

  get currentScreen(): string | null {
    return this.current;
  }

  isGameplayVisible(): boolean {
    return this.current === 'hud';
  }

  // ---------------------------------------------------------------- menu
  private buildMenu(): void {
    const el = h('div', { class: 'screen menu-screen' });
    const money = h('div', { class: 'menu-money' },
      h('span', { class: 'menu-money-icon', html: ICONS.coin }),
      h('span', { attrs: { id: 'menu-balance' }, text: formatTaka(this.state.balance) }),
    );
    const repChip = h('div', { class: 'menu-rep-chip' },
      h('span', { html: ICONS.trophy }),
      h('span', { attrs: { id: 'menu-rep' }, text: `${t('hud.rep')} ${this.state.rep}` }),
    );

    const brand = h('div', { class: 'menu-brand' },
      h('div', { class: 'menu-emblem', html: `<svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="34" fill="none" stroke="#E8B25A" stroke-width="2" opacity="0.8"/>
        <circle cx="50" cy="50" r="24" fill="none" stroke="#3AA0FF" stroke-width="3"/>
        <g stroke="#F7F0E3" stroke-width="1.8">
          <line x1="50" y1="26" x2="50" y2="74"/><line x1="26" y1="50" x2="74" y2="50"/>
          <line x1="33" y1="33" x2="67" y2="67"/><line x1="67" y1="33" x2="33" y2="67"/>
        </g>
        <g fill="#E8644A"><circle cx="50" cy="14" r="2.6"/><circle cx="86" cy="50" r="2.6"/><circle cx="50" cy="86" r="2.6"/><circle cx="14" cy="50" r="2.6"/></g>
        <circle cx="50" cy="50" r="6" fill="#E8B25A"/>
      </svg>` }),
      h('div', {},
        h('div', { class: 'menu-title', text: 'BANGLAR TESLA' }),
        h('div', { class: 'menu-title-bn', text: 'বাংলার টেসলা' }),
        h('div', { class: 'menu-sub', text: t('menu.tagline') }),
      ),
    );

    const soundUnlockMenu = h('button', {
      class: 'sound-unlock-pill hidden',
      attrs: { id: 'menu-sound-unlock', type: 'button' },
      on: {
        click: () => {
          void this.bridge.audio.init().then(() => {
            this.bridge.audio.uiTap();
            this.syncSoundUnlockPrompts();
          });
        },
      },
    },
      h('span', { html: ICONS.speaker }),
      h('span', { text: t('audio.tapToUnlock') }),
    );
    this.menuSoundUnlockEl = soundUnlockMenu;

    const topRightRow = h('div', { class: 'menu-top-row' }, soundUnlockMenu, repChip, money);
    const topRight = h('div', { class: 'menu-top-right' }, topRightRow);
    if (ENABLE_WEB_INSTALL_APK_BUTTON && !this.bridge.isAndroidApp()) {
      const apkLink = h('a', {
        class: 'install-apk-btn',
        attrs: {
          id: 'install-apk-btn',
          href: STABLE_APK_DOWNLOAD_URL,
          download: 'Banglar-Tesla.apk',
          rel: 'noopener noreferrer',
          title: t('menu.installApkSub'),
        },
        on: {
          click: () => {
            this.bridge.audio.uiConfirm();
            this.toast(t('toast.apkDownload'), 'good');
          },
        },
      },
        h('span', { html: ICONS.smartphone }),
        h('span', { text: t('menu.installApk') }),
      );
      const apkNote = h('div', {
        class: 'install-apk-note',
        attrs: { id: 'install-apk-note' },
        text: t('menu.installApkSub'),
      });
      topRight.append(apkLink, apkNote);
    }

    const top = h('div', { class: 'menu-top' }, brand, topRight);

    const modeRow = h('div', { class: 'menu-modes' });
    const modes: { id: 'duty' | 'free' | 'daily'; icon: string; title: string; desc: string }[] = [
      { id: 'duty', icon: 'rickshaw', title: 'menu.passengerDuty', desc: 'menu.passengerDutyDesc' },
      { id: 'free', icon: 'compass', title: 'menu.freeRide', desc: 'menu.freeRideDesc' },
      { id: 'daily', icon: 'calendar', title: 'menu.daily', desc: 'menu.dailyDesc' },
    ];
    for (const mode of modes) {
      const card = h('button', {
        class: 'mode-card',
        attrs: { type: 'button', 'data-mode': mode.id },
        on: {
          click: () => {
            this.bridge.audio.uiTap();
            this.bridge.startMode(mode.id);
          },
        },
      },
        h('span', { class: 'mc-icon', html: ICONS[mode.icon as keyof typeof ICONS] }),
        h('span', { class: 'mc-text' },
          h('span', { class: 'mc-title', text: t(mode.title) }),
          h('span', { class: 'mc-desc', text: t(mode.desc) }),
        ),
      );
      if (mode.id === 'daily' && !this.bridge.dailyAvailable()) card.classList.add('done');
      modeRow.append(card);
    }

    const playBtn = button(t('common.play'), {
      variant: 'primary',
      wide: true,
      onClick: () => {
        this.bridge.audio.uiConfirm();
        this.startModePrompt();
      },
    });
    const continueBtn = button(t('common.continue'), {
      variant: 'ghost',
      onClick: () => {
        this.bridge.audio.uiTap();
        const mode = this.state.progress.lastMode;
        this.bridge.startMode(mode === 'free' ? 'free' : mode === 'daily' ? 'daily' : 'duty');
      },
    });

    const blacklistBtn = button(t('menu.blacklist'), {
      variant: 'gold',
      wide: true,
      sub: t('menu.blacklistSub'),
      attrs: { id: 'menu-blacklist-btn', 'data-action': 'open-blacklist' },
      onClick: () => {
        this.bridge.audio.uiConfirm();
        this.bridge.openBlacklist('menu');
      },
    });

    const secondary = h('div', { class: 'menu-secondary' },
      button(t('common.garage'), { variant: 'ghost', attrs: { 'data-action': 'open-garage' }, onClick: () => this.openGarage('menu') }),
      button(t('common.store'), { variant: 'ghost', attrs: { 'data-action': 'open-store' }, onClick: () => this.openStore() }),
      button(t('common.settings'), { variant: 'ghost', attrs: { 'data-action': 'open-settings' }, onClick: () => this.openSettings(() => this.show('menu')) }),
      button(t('common.credits'), { variant: 'ghost', attrs: { 'data-action': 'open-credits' }, onClick: () => this.openCredits() }),
    );

    // Career scrapbook sits beside Continue (career-history context) — keeps the
    // 4-button secondary row intact for 915x412 landscape clipping budgets.
    const scrapbookBtn = button(t('scrapbook.open'), {
      variant: 'ghost',
      attrs: { 'data-action': 'open-scrapbook', id: 'menu-scrapbook-btn' },
      onClick: () => {
        this.bridge.audio.uiTap();
        this.bridge.openCareerScrapbook();
      },
    });

    const meta = h('div', { class: 'menu-meta' },
      h('span', { text: `v${APP_VERSION}` }),
      h('span', { text: '·' }),
      h('span', { text: t('menu.district') }),
      h('span', { text: '·' }),
      h('span', { text: t('menu.offlineReady') }),
    );

    const actions = h('div', { class: 'menu-actions' },
      playBtn,
      blacklistBtn,
      h('div', { class: 'menu-playrow' }, continueBtn, scrapbookBtn),
      secondary,
      meta,
    );

    const panel = h('div', { class: 'menu-panel' },
      h('div', { class: 'screentag', text: t('menu.modeTitle') }),
      modeRow,
      actions,
    );

    el.append(h('div', { class: 'menu-scrim' }), top, panel);
    this.menuEl = this.register('menu', el);
    this.refreshMenuChrome();
  }

  private refreshMenuChrome(): void {
    const bal = this.menuEl.querySelector('#menu-balance');
    if (bal) bal.textContent = formatTaka(this.state.balance);
    const rep = this.menuEl.querySelector('#menu-rep');
    if (rep) rep.textContent = `${t('hud.rep')} ${this.state.rep}`;
    const playrow = this.menuEl.querySelector('.menu-playrow');
    if (playrow) {
      const has = this.bridge.hasSave();
      playrow.classList.toggle('hidden', !has);
    }
    const meta = this.menuEl.querySelector('.menu-meta');
    if (meta) {
      const level = this.state.level;
      meta.setAttribute('data-level', String(level));
    }
    this.syncSoundUnlockPrompts();
  }

  syncSoundUnlockPrompts(): void {
    const s = this.settingsStore.get();
    const needsUnlock = !s.muted && !this.bridge.audio.unlocked;
    this.menuSoundUnlockEl?.classList.toggle('hidden', !needsUnlock);
    this.hudSoundUnlockEl?.classList.toggle('hidden', !needsUnlock);
  }

  private startModePrompt(): void {
    // First-time players get the short tutorial; everyone else goes straight in.
    if (!this.state.progress.tutorialDone) {
      this.openTutorial();
    } else {
      this.bridge.startMode('duty');
    }
  }

  // ----------------------------------------------------------------- HUD
  private buildHud(): void {
    const el = h('div', { class: 'hud hidden' });
    const objectiveLabel = h('div', { class: 'ob-label', text: t('hud.pickup') });
    const objectiveTitle = h('div', { class: 'ob-title' });
    const objectiveSub = h('div', { class: 'ob-sub' });
    const obMeter = h('div', { class: 'ob-meter' }, h('i'));
    const objective = h('div', { class: 'objective' }, objectiveLabel, objectiveTitle, objectiveSub, obMeter);

    const wallet = h('div', { class: 'wallet' }, h('span', { class: 'menu-money-icon', html: ICONS.coin }), h('span', { text: formatTaka(this.state.balance) }));
    const batteryPill = h('div', { class: 'battery-pill hidden', attrs: { id: 'hud-battery' } }, h('span', { text: '⚡ 100%' }));
    const staminaFill = h('i');
    const staminaText = h('span', { text: `${t('hud.stamina')} 100%` });
    const staminaPill = h(
      'div',
      { class: 'stamina-pill', attrs: { id: 'hud-stamina' } },
      staminaText,
      h('span', { class: 'stamina-track' }, staminaFill),
    );
    const hudSoundUnlock = h('button', {
      class: 'sound-unlock-pill hidden',
      attrs: { id: 'hud-sound-unlock', type: 'button' },
      on: {
        click: () => {
          void this.bridge.audio.init().then(() => {
            this.bridge.audio.uiTap();
            this.syncSoundUnlockPrompts();
          });
        },
      },
    },
      h('span', { html: ICONS.speaker }),
      h('span', { text: t('audio.tapToUnlock') }),
    );
    this.hudSoundUnlockEl = hudSoundUnlock;
    const pauseBtn = h('button', {
      class: 'icon-btn',
      attrs: { type: 'button', 'aria-label': 'pause', 'data-action': 'pause' },
      html: ICONS.pause,
      on: { click: () => this.bridge.pauseGame() },
    });
    const blacklistHudBtn = h('button', {
      class: 'icon-btn bl-hud-btn',
      attrs: { id: 'hud-blacklist-btn', type: 'button', 'aria-label': t('hud.blacklistBtn'), 'data-action': 'blacklist' },
      html: ICONS.trophy,
      on: { click: () => this.bridge.openBlacklist('hud') },
    });
    const camChip = h('span', { class: 'cam-mode-chip', text: t(`cam.short.${this.settingsStore.get().cameraMode}`) });
    const camBtn = h('button', {
      class: 'icon-btn cam-btn',
      attrs: { id: 'hud-cam', type: 'button', 'aria-label': 'camera', 'data-action': 'camera' },
      on: { click: () => this.bridge.toggleCamera() },
    }, h('span', { html: ICONS.camera }), camChip);
    const clockTextEl = h('span', { class: 'clock-val', attrs: { id: 'hud-clock-text' }, text: '08:00 AM' });
    const clockChip = h(
      'div',
      { class: 'hud-clock-chip', attrs: { id: 'hud-clock' } },
      h('span', { class: 'clock-ico', html: ICONS.clock }),
      clockTextEl,
    );
    this.hudClockTextEl = clockTextEl;
    const mini = h('div', { class: 'minimap' });
    this.miniCanvas = h('canvas', { attrs: { width: 208, height: 208 } });
    mini.append(this.miniCanvas, clockChip);

    const repCondSpan = h('span', { text: `${t('hud.rep')} 0 · ${t('hud.condition')} 100%` });
    const repCondPill = h('div', { class: 'rep-cond-pill', attrs: { id: 'hud-rep-cond' } }, repCondSpan);
    this.hudRepCondText = repCondSpan;

    const condWarnBadge = h(
      'div',
      { class: 'cond-warn-chip hidden', attrs: { id: 'hud-condition-warn' } },
      h('span', { text: t('toast.conditionLow') }),
    );
    this.hudCondWarnEl = condWarnBadge;

    const moodBarFill = h('i');
    const moodRow = h('div', { class: 'mood' }, h('span', { text: t('hud.mood') }), h('div', { class: 'mood-bar' }, moodBarFill));
    moodRow.id = 'hud-mood';

    const top = h('div', { class: 'hud-top' },
      objective,
      h(
        'div',
        { class: 'hud-topright' },
        h('div', { class: 'row' }, hudSoundUnlock, pauseBtn, camBtn, blacklistHudBtn),
        wallet,
        repCondPill,
        condWarnBadge,
        batteryPill,
        staminaPill,
        mini,
        moodRow,
      ),
    );

    const roadRageHead = h('div', { class: 'rr-head', text: 'ROAD RAGE!' });
    const roadRageSub = h('div', { class: 'rr-sub', text: '' });
    const roadRageBanner = h(
      'div',
      { class: 'roadrage-banner hidden', attrs: { id: 'roadrage-banner' } },
      roadRageHead,
      roadRageSub,
    );
    this.roadRageBannerEl = roadRageBanner;
    this.roadRageHeadEl = roadRageHead;
    this.roadRageSubEl = roadRageSub;

    // Police Pursuit Heat 1..5 HUD banner (hidden when idle)
    const pursuitHeatText = h('div', { class: 'pursuit-head', text: '' });
    const pursuitFill = h('i');
    const pursuitBanner = h(
      'div',
      { class: 'pursuit-banner hidden', attrs: { id: 'hud-pursuit' } },
      pursuitHeatText,
      h('div', { class: 'pursuit-track' }, pursuitFill),
    );
    this.hudPursuitEl = pursuitBanner;
    this.hudPursuitHeadEl = pursuitHeatText;
    this.hudPursuitFillEl = pursuitFill;

    // Rival Race / Event HUD strip & 3-2-1-GO countdown splash
    const racePosEl = h('span', { class: 'race-pos', text: '1ST' });
    const raceCpEl = h('span', { class: 'race-cp', text: 'CP 1/3' });
    const raceTimerEl = h('span', { class: 'race-timer', text: '01:00' });
    const raceStrip = h(
      'div',
      { class: 'race-hud-strip hidden', attrs: { id: 'hud-race' } },
      racePosEl,
      raceCpEl,
      raceTimerEl,
    );
    const raceCountdown = h('div', { class: 'race-countdown hidden', attrs: { id: 'hud-countdown' }, text: '3' });
    this.hudRaceEl = raceStrip;
    this.hudRacePosEl = racePosEl;
    this.hudRaceCpEl = raceCpEl;
    this.hudRaceTimerEl = raceTimerEl;
    this.hudCountdownEl = raceCountdown;

    const teaBtn = h('button', {
      class: 'tea-prompt-btn hidden',
      attrs: { id: 'hud-tea-btn', type: 'button' },
      text: t('hud.teaPrompt'),
      on: {
        click: () => {
          void this.bridge.audio.init();
          this.bridge.buyRoadsideTea();
        },
      },
    });
    this.hudTeaBtn = teaBtn;
    this.hudStaminaPill = staminaPill;
    this.hudStaminaText = staminaText;
    this.hudStaminaFill = staminaFill;

    const dialogue = h('div', { class: 'hud-dialogue' });
    this.dialogueEl = dialogue;
    const pedCallout = h('div', { class: 'ped-callout' });
    this.pedCalloutEl = pedCallout;
    this.hudCamChip = camChip;
    this.hudBattery = batteryPill;

    const hint = h('div', { class: 'hud-hint' });

    // touch controls
    const steerLeft = h('button', { class: 'touch-btn steer', attrs: { type: 'button', 'aria-label': 'left' }, html: ICONS.arrowLeft });
    const steerRight = h('button', { class: 'touch-btn steer', attrs: { type: 'button', 'aria-label': 'right' }, html: ICONS.arrowRight });
    const steerPad = h('div', { class: 'steer-pad' }, steerLeft, steerRight);
    const wheel = this.buildWheel();

    const pedal = h('button', { class: 'touch-btn pedal', attrs: { type: 'button' } },
      h('span', { text: t('hud.pedal') }),
    );
    const brake = h('button', { class: 'touch-btn brake', attrs: { type: 'button' } },
      h('span', { text: t('hud.brake') }),
    );
    const horn = h('button', { class: 'touch-btn horn', attrs: { type: 'button', 'aria-label': 'bell' }, html: ICONS.bell });

    const holdButton = (btn: HTMLElement, onDown: () => void, onUp: () => void): void => {
      const activePointers = new Set<number>();
      const down = (ev: PointerEvent): void => {
        ev.preventDefault();
        void this.bridge.audio.init();
        activePointers.add(ev.pointerId);
        btn.classList.add('active');
        onDown();
        try {
          btn.setPointerCapture(ev.pointerId);
        } catch {
          /* synthetic or unsupported pointer capture */
        }
      };
      const up = (ev: PointerEvent): void => {
        ev.preventDefault();
        activePointers.delete(ev.pointerId);
        if (activePointers.size === 0) {
          btn.classList.remove('active');
          onUp();
        }
      };
      this.touchReleaseCallbacks.push(() => {
        if (activePointers.size > 0 || btn.classList.contains('active')) {
          activePointers.clear();
          btn.classList.remove('active');
          onUp();
        }
      });
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    let steerLeftHeld = false;
    let steerRightHeld = false;
    const syncTouchSteer = (): void => {
      this.bridge.input.setTouchSteer((steerRightHeld ? 1 : 0) - (steerLeftHeld ? 1 : 0));
    };
    holdButton(
      steerLeft,
      () => {
        steerLeftHeld = true;
        syncTouchSteer();
      },
      () => {
        steerLeftHeld = false;
        syncTouchSteer();
      },
    );
    holdButton(
      steerRight,
      () => {
        steerRightHeld = true;
        syncTouchSteer();
      },
      () => {
        steerRightHeld = false;
        syncTouchSteer();
      },
    );
    holdButton(pedal, () => this.bridge.input.setPedal(true), () => this.bridge.input.setPedal(false));
    holdButton(brake, () => this.bridge.input.setBrake(true), () => this.bridge.input.setBrake(false));
    horn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      horn.classList.add('active');
      this.bridge.input.ringBell();
      window.setTimeout(() => horn.classList.remove('active'), 120);
    });

    const speedo = h('div', { class: 'speedo' }, h('b', { text: '0' }), h('span', { text: 'km/h' }));
    const tanBtn = h(
      'button',
      {
        class: 'touch-btn tan',
        attrs: { id: 'hud-tan-btn', type: 'button', 'aria-label': 'টান' },
      },
      h('span', { html: ICONS.bolt }),
      h('span', { text: 'টান' }),
    );
    tanBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      void this.bridge.audio.init();
      this.bridge.toggleTanBoost();
    });
    this.hudTanBtn = tanBtn;

    const turboFill = h('i', { class: 'turbo-bar-fill' });
    const turboLabel = h('span', { text: t('hud.turbo') });
    const turboBtn = h(
      'button',
      {
        class: 'touch-btn turbo',
        attrs: { id: 'hud-turbo-btn', type: 'button', 'aria-label': 'টার্বো', 'data-action': 'turbo' },
      },
      h('span', { html: ICONS.flame }),
      turboLabel,
      h('span', { class: 'turbo-bar-track' }, turboFill),
    );
    holdButton(
      turboBtn,
      () => this.bridge.input.setTurbo(true),
      () => this.bridge.input.setTurbo(false),
    );
    this.hudTurboBtn = turboBtn;
    this.hudTurboFill = turboFill;
    this.hudTurboLabel = turboLabel;

    const left = h('div', { class: 'drive-left' }, steerPad);
    const right = h('div', { class: 'drive-right' }, horn, speedo, brake, pedal);
    right.id = 'drive-right';
    const bottom = h('div', { class: 'hud-bottom' }, left, right);

    el.append(
      top,
      roadRageBanner,
      pursuitBanner,
      raceStrip,
      raceCountdown,
      dialogue,
      pedCallout,
      hint,
      teaBtn,
      turboBtn,
      tanBtn,
      bottom,
      wheel.el,
    );
    this.hud = this.register('hud', el);
    this.hudHint = hint;
    this.hudSpeedo = speedo;
    this.hudWallet = wallet;
    this.hudObjectiveLabel = objectiveLabel;
    this.hudObjectiveTitle = objectiveTitle;
    this.hudObjectiveSub = objectiveSub;
    this.hudMoodFill = moodBarFill;
    this.hudObMeter = obMeter.firstElementChild as HTMLElement;
    this.hudWheel = wheel.el;
    this.hudSteerPad = steerPad;
    this.hudPedal = pedal;
    this.hudBrake = brake;
    this.hudLeft = left;
    this.applyControlLayout();
  }

  private hudHint!: HTMLElement;
  private hudSpeedo!: HTMLElement;
  private hudWallet!: HTMLElement;
  private hudObjectiveLabel!: HTMLElement;
  private hudObjectiveTitle!: HTMLElement;
  private hudObjectiveSub!: HTMLElement;
  private hudMoodFill!: HTMLElement;
  private hudObMeter!: HTMLElement;
  private hudWheel!: HTMLElement;
  private hudSteerPad!: HTMLElement;
  private hudPedal!: HTMLElement;
  private hudBrake!: HTMLElement;
  private hudLeft!: HTMLElement;
  private hudCamChip!: HTMLElement;
  private hudBattery!: HTMLElement;
  private hudStaminaPill!: HTMLElement;
  private hudStaminaText!: HTMLElement;
  private hudStaminaFill!: HTMLElement;
  private hudTanBtn!: HTMLElement;
  private hudTurboBtn!: HTMLElement;
  private hudTurboFill!: HTMLElement;
  private hudTurboLabel!: HTMLElement;
  private hudClockTextEl!: HTMLElement;
  private hudRepCondText!: HTMLElement;
  private hudCondWarnEl!: HTMLElement;
  private hudPursuitEl!: HTMLElement;
  private hudPursuitHeadEl!: HTMLElement;
  private hudPursuitFillEl!: HTMLElement;
  private hudRaceEl!: HTMLElement;
  private hudRacePosEl!: HTMLElement;
  private hudRaceCpEl!: HTMLElement;
  private hudRaceTimerEl!: HTMLElement;
  private hudCountdownEl!: HTMLElement;
  private hudTeaBtn!: HTMLElement;
  private menuSoundUnlockEl: HTMLElement | null = null;
  private hudSoundUnlockEl: HTMLElement | null = null;
  private roadRageBannerEl!: HTMLElement;
  private roadRageHeadEl!: HTMLElement;
  private roadRageSubEl!: HTMLElement;
  private roadRageModalEl: HTMLElement | null = null;
  private pedCalloutEl!: HTMLElement;
  private pedCalloutTimer = 0;

  // Cached HUD DOM & pre-rendered minimap layer (zero live querySelector or redundant DOM mutations!)
  private hudMoodRow: HTMLElement | null = null;
  private hudMarkerEl: HTMLElement | null = null;
  private hudRecoverBtn: HTMLElement | null = null;
  private miniCtx: CanvasRenderingContext2D | null = null;
  private minimapBase: HTMLCanvasElement | null = null;
  private prevSpeedKmh = -1;
  private prevMoney = -1;
  private prevObjLabel = '';
  private prevObjTitle = '';
  private prevObjSub = '';
  private prevMoodPct = -1;
  private prevAboard: boolean | null = null;
  private prevObPct = -1;
  private prevCamMode = '';
  private prevElectric: boolean | null = null;
  private prevBattery = -1;
  private prevStamina = -1;
  private prevTanActive: boolean | null = null;
  private prevTanExhausted: boolean | null = null;
  private prevTeaAvail: boolean | null = null;
  private prevMarkerText = '';
  private prevClockText = '';
  private prevTurboPct = -1;
  private prevTurboActive: boolean | null = null;
  private prevRepVal = -1;
  private prevCondVal = -1;
  private prevCondLow: boolean | null = null;
  private prevPursuitKey = '';
  private prevPursuitPct = -1;
  private prevRaceVis: boolean | null = null;
  private prevCountdownText = '';
  private prevRaceSummary = '';

  private buildWheel(): { el: HTMLElement } {
    const knob = h('div', {
      style:
        'position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;background:radial-gradient(circle at 40% 30%,#f7dca6,#c98d31);box-shadow:0 6px 18px rgba(0,0,0,.45);',
    });
    const ring = h('div', {
      style:
        'position:relative;width:104px;height:104px;border-radius:50%;border:1px solid rgba(247,240,227,.28);background:radial-gradient(circle at 50% 40%,rgba(255,255,255,.12),rgba(8,20,17,.6));touch-action:none;',
    }, knob);
    const el = h('div', {
      class: 'hidden',
      style: 'position:absolute;left:calc(var(--safe-l) + 1.1rem);bottom:calc(var(--safe-b) + 1.1rem);pointer-events:auto;',
    }, ring);
    const start = (ev: PointerEvent): void => {
      ev.preventDefault();
      void this.bridge.audio.init();
      this.wheelActive = true;
      this.wheelPointerId = ev.pointerId;
      this.wheelStartX = ev.clientX;
      try {
        ring.setPointerCapture(ev.pointerId);
      } catch {
        /* synthetic or unsupported pointer capture */
      }
    };
    const move = (ev: PointerEvent): void => {
      if (!this.wheelActive || ev.pointerId !== this.wheelPointerId) return;
      const dx = clamp((ev.clientX - this.wheelStartX) / 44, -1, 1);
      knob.style.transform = `translateX(${dx * 22}px)`;
      this.bridge.input.setWheelSteer(dx);
    };
    const end = (ev: PointerEvent): void => {
      if (this.wheelPointerId !== null && ev.pointerId !== this.wheelPointerId) return;
      this.wheelActive = false;
      this.wheelPointerId = null;
      knob.style.transform = 'translateX(0)';
      this.bridge.input.setWheelSteer(0);
    };
    this.touchReleaseCallbacks.push(() => {
      this.wheelActive = false;
      this.wheelPointerId = null;
      knob.style.transform = 'translateX(0)';
      this.bridge.input.setWheelSteer(0);
    });
    ring.addEventListener('pointerdown', start);
    ring.addEventListener('pointermove', move);
    ring.addEventListener('pointerup', end);
    ring.addEventListener('pointercancel', end);
    ring.addEventListener('lostpointercapture', end);
    ring.addEventListener('contextmenu', (e) => e.preventDefault());
    return { el };
  }

  applyControlLayout(): void {
    const settings = this.settingsStore.get();
    const wheel = settings.steering === 'wheel';
    this.hudWheel.classList.toggle('hidden', !wheel);
    this.hudSteerPad.classList.toggle('hidden', wheel);
    this.hudSteerPad.firstElementChild?.classList.toggle('hidden', false);
    // Pedal and Brake must always remain accessible on touch devices, including in analog wheel mode.
    this.hudPedal.classList.remove('hidden');
    this.hudBrake.classList.remove('hidden');
    // handedness: swap the two clusters and keep Pedal under the outer driving thumb
    const left = this.hudLeft;
    const bottom = left.parentElement;
    if (!bottom) return;
    const leftFirst = settings.handedness === 'right';
    bottom.style.flexDirection = leftFirst ? 'row' : 'row-reverse';
    const rightCluster = this.hudPedal.parentElement as HTMLElement | null;
    if (rightCluster) rightCluster.style.flexDirection = leftFirst ? 'row' : 'row-reverse';
    // mirror the wheel & টান/টার্বো boost buttons to the opposite corner when left-handed
    this.hudWheel.style.left = settings.handedness === 'right' ? 'calc(var(--safe-l) + 1.1rem)' : 'auto';
    this.hudWheel.style.right = settings.handedness === 'right' ? 'auto' : 'calc(var(--safe-r) + 1.1rem)';
    this.hudTanBtn?.classList.toggle('left-handed', settings.handedness === 'left');
    this.hudTurboBtn?.classList.toggle('left-handed', settings.handedness === 'left');
  }

  updateCameraBadge(mode: CameraMode): void {
    if (this.hudCamChip) {
      this.hudCamChip.textContent = t(`cam.short.${mode}`);
    }
  }

  /** Show a non-spammy Bengali speech callout above a startled pedestrian. */
  showPedestrianCallout(screenX: number, screenY: number, textKey: string): void {
    if (this.current !== 'hud') return;
    const x = clamp(screenX, 90, window.innerWidth - 90);
    const y = clamp(screenY, 72, window.innerHeight - 140);
    this.pedCalloutEl.textContent = t(textKey);
    this.pedCalloutEl.style.left = `${Math.round(x)}px`;
    this.pedCalloutEl.style.top = `${Math.round(y)}px`;
    this.pedCalloutEl.classList.add('show');
    if (this.pedCalloutTimer) window.clearTimeout(this.pedCalloutTimer);
    this.pedCalloutTimer = window.setTimeout(() => {
      this.pedCalloutEl.classList.remove('show');
    }, 2200);
  }

  /** Called at ~20 Hz while driving; dirty-checked so unchanged values never mutate DOM. */
  updateHud(state: HudState): void {
    if (this.current !== 'hud') return;

    const kmh = Math.round(Math.abs(state.speed) * 3.6);
    if (kmh !== this.prevSpeedKmh) {
      this.prevSpeedKmh = kmh;
      this.hudSpeedo.firstElementChild!.textContent = String(kmh);
    }

    const moneyInt = Math.round(state.money);
    if (moneyInt !== this.prevMoney) {
      this.prevMoney = moneyInt;
      this.hudWallet.lastElementChild!.textContent = formatTaka(state.money);
    }

    if (state.objectiveLabel !== this.prevObjLabel) {
      this.prevObjLabel = state.objectiveLabel;
      this.hudObjectiveLabel.textContent = state.objectiveLabel;
    }
    if (state.objectiveTitle !== this.prevObjTitle) {
      this.prevObjTitle = state.objectiveTitle;
      this.hudObjectiveTitle.textContent = state.objectiveTitle;
    }
    if (state.objectiveSub !== this.prevObjSub) {
      this.prevObjSub = state.objectiveSub;
      this.hudObjectiveSub.textContent = state.objectiveSub;
    }

    const moodPct = Math.round(clamp01(state.mood / 100) * 100);
    if (moodPct !== this.prevMoodPct) {
      this.prevMoodPct = moodPct;
      this.hudMoodFill.style.width = `${moodPct}%`;
    }

    if (!this.hudMoodRow) {
      this.hudMoodRow = this.hud.querySelector('#hud-mood') as HTMLElement | null;
    }
    if (this.hudMoodRow && state.passengerAboard !== this.prevAboard) {
      this.prevAboard = state.passengerAboard;
      this.hudMoodRow.style.display = state.passengerAboard ? 'flex' : 'none';
    }

    const obPct = Math.round(clamp01(1 - state.distance / 600) * 100);
    if (obPct !== this.prevObPct) {
      this.prevObPct = obPct;
      this.hudObMeter.style.width = `${obPct}%`;
    }

    if (state.cameraMode && state.cameraMode !== this.prevCamMode) {
      this.prevCamMode = state.cameraMode;
      this.updateCameraBadge(state.cameraMode);
    }

    if (state.isElectric) {
      const bat = Math.round(state.battery ?? 100);
      if (this.prevElectric !== true) {
        this.prevElectric = true;
        this.hudBattery.classList.remove('hidden');
        this.hudStaminaPill.classList.add('hidden');
      }
      if (bat !== this.prevBattery) {
        this.prevBattery = bat;
        this.hudBattery.classList.toggle('low', bat < 22);
        this.hudBattery.firstElementChild!.textContent = `⚡ ${bat}%`;
      }
    } else {
      if (this.prevElectric !== false) {
        this.prevElectric = false;
        this.hudBattery.classList.add('hidden');
        this.hudStaminaPill.classList.remove('hidden');
      }
      const stam = Math.round(clamp(state.stamina ?? 100, 0, 100));
      if (stam !== this.prevStamina) {
        this.prevStamina = stam;
        this.hudStaminaPill.classList.toggle('low', stam < 20);
        this.hudStaminaText.textContent = `${t('hud.stamina')} ${stam}%`;
        this.hudStaminaFill.style.width = `${stam}%`;
      }
    }

    const tanOn = !!state.tanActive;
    if (tanOn !== this.prevTanActive) {
      this.prevTanActive = tanOn;
      this.hudTanBtn.classList.toggle('engaged', tanOn);
      this.hudTanBtn.setAttribute('aria-pressed', tanOn ? 'true' : 'false');
    }
    const exhausted = state.isElectric ? (state.battery ?? 100) <= 2.5 : (state.stamina ?? 100) < 12;
    if (exhausted !== this.prevTanExhausted) {
      this.prevTanExhausted = exhausted;
      this.hudTanBtn.classList.toggle('exhausted', exhausted);
    }

    const teaAvail = !!state.teaAvailable;
    if (teaAvail !== this.prevTeaAvail) {
      this.prevTeaAvail = teaAvail;
      this.hudTeaBtn.textContent = t('hud.teaPrompt');
      this.hudTeaBtn.classList.toggle('hidden', !teaAvail);
    }

    // Dynamic In-Game Clock: updates ONLY when displayed whole minute changes!
    if (state.clockText && state.clockText !== this.prevClockText) {
      this.prevClockText = state.clockText;
      this.hudClockTextEl.textContent = state.clockText;
    }

    // Hold-to-boost Turbo button & meter (dirty-checked!)
    const turboPct = Math.round(clamp(state.turboCharge ?? 100, 0, 100));
    if (turboPct !== this.prevTurboPct) {
      this.prevTurboPct = turboPct;
      this.hudTurboFill.style.width = `${turboPct}%`;
      this.hudTurboBtn.classList.toggle('exhausted', turboPct < 8);
    }
    const turboOn = !!state.turboActive;
    if (turboOn !== this.prevTurboActive) {
      this.prevTurboActive = turboOn;
      this.hudTurboBtn.classList.toggle('engaged', turboOn);
      this.hudTurboBtn.setAttribute('aria-pressed', turboOn ? 'true' : 'false');
    }

    // REP & Condition readout + single persistent deduplicated warning chip
    const repInt = Math.round(state.rep ?? 0);
    const condInt = Math.round(clamp(state.condition ?? 100, 0, 100));
    if (repInt !== this.prevRepVal || condInt !== this.prevCondVal) {
      this.prevRepVal = repInt;
      this.prevCondVal = condInt;
      this.hudRepCondText.textContent = `${t('hud.rep')} ${repInt} · ${t('hud.condition')} ${condInt}%`;
    }
    const condLow = !!state.conditionLow;
    if (condLow !== this.prevCondLow) {
      this.prevCondLow = condLow;
      this.hudCondWarnEl.firstElementChild!.textContent = t('toast.conditionLow');
      this.hudCondWarnEl.classList.toggle('hidden', !condLow);
    }

    // Police Pursuit Heat 1..5 HUD banner
    const pState = state.policeState ?? 'idle';
    const pHeat = state.policeHeat ?? 0;
    const pKey = `${pState}:${pHeat}`;
    if (pKey !== this.prevPursuitKey) {
      this.prevPursuitKey = pKey;
      if (pState === 'idle' || pHeat <= 0) {
        this.hudPursuitEl.classList.add('hidden');
      } else {
        const msg =
          pState === 'detecting'
            ? t('police.detecting')
            : pState === 'pursuing'
              ? t('police.pursuing', { heat: pHeat })
              : pState === 'losingSight'
                ? t('police.losing')
                : t('police.cooldown');
        this.hudPursuitHeadEl.textContent = `${'★'.repeat(pHeat)} ${msg}`;
        this.hudPursuitEl.classList.toggle('flashing', pState === 'pursuing' || pState === 'losingSight');
        this.hudPursuitEl.classList.remove('hidden');
      }
    }
    if (pState !== 'idle' && pHeat > 0) {
      const pPct = Math.round(clamp01(state.policeProgress ?? 0) * 100);
      if (pPct !== this.prevPursuitPct) {
        this.prevPursuitPct = pPct;
        this.hudPursuitFillEl.style.width = `${pPct}%`;
      }
    }

    // Rival Race / Event HUD strip + 3-2-1-GO countdown
    const race = state.race ?? null;
    const raceVis = !!(race && race.active);
    if (raceVis !== this.prevRaceVis) {
      this.prevRaceVis = raceVis;
      this.hudRaceEl.classList.toggle('hidden', !raceVis);
    }
    const cdText = race?.countdownText === 'GO!' ? t('race.go') : (race?.countdownText ?? '');
    if (cdText !== this.prevCountdownText) {
      this.prevCountdownText = cdText;
      this.hudCountdownEl.textContent = cdText;
      this.hudCountdownEl.classList.toggle('hidden', !cdText);
    }
    if (race && race.active) {
      const remS = Math.max(0, Math.ceil(race.remSec));
      const mm = String(Math.floor(remS / 60)).padStart(2, '0');
      const ss = String(remS % 60).padStart(2, '0');
      const lapCur = race.lapCur ?? 1;
      const lapTot = race.lapTot ?? 1;
      const sumKey = `${race.pos}/${race.total}:${lapCur}/${lapTot}:${race.cpCur}/${race.cpTot}:${mm}:${ss}`;
      if (sumKey !== this.prevRaceSummary) {
        this.prevRaceSummary = sumKey;
        this.hudRacePosEl.textContent = t('race.posOfTotal', { pos: race.pos, total: race.total });
        const cpStr = t('race.cp', { cur: race.cpCur, tot: race.cpTot });
        this.hudRaceCpEl.textContent =
          lapTot > 1 ? `${t('race.lap', { cur: lapCur, tot: lapTot })} · ${cpStr}` : cpStr;
        this.hudRaceTimerEl.textContent = `${mm}:${ss}`;
      }
    }

    if (state.hint) {
      if (this.lastHintKey !== state.hint) {
        this.hudHint.textContent = t(state.hint);
        this.hudHint.classList.add('show');
        this.lastHintKey = state.hint;
      }
    } else if (this.lastHintKey !== null) {
      this.hudHint.classList.remove('show');
      this.lastHintKey = null;
    }

    // World-space marker label cached & positioned without node creation/removal churn
    if (state.markerX !== null && state.markerY !== null) {
      if (!this.hudMarkerEl) {
        this.hudMarkerEl = h('div', { class: 'marker-label' });
        this.hud.append(this.hudMarkerEl);
      }
      const nextText = `${state.markerLabel ?? ''} ${state.distance > 0 ? formatDistance(state.distance) : ''}`.trim();
      if (nextText !== this.prevMarkerText) {
        this.prevMarkerText = nextText;
        this.hudMarkerEl.textContent = nextText;
      }
      this.hudMarkerEl.style.left = `${Math.round(state.markerX)}px`;
      this.hudMarkerEl.style.top = `${Math.round(state.markerY)}px`;
      this.hudMarkerEl.style.display = 'block';
    } else if (this.hudMarkerEl && this.hudMarkerEl.style.display !== 'none') {
      this.hudMarkerEl.style.display = 'none';
    }

    if (state.stuck && !this.hudRecoverBtn) {
      const btn = button(t('hud.recover'), {
        variant: 'gold',
        small: true,
        class: 'clickable',
        onClick: () => this.bridge.recoverRickshaw(),
      });
      btn.id = 'recover-btn';
      btn.setAttribute('style', 'position:absolute;left:50%;transform:translateX(-50%);bottom:calc(var(--safe-b) + 12.5rem);');
      this.hud.append(btn);
      this.hudRecoverBtn = btn;
    } else if (!state.stuck && this.hudRecoverBtn) {
      this.hudRecoverBtn.remove();
      this.hudRecoverBtn = null;
    }

    this.drawMinimap(state);
  }

  private ensureMinimapBase(scale: number): HTMLCanvasElement {
    if (this.minimapBase) return this.minimapBase;
    const size = 720; // covers [-342m .. +342m] @ 1.05 px/m
    const half = size / 2;
    const base = document.createElement('canvas');
    base.width = size;
    base.height = size;
    const bctx = base.getContext('2d')!;
    bctx.fillStyle = '#0e1916';
    bctx.fillRect(0, 0, size, size);
    // Campus and both approach aprons are part of the same minimap base as roads.
    const campus = drmcGamePolygon();
    bctx.beginPath();
    campus.forEach((p, i) => i ? bctx.lineTo(half + p.x * scale, half + p.z * scale) : bctx.moveTo(half + p.x * scale, half + p.z * scale));
    bctx.closePath();
    bctx.fillStyle = '#294d32';
    bctx.fill();
    bctx.strokeStyle = '#87a785';
    bctx.lineWidth = 1;
    bctx.stroke();
    bctx.lineCap = 'round';
    for (const [gate, road] of [[DRMC_GATE, DRMC_GATE_ROAD_POINT], [DRMC_SIDE_GATE, DRMC_SIDE_GATE_ROAD_POINT]]) {
      bctx.strokeStyle = '#9d9d85';
      bctx.lineWidth = 3;
      bctx.beginPath();
      bctx.moveTo(half + gate.x * scale, half + gate.z * scale);
      bctx.lineTo(half + road.x * scale, half + road.z * scale);
      bctx.stroke();
    }
    for (let i = 0; i < ROADS.length; i++) {
      const seg = ROADS[i];
      bctx.strokeStyle = seg.kind === 'main' ? '#3d584e' : seg.kind === 'medium' ? '#31463e' : '#253630';
      bctx.lineWidth = Math.max(2, seg.width * scale * 0.42);
      bctx.beginPath();
      bctx.moveTo(half + seg.ax * scale, half + seg.az * scale);
      bctx.lineTo(half + seg.bx * scale, half + seg.bz * scale);
      bctx.stroke();
    }
    bctx.fillStyle = 'rgba(232,178,90,0.45)';
    for (let i = 0; i < PLACES.length; i++) {
      const place = PLACES[i];
      bctx.beginPath();
      bctx.arc(half + place.x * scale, half + place.z * scale, 2.3, 0, Math.PI * 2);
      bctx.fill();
    }
    this.minimapBase = base;
    return base;
  }

  private drawMinimap(state: HudState): void {
    const canvas = this.miniCanvas;
    if (!canvas) return;
    if (!this.miniCtx) this.miniCtx = canvas.getContext('2d');
    const ctx = this.miniCtx;
    if (!ctx) return;
    const w = canvas.width;
    const hgt = canvas.height;
    const scale = 1.05;
    const cx = w / 2;
    const cy = hgt / 2;
    const px = this.minimapPlayer.x;
    const pz = this.minimapPlayer.z;

    // 1. Single fast blit of pre-rendered Mohammadpur street network + landmarks!
    const base = this.ensureMinimapBase(scale);
    const halfBase = base.width / 2;
    const srcX = halfBase + px * scale - cx;
    const srcY = halfBase + pz * scale - cy;
    ctx.fillStyle = '#0e1916';
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(base, srcX, srcY, w, hgt, 0, 0, w, hgt);

    // 2. Highlight congested / jammed Dhaka corridors in warm crimson-orange!
    if (state.jammedSegments && state.jammedSegments.length > 0) {
      ctx.strokeStyle = 'rgba(255, 92, 56, 0.86)';
      for (let i = 0; i < state.jammedSegments.length; i++) {
        const seg = segmentById(state.jammedSegments[i]);
        if (!seg) continue;
        ctx.lineWidth = Math.max(2.5, seg.width * scale * 0.44);
        ctx.beginPath();
        ctx.moveTo(cx + (seg.ax - px) * scale, cy + (seg.az - pz) * scale);
        ctx.lineTo(cx + (seg.bx - px) * scale, cy + (seg.bz - pz) * scale);
        ctx.stroke();
      }
    }

    // 3. Active shortest-time / jam-avoiding Dijkstra route polyline!
    if (state.routePoints && state.routePoints.length > 1) {
      ctx.save();
      ctx.strokeStyle = state.detourActive ? '#ffd166' : '#4cd6a0';
      ctx.lineWidth = 2.6;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      for (let i = 0; i < state.routePoints.length; i++) {
        const rp = state.routePoints[i];
        const rx = cx + (rp.x - px) * scale;
        const ry = cy + (rp.z - pz) * scale;
        if (i === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 4. Active pickup / drop-off marker
    if (this.minimapMarker) {
      const mx = cx + (this.minimapMarker.x - px) * scale;
      const my = cy + (this.minimapMarker.z - pz) * scale;
      const clampedX = clamp(mx, 8, w - 8);
      const clampedY = clamp(my, 8, hgt - 8);
      ctx.fillStyle = state.passengerAboard ? '#e8b25a' : '#4cd6a0';
      ctx.beginPath();
      ctx.arc(clampedX, clampedY, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4b. Roadblocks (orange barricade dots)
    if (state.roadblocks) {
      for (let i = 0; i < state.roadblocks.length; i++) {
        const rb = state.roadblocks[i];
        if (!rb.active || rb.smashed) continue;
        const rx = cx + (rb.x - px) * scale;
        const ry = cy + (rb.z - pz) * scale;
        if (rx < 4 || rx > w - 4 || ry < 4 || ry > hgt - 4) continue;
        ctx.fillStyle = '#fb923c';
        ctx.fillRect(rx - 3, ry - 1.5, 6, 3);
      }
    }

    // 4c. Police SUVs (flashing red/blue dots)
    if (state.policeUnits && state.policeState && state.policeState !== 'idle') {
      const flashBlue = ((performance.now() * 0.008) | 0) % 2 === 0;
      for (let i = 0; i < state.policeUnits.length; i++) {
        const pu = state.policeUnits[i];
        if (!pu.active) continue;
        const ux = clamp(cx + (pu.x - px) * scale, 6, w - 6);
        const uy = clamp(cy + (pu.z - pz) * scale, 6, hgt - 6);
        ctx.fillStyle = flashBlue ? '#38bdf8' : '#ef4444';
        ctx.beginPath();
        ctx.arc(ux, uy, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4d. All 3 Rival Rickshaws & Race Checkpoint marker
    if (state.race && state.race.active) {
      const tx = clamp(cx + (state.race.targetX - px) * scale, 7, w - 7);
      const ty = clamp(cy + (state.race.targetZ - pz) * scale, 7, hgt - 7);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(tx, ty, 5.5, 0, Math.PI * 2);
      ctx.stroke();

      if (state.race.rivals && state.race.rivals.length > 0) {
        for (let i = 0; i < state.race.rivals.length; i++) {
          const rv = state.race.rivals[i];
          const rvx = clamp(cx + (rv.x - px) * scale, 6, w - 6);
          const rvy = clamp(cy + (rv.z - pz) * scale, 6, hgt - 6);
          ctx.fillStyle = rv.accentHex || '#f472b6';
          ctx.beginPath();
          ctx.arc(rvx, rvy, 4.1, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (state.race.hasRival) {
        const rvx = clamp(cx + (state.race.rivalX - px) * scale, 6, w - 6);
        const rvy = clamp(cy + (state.race.rivalZ - pz) * scale, 6, hgt - 6);
        ctx.fillStyle = '#f472b6';
        ctx.beginPath();
        ctx.arc(rvx, rvy, 4.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 5. Player directional arrow
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI - this.minimapPlayer.yaw);
    ctx.fillStyle = '#f7f0e3';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(232,178,90,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, hgt - 1);
  }

  private minimapPlayer = { x: 0, z: 46, yaw: Math.PI };
  private minimapMarker: { x: number; z: number } | null = null;

  setMinimapPlayer(x: number, z: number, yaw: number): void {
    this.minimapPlayer = { x, z, yaw };
  }

  setMinimapMarker(pos: { x: number; z: number } | null): void {
    this.minimapMarker = pos;
  }

  showDialogue(whoKey: string, textKey: string, secondary?: string): void {
    if (!this.settingsStore.get().subtitles) {
      this.bridge.audio.teaClink();
      return;
    }
    clear(this.dialogueEl);
    this.dialogueEl.append(h('span', { class: 'who', text: t(whoKey) }), h('span', { text: t(textKey) }));
    if (secondary) this.dialogueEl.append(h('span', { class: 'en', text: secondary }));
    this.dialogueEl.classList.add('show');
    if (this.dialogueTimer) window.clearTimeout(this.dialogueTimer);
    this.dialogueTimer = window.setTimeout(() => this.dialogueEl.classList.remove('show'), 4200);
  }

  hideDialogue(): void {
    this.dialogueEl.classList.remove('show');
  }

  /** Show exact Bangla Unicode road-rage subtitle cleanly regardless of current locale. */
  showRoadRageSubtitle(speakerKey: string, banglaLine: string): void {
    clear(this.dialogueEl);
    this.dialogueEl.append(
      h('span', { class: 'who', text: t(speakerKey) }),
      h('span', { text: banglaLine }),
    );
    this.dialogueEl.classList.add('show');
    if (this.dialogueTimer) window.clearTimeout(this.dialogueTimer);
    this.dialogueTimer = window.setTimeout(() => this.dialogueEl.classList.remove('show'), 3600);
  }

  setRoadRageBanner(headline: string | null, subKey?: string, escapingSec?: number | null): void {
    if (!headline) {
      this.roadRageBannerEl?.classList.add('hidden');
      return;
    }
    this.roadRageHeadEl.textContent = headline;
    if (subKey === 'roadrage.escaping' && typeof escapingSec === 'number') {
      this.roadRageSubEl.textContent = t('roadrage.escaping', { s: escapingSec.toFixed(1) });
    } else if (subKey) {
      this.roadRageSubEl.textContent = t(subKey);
    } else {
      this.roadRageSubEl.textContent = '';
    }
    this.roadRageBannerEl.classList.remove('hidden');
  }

  openRoadRageConfrontation(): void {
    this.closeRoadRageConfrontation();
    this.releaseTouchInputs();
    const canPay = this.state.balance >= 100;

    const payBtn = h(
      'button',
      {
        class: `btn primary wide${canPay ? '' : ' disabled'}`,
        attrs: {
          id: 'roadrage-pay-btn',
          type: 'button',
          ...(canPay ? {} : { disabled: 'true', 'aria-disabled': 'true' }),
        },
        on: {
          click: () => {
            if (this.state.balance < 100) return;
            this.bridge.settleRoadRagePay();
          },
        },
      },
      h('span', { text: t('roadrage.choice.pay') }),
    );

    const refuseBtn = h(
      'button',
      {
        class: 'btn danger wide',
        attrs: { id: 'roadrage-refuse-btn', type: 'button' },
        on: {
          click: () => {
            this.bridge.refuseRoadRagePay();
          },
        },
      },
      h('span', { text: t('roadrage.choice.refuse') }),
    );

    const card = h(
      'div',
      { class: 'roadrage-modal', attrs: { id: 'roadrage-modal' } },
      h('div', { class: 'screentag', text: 'ROAD RAGE!' }),
      h('h3', { text: t('roadrage.modal.title') }),
      h('p', { text: t('roadrage.modal.desc') }),
      ...(canPay
        ? []
        : [
            h('div', {
              class: 'roadrage-shortage',
              attrs: { id: 'roadrage-shortage' },
              text: t('roadrage.noMoney'),
            }),
          ]),
      h('div', { class: 'btn-stack' }, payBtn, refuseBtn),
    );

    const wrap = h('div', { class: 'roadrage-modal-wrap', attrs: { id: 'roadrage-modal-wrap' } }, card);
    this.roadRageModalEl = wrap;
    this.root.append(wrap);
  }

  closeRoadRageConfrontation(): void {
    if (this.roadRageModalEl) {
      this.roadRageModalEl.remove();
      this.roadRageModalEl = null;
    }
  }

  // ---------------------------------------------------------------- pause
  private buildPause(): void {
    const { wrap, body } = sheet(t('pause.title'));
    body.append(
      button(t('pause.resume'), { variant: 'primary', wide: true, onClick: () => this.bridge.resumeGame() }),
      button(t('pause.recover'), { variant: 'ghost', wide: true, sub: t('pause.recoverFee', { n: formatTaka(45) }), onClick: () => this.bridge.recoverRickshaw() }),
      button(t('menu.blacklist'), { variant: 'gold', wide: true, onClick: () => this.bridge.openBlacklist('pause') }),
      button(t('pause.restart'), { variant: 'ghost', wide: true, onClick: () => this.bridge.restartMission() }),
      button(t('common.settings'), { variant: 'ghost', wide: true, onClick: () => this.openSettings(() => this.show('pause')) }),
      button(t('pause.quit'), { variant: 'danger', wide: true, onClick: () => this.confirmQuit() }),
    );
    this.pauseEl = this.register('pause', h('div', { class: 'screen' }, wrap));
  }

  private confirmQuit(): void {
    const m = modal({
      title: t('pause.quit'),
      message: t('pause.quitWarn'),
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        this.overlays = this.overlays.filter((o) => o.name !== 'modal');
        document.querySelectorAll('.modal-wrap').forEach((n) => n.remove());
        this.bridge.returnToMenu();
      },
    });
    this.overlays.push({ name: 'modal', el: m });
    this.root.append(m);
  }

  showPause(fee: number): void {
    const recoverBtn = this.pauseEl.querySelectorAll('.btn')[1] as HTMLButtonElement | undefined;
    if (recoverBtn) {
      const sub = recoverBtn.querySelector('.sub');
      if (sub) sub.textContent = fee > 0 ? t('pause.recoverFee', { n: formatTaka(fee) }) : t('common.free');
    }
    this.show('pause');
  }

  // --------------------------------------------------------------- result
  private buildResult(): void {
    const el = h('div', { class: 'screen result-screen' });
    this.resultEl = this.register('result', el);
  }

  showResult(payload: {
    fare: FareBreakdown;
    offer: MissionOffer;
    distance: number;
    time: number;
    daily: boolean;
    unlock?: string | null;
    onNext: () => void;
    onFree: () => void;
    onGarage: () => void;
  }): void {
    // toasts would sit on top of the result card; clear them first
    this.clearToasts();
    this.renderResult(payload);
  }

  private renderResult(payload: {
    fare: FareBreakdown;
    offer: MissionOffer;
    distance: number;
    time: number;
    daily: boolean;
    unlock?: string | null;
    onNext: () => void;
    onFree: () => void;
    onGarage: () => void;
  }): void {
    clear(this.resultEl);
    const { fare, offer, distance, time } = payload;
    const good = fare.mood >= 65;
    const card = h('div', { class: 'result-card glass' },
      h('div', { class: 'screentag', text: payload.daily ? t('mission.daily') : t('result.title') }),
      h('div', { class: 'spread' },
        h('h2', { text: t('result.title') }),
        h('div', { class: 'stars', text: '★'.repeat(fare.stars) + '☆'.repeat(5 - fare.stars) }),
      ),
      h('div', { class: 'row wrap' },
        h('span', { class: 'pill', text: `${t('common.distance')} ${formatDistance(distance)}` }),
        h('span', { class: 'pill', text: `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}` }),
        h('span', { class: `pill ${fare.onTime ? 'green' : 'red'}`, text: fare.onTime ? t('hud.onTime') : t('hud.late') }),
        h('span', { class: 'pill gold', text: `${t('hud.mood')} ${Math.round(fare.mood)}` }),
      ),
      h('div', { class: 'breakdown' },
        row(t('result.base'), fare.base),
        row(t('result.distance'), fare.distance),
        row(t('result.time'), fare.time),
        fare.smooth ? row(t('result.smooth'), fare.smooth) : null,
        fare.tip ? row(t('result.tip'), fare.tip) : null,
        fare.damage ? row(t('result.damage'), -fare.damage, true) : null,
      ),
      h('div', { class: 'result-total' },
        h('span', { text: t('result.total') }),
        h('b', { class: 'taka', text: formatTaka(fare.total) }),
      ),
      good ? h('div', { class: 'stamp', text: fare.stars === 5 ? t('result.boss') : t('result.smoothStamp') }) : null,
      payload.unlock ? h('div', { class: 'pill gold', text: `${t('result.unlock')}: ${payload.unlock}` }) : null,
      h('div', { class: 'divider' }),
      button(t('result.next'), { variant: 'primary', wide: true, onClick: payload.onNext }),
      h('div', { class: 'row' },
        button(t('result.freeRide'), { variant: 'ghost', onClick: payload.onFree }),
        button(t('result.garage'), { variant: 'ghost', onClick: payload.onGarage }),
      ),
    );
    this.resultEl.append(card);
    this.show('result');
    if (good) this.bridge.audio.successStinger();
    else this.bridge.audio.failStinger();
    void offer;
  }

  private refreshShopView(): void {
    if (this.current === 'store') {
      this.buildStore();
      this.show('store');
    } else {
      this.buildGarage();
      this.show('garage');
    }
  }

  // --------------------------------------------------------------- garage
  openGarage(from: 'menu' | 'pause' | 'result'): void {
    this.garageFrom = from;
    this.bridge.openGarage(from);
    this.buildGarage();
    this.show('garage');
  }

  private buildGarage(): void {
    if (this.garageEl) {
      this.garageEl.remove();
      this.screens.delete('garage');
      this.garageEl = null;
    }
    const vehicle = this.state.vehicle();
    const stats = vehicleStats(vehicle, this.state.progress.upgrades);
    const condition = this.state.progress.condition;
    const repair = this.state.repairQuote();
    const { wrap, body } = sheet(t('garage.title'), {
      subtitle: `${t('garage.subtitle')} · ${formatTaka(this.state.balance)}`,
      onClose: () => this.closeGarage(),
    });

    body.append(
      h('div', { class: 'spread' },
        h('div', {},
          h('h3', { text: t(vehicle.nameKey) }),
          h('div', { class: 'tiny muted', text: t(vehicle.descKey) }),
        ),
        h('div', { class: 'pill gold', text: `${t('garage.condition')} ${Math.round(condition)}%` }),
      ),
      h('div', { class: 'col', style: 'gap:.22rem' },
        statBar(t('garage.stat.speed'), stats.speed),
        statBar(t('garage.stat.accel'), stats.accel),
        statBar(t('garage.stat.handling'), stats.handling),
        statBar(t('garage.stat.braking'), stats.braking),
        statBar(t('garage.stat.comfort'), stats.comfort),
        vehicle.kind === 'electric' ? statBar(t('garage.stat.efficiency'), stats.efficiency) : null,
      ),
      repair > 0
        ? button(t('garage.repairCost', { n: formatTaka(repair) }), {
            variant: 'ghost',
            wide: true,
            onClick: () => {
              const res = this.state.repair();
              if (res.ok) {
                this.bridge.audio.uiConfirm();
                this.toast(t('garage.repairDone'), 'good');
                this.buildGarage();
                this.show('garage');
              } else {
                this.bridge.audio.uiError();
                this.toast(t('common.insufficient'), 'bad');
              }
            },
          })
        : h('div', { class: 'pill green', text: t('garage.conditionGood') }),
      h('div', { class: 'tiny muted', text: t('garage.drag') }),
      h('div', { class: 'tabs' },
        ...([
          ['paint', t('garage.paint')],
          ['upgrades', t('garage.upgrades')],
          ['accessories', t('garage.accessories')],
          ['vehicles', t('garage.vehicles')],
        ] as [typeof this.garageTab, string][]).map(([id, label]) =>
          h('button', {
            class: this.garageTab === id ? 'on' : '',
            attrs: { type: 'button', 'data-tab': id },
            text: label,
            on: {
              click: () => {
                this.garageTab = id;
                this.buildGarage();
                this.show('garage');
              },
            },
          }),
        ),
      ),
    );

    const grid = h('div', { class: 'card-grid' });
    if (this.garageTab === 'vehicles') {
      body.append(this.cassetteBox());
    }
    if (this.garageTab === 'paint' || this.garageTab === 'accessories') {
      const categories: CosmeticCategory[] =
        this.garageTab === 'paint'
          ? ['paint', 'art']
          : ['tassel', 'bell', 'flowers', 'mirror'];
      for (const category of categories) {
        for (const item of cosmeticsByCategory(category)) {
          grid.append(this.cosmeticCard(item.id));
        }
      }
    } else if (this.garageTab === 'upgrades') {
      for (const up of UPGRADES) grid.append(this.upgradeCard(up.id));
    } else {
      for (const v of VEHICLES) grid.append(this.vehicleCard(v.id));
    }
    body.append(grid);
    body.append(h('div', { class: 'divider' }), button(t('common.back'), { variant: 'ghost', wide: true, onClick: () => this.closeGarage() }));

    this.garageEl = h('div', { class: 'screen' }, wrap);
    this.register('garage', this.garageEl);
    this.garageEl.classList.remove('hidden');
  }

  private cosmeticCard(id: string): HTMLElement {
    const def = cosmeticById(id);
    if (!def) return h('div');
    const owned = this.state.ownsCosmetic(id);
    const equipped = this.state.progress.cosmetics[def.category] === id;
    const affordable = this.state.balance >= def.price;
    const card = h('button', {
      class: `item-card${owned ? ' owned' : ''}${equipped ? ' selected' : ''}`,
      attrs: { type: 'button', 'data-cosmetic-id': id },
      on: {
        click: () => {
          if (this.busy) return;
          if (owned) {
            if (equipped) return;
            const res = this.state.equipCosmetic(id);
            if (res.ok) {
              this.bridge.audio.uiConfirm();
              this.toast(t('store.equipDone'), 'good');
              this.bridge.applySettings();
              this.refreshShopView();
            }
          } else if (affordable) {
            this.confirmPurchase(t(def.nameKey), formatTaka(def.price), () => {
              const res = this.state.buyCosmetic(id);
              if (res.ok) {
                this.bridge.audio.coin();
                this.toast(t('store.buyDone'), 'good');
                this.bridge.applySettings();
              } else {
                this.bridge.audio.uiError();
                this.toast(t('common.insufficient'), 'bad');
              }
              this.refreshShopView();
            });
          } else {
            this.bridge.audio.uiError();
            this.toast(t('store.notEnough', { n: formatTaka(def.price - this.state.balance) }), 'bad');
          }
        },
      },
    },
      h('div', { class: 'swatch', style: `background:linear-gradient(135deg,${def.swatch[0]},${def.swatch[1]})` }),
      h('div', { class: 'ic-name', text: t(def.nameKey) }),
      h('div', { class: 'ic-desc', text: equipped ? t('common.equipped') : owned ? t('common.owned') : t('common.buy') }),
      h('div', { class: 'ic-price' },
        h('span', { class: 'taka', text: owned ? '' : formatTaka(def.price) }),
        owned ? h('span', { class: 'pill green', text: equipped ? '✓' : t('common.owned') }) : null,
      ),
    );
    return card;
  }

  private upgradeCard(id: string): HTMLElement {
    const up = UPGRADES.find((u) => u.id === id)!;
    const level = this.state.upgradeLevel(id);
    const price = this.state.nextUpgradePrice(id);
    const maxed = level >= up.maxLevel;
    return h('button', {
      class: `item-card${maxed ? ' owned' : ''}`,
      attrs: { type: 'button', 'data-upgrade-id': id },
      on: {
        click: () => {
          if (this.busy) return;
          if (maxed || price === null) return;
          if (this.state.balance < price) {
            this.bridge.audio.uiError();
            this.toast(t('store.notEnough', { n: formatTaka(price - this.state.balance) }), 'bad');
            return;
          }
          this.confirmPurchase(t(up.nameKey), formatTaka(price), () => {
            const res = this.state.buyUpgrade(id);
            if (res.ok) {
              this.bridge.audio.coin();
              this.toast(t('common.apply'), 'good');
              this.bridge.applySettings();
            } else {
              this.bridge.audio.uiError();
            }
            this.refreshShopView();
          });
        },
      },
    },
      h('div', { class: 'ic-name', text: t(up.nameKey) }),
      h('div', { class: 'ic-desc', text: t(up.descKey) }),
      h('div', { class: 'row' },
        ...Array.from({ length: up.maxLevel }, (_, i) =>
          h('span', { class: 'pill', style: `padding:.1rem .4rem;${i < level ? 'background:rgba(76,214,160,.25);border-color:rgba(76,214,160,.5)' : ''}`, text: '●' }),
        ),
      ),
      h('div', { class: 'ic-price' },
        maxed ? h('span', { class: 'pill green', text: t('common.max') }) : h('span', { class: 'taka', text: formatTaka(price ?? 0) }),
      ),
    );
  }

  private vehicleCard(id: string): HTMLElement {
    const v = vehicleById(id);
    const isComingSoon = !!v.comingSoon;
    const owned = !isComingSoon && this.state.ownsVehicle(id);
    const selected = !isComingSoon && this.state.selectedVehicleId === id;
    const unlocked = !isComingSoon && this.state.vehicleUnlocked(id);
    const price = v.price;
    const vStats = vehicleStats(v, this.state.progress.upgrades);

    const miniBars = h('div', { class: 'veh-mini-stats' },
      h('div', { class: 'veh-mini-row' },
        h('span', { text: t('garage.stat.speed') }),
        h('span', { class: 'veh-mini-track' }, h('i', { style: `width:${Math.round(vStats.speed * 100)}%` })),
      ),
      h('div', { class: 'veh-mini-row' },
        h('span', { text: t('garage.stat.accel') }),
        h('span', { class: 'veh-mini-track' }, h('i', { style: `width:${Math.round(vStats.accel * 100)}%` })),
      ),
      h('div', { class: 'veh-mini-row' },
        h('span', { text: t('garage.stat.handling') }),
        h('span', { class: 'veh-mini-track' }, h('i', { style: `width:${Math.round(vStats.handling * 100)}%` })),
      ),
    );

    return h('button', {
      class: `item-card${owned ? ' owned' : ''}${selected ? ' selected' : ''}${isComingSoon ? ' coming-soon' : ''}`,
      attrs: {
        type: 'button',
        'data-vehicle-id': id,
        ...(isComingSoon ? { 'aria-disabled': 'true' } : {}),
      },
      on: {
        click: () => {
          if (this.busy) return;
          if (isComingSoon) {
            this.bridge.previewVehicleInShowroom?.(id);
            this.bridge.audio.uiTap();
            this.toast(t('store.comingSoonSub'));
            return;
          }
          if (owned) {
            if (selected) return;
            this.state.selectVehicle(id);
            this.bridge.audio.uiConfirm();
            this.toast(t('garage.selected'), 'good');
            this.bridge.applySettings();
            this.refreshShopView();
          } else if (!unlocked) {
            this.bridge.audio.uiError();
            this.toast(t('common.locked'), 'bad');
          } else if (this.state.balance >= price) {
            this.confirmPurchase(t(v.nameKey), formatTaka(price), () => {
              const res = this.state.buyVehicle(id);
              if (res.ok) {
                this.bridge.audio.coin();
                this.toast(t('store.buyDone'), 'good');
                this.bridge.applySettings();
              } else {
                this.bridge.audio.uiError();
              }
              this.refreshShopView();
            });
          } else {
            this.bridge.audio.uiError();
            this.toast(t('store.notEnough', { n: formatTaka(price - this.state.balance) }), 'bad');
          }
        },
      },
    },
      h('div', { class: 'swatch', style: `background:linear-gradient(135deg,${v.palette.body},${v.palette.panel})` }),
      h('div', { class: 'ic-name', text: t(v.nameKey) }),
      h('div', { class: 'ic-desc', text: t(v.descKey) }),
      miniBars,
      h('div', { class: 'ic-price' },
        isComingSoon
          ? h('span', { class: 'coming-soon-badge', text: t('store.comingSoon') })
          : owned
            ? h('span', { class: 'pill green', text: selected ? t('garage.selected') : t('common.owned') })
            : h('span', { class: 'taka', text: unlocked ? formatTaka(price) : `🔒 ${v.ridesRequired}` }),
      ),
    );
  }

  private confirmPurchase(name: string, price: string, onConfirm: () => void): void {
    if (this.busy) return;
    this.busy = true;
    const m = modal({
      title: t('store.confirmTitle'),
      message: t('garage.chargeConfirm', { name, price }),
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        this.busy = false;
        onConfirm();
      },
      onCancel: () => {
        this.busy = false;
      },
    });
    this.root.append(m);
  }

  closeGarage(): void {
    if (this.garageEl) {
      this.garageEl.remove();
      this.screens.delete('garage');
      this.garageEl = null;
    }
    this.bridge.closeGarage();
    if (this.garageFrom === 'menu') this.show('menu');
    else if (this.garageFrom === 'pause') this.show('pause');
    else this.show('menu');
  }

  closeStore(): void {
    if (this.storeEl) {
      this.storeEl.remove();
      this.screens.delete('store');
      this.storeEl = null;
    }
    this.show('menu');
    this.bridge.setShowroomVisible(false);
  }

  /** Cassette Box: the original soundtrack tapes unlocked by playing. */
  private cassetteBox(): HTMLElement {
    const row = h('div', { class: 'col', style: 'gap:.3rem' });
    row.append(h('div', { class: 'screentag', text: t('tape.cassette') === '' ? 'Cassette Box' : '📻 Cassette Box' }));
    for (const tape of TAPES) {
      const unlocked = this.state.progress.tapes.includes(tape.id);
      const active = this.currentTape === tape.id;
      row.append(h('div', { class: 'spread' },
        h('div', { class: 'small', text: t(tape.nameKey) }),
        unlocked
          ? button(active ? t('common.equipped') : t('common.play'), {
              variant: active ? 'gold' : 'ghost',
              small: true,
              onClick: () => {
                const id = tape.id as 'cassette' | 'radio' | 'brishti';
                this.currentTape = id;
                this.bridge.setTrack(id);
                this.refreshShopView();
              },
            })
          : h('span', { class: 'pill', text: t('tape.locked') }),
      ));
    }
    return h('div', { class: 'panel glass', style: 'padding:.6rem .75rem;display:flex;flex-direction:column;gap:.3rem' }, row);
  }

  // ---------------------------------------------------------------- store (Dokan)
  openStore(): void {
    this.bridge.openShowroomFromMenu?.();
    this.buildStore();
    this.show('store');
    this.bridge.setShowroomVisible(true);
  }

  private buildStore(): void {
    if (this.storeEl) {
      this.storeEl.remove();
      this.screens.delete('store');
      this.storeEl = null;
    }
    const eqVehicle = this.state.vehicle();
    const { wrap, body } = sheet(t('store.title'), {
      subtitle: `${t('store.subtitle')} · ${t(eqVehicle.nameKey)}`,
      onClose: () => this.closeStore(),
    });
    const tabs = h('div', { class: 'tabs' });
    for (const [id, label] of [
      ['vehicles', t('store.vehicles')],
      ['upgrades', t('store.upgrades')],
      ['paint', t('store.paint')],
      ['accessories', t('store.accessories')],
    ] as [typeof this.storeTab, string][]) {
      tabs.append(h('button', {
        class: this.storeTab === id ? 'on' : '',
        attrs: { type: 'button', 'data-store-tab': id },
        text: label,
        on: {
          click: () => {
            this.storeTab = id;
            this.buildStore();
            this.show('store');
          },
        },
      }));
    }
    body.append(
      h('div', { class: 'spread' },
        h('div', { class: 'pill gold', attrs: { id: 'store-balance' }, text: formatTaka(this.state.balance) }),
        h('div', { class: 'pill green', text: `${t('common.equipped')}: ${t(eqVehicle.nameKey)}` }),
      ),
      tabs,
    );
    const grid = h('div', { class: 'card-grid' });
    if (this.storeTab === 'vehicles') {
      for (const v of VEHICLES) grid.append(this.vehicleCard(v.id));
    } else if (this.storeTab === 'upgrades') {
      for (const up of UPGRADES) grid.append(this.upgradeCard(up.id));
    } else if (this.storeTab === 'paint') {
      for (const c of COSMETICS.filter((x) => x.category === 'paint' || x.category === 'art')) {
        grid.append(this.cosmeticCard(c.id));
      }
    } else {
      for (const c of COSMETICS.filter((x) => x.category !== 'paint' && x.category !== 'art')) {
        grid.append(this.cosmeticCard(c.id));
      }
    }
    body.append(
      grid,
      h('div', { class: 'divider' }),
      button(t('common.back'), { variant: 'ghost', wide: true, onClick: () => this.closeStore() }),
    );
    this.storeEl = h('div', { class: 'screen' }, wrap);
    this.register('store', this.storeEl);
  }

  // -------------------------------------------------------------- settings
  openSettings(back: () => void): void {
    this.settingsReturn = back;
    this.buildSettings();
    this.show('settings');
  }

  private buildSettings(): void {
    if (this.settingsEl) {
      this.settingsEl.remove();
      this.settingsEl = null;
    }
    const s = this.settingsStore.get();
    const { wrap, body } = sheet(t('settings.title'), {
      onClose: () => this.closeSettings(),
    });

    const patch = (p: Partial<Settings>): void => {
      this.settingsStore.set(p);
      this.bridge.applySettings();
    };

    // graphics
    body.append(h('h3', { text: t('settings.graphics') }));
    body.append(segmented<QualityPreset>({
      label: t('settings.quality'),
      value: s.quality,
      options: [
        { value: 'low', label: t('quality.low') },
        { value: 'balanced', label: t('quality.balanced') },
        { value: 'high', label: t('quality.high') },
        { value: 'pc_high', label: t('quality.pc_high') },
      ],
      onChange: (v) => {
        patch({ quality: v, shadows: QUALITY[v].shadows });
        this.buildSettings();
        this.show('settings');
      },
    }));
    body.append(h('div', { class: 'tiny muted', text: t('settings.qualityNote') }));
    body.append(slider({
      label: t('settings.renderScale'),
      value: s.renderScale,
      min: 0.6,
      max: 1.2,
      step: 0.05,
      onInput: (v) => patch({ renderScale: v }),
      display: (v) => `${Math.round(v * 100)}%`,
    }));
    body.append(toggle({ label: t('settings.shadows'), value: s.shadows, onChange: (v) => patch({ shadows: v }) }));
    body.append(segmented<'30' | '60'>({
      label: t('settings.fps'),
      value: s.fpsTarget === 30 ? '30' : '60',
      options: [
        { value: '30', label: t('settings.fps30') },
        { value: '60', label: t('settings.fps60') },
      ],
      onChange: (v) => patch({ fpsTarget: v === '30' ? 30 : 60 }),
    }));

    // audio
    body.append(h('div', { class: 'divider' }), h('h3', { text: t('settings.audio') }));
    body.append(toggle({
      label: t('settings.mute'),
      value: s.muted,
      onChange: (v) => {
        patch({ muted: v });
        this.syncSoundUnlockPrompts();
      },
    }));
    body.append(slider({ label: t('settings.master'), value: s.master, onInput: (v) => patch({ master: v }) }));
    body.append(toggle({
      label: t('settings.musicToggle'),
      value: s.musicEnabled,
      onChange: (v) => patch({ musicEnabled: v }),
    }));
    body.append(slider({ label: t('settings.music'), value: s.music, onInput: (v) => patch({ music: v }) }));
    body.append(toggle({
      label: t('settings.sfxToggle'),
      value: s.sfxEnabled,
      onChange: (v) => patch({ sfxEnabled: v }),
    }));
    body.append(slider({ label: t('settings.sfx'), value: s.sfx, onInput: (v) => patch({ sfx: v }) }));
    body.append(slider({ label: t('settings.ambience'), value: s.ambience, onInput: (v) => patch({ ambience: v }) }));
    body.append(slider({ label: t('settings.traffic'), value: s.traffic, onInput: (v) => patch({ traffic: v }) }));
    body.append(slider({ label: t('settings.vehicle'), value: s.vehicle, onInput: (v) => patch({ vehicle: v }) }));
    body.append(slider({ label: t('settings.dialogue'), value: s.dialogue, onInput: (v) => patch({ dialogue: v }) }));
    body.append(slider({ label: t('settings.ui'), value: s.ui, onInput: (v) => patch({ ui: v }) }));
    body.append(toggle({
      label: t('settings.calmAmbience'),
      value: s.reduceNoisyAmbience,
      onChange: (v) => patch({ reduceNoisyAmbience: v }),
    }));
    body.append(segmented<'both' | 'music' | 'street'>({
      label: t('settings.radioMode'),
      value: s.radioMode,
      options: [
        { value: 'both', label: t('settings.radio.both') },
        { value: 'music', label: t('settings.radio.music') },
        { value: 'street', label: t('settings.radio.street') },
      ],
      onChange: (v) => patch({ radioMode: v }),
    }));

    // controls
    body.append(h('div', { class: 'divider' }), h('h3', { text: t('settings.controls') }));
    body.append(segmented<'buttons' | 'wheel'>({
      label: t('settings.steering'),
      value: s.steering,
      options: [
        { value: 'buttons', label: t('settings.steering.buttons') },
        { value: 'wheel', label: t('settings.steering.wheel') },
      ],
      onChange: (v) => {
        patch({ steering: v });
        this.applyControlLayout();
      },
    }));
    body.append(segmented<'right' | 'left'>({
      label: t('settings.handedness'),
      value: s.handedness,
      options: [
        { value: 'right', label: t('settings.rightHanded') },
        { value: 'left', label: t('settings.leftHanded') },
      ],
      onChange: (v) => {
        patch({ handedness: v });
        this.applyControlLayout();
      },
    }));
    body.append(slider({
      label: t('settings.sensitivity'),
      value: s.sensitivity,
      min: 0.35,
      max: 1.8,
      onInput: (v) => patch({ sensitivity: v }),
    }));
    body.append(slider({
      label: t('settings.deadzone'),
      value: s.deadzone,
      min: 0,
      max: 0.4,
      onInput: (v) => patch({ deadzone: v }),
      display: (v) => `${Math.round(v * 100)}%`,
    }));
    body.append(toggle({ label: t('settings.cameraShake'), value: s.cameraShake, onChange: (v) => patch({ cameraShake: v }) }));
    body.append(toggle({ label: t('settings.lowFlash'), value: s.lowFlash, onChange: (v) => patch({ lowFlash: v }) }));
    body.append(toggle({ label: t('settings.haptics'), value: s.haptics, note: t('settings.hapticsNote'), onChange: (v) => patch({ haptics: v }) }));

    // language + accessibility
    body.append(h('div', { class: 'divider' }), h('h3', { text: t('settings.language') }));
    body.append(segmented<Locale>({
      value: s.language,
      options: [
        { value: 'bn', label: 'বাংলা' },
        { value: 'en', label: 'English' },
      ],
      onChange: (v) => {
        patch({ language: v });
        setLocale(v);
        this.rebuildAll();
        this.buildSettings();
        this.show('settings');
      },
    }));

    body.append(h('div', { class: 'divider' }), h('h3', { text: t('settings.accessibility') }));
    body.append(slider({
      label: t('settings.textSize'),
      value: s.textScale,
      min: 0.85,
      max: 1.4,
      onInput: (v) => {
        patch({ textScale: v });
        document.documentElement.style.setProperty('--text-scale', String(v));
      },
    }));
    body.append(slider({
      label: t('settings.hudScale'),
      value: s.hudScale,
      min: 0.8,
      max: 1.3,
      onInput: (v) => {
        patch({ hudScale: v });
        document.documentElement.style.setProperty('--ui-scale', String(v));
      },
    }));
    body.append(toggle({ label: t('settings.reduceEffects'), value: s.reduceEffects, onChange: (v) => patch({ reduceEffects: v }) }));
    body.append(toggle({ label: t('settings.subtitles'), value: s.subtitles, onChange: (v) => patch({ subtitles: v }) }));

    body.append(h('div', { class: 'divider' }));
    body.append(button(t('settings.reset'), {
      variant: 'ghost',
      wide: true,
      onClick: () => {
        this.settingsStore.reset();
        this.bridge.applySettings();
        this.rebuildAll();
        this.buildSettings();
        this.show('settings');
        this.toast(t('settings.resetDone'), 'good');
      },
    }));
    body.append(button(t('common.back'), { variant: 'primary', wide: true, onClick: () => this.closeSettings() }));

    this.settingsEl = h('div', { class: 'screen' }, wrap);
    this.register('settings', this.settingsEl);
  }

  closeSettings(): void {
    if (this.settingsEl) {
      this.settingsEl.remove();
      this.screens.delete('settings');
      this.settingsEl = null;
    }
    const back = this.settingsReturn;
    this.settingsReturn = null;
    if (back) back();
    else this.show('menu');
  }

  // --------------------------------------------------------------- credits
  private openCredits(): void {
    if (this.creditsEl) {
      this.creditsEl.remove();
      this.screens.delete('credits');
      this.creditsEl = null;
    }
    const close = (): void => {
      if (this.creditsEl) {
        this.creditsEl.remove();
        this.screens.delete('credits');
        this.creditsEl = null;
      }
      this.show('menu');
    };
    const { wrap, body } = sheet(t('credits.title'), { onClose: close });
    body.append(
      h('div', { class: 'credits-list' },
        h('p', { class: 'small', text: t('credits.made') }),
        h('h3', { text: t('credits.design') }),
        h('p', { text: 'Arena agent build · procedural art, code and audio' }),
        h('h3', { text: t('credits.engine') }),
        h('p', { text: 'three.js r186 · Vite · TypeScript' }),
        h('h3', { text: t('credits.fonts') }),
        h('p', { text: 'Hind Siliguri by Indian Type Foundry — SIL Open Font License 1.1' }),
        h('h3', { text: t('credits.audio') }),
        h('p', { text: t('credits.audioNote') }),
        h('h3', { text: t('credits.assets') }),
        h('p', { text: t('credits.assetsNote') }),
        h('p', { class: 'tiny muted', text: t('credits.mapNote') }),
        h('p', { class: 'tiny', style: 'color:#8fe3c0;margin-top:.25rem', text: t('osm.credit') }),
        h('p', { class: 'small', style: 'margin-top:.5rem;color:#e8b25a', text: t('credits.thanks') }),
      ),
      button(t('common.back'), { variant: 'ghost', wide: true, onClick: close }),
    );
    this.creditsEl = h('div', { class: 'screen' }, wrap);
    this.register('credits', this.creditsEl);
    this.show('credits');
  }

  // -------------------------------------------------------------- tutorial
  private tutorialStep = 0;
  openTutorial(): void {
    if (this.tutorialEl) {
      this.tutorialEl.remove();
      this.tutorialEl = null;
    }
    this.tutorialStep = 0;
    this.renderTutorial();
  }

  private renderTutorial(): void {
    if (this.tutorialEl) {
      this.tutorialEl.remove();
      this.tutorialEl = null;
    }
    const steps = [
      { title: 'tut.1.title', body: 'tut.1.body' },
      { title: 'tut.2.title', body: 'tut.2.body' },
      { title: 'tut.3.title', body: 'tut.3.body' },
      { title: 'tut.4.title', body: 'tut.4.body' },
    ];
    const step = steps[this.tutorialStep];
    const { wrap, body } = sheet(t(step.title), {
      subtitle: `${this.tutorialStep + 1} / ${steps.length}`,
      onClose: () => this.finishTutorial(),
    });
    body.append(
      h('p', { class: 'small', text: t(step.body) }),
      button(this.tutorialStep === steps.length - 1 ? t('tut.done') : t('tut.next'), {
        variant: 'primary',
        wide: true,
        onClick: () => {
          this.bridge.audio.uiTap();
          if (this.tutorialStep >= steps.length - 1) this.finishTutorial();
          else {
            this.tutorialStep++;
            this.renderTutorial();
          }
        },
      }),
      button(t('tut.skip'), { variant: 'ghost', wide: true, onClick: () => this.finishTutorial() }),
    );
    this.tutorialEl = h('div', { class: 'screen' }, wrap);
    this.register('tutorial', this.tutorialEl);
    this.show('tutorial');
  }

  private finishTutorial(): void {
    this.tutorialEl?.remove();
    this.tutorialEl = null;
    this.state.markTutorialDone();
    this.bridge.startMode('duty');
  }

  // --------------------------------------------------------------- loading
  private buildLoading(): void {
    const bar = h('i');
    const label = h('div', { class: 'tiny muted', text: t('common.loading') });
    const el = h('div', { class: 'loading-screen hidden' },
      h('div', { class: 'loading-inner' },
        h('div', { class: 'boot-title', style: 'font-size:1.1rem;letter-spacing:.2em', text: 'BANGLAR TESLA' }),
        h('div', { class: 'bar' }, bar),
        label,
      ),
    );
    this.loadingEl = h('div');
    this.loadingEl = el;
    this.loadingBar = bar;
    this.root.append(el);
  }

  private loadingBar!: HTMLElement;

  showLoading(label?: string): void {
    this.loadingEl.classList.remove('hidden');
    this.loadingBar.style.width = '8%';
    const el = this.loadingEl.querySelector('.tiny');
    if (el && label) el.textContent = label;
  }

  setLoadingProgress(p: number): void {
    this.loadingBar.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
  }

  hideLoading(): void {
    this.loadingEl.classList.add('hidden');
  }

  // ------------------------------------------------------------- job offer
  private offerEl: HTMLElement | null = null;

  showJobOffer(offer: MissionOffer, pickupName: string, dropName: string, onAccept: () => void, onDecline: () => void): void {
    this.hideJobOffer();
    const card = h('div', { class: 'glass job-offer-card' },
      h('div', { class: 'screentag', text: offer.daily ? t('mission.daily') : t('mission.standard') }),
      h('div', { class: 'spread' },
        h('h3', { text: `${pickupName} → ${dropName}` }),
        h('span', { class: 'pill gold', text: formatTaka(offer.fareEstimate) }),
      ),
      h('div', { class: 'row wrap' },
        h('span', { class: 'pill', text: t(offer.optional === 'smooth' ? 'mission.optional.smooth' : offer.optional === 'rain' ? 'mission.optional.rain' : offer.optional === 'lane' ? 'mission.optional.alley' : 'mission.optional.fast') }),
        h('span', { class: 'pill', text: `${t('common.distance')} ${formatDistance(offer.distance)}` }),
        h('span', { class: 'pill', text: `${t('common.time')} ${Math.round(offer.targetTime / 60)}m` }),
      ),
      h('div', { class: 'row' },
        button(t('common.cancel'), { variant: 'ghost', small: true, onClick: onDecline }),
        button(t('common.continue'), { variant: 'primary', small: true, class: 'grow', onClick: onAccept }),
      ),
    );
    card.id = 'job-offer';
    this.offerEl = card;
    this.root.append(card);
  }

  /** Stop-nearby interaction: exactly one bargain attempt for this passenger. */
  showRoadsideOffer(dropName: string, fare: number, attempted: boolean, onAccept: () => void, onDecline: () => void, onBargain: () => void): void {
    this.hideJobOffer();
    const card = h('div', { class: 'glass job-offer-card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('roadside.speaker') } },
      h('h3', { text: t('roadside.destination', { destination: dropName }) }),
      h('p', { class: 'pill gold', text: t('roadside.fare', { fare: formatTaka(fare) }) }),
      h('div', { class: 'row wrap' },
        button(t('roadside.board'), { variant: 'primary', small: true, onClick: onAccept, attrs: { 'data-roadside': 'board' } }),
        button(t('roadside.cancel'), { variant: 'ghost', small: true, onClick: onDecline, attrs: { 'data-roadside': 'cancel' } }),
        button(t('roadside.bargain'), { variant: 'ghost', small: true, onClick: onBargain,
          attrs: { 'data-roadside': 'bargain', ...(attempted ? { disabled: 'true', 'aria-disabled': 'true' } : {}) } }),
      ),
    );
    card.id = 'roadside-offer';
    this.offerEl = card;
    this.root.append(card);
  }

  hideJobOffer(): void {
    this.offerEl?.remove();
    this.offerEl = null;
  }

  // --------------------------------------------------- Blacklist & Race UI (v0.5.0)
  private buildCinematicOverlay(): void {
    this.cinematicBadgeEl = h('div', { class: 'cinematic-badge', text: '' });
    this.cinematicHeadEl = h('div', { class: 'cinematic-head', text: '' });
    this.cinematicSubEl = h('div', { class: 'cinematic-sub', text: '' });
    this.cinematicSkipBtn = h(
      'button',
      {
        class: 'btn ghost small cinematic-skip-btn',
        attrs: { id: 'cinematic-skip-btn', type: 'button' },
        on: {
          click: () => {
            this.bridge.audio.uiTap();
            this.bridge.skipBlacklistIntro();
          },
        },
      },
      h('span', { text: t('cinematic.skip') }),
    );

    const el = h(
      'div',
      { class: 'cinematic-overlay hidden', attrs: { id: 'cinematic-overlay' } },
      h('div', { class: 'cinematic-bar top' }, this.cinematicSkipBtn),
      h(
        'div',
        { class: 'cinematic-bar bottom' },
        this.cinematicBadgeEl,
        this.cinematicHeadEl,
        this.cinematicSubEl,
      ),
    );
    this.cinematicEl = el;
    this.root.append(el);
  }

  updateCinematicUi(state: CinematicUiState): void {
    if (!state.active) {
      this.cinematicEl.classList.add('hidden');
      return;
    }
    this.cinematicSkipBtn.firstElementChild!.textContent = t('cinematic.skip');
    this.cinematicBadgeEl.textContent = state.rankBadge;
    this.cinematicBadgeEl.classList.toggle('hidden', !state.rankBadge);
    this.cinematicHeadEl.textContent = state.headline;
    this.cinematicSubEl.textContent = state.subline;
    this.cinematicEl.classList.remove('hidden');
  }

  openBlacklistView(from: 'menu' | 'hud' | 'pause'): void {
    this.blacklistFrom = from;
    this.renderBlacklistScreen();
    this.show('blacklist');
  }

  closeBlacklist(): void {
    if (this.blacklistEl) {
      this.blacklistEl.remove();
      this.screens.delete('blacklist');
      this.blacklistEl = null;
    }
    if (this.blacklistFrom === 'hud') {
      this.bridge.resumeGame();
    } else if (this.blacklistFrom === 'pause') {
      this.show('pause');
    } else {
      this.show('menu');
    }
  }

  private renderBlacklistScreen(): void {
    if (this.blacklistEl) {
      this.blacklistEl.remove();
      this.screens.delete('blacklist');
      this.blacklistEl = null;
    }
    const loc = getLocale();
    const { wrap, body } = sheet(t('blacklist.title'), {
      subtitle: t('blacklist.subtitle'),
      onClose: () => this.closeBlacklist(),
    });
    wrap.id = 'blacklist-sheet';

    const curRank = this.state.blacklistRank;
    const statusChipText =
      curRank <= 0
        ? t('blacklist.championBadge')
        : t('blacklist.nextRank', { rank: curRank });

    const summaryBar = h(
      'div',
      { class: 'blacklist-summary' },
      h('span', { class: 'pill gold', text: t('blacklist.yourRep', { rep: this.state.rep }) }),
      h('span', { class: 'pill', text: statusChipText }),
      button(t('blacklist.replayIntro'), {
        variant: 'ghost',
        small: true,
        attrs: { id: 'blacklist-replay-intro' },
        onClick: () => {
          this.bridge.audio.uiTap();
          this.bridge.replayBlacklistIntro();
        },
      }),
    );

    const tabs = segmented<'rivals' | 'events'>({
      options: [
        { value: 'rivals', label: t('blacklist.tabRivals') },
        { value: 'events', label: t('blacklist.tabEvents') },
      ],
      value: this.blacklistTab,
      onChange: (val) => {
        this.blacklistTab = val;
        this.renderBlacklistScreen();
        this.show('blacklist');
      },
    });

    const listWrap = h('div', { class: 'blacklist-list' });
    const defeatedSet = this.state.defeatedRanks;
    if (this.blacklistTab === 'rivals') {
      for (const rival of BLACKLIST_RIVALS) {
        const checklist = this.state.checklistForRival(rival.rank, rival.repRequired);
        const defeated = defeatedSet.has(rival.rank);
        const canChallenge = checklist.ready;
        const name = loc === 'en' ? rival.nameEn : rival.nameBn;
        const arch = loc === 'en' ? rival.archetypeEn : rival.archetypeBn;
        const terr = loc === 'en' ? rival.territoryEn : rival.territoryBn;
        const taunt = loc === 'en' ? rival.tauntEn : rival.tauntBn;
        const ev = rival.bossEvent;

        const badgeLabel = defeated
          ? t('blacklist.defeated')
          : canChallenge
            ? t('blacklist.ready')
            : t('blacklist.lockedRep', { rep: rival.repRequired });

        const portraitEl = h('div', {
          class: 'bl-portrait',
          attrs: { 'data-rival-portrait': rival.id },
        });
        portraitEl.innerHTML = renderRivalPortraitSvg(rival);

        const introBtn = button(t('blacklist.watchIntro'), {
          variant: 'ghost',
          small: true,
          attrs: {
            'data-intro-rank': String(rival.rank),
          },
          onClick: () => {
            this.bridge.audio.uiTap();
            this.bridge.playRivalIntro(rival.rank, false);
          },
        });

        const challengeBtn = button(t('blacklist.challengeBtn'), {
          variant: canChallenge ? (defeated ? 'ghost' : 'primary') : 'ghost',
          small: true,
          attrs: {
            'data-event-id': ev.id,
            'data-rival-rank': String(rival.rank),
            ...(canChallenge ? {} : { disabled: 'true', 'aria-disabled': 'true' }),
          },
          onClick: () => {
            if (!canChallenge) return;
            this.bridge.audio.uiConfirm();
            this.bridge.startRivalEvent(ev.id);
          },
        });
        if (!canChallenge) challengeBtn.classList.add('disabled');

        const checklistLine = (complete: boolean, text: string, id: string): HTMLElement =>
          h('div', { class: `blacklist-task${complete ? ' complete' : ''}`, attrs: { 'data-task': id } },
            h('span', { text: complete ? '✓' : '○', attrs: { 'aria-hidden': 'true' } }),
            h('span', { text }),
          );
        const checklistEl = h('div', { class: 'blacklist-checklist', attrs: { 'data-checklist-rank': String(rival.rank) } },
          h('strong', { class: 'tiny', text: t('blacklist.tasksTitle') }),
          checklistLine(checklist.rankUnlocked, t('blacklist.task.rank'), 'rank'),
          checklistLine(checklist.reputationMet, t('blacklist.task.rep', { current: this.state.rep, required: rival.repRequired }), 'rep'),
          ...checklist.tasks.map((task) => checklistLine(task.complete, t(`blacklist.task.${task.task}`), task.task)),
        );
        if (rival.rank === curRank && checklist.tasks.some((task) => task.task === 'escape' && !task.complete)) {
          checklistEl.append(button(t('blacklist.startEscape'), {
            variant: 'ghost', small: true,
            attrs: { 'data-police-challenge-rank': String(rival.rank) },
            onClick: () => this.bridge.startBlacklistEscape(rival.rank),
          }));
        }
        const card = h(
          'div',
          {
            class: `blacklist-card${defeated ? ' defeated' : canChallenge ? ' ready' : ' locked'}`,
            attrs: { 'data-rank': String(rival.rank) },
          },
          h(
            'div',
            { class: 'bl-card-head' },
            portraitEl,
            h(
              'span',
              {
                class: 'bl-rank-pill',
                style: `border-color:${rival.accentHex};color:${rival.accentHex}`,
                text: `#${rival.rank}`,
              },
            ),
            h(
              'div',
              { class: 'bl-title-col' },
              h('strong', { text: name }),
              h('span', {
                class: 'tiny muted',
                text: `${arch} · ${t(`race.tendency.${rival.tendency}`)} · ${terr}`,
              }),
            ),
            h('span', { class: `pill ${defeated ? '' : canChallenge ? 'gold' : ''}`, text: badgeLabel }),
          ),
          h('div', { class: 'bl-taunt', text: `“${taunt}”` }),
          checklistEl,
          h(
            'div',
            { class: 'bl-card-foot' },
            h(
              'div',
              { class: 'tiny' },
              h('div', {
                text: `${t(`event.kind.${ev.kind}`)} · ${t('blacklist.rewardLine', {
                  cash: formatTaka(ev.cashReward),
                  rep: ev.repReward,
                })}`,
              }),
              h('div', {
                class: 'muted',
                text: t('blacklist.lossNote', { fee: formatTaka(ev.lossFee) }),
              }),
            ),
            h('div', { class: 'bl-action-row' }, introBtn, challengeBtn),
          ),
        );
        listWrap.append(card);
      }
    } else {
      for (const ev of OPEN_STREET_EVENTS) {
        listWrap.append(this.buildStreetEventCard(ev, loc));
      }
    }

    body.append(
      summaryBar,
      tabs,
      listWrap,
      button(t('common.back'), { variant: 'ghost', wide: true, onClick: () => this.closeBlacklist() }),
    );
    this.blacklistEl = h('div', { class: 'screen' }, wrap);
    this.register('blacklist', this.blacklistEl);
  }

  private buildStreetEventCard(ev: RivalEventSpec, loc: Locale): HTMLElement {
    const title = loc === 'en' ? ev.titleEn : ev.titleBn;
    const desc = loc === 'en' ? ev.descEn : ev.descBn;
    const completed = this.state.completedEvents.has(ev.id);
    return h(
      'div',
      { class: 'blacklist-card ready', attrs: { 'data-street-event': ev.id } },
      h(
        'div',
        { class: 'bl-card-head' },
        h('span', { class: 'pill gold', text: t(`event.kind.${ev.kind}`) }),
        h('strong', { class: 'grow', text: title }),
        ...(completed ? [h('span', { class: 'pill', text: '✓' })] : []),
      ),
      h('p', { class: 'tiny muted', style: 'margin:0.18rem 0', text: desc }),
      h(
        'div',
        { class: 'bl-card-foot' },
        h('span', {
          class: 'tiny',
          text: t('blacklist.rewardLine', { cash: formatTaka(ev.cashReward), rep: ev.repReward }),
        }),
        button(t('blacklist.startEventBtn'), {
          variant: 'primary',
          small: true,
          attrs: { 'data-event-id': ev.id },
          onClick: () => {
            this.bridge.audio.uiConfirm();
            this.bridge.startRivalEvent(ev.id);
          },
        }),
      ),
    );
  }

  /** Pooled weather overlays — created ONCE at boot, mutated only on weather events. */
  private buildWeatherOverlays(): void {
    this.sunGlareEl = h('div', { class: 'sun-glare', attrs: { 'aria-hidden': 'true' } });
    this.lightningEl = h('div', { class: 'lightning-flash', attrs: { 'aria-hidden': 'true' } });
    this.root.append(this.sunGlareEl, this.lightningEl);
    // 10 pooled screen droplets with compositor-driven CSS drip animation
    for (let i = 0; i < 10; i++) {
      const drop = h('div', {
        class: 'rain-drop',
        attrs: {
          'aria-hidden': 'true',
          style: `left:${(i * 9.7 + 5) % 96}%;top:${-6 - (i % 4) * 5}%;animation-delay:${(i * 0.47).toFixed(2)}s;animation-duration:${(2.1 + (i % 3) * 0.7).toFixed(2)}s`,
        },
      });
      this.rainDropEls.push(drop);
      this.root.append(drop);
    }
    this.setRainDrops(false);
  }

  /** Angle-dependent sun glare overlay (vNext §4 Sunny state). Dirty-checked. */
  setSunGlare(strength: number, screenX: number, screenY: number): void {
    if (!this.sunGlareEl) return;
    const s = Math.max(0, Math.min(1, strength));
    const key = `${s.toFixed(2)}|${Math.round(screenX / 24)}|${Math.round(screenY / 24)}`;
    if (key === this.sunGlareState) return;
    this.sunGlareState = key;
    this.sunGlareEl.style.opacity = s.toFixed(2);
    this.sunGlareEl.style.transform = `translate(${Math.round(screenX)}px, ${Math.round(screenY)}px)`;
    this.sunGlareEl.classList.toggle('on', s > 0.02);
  }

  /** Lightning flash overlay — one style write per strike, CSS handles the fade. */
  triggerLightningFlash(strength: number, flashAllowed: boolean): void {
    if (!this.lightningEl) return;
    const s = flashAllowed ? Math.max(0.12, Math.min(0.55, strength)) : Math.min(0.12, strength * 0.2);
    this.lightningEl.style.opacity = String(s);
    // Force style flush so the CSS fade transition retriggers per strike
    void this.lightningEl.getBoundingClientRect();
    this.lightningEl.style.opacity = '0';
  }

  /** Toggle the pooled rain droplets (event-driven, zero per-frame cost). */
  setRainDrops(active: boolean): void {
    if (active === this.rainDropsActive) return;
    this.rainDropsActive = active;
    for (const drop of this.rainDropEls) drop.classList.toggle('on', active);
  }

  /** Bounded stunt/score HUD chip (vNext §9). One node, dirty text writes only. */
  showStuntChip(text: string, points: number, combo: number): void {
    if (!this.stuntChipEl) {
      this.stuntChipEl = h('div', { class: 'stunt-chip', attrs: { 'aria-live': 'polite' } });
      this.root.append(this.stuntChipEl);
    }
    this.stuntChipEl.textContent = `${text} +${points}${combo > 1 ? ` ×${combo}` : ''}`;
    this.stuntChipEl.classList.add('on');
    window.clearTimeout(this.stuntChipTimer);
    this.stuntChipTimer = window.setTimeout(() => {
      this.stuntChipEl?.classList.remove('on');
    }, 1700);
  }
  private stuntChipTimer = 0;

  /**
   * §8 spontaneous rival challenge offer (accept/decline). Replaces nothing;
   * only shown from free-roam recognition with cooldowns in the game layer.
   */
  showRivalChallenge(
    name: string,
    territory: string,
    onAccept: () => void,
    onDecline: () => void,
  ): void {
    this.hideRivalChallenge();
    const card = h(
      'div',
      { class: 'rival-challenge', attrs: { role: 'dialog', 'aria-label': name } },
      h('div', { class: 'rc-head', text: t('rival.challengeTitle') }),
      h('div', { class: 'rc-name', text: name }),
      h('div', { class: 'tiny muted', text: territory }),
      h(
        'div',
        { class: 'rc-actions' },
        button(t('rival.accept'), {
          variant: 'primary',
          small: true,
          attrs: { id: 'rival-accept-btn' },
          onClick: () => {
            this.hideRivalChallenge();
            onAccept();
          },
        }),
        button(t('rival.decline'), {
          variant: 'ghost',
          small: true,
          attrs: { id: 'rival-decline-btn' },
          onClick: () => {
            this.hideRivalChallenge();
            onDecline();
          },
        }),
      ),
    );
    this.rivalChallengeEl = card;
    this.root.append(card);
  }

  hideRivalChallenge(): void {
    if (this.rivalChallengeEl) {
      this.rivalChallengeEl.remove();
      this.rivalChallengeEl = null;
    }
  }

  /** §10 permanent career scrapbook screen (metadata + bounded framed photos). */
  openScrapbook(snapshot: ScrapbookSnapshot, records: readonly ScrapbookRecord[]): void {
    if (this.scrapbookEl) {
      this.scrapbookEl.remove();
      this.screens.delete('scrapbook');
      this.scrapbookEl = null;
    }
    const { wrap, body } = sheet(t('scrapbook.title'), {
      subtitle: t('scrapbook.subtitle'),
      onClose: () => this.closeScrapbook(),
    });
    wrap.id = 'scrapbook-sheet';

    const stats = h(
      'div',
      { class: 'scrapbook-stats' },
      h('span', { class: 'pill gold', text: `${t('scrapbook.wins')}: ${snapshot.raceWins}` }),
      h('span', { class: 'pill', text: `${t('scrapbook.losses')}: ${snapshot.raceLosses}` }),
      h('span', { class: 'pill', text: `${t('scrapbook.topSpeed')}: ${Math.round(snapshot.topSpeedKmh)} km/h` }),
      h('span', { class: 'pill', text: `${t('scrapbook.escapes')}: ${snapshot.policeEscapes}` }),
      h('span', { class: 'pill', text: `${t('scrapbook.nearMisses')}: ${snapshot.nearMisses}` }),
      h('span', { class: 'pill', text: `${t('scrapbook.stunts')}: ${snapshot.stunts}` }),
    );

    const listWrap = h('div', { class: 'scrapbook-list' });
    for (const rec of [...records].reverse().slice(0, 80)) {
      const card = h(
        'div',
        { class: 'scrapbook-card', attrs: { 'data-record-id': rec.id } },
        rec.photoThumb
          ? (() => {
              const thumb = h('div', { class: 'scrapbook-thumb' });
              const img = document.createElement('img');
              img.src = rec.photoThumb;
              img.alt = rec.titleEn;
              img.loading = 'lazy';
              thumb.append(img);
              return thumb;
            })()
          : h('div', { class: 'scrapbook-thumb placeholder', text: '🖼' }),
        h(
          'div',
          { class: 'scrapbook-card-body' },
          h('strong', { text: getLocale() === 'en' ? rec.titleEn : rec.titleBn }),
          h('div', { class: 'tiny muted', text: getLocale() === 'en' ? rec.detailEn : rec.detailBn }),
          h('div', {
            class: 'tiny muted',
            text: `${rec.vehicleId} · ${String(Math.floor(rec.minutesOfDay / 60)).padStart(2, '0')}:${String(
              Math.floor(rec.minutesOfDay % 60),
            ).padStart(2, '0')}${rec.topSpeedKmh ? ` · ${Math.round(rec.topSpeedKmh)} km/h` : ''}${
              rec.takaDelta ? ` · ${rec.takaDelta > 0 ? '+' : ''}${rec.takaDelta}৳` : ''
            }`,
          }),
        ),
      );
      listWrap.append(card);
    }

    body.append(stats, listWrap, button(t('common.back'), { variant: 'ghost', wide: true, onClick: () => this.closeScrapbook() }));
    this.scrapbookEl = h('div', { class: 'screen' }, wrap);
    this.register('scrapbook', this.scrapbookEl);
    this.show('scrapbook');
  }

  closeScrapbook(): void {
    if (this.scrapbookEl) {
      this.scrapbookEl.remove();
      this.screens.delete('scrapbook');
      this.scrapbookEl = null;
    }
    this.show('menu');
  }

  openRaceResult(summary: RaceResultSummary): void {
    if (this.raceResultEl) {
      this.raceResultEl.remove();
      this.screens.delete('raceResult');
      this.raceResultEl = null;
    }
    const loc = getLocale();
    const evTitle = loc === 'en' ? summary.event.titleEn : summary.event.titleBn;

    const buildStandingsList = () => {
      const wrapList = h('div', { class: 'winner-standings-list' });
      for (const st of summary.standings) {
        const displayName = st.isPlayer
          ? loc === 'en'
            ? 'You (Player)'
            : 'আপনি (প্লেয়ার)'
          : loc === 'en'
            ? st.nameEn
            : st.nameBn;
        wrapList.append(
          h(
            'div',
            { class: `standing-pill${st.isPlayer ? ' is-player' : ''}` },
            h('span', {
              class: 'standing-pos',
              style: `color:${st.accentHex}`,
              text: `#${st.position}`,
            }),
            h('span', { class: 'standing-name', text: displayName }),
          ),
        );
      }
      return wrapList;
    };

    const continueBtn = button(t('race.continueBtn'), {
      variant: summary.won ? 'primary' : 'ghost',
      wide: !summary.won,
      attrs: { id: 'race-blacklist-btn' },
      onClick: () => {
        this.bridge.audio.uiTap();
        this.bridge.stopWinnerPhoto();
        this.openBlacklistView('hud');
      },
    });
    const retryBtn = button(t('race.raceAgainBtn'), {
      variant: summary.won ? 'ghost' : 'primary',
      wide: !summary.won,
      attrs: { id: 'race-retry-btn' },
      onClick: () => {
        this.bridge.audio.uiConfirm();
        this.bridge.stopWinnerPhoto();
        this.bridge.retryLastEvent();
      },
    });
    const freeRoamBtn = button(t('race.returnFreeRoamBtn'), {
      variant: 'ghost',
      wide: !summary.won,
      attrs: { id: 'race-freeride-btn' },
      onClick: () => {
        this.bridge.audio.uiTap();
        this.bridge.stopWinnerPhoto();
        this.bridge.exitRaceToFreeRide();
      },
    });

    if (summary.won) {
      // §27 Victory-Only Original Banglar Tesla Printed-Photo / Scrapbook Snapshot
      const rankPill =
        summary.unlockedNextRank !== null
          ? h('span', {
              class: 'pill gold',
              text:
                summary.unlockedNextRank === 0
                  ? t('race.crowned')
                  : t('race.rankUp', { rank: summary.unlockedNextRank }),
            })
          : null;

      const photoCard = h(
        'div',
        {
          class: 'winner-photo-frame',
          attrs: { id: 'race-result-sheet', 'data-result-mode': 'winner-photo' },
        },
        h('span', { class: 'photo-tape photo-tape-tl', attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'photo-tape photo-tape-tr', attrs: { 'aria-hidden': 'true' } }),
        h(
          'div',
          { class: 'winner-photo-top' },
          h(
            'div',
            { class: 'winner-photo-stamp' },
            h('strong', { text: t('race.photoStamp') }),
            h('span', { text: t('race.photoSub') }),
          ),
          h('span', {
            class: 'winner-pos-badge',
            text: t('race.posOfTotal', { pos: summary.playerPosition, total: summary.totalRacers }),
          }),
        ),
        // Clear center viewport window showing the live 3D winning rickshaw + celebratory driver!
        h('div', { class: 'winner-photo-window', attrs: { 'data-testid': 'winner-photo-window' } }),
        h(
          'div',
          { class: 'winner-photo-dock' },
          h(
            'div',
            { class: 'winner-dock-header' },
            h(
              'div',
              {},
              h('h2', { class: 'winner-dock-title', text: t('race.wonTitle') }),
              h('div', { class: 'tiny muted', text: evTitle }),
            ),
            rankPill,
          ),
          h(
            'div',
            { class: 'winner-stats-grid' },
            h(
              'div',
              { class: 'winner-stat-cell' },
              h('span', { class: 'tiny muted', text: t('race.timeTaken') }),
              h('strong', { text: `${summary.timeSeconds.toFixed(1)}s` }),
            ),
            h(
              'div',
              { class: 'winner-stat-cell' },
              h('span', { class: 'tiny muted', text: t('race.topSpeed') }),
              h('strong', { text: `${Math.max(18, Math.round(summary.topSpeedKmh))} km/h` }),
            ),
            h(
              'div',
              { class: 'winner-stat-cell' },
              h('span', { class: 'tiny muted', text: t('race.cashDelta') }),
              h('strong', { class: 'gold-txt', text: `+${formatTaka(summary.cashDelta)}` }),
            ),
            h(
              'div',
              { class: 'winner-stat-cell' },
              h('span', { class: 'tiny muted', text: t('race.repEarned') }),
              h('strong', { class: 'teal-txt', text: `+${summary.repEarned} REP` }),
            ),
          ),
          h(
            'div',
            { class: 'winner-standings-wrap' },
            h('span', { class: 'tiny muted', text: t('race.standingsTitle') }),
            buildStandingsList(),
          ),
          h('div', { class: 'winner-actions-row' }, continueBtn, retryBtn, freeRoamBtn),
        ),
      );

      this.raceResultEl = h('div', { class: 'screen winner-photo-screen' }, photoCard);
      this.register('raceResult', this.raceResultEl);
      this.show('raceResult');
      return;
    }

    // Separate Non-Photo Defeat Result Screen (Losses NEVER trigger Winner Snapshot!)
    const { wrap, body } = sheet(t('race.lostTitle'), {
      subtitle: `${evTitle} · ${t('race.posOfTotal', { pos: summary.playerPosition, total: summary.totalRacers })}`,
    });
    wrap.id = 'race-result-sheet';
    wrap.setAttribute('data-result-mode', 'defeat');

    const rows = h(
      'div',
      { class: 'breakdown' },
      h('p', { class: 'small', style: 'margin:0 0 0.4rem', text: t(summary.reasonKey) }),
      h(
        'div',
        { class: 'brow' },
        h('span', { text: t('race.finalPosition') }),
        h('span', { text: t('race.posOfTotal', { pos: summary.playerPosition, total: summary.totalRacers }) }),
      ),
      h(
        'div',
        { class: 'brow' },
        h('span', { text: t('race.timeTaken') }),
        h('span', { text: `${summary.timeSeconds.toFixed(1)}s` }),
      ),
      h(
        'div',
        { class: 'brow' },
        h('span', { text: t('race.topSpeed') }),
        h('span', { text: `${Math.round(summary.topSpeedKmh)} km/h` }),
      ),
      row(t('race.cashDelta'), summary.cashDelta, summary.cashDelta < 0),
      h(
        'div',
        { class: 'brow' },
        h('span', { text: t('race.repEarned') }),
        h('span', { text: `+${summary.repEarned} REP` }),
      ),
      h('div', { class: 'tiny muted', style: 'margin-top:0.35rem', text: t('race.standingsTitle') }),
      buildStandingsList(),
    );

    const btnCol = h('div', { class: 'btn-stack' }, retryBtn, continueBtn, freeRoamBtn);
    body.append(rows, btnCol);
    this.raceResultEl = h('div', { class: 'screen' }, wrap);
    this.register('raceResult', this.raceResultEl);
    this.show('raceResult');
  }

  // ---------------------------------------------------------------- toasts
  toast(message: string, tone?: 'good' | 'bad'): void {
    const now = performance.now();
    const lastAt = this.toastLastAt.get(message) ?? -10000;
    if (now - lastAt < 3200) {
      return; // Deduplicate identical rapid toast messages!
    }
    this.toastLastAt.set(message, now);

    // Cap visible toast stack at <= 2 elements so warnings never pile up on screen
    while (this.toastStack.childElementCount >= 2) {
      this.toastStack.firstElementChild?.remove();
    }

    const el = h('div', { class: `toast${tone ? ` ${tone}` : ''}`, text: message });
    this.toastStack.append(el);
    window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .3s ease';
      window.setTimeout(() => el.remove(), 320);
    }, 2400);
  }

  clearToasts(): void {
    while (this.toastStack.firstChild) this.toastStack.removeChild(this.toastStack.firstChild);
  }

  // ----------------------------------------------------------------- misc
  setResultReturnTo(target: 'menu' | 'game'): void {
    // Retained for the bridge contract; navigation is driven by `garageFrom`.
    this.garageFrom = target === 'menu' ? 'menu' : this.garageFrom;
  }

  rebuildAll(): void {
    this.menuEl.remove();
    this.buildMenu();
    this.pauseEl.remove();
    this.buildPause();
    if (this.hudTurboLabel) this.hudTurboLabel.textContent = t('hud.turbo');
    if (this.hudCondWarnEl?.firstElementChild) {
      this.hudCondWarnEl.firstElementChild.textContent = t('toast.conditionLow');
    }
    this.applyControlLayout();
    this.refreshMenuChrome();
    this.prevCamMode = '';
    this.lastHintKey = null;
    this.prevObjLabel = '';
    this.prevObjTitle = '';
    this.prevObjSub = '';
    this.prevMoney = -1;
    this.prevStamina = -1;
    this.prevTeaAvail = null;
    this.prevRepVal = -1;
    this.prevCondVal = -1;
    this.prevCondLow = null;
    this.prevPursuitKey = '';
    this.prevRaceSummary = '';
  }

  /** Keep UI text in sync when the language changes mid-session. */
  refreshLocale(): void {
    setLocale(this.settingsStore.get().language);
    this.prevCamMode = '';
    this.lastHintKey = null;
    this.prevRepVal = -1;
    this.prevCondVal = -1;
    this.prevCondLow = null;
    this.prevPursuitKey = '';
    this.prevRaceSummary = '';
  }

  /** Debug helper used by the automated smoke test. */
  debugState(): { screen: string | null; strings: number; locale: Locale } {
    return { screen: this.current, strings: STRING_KEYS.length, locale: getLocale() };
  }
}

function row(label: string, value: number, minus = false): HTMLElement {
  return h('div', { class: `brow${minus || value < 0 ? ' minus' : ''}` },
    h('span', { text: label }),
    h('span', { text: `${value < 0 ? '-' : '+'}${formatTaka(Math.abs(value))}` }),
  );
}

export function vehicleStatInfo(state: GameState): VehicleStatInfo {
  return vehicleStats(state.vehicle(), state.progress.upgrades);
}
