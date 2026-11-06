using System;
using System.Collections.Generic;
using System.Linq;

namespace BanglarTesla.Domain
{
    public enum BlacklistTask { Race, Fare, Escape }

    public readonly struct BlacklistTaskStatus
    {
        public readonly BlacklistTask Task;
        public readonly bool Complete;
        public BlacklistTaskStatus(BlacklistTask task, bool complete) { Task = task; Complete = complete; }
    }

    public sealed class BlacklistChecklist
    {
        public bool Defeated, RankUnlocked, ReputationMet, RaceWinsMet, BountyMet, Ready;
        public int RaceWins, RaceTarget, Bounty, BountyTarget;
        public IReadOnlyList<BlacklistTaskStatus> Tasks = Array.Empty<BlacklistTaskStatus>();
    }

    public static class BlacklistRequirements
    {
        public static string TaskId(int rank, BlacklistTask task) => $"{rank}:{task.ToString().ToLowerInvariant()}";

        public static IReadOnlyList<BlacklistTask> TasksForRank(int rank) =>
            rank <= 7 ? new[] { BlacklistTask.Race, BlacklistTask.Fare, BlacklistTask.Escape } : new[] { BlacklistTask.Race, BlacklistTask.Fare };

        public static int RaceWinsRequired(int rank) => rank >= 9 ? 1 : rank >= 7 ? 2 : rank >= 4 ? 3 : 4;

        public static int BountyRequired(int rank)
        {
            int[] values = { 0, 2100, 1600, 1200, 850, 550, 300, 120, 0, 0, 0 };
            return rank >= 0 && rank < values.Length ? values[rank] : 0;
        }

        public static BlacklistChecklist Checklist(ProgressData state, int rank, int repRequired)
        {
            bool defeated = state.BlacklistDefeated.Contains(rank);
            IReadOnlyList<BlacklistTask> required = TasksForRank(rank);
            BlacklistTaskStatus[] tasks = required.Select(task => new BlacklistTaskStatus(task,
                defeated || state.BlacklistTasks.Contains(TaskId(rank, task)))).ToArray();
            bool unlocked = defeated || rank == state.BlacklistNextRank;
            bool reputation = defeated || state.Rep >= repRequired;
            state.BlacklistRaceWins.TryGetValue(rank.ToString(), out int raceWins);
            raceWins = Math.Max(0, raceWins);
            int raceTarget = RaceWinsRequired(rank);
            int bounty = Math.Max(0, state.BlacklistBounty);
            int bountyTarget = BountyRequired(rank);
            bool raceMet = defeated || raceWins >= raceTarget;
            bool bountyMet = defeated || bounty >= bountyTarget;
            return new BlacklistChecklist
            {
                Defeated = defeated, RankUnlocked = unlocked, ReputationMet = reputation,
                RaceWins = raceWins, RaceTarget = raceTarget, RaceWinsMet = raceMet,
                Bounty = bounty, BountyTarget = bountyTarget, BountyMet = bountyMet,
                Tasks = tasks,
                Ready = defeated || unlocked && reputation && raceMet && bountyMet && tasks.All(task => task.Complete),
            };
        }
    }
}
