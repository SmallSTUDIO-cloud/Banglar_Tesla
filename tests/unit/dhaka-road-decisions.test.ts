import { describe, expect, it } from 'vitest';
import { SafeDetourProgress, contextualCareBonus, isUnsafeClosePass } from '../../src/gameplay/roadDecisions';
import { generateMission } from '../../src/missions/mission';
import { computeFare } from '../../src/economy/economy';

describe('earned, not fictionalized, Mohammadpur detours', () => {
  it('requires actual clean displacement and time before awarding one existing traffic bonus', () => {
    const d=new SafeDetourProgress();d.arm(3);
    expect(d.advance(0.1,0,3,false,true)).toBe(false); // map choice alone
    for(let i=0;i<79;i++) expect(d.advance(0.1,0.5,3,false,true)).toBe(false);
    expect(d.advance(0.1,0.5,3,false,true)).toBe(true);
    expect(d.advance(0.1,2,3,false,true)).toBe(false);
    d.reset();d.arm(0);
    expect(d.advance(10,1000,0,false,true)).toBe(false); // capped vs teleport
  });
  it('disqualifies collision, sidewalk cutting, recovery and routes no longer avoiding a jam', () => {
    for(const [hit,sidewalk] of [[1,false],[0,true]] as const){
      const d=new SafeDetourProgress();d.arm(0);
      expect(d.advance(5,25,hit,sidewalk,true)).toBe(false);
      expect(d.advance(30,200,0,false,true)).toBe(false);
    }
    const d=new SafeDetourProgress();d.arm(0);d.disqualify();
    expect(d.advance(30,200,0,false,true)).toBe(false);
    d.reset();d.arm(0);
    expect(d.advance(30,200,0,false,false)).toBe(false);
  });
});

describe('safe close-pass feedback', () => {
  it('warns only when genuinely fast and close; never awards points or turbo by itself', () => {
    expect(isUnsafeClosePass(6, 0.9, 0.6, 0)).toBe(true);
    expect(isUnsafeClosePass(3, 0.9, 0.6, 0)).toBe(false);
    expect(isUnsafeClosePass(6, 9, 0.6, 0)).toBe(false);
    expect(isUnsafeClosePass(6, 0.9, 0.6, 8)).toBe(false);
  });
});

describe('contextual rain passenger request, without renegotiating flat fares', () => {
  it('uses a wet-weather preference for a shopper at an existing connected market stop', () => {
    // 0: choice, 0.38: shopper, 0.8: preference, rest: market/ids.
    const seq=[0,0.38,0.8,0.1,0.5,0.5];
    const rainy=generateMission({rng:()=>seq.shift()??0.5,fromPlaceId:'bazaar',wet:true});
    expect(rainy.pickupId).toBe('bazaar');
    expect(rainy.archetype).toBe('shopper');
    expect(rainy.optional).toBe('rain');
    expect(rainy.distance).toBeGreaterThan(0);
    expect(rainy.fareEstimate).toBeGreaterThan(0);
    expect(contextualCareBonus(rainy.optional,true,86,0,0)).toBe(12);
    expect(contextualCareBonus(rainy.optional,false,86,0,0)).toBe(0);
    expect(contextualCareBonus(rainy.optional,true,86,1,0)).toBe(0);
    expect(contextualCareBonus(rainy.optional,true,74,0,0)).toBe(0);
    expect(contextualCareBonus(rainy.optional,true,86,0,2)).toBe(0);
  });
  it('keeps the care bonus bounded and never rewards hits or an unrequested rainy run', () => {
    const fare=computeFare({distance:130,timeTaken:70,targetTime:100,mood:82,damage:0,trafficBonus:contextualCareBonus('rain',true,82,0,0)});
    const no=computeFare({distance:130,timeTaken:70,targetTime:100,mood:82,damage:0,trafficBonus:0});
    expect(fare.total-no.total).toBe(12);
    expect(contextualCareBonus('fast',true,82,0,0)).toBe(0);
  });
});
