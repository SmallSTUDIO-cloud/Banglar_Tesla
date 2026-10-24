/**
 * Input facade. Touch buttons, the analog steering wheel, keyboard and
 * standard gamepads all write into the same normalized axes:
 *   steer:    -1 = LEFT, +1 = RIGHT
 *   throttle:  0..1 forward
 *   brake:     0..1 brake (hold at standstill to reverse)
 *
 * Keyboard (development / desktop):
 *   W / ↑        pedal / throttle
 *   S / ↓        brake, hold at standstill to reverse
 *   A / ←        steer LEFT  (-1)
 *   D / →        steer RIGHT (+1)
 *   Space        bell
 *   C / V        cycle camera mode
 *   Esc / P      pause
 *   R            recover
 *   F3           dev-only performance diagnostics overlay
 */

import { clamp } from './mathx';

export interface SampledInput {
  steer: number;
  throttle: number;
  brake: number;
  horn: boolean;
}

export class InputManager {
  /** -1 = left, +1 = right. */
  steer = 0;
  throttle = 0;
  brake = 0;
  hornPressed = false;
  private keys = new Set<string>();
  private touchSteer = 0;
  private touchPedal = false;
  private touchBrake = false;
  private wheelSteer = 0;
  private sensitivity = 0.9;
  private stickThreshold = 0.05;
  private listeners: { type: string; fn: (e: Event) => void }[] = [];
  private deadzone = 0.12;
  private prevGamepadCam = false;
  private prevGamepadPause = false;
  private prevGamepadHorn = false;
  private out: SampledInput = { steer: 0, throttle: 0, brake: 0, horn: false };

  onPause?: () => void;
  onCamera?: () => void;
  onRecover?: () => void;
  onHorn?: () => void;
  onDevPerf?: () => void;

  constructor() {}

  attach(): void {
    const keydown = (e: Event): void => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      this.keys.add(ev.code);
      if (ev.code === 'Escape' || ev.code === 'KeyP') this.onPause?.();
      if (ev.code === 'KeyC' || ev.code === 'KeyV') this.onCamera?.();
      if (ev.code === 'KeyR') this.onRecover?.();
      if (ev.code === 'F3' || (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyP')) {
        ev.preventDefault();
        this.onDevPerf?.();
      }
      if (ev.code === 'Space') {
        ev.preventDefault();
        this.hornPressed = true;
        this.onHorn?.();
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(ev.code)) ev.preventDefault();
    };
    const keyup = (e: Event): void => {
      const ev = e as KeyboardEvent;
      this.keys.delete(ev.code);
      if (ev.code === 'Space') this.hornPressed = false;
    };
    const blur = (): void => {
      this.keys.clear();
      this.touchPedal = false;
      this.touchBrake = false;
      this.touchSteer = 0;
      this.wheelSteer = 0;
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    this.listeners.push(
      { type: 'keydown', fn: keydown },
      { type: 'keyup', fn: keyup },
      { type: 'blur', fn: blur },
    );
  }

  detach(): void {
    for (const l of this.listeners) window.removeEventListener(l.type, l.fn);
    this.listeners = [];
  }

  setSensitivity(value: number): void {
    this.sensitivity = clamp(value, 0.35, 1.8);
  }

  setDeadzone(value: number): void {
    this.deadzone = clamp(value, 0, 0.4);
  }

  /** Touch: steer buttons (-1 = LEFT, +1 = RIGHT while held). */
  setTouchSteer(value: number): void {
    this.touchSteer = clamp(value, -1, 1);
  }

  /** Touch/analog wheel: -1 = LEFT .. +1 = RIGHT. */
  setWheelSteer(value: number): void {
    this.wheelSteer = clamp(value, -1, 1);
  }

  setPedal(down: boolean): void {
    this.touchPedal = down;
  }

  setBrake(down: boolean): void {
    this.touchBrake = down;
  }

  ringBell(): void {
    this.hornPressed = true;
    this.onHorn?.();
    window.setTimeout(() => {
      this.hornPressed = false;
    }, 90);
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Recompute the axes; call once per frame before stepping physics. */
  sample(): SampledInput {
    const kbSteer = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    const kbThrottle = this.key('KeyW', 'ArrowUp') ? 1 : 0;
    const kbBrake = this.key('KeyS', 'ArrowDown') ? 1 : 0;

    // Optional standard HTML5 Gamepad / steering controller support
    let gpSteer = 0;
    let gpThrottle = 0;
    let gpBrake = 0;
    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      const pads = navigator.getGamepads();
      const pad = pads ? pads[0] || pads[1] || pads[2] || pads[3] : null;
      if (pad && pad.connected) {
        const ax0 = pad.axes[0] ?? 0;
        const dpadLeft = pad.buttons[14]?.pressed ? -1 : 0;
        const dpadRight = pad.buttons[15]?.pressed ? 1 : 0;
        gpSteer = dpadLeft || dpadRight ? dpadLeft + dpadRight : ax0;
        gpThrottle = Math.max(pad.buttons[7]?.value ?? 0, pad.buttons[0]?.pressed ? 1 : 0);
        gpBrake = Math.max(pad.buttons[6]?.value ?? 0, pad.buttons[1]?.pressed ? 1 : 0);

        const camBtn = !!pad.buttons[3]?.pressed;
        if (camBtn && !this.prevGamepadCam) this.onCamera?.();
        this.prevGamepadCam = camBtn;

        const pauseBtn = !!pad.buttons[9]?.pressed;
        if (pauseBtn && !this.prevGamepadPause) this.onPause?.();
        this.prevGamepadPause = pauseBtn;

        const hornBtn = !!pad.buttons[2]?.pressed;
        if (hornBtn && !this.prevGamepadHorn) this.onHorn?.();
        this.prevGamepadHorn = hornBtn;
      }
    }

    const analogSteer =
      Math.abs(this.wheelSteer) >= Math.abs(gpSteer) ? this.wheelSteer : gpSteer;
    const hasAnalog = Math.abs(analogSteer) > 0.001;
    const hasTouchBtn = Math.abs(this.touchSteer) > 0.001;

    let steer = 0;
    if (hasTouchBtn) {
      steer = this.touchSteer;
    } else if (hasAnalog) {
      const sign = Math.sign(analogSteer);
      const mag = Math.abs(analogSteer);
      const dz = Math.max(this.stickThreshold, this.deadzone);
      steer = mag < dz ? 0 : sign * ((mag - dz) / Math.max(0.05, 1 - dz));
    } else {
      steer = kbSteer;
    }

    // For digital buttons/keys (-1 or +1), keep crisp full-direction sign while
    // allowing sensitivity to scale analog inputs smoothly.
    const scaled = hasAnalog && !hasTouchBtn ? steer * this.sensitivity : steer * Math.max(0.75, this.sensitivity);
    this.steer = clamp(scaled, -1, 1);
    this.throttle = clamp(Math.max(this.touchPedal ? 1 : 0, kbThrottle, gpThrottle), 0, 1);
    this.brake = clamp(Math.max(this.touchBrake ? 1 : 0, kbBrake, gpBrake), 0, 1);

    this.out.steer = this.steer;
    this.out.throttle = this.throttle;
    this.out.brake = this.brake;
    this.out.horn = this.hornPressed;
    return this.out;
  }
}
