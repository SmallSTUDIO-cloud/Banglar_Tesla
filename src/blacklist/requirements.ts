/** Persistent, per-rank Blacklist preparation. Results are recorded only by
 * completed gameplay: a street-event win, a passenger drop-off and, for the
 * top seven ranks, a separately started and successfully escaped pursuit. */
export type BlacklistTask = 'race' | 'fare' | 'escape';

export interface BlacklistRequirementState {
  blacklistNextRank: number;
  blacklistDefeated: readonly number[];
  blacklistTasks: readonly string[];
  rep: number;
}

export function blacklistTaskId(rank: number, task: BlacklistTask): string {
  return `${rank}:${task}`;
}

export function tasksForRank(rank: number): BlacklistTask[] {
  return rank <= 7 ? ['race', 'fare', 'escape'] : ['race', 'fare'];
}

export function blacklistChecklist(state: BlacklistRequirementState, rank: number, repRequired: number) {
  const defeated = state.blacklistDefeated.includes(rank);
  const tasks = tasksForRank(rank).map((task) => ({
    task,
    complete: defeated || state.blacklistTasks.includes(blacklistTaskId(rank, task)),
  }));
  const rankUnlocked = defeated || rank === state.blacklistNextRank;
  const reputationMet = defeated || state.rep >= repRequired;
  return {
    defeated,
    rankUnlocked,
    reputationMet,
    tasks,
    ready: defeated || (rankUnlocked && reputationMet && tasks.every((task) => task.complete)),
  };
}
