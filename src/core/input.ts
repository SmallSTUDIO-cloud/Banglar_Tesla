/**
 * Input facade. Touch buttons, the analog steering wheel and the keyboard all
 * write into the same axes, so gameplay only ever reads normalised values.
 *
 * Keyboard (development / desktop):
 *   W / ↑        pedal
 *   S / ↓        brake, hold at standstill to reverse
 *   A / D / ←/→  steer
 *   Space        bell
 *   C            camera mode
 *   E            interact (pick up / drop off hint)
 *   Esc / P      pause
 *   R            recover
 */

import { clamp } from './mathx';

export class InputManager {
  /** -1..1 steering. */
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
  private stickThreshold = 0.06;
  private listeners: { type: string; fn: (e: Event) => void }[] = [];
  private deadzone = 0.12;
  onPause?: () => void;
  onCamera?: () => void;
  onRecover?: () => void;
  onHorn?: () => void;

  constructor() {}

  attach(): void {
    const keydown = (e: Event): void => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      this.keys.add(ev.code);
      if (ev.code === 'Escape' || ev.code === 'KeyP') this.onPause?.();
      if (ev.code === 'KeyC') this.onCamera?.();
      if (ev.code === 'KeyR') this.onRecover?.();
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

  /** Touch: steer buttons (-1 / +1 while held). */
  setTouchSteer(value: number): void {
    this.touchSteer = clamp(value, -1, 1);
  }

  /** Touch/analog wheel: -1..1. */
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
  sample(): { steer: number; throttle: number; brake: number; horn: boolean } {
    const kbSteer = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    const kbThrottle = this.key('KeyW', 'ArrowUp') ? 1 : 0;
    const kbBrake = this.key('KeyS', 'ArrowDown') ? 1 : 0;

    const touchSteer = Math.abs(this.wheelSteer) > Math.abs(this.touchSteer) ? this.wheelSteer : this.touchSteer;
    let steer = Math.abs(touchSteer) > 0.001 ? touchSteer : kbSteer;
    // radial-ish deadzone for the analog wheel, but keep digital keys crisp
    if (Math.abs(steer) < this.stickThreshold) steer = 0;
    if (Math.abs(touchSteer) > 0.001) {
      const sign = Math.sign(steer);
      const mag = Math.abs(steer);
      steer = mag < this.deadzone ? 0 : sign * ((mag - this.deadzone) / (1 - this.deadzone));
    }
    this.steer = clamp(steer * this.sensitivity, -1, 1);
    this.throttle = Math.max(this.touchPedal ? 1 : 0, kbThrottle);
    this.brake = Math.max(this.touchBrake ? 1 : 0, kbBrake);
    return { steer: this.steer, throttle: this.throttle, brake: this.brake, horn: this.hornPressed };
  }
}
