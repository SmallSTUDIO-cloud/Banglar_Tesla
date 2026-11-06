using System;
using System.Collections.Generic;
using System.Linq;

namespace BanglarTesla.Domain
{
    public enum PurchaseFailure { Insufficient, Owned, Maxed, Locked, ComingSoon, Unknown, Busy }

    public readonly struct PurchaseResult
    {
        public readonly bool Ok;
        public readonly PurchaseFailure? Reason;
        public readonly int Shortage;
        public readonly int Balance;
        private PurchaseResult(bool ok, PurchaseFailure? reason, int shortage, int balance) { Ok = ok; Reason = reason; Shortage = shortage; Balance = balance; }
        public static PurchaseResult Success(int balance) => new(true, null, 0, balance);
        public static PurchaseResult Failure(PurchaseFailure reason, int balance, int shortage = 0) => new(false, reason, shortage, balance);
    }

    public readonly struct RideCompletion
    {
        public readonly int Earned;
        public readonly double Distance, Mood, Damage;
        public readonly string Mode;
        public readonly bool Wet;
        public RideCompletion(int earned, double distance, double mood, double damage, string mode, bool wet)
        {
            Earned = earned; Distance = distance; Mood = mood; Damage = damage; Mode = mode; Wet = wet;
        }
    }

    public readonly struct RivalProgressionInfo
    {
        public readonly string BossEventId;
        public readonly int RepRequired;
        public RivalProgressionInfo(string bossEventId, int repRequired) { BossEventId = bossEventId; RepRequired = repRequired; }
    }

    public interface IRivalProgressionCatalog
    {
        bool TryGetRival(int rank, out RivalProgressionInfo info);
        bool IsOpenStreetEvent(string eventId);
    }

    /// <summary>Authoritative progression and guarded economy transactions.</summary>
    public sealed class GameState
    {
        private readonly Func<double> now;
        private readonly IRivalProgressionCatalog? rivalCatalog;
        private bool transactionBusy, lowConditionWarned;
        private double lastImpactAtSeconds = -10.0;

        public GameState(IKeyValueStorage? storage, Func<double>? now = null, IRivalProgressionCatalog? rivalCatalog = null)
        {
            this.now = now ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            this.rivalCatalog = rivalCatalog;
            Store = new SaveStore(storage);
            LoadResult loaded = Store.Load(this.now());
            RecoveredFromBackup = loaded.Recovered;
            Progress = loaded.Progress ?? GameProgress.CreateDefault(this.now());
            lowConditionWarned = Progress.Condition < 35.0;
        }

        public SaveStore Store { get; }
        public ProgressData Progress { get; private set; }
        public bool RecoveredFromBackup { get; }
        public double TurboCharge { get; set; } = 100.0;
        public int Balance => Progress.Balance;
        public int Rep => Progress.Rep;
        public int Level => Economy.LevelForRides(Progress.Rides).Level;
        public int BlacklistRank => Progress.BlacklistNextRank;
        public VehicleDefinition Vehicle => VehicleCatalog.VehicleById(Progress.SelectedVehicle);
        public event Action<int>? BalanceChanged;
        public event Action<int>? RepChanged;
        public event Action<ProgressData>? ProgressChanged;
        public event Action<ProgressData>? BeforeSave;
        public event Action<string>? AchievementUnlocked;
        public event Action<string>? Unlock;
        public event Action<bool>? Saved;
        public event Action<string>? LowConditionWarning;
        public event Action<string, string, int>? Transaction;

        public void AddMoney(double amount)
        {
            if (!double.IsFinite(amount) || amount <= 0.0) return;
            long add = (long)Math.Round(amount, MidpointRounding.AwayFromZero);
            Progress.Balance = (int)Math.Min(10_000_000L, Progress.Balance + add);
            Progress.TotalEarned = (int)Math.Min(1_000_000_000L, Progress.TotalEarned + add);
            BalanceChanged?.Invoke(Progress.Balance);
            ProgressChanged?.Invoke(Progress);
        }

        public bool Spend(double amount)
        {
            if (!Economy.CanAfford(Progress.Balance, amount)) return false;
            Progress.Balance -= (int)Math.Round(amount, MidpointRounding.AwayFromZero);
            BalanceChanged?.Invoke(Progress.Balance);
            ProgressChanged?.Invoke(Progress);
            return true;
        }

        public int DeductPenalty(double requestedAmount)
        {
            if (!double.IsFinite(requestedAmount) || requestedAmount <= 0.0) return 0;
            int actual = (int)Math.Min(Progress.Balance, (long)Math.Round(requestedAmount, MidpointRounding.AwayFromZero));
            if (actual <= 0) return 0;
            Progress.Balance -= actual;
            BalanceChanged?.Invoke(Progress.Balance);
            ProgressChanged?.Invoke(Progress);
            return actual;
        }

        public void AddRep(double amount)
        {
            if (!double.IsFinite(amount) || amount <= 0.0) return;
            long add = (long)Math.Round(amount, MidpointRounding.AwayFromZero);
            Progress.Rep = (int)Math.Min(100_000_000L, Progress.Rep + add);
            RepChanged?.Invoke(Progress.Rep);
            ProgressChanged?.Invoke(Progress);
        }

        public int UpgradeLevel(string id) => Progress.Upgrades.TryGetValue(id, out int level) ? level : 0;
        public int? NextUpgradePrice(string id)
        {
            UpgradeDefinition? definition = VehicleCatalog.UpgradeById(id);
            if (definition is null) return null;
            int level = UpgradeLevel(id);
            return level >= definition.MaxLevel ? null : Economy.UpgradePrice(definition, level);
        }

        public PurchaseResult BuyUpgrade(string id)
        {
            if (transactionBusy) return PurchaseResult.Failure(PurchaseFailure.Busy, Balance);
            transactionBusy = true;
            try
            {
                UpgradeDefinition? definition = VehicleCatalog.UpgradeById(id);
                if (definition is null) return PurchaseResult.Failure(PurchaseFailure.Unknown, Balance);
                int level = UpgradeLevel(id);
                if (level >= definition.MaxLevel) return PurchaseResult.Failure(PurchaseFailure.Maxed, Balance);
                if (Progress.Rides < definition.RidesRequired) return PurchaseResult.Failure(PurchaseFailure.Locked, Balance);
                int price = definition.Prices[level];
                if (!Economy.CanAfford(Balance, price)) return PurchaseResult.Failure(PurchaseFailure.Insufficient, Balance, price - Balance);
                Spend(price);
                Progress.Upgrades[id] = level + 1;
                UnlockAchievement("ach.firstUpgrade");
                Transaction?.Invoke("upgrade", id, level + 1);
                SaveNow();
                return PurchaseResult.Success(Balance);
            }
            finally { transactionBusy = false; }
        }

        public bool OwnsVehicle(string id)
        {
            VehicleDefinition? definition = VehicleCatalog.Vehicles.FirstOrDefault(vehicle => vehicle.Id == id);
            return definition is not null && !definition.ComingSoon && Progress.OwnedVehicles.Contains(id);
        }

        public bool VehicleUnlocked(string id)
        {
            VehicleDefinition? definition = VehicleCatalog.Vehicles.FirstOrDefault(vehicle => vehicle.Id == id);
            return definition is not null && !definition.ComingSoon && (Progress.Rides >= definition.RidesRequired || OwnsVehicle(id));
        }

        public PurchaseResult BuyVehicle(string id)
        {
            if (transactionBusy) return PurchaseResult.Failure(PurchaseFailure.Busy, Balance);
            transactionBusy = true;
            try
            {
                VehicleDefinition? definition = VehicleCatalog.Vehicles.FirstOrDefault(vehicle => vehicle.Id == id);
                if (definition is null) return PurchaseResult.Failure(PurchaseFailure.Unknown, Balance);
                if (definition.ComingSoon) return PurchaseResult.Failure(PurchaseFailure.ComingSoon, Balance);
                if (OwnsVehicle(id)) return PurchaseResult.Failure(PurchaseFailure.Owned, Balance);
                if (!VehicleUnlocked(id)) return PurchaseResult.Failure(PurchaseFailure.Locked, Balance);
                if (!Economy.CanAfford(Balance, definition.Price)) return PurchaseResult.Failure(PurchaseFailure.Insufficient, Balance, definition.Price - Balance);
                Spend(definition.Price);
                Progress.OwnedVehicles.Add(id);
                Progress.SelectedVehicle = id;
                if (id == "electric") UnlockAchievement("ach.electricOwner");
                Transaction?.Invoke("vehicle", id, 1);
                SaveNow();
                return PurchaseResult.Success(Balance);
            }
            finally { transactionBusy = false; }
        }

        public bool SelectVehicle(string id)
        {
            if (!OwnsVehicle(id)) return false;
            Progress.SelectedVehicle = id;
            ProgressChanged?.Invoke(Progress);
            SaveNow();
            return true;
        }

        public bool OwnsCosmetic(string id)
        {
            CosmeticDefinition? definition = VehicleCatalog.CosmeticById(id);
            return definition is not null && (definition.Price == 0 || Progress.OwnedCosmetics.Contains(id));
        }

        public PurchaseResult BuyCosmetic(string id)
        {
            if (transactionBusy) return PurchaseResult.Failure(PurchaseFailure.Busy, Balance);
            transactionBusy = true;
            try
            {
                CosmeticDefinition? definition = VehicleCatalog.CosmeticById(id);
                if (definition is null) return PurchaseResult.Failure(PurchaseFailure.Unknown, Balance);
                if (OwnsCosmetic(id)) return PurchaseResult.Failure(PurchaseFailure.Owned, Balance);
                if (!Economy.CanAfford(Balance, definition.Price)) return PurchaseResult.Failure(PurchaseFailure.Insufficient, Balance, definition.Price - Balance);
                Spend(definition.Price);
                Progress.OwnedCosmetics.Add(id);
                Progress.Cosmetics[CategoryKey(definition.Category)] = id;
                Transaction?.Invoke("cosmetic", id, 1);
                SaveNow();
                return PurchaseResult.Success(Balance);
            }
            finally { transactionBusy = false; }
        }

        public PurchaseResult EquipCosmetic(string id, CosmeticCategory? category = null)
        {
            if (id == string.Empty && category.HasValue)
            {
                Progress.Cosmetics[CategoryKey(category.Value)] = string.Empty;
                SaveNow();
                return PurchaseResult.Success(Balance);
            }
            CosmeticDefinition? definition = VehicleCatalog.CosmeticById(id);
            if (definition is null) return PurchaseResult.Failure(PurchaseFailure.Unknown, Balance);
            if (!OwnsCosmetic(id)) return PurchaseResult.Failure(PurchaseFailure.Locked, Balance);
            Progress.Cosmetics[CategoryKey(definition.Category)] = id;
            Transaction?.Invoke("equip", id, 1);
            SaveNow();
            return PurchaseResult.Success(Balance);
        }

        public void DamageCondition(double amount)
        {
            if (!double.IsFinite(amount) || amount <= 0.0) return;
            if (Progress.Condition >= 50.0) lowConditionWarned = false;
            Progress.Condition = Numerics.Clamp(Progress.Condition - amount, 5.0, 100.0);
            if (Progress.Condition < 35.0 && !lowConditionWarned)
            {
                lowConditionWarned = true;
                LowConditionWarning?.Invoke("toast.conditionLow");
            }
        }

        public bool DamageFromImpact(double amount, double simulationSeconds)
        {
            if (amount <= 0.0 || simulationSeconds - lastImpactAtSeconds < 0.28) return false;
            lastImpactAtSeconds = simulationSeconds;
            DamageCondition(amount);
            return true;
        }

        public PurchaseResult Repair()
        {
            int price = Economy.RepairCost(Progress.Condition);
            if (price == 0) return PurchaseResult.Failure(PurchaseFailure.Maxed, Balance);
            if (!Economy.CanAfford(Balance, price)) return PurchaseResult.Failure(PurchaseFailure.Insufficient, Balance, price - Balance);
            Spend(price);
            Progress.Condition = 100.0;
            lowConditionWarned = false;
            Transaction?.Invoke("repair", "repair", 100);
            SaveNow();
            return PurchaseResult.Success(Balance);
        }

        public bool RecordBlacklistTask(BlacklistTask task, int? rank = null)
        {
            int targetRank = rank ?? BlacklistRank;
            if (targetRank < 1 || targetRank > 10 || targetRank != BlacklistRank || !BlacklistRequirements.TasksForRank(targetRank).Contains(task)) return false;
            string id = BlacklistRequirements.TaskId(targetRank, task);
            if (Progress.BlacklistTasks.Contains(id)) return false;
            Progress.BlacklistTasks.Add(id);
            ProgressChanged?.Invoke(Progress);
            SaveNow();
            return true;
        }

        public int RecordPursuitEscape(double maxHeat, double repReward)
        {
            if (BlacklistRank <= 0 || !double.IsFinite(maxHeat) || maxHeat < 1.0) return 0;
            double safeRep = double.IsFinite(repReward) ? Numerics.Clamp(repReward, 0.0, 100_000.0) : 0.0;
            int earned = Math.Max(80, (int)Math.Round(Math.Min(5.0, maxHeat) * 70.0 + safeRep, MidpointRounding.AwayFromZero));
            Progress.BlacklistBounty = (int)Math.Min(100_000_000L, Progress.BlacklistBounty + (long)earned);
            ProgressChanged?.Invoke(Progress);
            SaveNow();
            return earned;
        }

        public bool RecordEventVictory(string eventId, int cashReward, int repReward, int? blacklistRank = null)
        {
            if (blacklistRank.HasValue)
            {
                int rank = blacklistRank.Value;
                if (rivalCatalog is null || !rivalCatalog.TryGetRival(rank, out RivalProgressionInfo info) || eventId != info.BossEventId) return false;
                if (!Progress.BlacklistDefeated.Contains(rank) &&
                    (rank != BlacklistRank || !BlacklistRequirements.Checklist(Progress, rank, info.RepRequired).Ready)) return false;
            }
            int? resolvedRank = blacklistRank;
            bool alreadyPaid = Progress.CompletedEvents.Contains(eventId) || resolvedRank.HasValue && Progress.BlacklistDefeated.Contains(resolvedRank.Value);
            if (!alreadyPaid)
            {
                if (cashReward > 0) AddMoney(cashReward);
                if (repReward > 0) AddRep(repReward);
                if (!string.IsNullOrEmpty(eventId)) Progress.CompletedEvents.Add(eventId);
            }
            if (!resolvedRank.HasValue && rivalCatalog?.IsOpenStreetEvent(eventId) == true && BlacklistRank >= 1)
            {
                string key = BlacklistRank.ToString();
                Progress.BlacklistRaceWins[key] = Math.Min(1000, (Progress.BlacklistRaceWins.TryGetValue(key, out int wins) ? wins : 0) + 1);
                RecordBlacklistTask(BlacklistTask.Race);
                ProgressChanged?.Invoke(Progress);
            }
            if (resolvedRank is >= 1 and <= 10 && !Progress.BlacklistDefeated.Contains(resolvedRank.Value))
            {
                int rank = resolvedRank.Value;
                Progress.BlacklistDefeated.Add(rank);
                Progress.BlacklistDefeated.Sort((a, b) => b.CompareTo(a));
                Progress.BlacklistNextRank = Math.Min(Progress.BlacklistNextRank, rank - 1);
                if (rank == 10) UnlockAchievement("ach.blacklistStart");
                if (rank == 1) UnlockAchievement("ach.blacklistChamp");
            }
            SaveNow();
            return !alreadyPaid;
        }

        public void RecordRide(RideCompletion ride)
        {
            Progress.Rides++;
            RecordBlacklistTask(BlacklistTask.Fare);
            Progress.DistanceTravelled += Math.Max(0.0, ride.Distance);
            Progress.LastMode = ride.Mode is "free" or "daily" ? ride.Mode : "duty";
            AddMoney(ride.Earned);
            int rideRep = 35 + (int)Math.Round(Math.Max(0.0, ride.Distance) * 0.06, MidpointRounding.AwayFromZero) +
                (ride.Damage == 0.0 ? 20 : 0) + (ride.Mood >= 80.0 ? 15 : 0);
            AddRep(rideRep);
            if (Progress.Rides == 1) UnlockAchievement("ach.firstRide");
            if (Progress.Rides >= 10) UnlockAchievement("ach.tenRides");
            if (ride.Damage == 0.0 && ride.Mood >= 80.0) UnlockAchievement("ach.cleanRun");
            if (ride.Wet) UnlockAchievement("ach.rainRide");
            if (Progress.DistanceTravelled >= 3000.0) UnlockAchievement("ach.explorer");
            foreach (TapeDefinition tape in VehicleCatalog.Tapes)
                if (Progress.Rides >= tape.UnlockRides && !Progress.Tapes.Contains(tape.Id))
                {
                    Progress.Tapes.Add(tape.Id);
                    Unlock?.Invoke(tape.Id);
                }
            SaveNow();
        }

        public void UnlockAchievement(string id)
        {
            if (Progress.Achievements.Contains(id)) return;
            Progress.Achievements.Add(id);
            AchievementUnlocked?.Invoke(id);
        }

        public void MarkBlacklistIntroSeen()
        {
            if (Progress.BlacklistIntroSeen) return;
            Progress.BlacklistIntroSeen = true;
            SaveNow();
        }

        public void MarkTutorialDone() { Progress.TutorialDone = true; SaveNow(); }
        public void SetMode(string mode) => Progress.LastMode = mode is "free" or "daily" ? mode : "duty";
        public void SetSpawn(double x, double z, double yaw) => Progress.Spawn = new SpawnData { X = x, Z = z, Yaw = yaw };
        public void SetHeat(double heat) => Progress.Heat = Numerics.Clamp(double.IsFinite(heat) ? heat : 0.0, 0.0, 5.0);

        public void SaveNow()
        {
            BeforeSave?.Invoke(Progress);
            if (Store.Save(Progress, now())) Saved?.Invoke(true);
        }

        public void Autosave()
        {
            BeforeSave?.Invoke(Progress);
            if (Store.Autosave(Progress, now())) Saved?.Invoke(true);
        }

        public void ResetProgress()
        {
            Store.Clear();
            Progress = GameProgress.CreateDefault(now());
            lowConditionWarned = false;
            TurboCharge = 100.0;
            Store.Save(Progress, now());
            BalanceChanged?.Invoke(Balance);
            RepChanged?.Invoke(Rep);
            ProgressChanged?.Invoke(Progress);
        }

        private static string CategoryKey(CosmeticCategory category) => category.ToString().ToLowerInvariant();
    }
}
