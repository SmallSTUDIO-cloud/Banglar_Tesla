import { describe, expect, it } from 'vitest';
import {
  buildArmChain,
  buildDriverArms,
  handGripOffset,
  wristToHandGap,
} from '../../src/characters/limbRig';
import {
  NPC_CNG_DRIVER_ARMS,
  NPC_EASYBIKE_DRIVER_ARMS,
  NPC_RICKSHAW_PASSENGER_ARMS,
  NPC_RICKSHAW_PULLER_ARMS,
} from '../../src/ai/vehicles';

describe('character rig continuity — no duplicated/detached hands (vNext §2)', () => {
  it('keeps the forearm buried inside the hand box (zero visible double-fist gap)', () => {
    for (const chain of [
      ...NPC_RICKSHAW_PULLER_ARMS,
      ...NPC_RICKSHAW_PASSENGER_ARMS,
      ...NPC_CNG_DRIVER_ARMS,
      ...NPC_EASYBIKE_DRIVER_ARMS,
    ]) {
      expect(wristToHandGap(chain)).toBeLessThanOrEqual(0.035);
      expect(handGripOffset(chain)).toBeLessThanOrEqual(0.02);
    }
  });

  it('gives every NPC driver exactly one left and one right hand on one handlebar', () => {
    for (const arms of [
      NPC_RICKSHAW_PULLER_ARMS,
      NPC_CNG_DRIVER_ARMS,
      NPC_EASYBIKE_DRIVER_ARMS,
    ]) {
      expect(arms.length).toBe(2);
      const [left, right] = arms;
      expect(left.side).toBe(1);
      expect(right.side).toBe(-1);
      // Hands sit on opposite sides of the bar with a natural grip span
      expect(left.hand.center.x).toBeGreaterThan(0.12);
      expect(right.hand.center.x).toBeLessThan(-0.12);
      // Both hands share the bar height/plane (one handlebar)
      expect(Math.abs(left.hand.center.y - right.hand.center.y)).toBeLessThan(0.02);
      expect(Math.abs(left.hand.center.z - right.hand.center.z)).toBeLessThan(0.02);
      // Left and right chains must never overlap (no doubled geometry)
      const gap = Math.hypot(
        left.hand.center.x - right.hand.center.x,
        left.hand.center.y - right.hand.center.y,
        left.hand.center.z - right.hand.center.z,
      );
      expect(gap).toBeGreaterThan(0.28);
    }
  });

  it('bends elbows outward so arms never pass through the torso', () => {
    for (const chain of [
      ...NPC_RICKSHAW_PULLER_ARMS,
      ...NPC_CNG_DRIVER_ARMS,
      ...NPC_EASYBIKE_DRIVER_ARMS,
    ]) {
      expect(Math.abs(chain.elbow.x)).toBeGreaterThan(Math.abs(chain.shoulder.x));
      expect(chain.elbow.y).toBeGreaterThan(chain.wrist.y); // elbow rides above the grip
      // Upper arm + forearm are contiguous at the elbow
      const seam = Math.hypot(
        chain.upper.to.x - chain.fore.from.x,
        chain.upper.to.y - chain.fore.from.y,
        chain.upper.to.z - chain.fore.from.z,
      );
      expect(seam).toBeLessThan(0.02);
    }
  });

  it('keeps passenger hands resting on the lap (not on the handlebar)', () => {
    const [l, r] = NPC_RICKSHAW_PASSENGER_ARMS;
    expect(l.grip.z).toBeLessThan(-0.4);
    expect(r.grip.z).toBeLessThan(-0.4);
    expect(wristToHandGap(l)).toBeLessThanOrEqual(0.035);
    expect(wristToHandGap(r)).toBeLessThanOrEqual(0.035);
  });

  it('holds pose determinism across repeated builds (one authoritative pose state)', () => {
    const a = buildDriverArms({
      shoulderX: 0.185,
      shoulderY: 1.4,
      shoulderZ: 0.1,
      gripLeft: { x: 0.205, y: 1.155, z: 0.725 },
      gripRight: { x: -0.205, y: 1.155, z: 0.725 },
      upperRadius: 0.038,
      foreRadius: 0.034,
      handSize: { x: 0.062, y: 0.058, z: 0.088 },
    });
    const b = buildDriverArms({
      shoulderX: 0.185,
      shoulderY: 1.4,
      shoulderZ: 0.1,
      gripLeft: { x: 0.205, y: 1.155, z: 0.725 },
      gripRight: { x: -0.205, y: 1.155, z: 0.725 },
      upperRadius: 0.038,
      foreRadius: 0.034,
      handSize: { x: 0.062, y: 0.058, z: 0.088 },
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('rejects degenerate grips without producing NaN geometry', () => {
    const chain = buildArmChain({
      side: 1,
      shoulder: { x: 0, y: 1, z: 0 },
      grip: { x: 0, y: 1, z: 0 },
      upperRadius: 0.03,
      foreRadius: 0.03,
      handSize: { x: 0.05, y: 0.05, z: 0.05 },
    });
    for (const v of [chain.upper.mid, chain.fore.mid, chain.hand.center]) {
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.y)).toBe(true);
      expect(Number.isFinite(v.z)).toBe(true);
    }
  });
});
