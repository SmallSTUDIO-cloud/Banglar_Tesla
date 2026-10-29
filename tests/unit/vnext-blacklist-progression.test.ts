import { describe, expect, it } from 'vitest';
import { BLACKLIST_RIVALS, OPEN_STREET_EVENTS } from '../../src/blacklist/blacklistCatalog';
import { tasksForRank } from '../../src/blacklist/requirements';
import { GameState } from '../../src/core/gameState';
import { createDefaultProgress, migrateProgress, sanitizeProgress, SAVE_VERSION } from '../../src/core/save';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe('persistent Blacklist prerequisites and rewards', () => {
  it('migrates v3 without losing career state or inventing completed tasks', () => {
    const legacy = { ...createDefaultProgress(10), version: 3, balance: 1337, rides: 12, rep: 400,
      blacklistNextRank: 8, blacklistDefeated: [10, 9], blacklistTasks: undefined,
      scrapbook: { records: [{ id: 'old-record' }] } };
    const p = sanitizeProgress(migrateProgress(legacy), 20);
    expect(p.version).toBe(SAVE_VERSION);
    expect([p.balance,p.rides,p.rep,p.blacklistNextRank]).toEqual([1337,12,400,8]);
    expect(p.blacklistDefeated).toEqual([10,9]);
    expect(p.blacklistTasks).toEqual([]);
    expect(p.scrapbook).toEqual({ records: [{ id: 'old-record' }] });
    const sanitized = sanitizeProgress({ ...p, blacklistTasks: ['8:fare','8:fare','bad','1:escape','0:race'] });
    expect(sanitized.blacklistTasks).toEqual(['8:fare','1:escape']);
  });

  it('requires real per-tier work in order and pays each event only once across reloads', () => {
    const storage = new MemoryStorage();
    let state = new GameState(storage, () => 1000);
    state.progress.rep = 100_000;
    const optional = OPEN_STREET_EVENTS[0];
    for (const rival of BLACKLIST_RIVALS) {
      const rank = rival.rank;
      expect(state.blacklistRank).toBe(rank);
      expect(tasksForRank(rank)).toEqual(rank <= 7 ? ['race', 'fare', 'escape'] : ['race', 'fare']);
      expect(state.checklistForRival(rank, rival.repRequired).ready).toBe(false);
      const boss = { eventId: rival.bossEvent.id, cashReward: rival.bossEvent.cashReward, repReward: rival.bossEvent.repReward, blacklistRank: rank };
      const balanceBeforeRejected = state.balance;
      expect(state.recordEventVictory(boss)).toBe(false);
      expect(state.balance).toBe(balanceBeforeRejected);
      const beforeOptional = state.balance;
      const paidOptional = state.recordEventVictory({ eventId: optional.id, cashReward: 100, repReward: 20 });
      expect(paidOptional).toBe(rank === 10);
      expect(state.balance - beforeOptional).toBe(rank === 10 ? 100 : 0);
      expect(state.recordBlacklistTask('race')).toBe(false); // cannot count twice
      state.recordRide({ earned: 25, distance: 100, mood: 90, damage: 0, mode: 'free', wet: false });
      if (rank <= 7) {
        expect(state.checklistForRival(rank, rival.repRequired).ready).toBe(false);
        expect(state.recordBlacklistTask('escape', rank)).toBe(true);
        expect(state.recordBlacklistTask('escape', rank)).toBe(false);
      }
      expect(state.checklistForRival(rank, rival.repRequired).ready).toBe(true);
      const beforeBoss = state.balance;
      expect(state.recordEventVictory(boss)).toBe(true);
      expect(state.balance).toBe(beforeBoss + boss.cashReward);
      expect(state.blacklistRank).toBe(rank - 1);
      state = new GameState(storage, () => 2000);
      expect(state.blacklistRank).toBe(rank - 1);
      expect(state.defeatedRanks.has(rank)).toBe(true);
      expect(state.recordEventVictory(boss)).toBe(false);
      expect(state.balance).toBe(beforeBoss + boss.cashReward);
    }
    expect(state.blacklistRank).toBe(0);
    expect(state.defeatedRanks.size).toBe(10);
  });

  it('cannot complete a locked rank, mislabel a boss, or bypass reputation', () => {
    const s = new GameState(null, () => 1000);
    const rival = BLACKLIST_RIVALS[1];
    s.progress.blacklistNextRank = rival.rank;
    s.progress.blacklistDefeated = [10];
    s.recordBlacklistTask('race');
    s.recordBlacklistTask('fare');
    expect(s.checklistForRival(rival.rank, rival.repRequired).ready).toBe(false);
    expect(s.recordEventVictory({ eventId: rival.bossEvent.id, blacklistRank: rival.rank, cashReward: 100, repReward: 1 })).toBe(false);
    s.progress.rep = rival.repRequired;
    expect(s.recordEventVictory({ eventId: 'wrong-event', blacklistRank: rival.rank, cashReward: 100, repReward: 1 })).toBe(false);
    expect(s.recordBlacklistTask('race', 8)).toBe(false);
  });
});
