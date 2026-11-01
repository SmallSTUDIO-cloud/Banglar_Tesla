/** Original Dhaka blacklist preparation, inspired by the race/pursuit/bounty
 * rhythm of 2005 arcade careers. No imported game assets or copied data. */
export type BlacklistTask = 'race' | 'fare' | 'escape';

export interface BlacklistRequirementState {
  blacklistNextRank: number;
  blacklistDefeated: readonly number[];
  blacklistTasks: readonly string[];
  blacklistRaceWins: Record<string, number>;
  blacklistBounty: number;
  rep: number;
}

export function blacklistTaskId(rank: number, task: BlacklistTask): string {
  return `${rank}:${task}`;
}

export function tasksForRank(rank: number): BlacklistTask[] {
  return rank <= 7 ? ['race', 'fare', 'escape'] : ['race', 'fare'];
}

/** Race wins are earned in the active tier; bounty persists across the career. */
export function raceWinsRequired(rank: number): number {
  return rank >= 9 ? 1 : rank >= 7 ? 2 : rank >= 4 ? 3 : 4;
}

export function bountyRequired(rank: number): number {
  return [0, 2100, 1600, 1200, 850, 550, 300, 120, 0, 0, 0][rank] ?? 0;
}

export function blacklistChecklist(state: BlacklistRequirementState, rank: number, repRequired: number) {
  const defeated = state.blacklistDefeated.includes(rank);
  const tasks = tasksForRank(rank).map((task) => ({
    task,
    complete: defeated || state.blacklistTasks.includes(blacklistTaskId(rank, task)),
  }));
  const rankUnlocked = defeated || rank === state.blacklistNextRank;
  const reputationMet = defeated || state.rep >= repRequired;
  const raceWins = Math.max(0, Math.floor(state.blacklistRaceWins[String(rank)] ?? 0));
  const raceTarget = raceWinsRequired(rank);
  const bounty = Math.max(0, state.blacklistBounty);
  const bountyTarget = bountyRequired(rank);
  return {
    defeated, rankUnlocked, reputationMet, tasks,
    raceWins, raceTarget, raceWinsMet: defeated || raceWins >= raceTarget,
    bounty, bountyTarget, bountyMet: defeated || bounty >= bountyTarget,
    ready: defeated || (rankUnlocked && reputationMet && raceWins >= raceTarget &&
      bounty >= bountyTarget && tasks.every((task) => task.complete)),
  };
}
