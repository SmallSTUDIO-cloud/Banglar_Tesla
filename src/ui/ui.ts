/**
 * The full game UI: main menu, HUD, pause, results, garage, store, settings,
 * credits, tutorial, loading and toasts. DOM-based so Bangla text shapes
 * perfectly and the layout is genuinely responsive on phones.
 */

import { t, getLocale, setLocale, STRING_KEYS, type Locale } from '../core/i18n';
import { formatDistance, formatTaka, clamp, clamp01 } from '../core/mathx';
import { QUALITY, type QualityPreset } from '../core/config';
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
import { ROADS, PLACES } from '../world/layout';
import { h, button, slider, toggle, segmented, sheet, modal, statBar, clear } from './dom';
import { ICONS } from './icons';
import type { MissionOffer } from '../missions/mission';

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
  setShowroomVisible(visible: boolean): void;
  rotateShowroom(dx: number): void;
  setTrack(track: 'cassette' | 'radio' | 'brishti'): void;
  setCameraMode(mode: 'chase' | 'close'): void;
  toggleCamera(): void;
  applySettings(): void;
  dailyAvailable(): boolean;
  installPrompt?(): void;
  hasSave(): boolean;
}

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
    this.buildMenu();
    this.buildHud();
    this.buildPause();
    this.buildResult();
    this.buildLoading();
    this.show('menu');

    this.state.on('balance', () => {
      this.refreshMenuChrome();
    });
    this.state.on('toast', (payload) => {
      this.toast(t(payload.key, payload.params), payload.tone);
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
  }

  /** Handles Android hardware back / browser back navigation. Returns true if consumed. */
  handleBackAction(): boolean {
    switch (this.current) {
      case 'hud':
        this.bridge.pauseGame();
        return true;
      case 'pause':
        this.bridge.resumeGame();
        return true;
      case 'settings':
        this.closeSettings();
        return true;
      case 'garage':
        this.closeGarage();
        return true;
      case 'store':
        this.show('menu');
        this.bridge.setShowroomVisible(false);
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

    const top = h('div', { class: 'menu-top' }, brand, money);

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

    const secondary = h('div', { class: 'menu-secondary' },
      button(t('common.garage'), { variant: 'ghost', onClick: () => this.openGarage('menu') }),
      button(t('common.store'), { variant: 'ghost', onClick: () => this.openStore() }),
      button(t('common.settings'), { variant: 'ghost', onClick: () => this.openSettings(() => this.show('menu')) }),
      button(t('common.credits'), { variant: 'ghost', onClick: () => this.openCredits() }),
    );

    const meta = h('div', { class: 'menu-meta' },
      h('span', { text: `v0.1.0` }),
      h('span', { text: '·' }),
      h('span', { text: t('menu.district') }),
      h('span', { text: '·' }),
      h('span', { text: t('menu.offlineReady') }),
    );

    const actions = h('div', { class: 'menu-actions' },
      playBtn,
      h('div', { class: 'menu-playrow' }, continueBtn),
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
    const pauseBtn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'pause' }, html: ICONS.pause, on: { click: () => this.bridge.pauseGame() } });
    const camBtn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'camera' }, html: ICONS.camera, on: { click: () => this.bridge.toggleCamera() } });
    const mini = h('div', { class: 'minimap' });
    this.miniCanvas = h('canvas', { attrs: { width: 208, height: 208 } });
    mini.append(this.miniCanvas);
    const moodBarFill = h('i');
    const moodRow = h('div', { class: 'mood' }, h('span', { text: t('hud.mood') }), h('div', { class: 'mood-bar' }, moodBarFill));
    moodRow.id = 'hud-mood';

    const top = h('div', { class: 'hud-top' },
      objective,
      h('div', { class: 'hud-topright' }, h('div', { class: 'row' }, pauseBtn, camBtn), wallet, mini, moodRow),
    );

    const dialogue = h('div', { class: 'hud-dialogue' });
    this.dialogueEl = dialogue;

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

    const left = h('div', { class: 'drive-left' }, steerPad);
    const right = h('div', { class: 'drive-right' }, horn, speedo, brake, pedal);
    right.id = 'drive-right';
    const bottom = h('div', { class: 'hud-bottom' }, left, right);

    el.append(top, dialogue, hint, bottom, wheel.el);
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
    // mirror the wheel to the opposite corner when left-handed
    this.hudWheel.style.left = settings.handedness === 'right' ? 'calc(var(--safe-l) + 1.1rem)' : 'auto';
    this.hudWheel.style.right = settings.handedness === 'right' ? 'auto' : 'calc(var(--safe-r) + 1.1rem)';
  }

  /** Called every frame while driving. */
  updateHud(state: HudState): void {
    if (this.current !== 'hud') return;
    this.hudSpeedo.firstElementChild!.textContent = String(Math.round(state.speed * 3.6));
    this.hudWallet.lastElementChild!.textContent = formatTaka(state.money);
    this.hudObjectiveLabel.textContent = state.objectiveLabel;
    this.hudObjectiveTitle.textContent = state.objectiveTitle;
    this.hudObjectiveSub.textContent = state.objectiveSub;
    this.hudMoodFill.style.width = `${Math.round(clamp01(state.mood / 100) * 100)}%`;
    const moodRow = this.hud.querySelector('#hud-mood') as HTMLElement | null;
    if (moodRow) moodRow.style.display = state.passengerAboard ? 'flex' : 'none';
    const pct = clamp01(1 - state.distance / 600);
    this.hudObMeter.style.width = `${Math.round(pct * 100)}%`;

    if (state.hint) {
      if (this.lastHintKey !== state.hint) {
        this.hudHint.textContent = t(state.hint);
        this.hudHint.classList.add('show');
        this.lastHintKey = state.hint;
      }
    } else if (this.hudHint.classList.contains('show')) {
      this.hudHint.classList.remove('show');
      this.lastHintKey = null;
    }

    // marker label follows the world-space marker
    const existing = this.hud.querySelector('.marker-label');
    if (state.markerX !== null && state.markerY !== null) {
      const label = existing ?? h('div', { class: 'marker-label' });
      label.textContent = `${state.markerLabel ?? ''} ${state.distance > 0 ? formatDistance(state.distance) : ''}`.trim();
      label.setAttribute('style', `left:${state.markerX}px;top:${state.markerY}px`);
      if (!existing) this.hud.append(label);
    } else if (existing) {
      existing.remove();
    }

    const recoverBtn = this.hud.querySelector('#recover-btn') as HTMLElement | null;
    if (state.stuck && !recoverBtn) {
      const btn = button(t('hud.recover'), {
        variant: 'gold',
        small: true,
        class: 'clickable',
        onClick: () => this.bridge.recoverRickshaw(),
      });
      btn.id = 'recover-btn';
      btn.setAttribute('style', 'position:absolute;left:50%;transform:translateX(-50%);bottom:calc(var(--safe-b) + 12.5rem);');
      this.hud.append(btn);
    } else if (!state.stuck && recoverBtn) {
      recoverBtn.remove();
    }

    this.drawMinimap(state);
  }

  private drawMinimap(state: HudState): void {
    const canvas = this.miniCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const hgt = canvas.height;
    const scale = 2.6; // pixels per metre
    const cx = w / 2;
    const cy = hgt / 2;
    const px = this.minimapPlayer.x;
    const pz = this.minimapPlayer.z;
    ctx.clearRect(0, 0, w, hgt);
    ctx.fillStyle = '#101c18';
    ctx.fillRect(0, 0, w, hgt);
    // roads
    ctx.strokeStyle = '#31443c';
    for (const road of ROADS) {
      ctx.lineWidth = Math.max(2, road.width * scale * 0.35);
      ctx.beginPath();
      if (road.axis === 'z') {
        ctx.moveTo(cx + (road.center - px) * scale, cy + (road.from - pz) * scale);
        ctx.lineTo(cx + (road.center - px) * scale, cy + (road.to - pz) * scale);
      } else {
        ctx.moveTo(cx + (road.from - px) * scale, cy + (road.center - pz) * scale);
        ctx.lineTo(cx + (road.to - px) * scale, cy + (road.center - pz) * scale);
      }
      ctx.stroke();
    }
    // places
    for (const place of PLACES) {
      const x = cx + (place.x - px) * scale;
      const y = cy + (place.z - pz) * scale;
      if (x < -10 || y < -10 || x > w + 10 || y > hgt + 10) continue;
      ctx.fillStyle = 'rgba(232,178,90,0.35)';
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // active marker
    if (state.markerX !== null && this.minimapMarker) {
      const mx = cx + (this.minimapMarker.x - px) * scale;
      const my = cy + (this.minimapMarker.z - pz) * scale;
      const clampedX = clamp(mx, 8, w - 8);
      const clampedY = clamp(my, 8, hgt - 8);
      ctx.fillStyle = state.passengerAboard ? '#e8b25a' : '#4cd6a0';
      ctx.beginPath();
      ctx.arc(clampedX, clampedY, 5, 0, Math.PI * 2);
      ctx.fill();
      if (clampedX !== mx || clampedY !== my) {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(clampedX, clampedY);
        ctx.stroke();
      }
    }
    // player arrow
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-this.minimapPlayer.yaw + Math.PI);
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

  // ---------------------------------------------------------------- pause
  private buildPause(): void {
    const { wrap, body } = sheet(t('pause.title'));
    body.append(
      button(t('pause.resume'), { variant: 'primary', wide: true, onClick: () => this.bridge.resumeGame() }),
      button(t('pause.recover'), { variant: 'ghost', wide: true, sub: t('pause.recoverFee', { n: formatTaka(45) }), onClick: () => this.bridge.recoverRickshaw() }),
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
      this.garageEl = null;
    }
    const vehicle = this.state.vehicle();
    const stats = vehicleStats(vehicle, this.state.progress.upgrades);
    const condition = this.state.progress.condition;
    const repair = this.state.repairQuote();
    const { wrap, body } = sheet(t('garage.title'), {
      subtitle: t('garage.subtitle'),
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
      h('div', { class: 'col', style: 'gap:.25rem' },
        statBar(t('garage.stat.speed'), stats.speed),
        statBar(t('garage.stat.handling'), stats.handling),
        statBar(t('garage.stat.comfort'), stats.comfort),
        statBar(t('garage.stat.braking'), stats.braking),
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
            attrs: { type: 'button' },
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
      const categories: CosmeticCategory[] = this.garageTab === 'paint' ? ['paint', 'art'] : ['tassel', 'bell', 'flowers', 'mirror'];
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
    this.screens.set('garage', this.garageEl);
  }

  private cosmeticCard(id: string): HTMLElement {
    const def = cosmeticById(id);
    if (!def) return h('div');
    const owned = this.state.ownsCosmetic(id);
    const equipped = this.state.progress.cosmetics[def.category] === id;
    const affordable = this.state.balance >= def.price;
    const card = h('button', {
      class: `item-card${owned ? ' owned' : ''}${equipped ? ' selected' : ''}`,
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (this.busy) return;
          if (owned) {
            if (equipped) return;
            const res = this.state.equipCosmetic(id);
            if (res.ok) {
              this.bridge.audio.uiConfirm();
              this.toast(t('store.equipDone'), 'good');
              this.buildGarage();
              this.show('garage');
            }
          } else if (affordable) {
            this.confirmPurchase(t(def.nameKey), formatTaka(def.price), () => {
              const res = this.state.buyCosmetic(id);
              if (res.ok) {
                this.bridge.audio.coin();
                this.toast(t('store.buyDone'), 'good');
              } else {
                this.bridge.audio.uiError();
                this.toast(t('common.insufficient'), 'bad');
              }
              this.buildGarage();
              this.show('garage');
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
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (maxed) return;
          if (price === null) return;
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
            this.buildGarage();
            this.show('garage');
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
    const owned = this.state.ownsVehicle(id);
    const selected = this.state.selectedVehicleId === id;
    const unlocked = this.state.vehicleUnlocked(id);
    const price = v.price;
    return h('button', {
      class: `item-card${owned ? ' owned' : ''}${selected ? ' selected' : ''}`,
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (owned) {
            if (selected) return;
            this.state.selectVehicle(id);
            this.bridge.audio.uiConfirm();
            this.toast(t('garage.selected'), 'good');
            this.bridge.applySettings();
            this.buildGarage();
            this.show('garage');
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
              this.buildGarage();
              this.show('garage');
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
      h('div', { class: 'ic-price' },
        owned ? h('span', { class: 'pill green', text: selected ? t('garage.selected') : t('common.owned') }) : h('span', { class: 'taka', text: unlocked ? formatTaka(price) : `🔒 ${v.ridesRequired}` }),
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
    this.bridge.closeGarage();
    // Return to wherever the player came from — never dump them into gameplay
    // they did not start (e.g. garage opened from the main menu).
    if (this.garageFrom === 'menu') this.show('menu');
    else if (this.garageFrom === 'pause') this.show('pause');
    else this.show('menu');
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
                this.buildGarage();
                this.show('garage');
              },
            })
          : h('span', { class: 'pill', text: t('tape.locked') }),
      ));
    }
    return h('div', { class: 'panel glass', style: 'padding:.6rem .75rem;display:flex;flex-direction:column;gap:.3rem' }, row);
  }

  // ---------------------------------------------------------------- store
  openStore(): void {
    this.buildStore();
    this.show('store');
    this.bridge.setShowroomVisible(true);
  }

  private buildStore(): void {
    if (this.storeEl) {
      this.storeEl.remove();
      this.storeEl = null;
    }
    const { wrap, body } = sheet(t('store.title'), {
      subtitle: t('store.subtitle'),
      onClose: () => {
        this.show('menu');
        this.bridge.setShowroomVisible(false);
      },
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
        attrs: { type: 'button' },
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
        h('div', { class: 'pill gold', text: formatTaka(this.state.balance) }),
        h('div', { class: 'tiny muted', text: t('store.subtitle') }),
      ),
      tabs,
    );
    const grid = h('div', { class: 'card-grid' });
    if (this.storeTab === 'vehicles') {
      for (const v of VEHICLES) grid.append(this.vehicleCard(v.id));
    } else if (this.storeTab === 'upgrades') {
      for (const up of UPGRADES) grid.append(this.upgradeCard(up.id));
    } else if (this.storeTab === 'paint') {
      for (const c of COSMETICS.filter((x) => x.category === 'paint' || x.category === 'art')) grid.append(this.cosmeticCard(c.id));
    } else {
      for (const c of COSMETICS.filter((x) => x.category !== 'paint' && x.category !== 'art')) grid.append(this.cosmeticCard(c.id));
    }
    body.append(grid);
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
    body.append(toggle({ label: t('settings.mute'), value: s.muted, onChange: (v) => patch({ muted: v }) }));
    body.append(slider({ label: t('settings.music'), value: s.music, onInput: (v) => patch({ music: v }) }));
    body.append(slider({ label: t('settings.ambience'), value: s.ambience, onInput: (v) => patch({ ambience: v }) }));
    body.append(slider({ label: t('settings.traffic'), value: s.traffic, onInput: (v) => patch({ traffic: v }) }));
    body.append(slider({ label: t('settings.vehicle'), value: s.vehicle, onInput: (v) => patch({ vehicle: v }) }));
    body.append(slider({ label: t('settings.dialogue'), value: s.dialogue, onInput: (v) => patch({ dialogue: v }) }));
    body.append(slider({ label: t('settings.ui'), value: s.ui, onInput: (v) => patch({ ui: v }) }));
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
    const back = this.settingsReturn;
    this.settingsReturn = null;
    if (back) back();
    else this.show('menu');
  }

  // --------------------------------------------------------------- credits
  private openCredits(): void {
    if (this.creditsEl) {
      this.creditsEl.remove();
      this.creditsEl = null;
    }
    const { wrap, body } = sheet(t('credits.title'), { onClose: () => this.show('menu') });
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
        h('p', { class: 'small', style: 'margin-top:.5rem;color:#e8b25a', text: t('credits.thanks') }),
      ),
      button(t('common.back'), { variant: 'ghost', wide: true, onClick: () => this.show('menu') }),
    );
    this.creditsEl = h('div', { class: 'screen' }, wrap);
    this.register('credits', this.creditsEl);
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

  hideJobOffer(): void {
    this.offerEl?.remove();
    this.offerEl = null;
  }

  // ---------------------------------------------------------------- toasts
  toast(message: string, tone?: 'good' | 'bad'): void {
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
    this.applyControlLayout();
    this.refreshMenuChrome();
  }

  /** Keep UI text in sync when the language changes mid-session. */
  refreshLocale(): void {
    setLocale(this.settingsStore.get().language);
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
