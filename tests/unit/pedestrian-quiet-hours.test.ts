import { describe, expect, it } from 'vitest';
import { QUALITY } from '../../src/core/config';
import { PedestrianSystem } from '../../src/ai/pedestrians';

describe('night crowd easing', () => {
  it('retains a nearby walker and stable reserved caller while retiring a distant instance', () => {
    const crowd = new PedestrianSystem(QUALITY.balanced);
    const state = crowd as unknown as {
      peds: { worldX: number; worldZ: number; roadsideReserved: boolean }[];
      activeCount: number;
    };
    const initial = crowd.activePedestrianCount;
    const nearbyTail = state.peds[initial - 1];
    const caller = state.peds[1];
    for (let i = 0; i < initial; i++) {
      state.peds[i].worldX = 0;
      state.peds[i].worldZ = 0;
    }
    state.peds[0].worldX = 100;
    caller.roadsideReserved = true;
    crowd.setTimeMinutes(3 * 60);
    crowd.update(1.3, 0, 0, 0);
    expect(crowd.activePedestrianCount).toBe(initial - 1);
    expect(state.peds[1]).toBe(caller);
    expect(state.peds[initial - 1]).not.toBe(nearbyTail);
    expect(state.peds[initial - 1].worldX).toBe(100);
    expect(state.peds[0]).toBe(nearbyTail);
    crowd.dispose();
  });
});
