using System;
using System.Collections.Generic;

namespace BanglarTesla.Domain
{
    public readonly struct DriverLevel
    {
        public readonly int Level;
        public readonly string TitleKey;
        public readonly int? NextAt;
        public DriverLevel(int level, string titleKey, int? nextAt) { Level = level; TitleKey = titleKey; NextAt = nextAt; }
    }

    [Serializable]
    public sealed class VehicleTuning
    {
        public double MaxSpeed = 5.65;
        public double Accel = 2.95;
        public double BrakeDecel = 5.4;
        public double SteerMaxLow = 0.68;
        public double SteerMaxHigh = 0.165;
        public double SteerRateMultiplier = 1.0;
        public double Grip = 0.7;
        public double RoughSurfaceKeep = 0.84;
        public double RollingDragScale = 1.0;
        public bool IsElectric;
        public double BatteryDrainMultiplier = 1.0;
        public double RegenFactor;
        public double TurboDrainMultiplier = 1.0;
        public double TurboRechargeMultiplier = 1.0;
        public double SuspensionSmoothing;
        public double ComfortBonus;
        public double DamageMultiplier = 1.0;
        public double RainShield;
        public double NightBeam = 1.0;
    }

    public readonly struct FareBreakdown
    {
        public readonly int Base;
        public readonly int Distance;
        public readonly int Time;
        public readonly int Smooth;
        public readonly int Tip;
        public readonly int Traffic;
        public readonly int Damage;
        public readonly int Total;
        public readonly int Stars;
        public readonly bool OnTime;
        public readonly double Mood;

        public FareBreakdown(int baseFare, int distance, int time, int smooth, int tip, int traffic, int damage, int total, int stars, bool onTime, double mood)
        {
            Base = baseFare; Distance = distance; Time = time; Smooth = smooth; Tip = tip; Traffic = traffic;
            Damage = damage; Total = total; Stars = stars; OnTime = onTime; Mood = mood;
        }
    }

    public readonly struct VehicleStatInfo
    {
        public readonly double Speed, Accel, Handling, Comfort, Braking, Durability, Efficiency;
        public VehicleStatInfo(double speed, double accel, double handling, double comfort, double braking, double durability, double efficiency)
        {
            Speed = speed; Accel = accel; Handling = handling; Comfort = comfort; Braking = braking;
            Durability = durability; Efficiency = efficiency;
        }
    }

    /// <summary>Faithful pure-C# port of the v0.6.7 fare, repair and derived-vehicle rules.</summary>
    public static class Economy
    {
        public const double BaseSpeed = 5.65;
        public const double BaseAccel = 2.95;
        public const double BaseBrake = 5.4;

        private static readonly (int At, string TitleKey)[] Levels =
        {
            (0, "title.rookie"), (5, "title.regular"), (12, "title.veteran"), (25, "title.legend"),
        };

        public static DriverLevel LevelForRides(int rides)
        {
            int index = 0;
            for (int i = 0; i < Levels.Length; i++) if (rides >= Levels[i].At) index = i;
            int? next = index + 1 < Levels.Length ? Levels[index + 1].At : null;
            return new DriverLevel(index + 1, Levels[index].TitleKey, next);
        }

        public static FareBreakdown ComputeFare(double distanceMeters, double timeTaken, double targetTime, double mood, double damageHits, double fareMultiplier = 1.0, double trafficBonus = 0.0)
        {
            double distanceValue = Math.Max(0.0, distanceMeters);
            double moodValue = Numerics.Clamp(mood, 0.0, 100.0);
            const int baseFare = 30;
            int distance = Round(distanceValue * 0.22);
            bool onTime = timeTaken <= targetTime * 1.05;
            int time = onTime ? 20 : 0;
            double smoothRatio = Numerics.Clamp01((moodValue - 50.0) / 50.0) * (damageHits == 0.0 ? 1.0 : 0.45);
            int smooth = Round(25.0 * smoothRatio);
            double tipRatio = Numerics.Clamp01((moodValue - 62.0) / 38.0) * (onTime ? 1.0 : 0.35);
            int tip = Round(30.0 * tipRatio);
            int traffic = Math.Max(0, Round(trafficBonus));
            int damage = Math.Min(baseFare + distance, Round(Math.Max(0.0, damageHits) * 8.0));
            int subtotal = Math.Max(10, baseFare + distance + time + smooth + tip + traffic - damage);
            int total = Math.Max(0, Round(subtotal * fareMultiplier));
            double score = moodValue * 0.65 + (onTime ? 22.0 : 0.0) + (damageHits == 0.0 ? 13.0 : Math.Max(0.0, 10.0 - damageHits * 4.0));
            int stars = score >= 90.0 ? 5 : score >= 76.0 ? 4 : score >= 56.0 ? 3 : score >= 38.0 ? 2 : 1;
            return new FareBreakdown(baseFare, distance, time, smooth, tip, traffic, damage, total, stars, onTime, moodValue);
        }

        public static int RepairCost(double condition)
        {
            double missing = Numerics.Clamp(100.0 - condition, 0.0, 100.0);
            return missing < 1.0 ? 0 : Math.Max(10, Round(missing * 2.2));
        }

        public static VehicleTuning DeriveTuning(VehicleDefinition vehicle, IReadOnlyDictionary<string, int>? upgrades, double condition, double wetness = 0.0)
        {
            upgrades ??= new Dictionary<string, int>();
            int tyres = Level(upgrades, "tyres", 3), brakes = Level(upgrades, "brakes", 3);
            int bearings = Level(upgrades, "bearings", 3), steering = Level(upgrades, "steering", 3);
            int seat = Level(upgrades, "seat", 3), efficiency = Level(upgrades, "efficiency", 3);
            int turboCap = Level(upgrades, "turboCap", 3), turboRecharge = Level(upgrades, "turboRecharge", 3);
            int canopy = Level(upgrades, "canopy", 2), lights = Level(upgrades, "lights", 2);
            int sealedDrive = Level(upgrades, "sealedDrive", 2);
            double condFactor = 0.85 + 0.15 * Numerics.Clamp01(condition / 85.0);
            double wetGripLoss = wetness * 0.22 * (1.0 - tyres * 0.22);
            bool isElectric = vehicle.Kind == VehicleDriveKind.Electric;
            double motorSpeedBoost = bearings * (isElectric ? 0.56 : 0.48);
            double efficiencySpeedBoost = efficiency * (isElectric ? 0.16 : 0.08);
            return new VehicleTuning
            {
                IsElectric = isElectric,
                MaxSpeed = (BaseSpeed + vehicle.TopSpeedBonus + motorSpeedBoost + efficiencySpeedBoost) * condFactor,
                Accel = BaseAccel * vehicle.AccelMultiplier * (1.0 + bearings * 0.12 + efficiency * 0.03) *
                    (1.0 - Numerics.Clamp01(wetness) * 0.11 * (1.0 - sealedDrive * 0.38)) * condFactor,
                BrakeDecel = (BaseBrake + vehicle.BrakeBonus + brakes * 0.85) * (1.0 - wetGripLoss * 0.72),
                SteerMaxLow = 0.68 + steering * 0.045,
                SteerMaxHigh = 0.165 + steering * 0.015,
                SteerRateMultiplier = 1.0 + steering * 0.15,
                Grip = Numerics.Clamp(0.64 + vehicle.GripBonus + tyres * 0.09 - wetGripLoss, 0.38, 0.99),
                RoughSurfaceKeep = Numerics.Clamp(0.84 + tyres * 0.03 + seat * 0.02, 0.8, 0.97),
                RollingDragScale = Numerics.Clamp(1.0 - bearings * 0.05 - efficiency * 0.08, 0.62, 1.0),
                ComfortBonus = seat * 0.2 + canopy * 0.06,
                DamageMultiplier = Numerics.Clamp(1.0 - seat * 0.16, 0.48, 1.0),
                BatteryDrainMultiplier = Numerics.Clamp(1.0 - efficiency * 0.16, 0.48, 1.0),
                RegenFactor = isElectric ? 0.12 + efficiency * 0.11 : 0.0,
                TurboDrainMultiplier = Numerics.Clamp(1.0 - turboCap * 0.14, 0.54, 1.0),
                TurboRechargeMultiplier = 1.0 + turboRecharge * 0.22,
                SuspensionSmoothing = seat * 0.22,
                RainShield = canopy * 0.4,
                NightBeam = 1.0 + lights * 0.55 + (isElectric ? 0.35 : 0.0),
            };
        }

        public static VehicleStatInfo VehicleStats(VehicleDefinition vehicle, IReadOnlyDictionary<string, int>? upgrades)
        {
            upgrades ??= new Dictionary<string, int>();
            int tyres = Level(upgrades, "tyres", 3), brakes = Level(upgrades, "brakes", 3);
            int bearings = Level(upgrades, "bearings", 3), steering = Level(upgrades, "steering", 3);
            int seat = Level(upgrades, "seat", 3), efficiency = Level(upgrades, "efficiency", 3);
            int canopy = Level(upgrades, "canopy", 2);
            double baseEfficiency = vehicle.Kind == VehicleDriveKind.Electric ? 0.72 : 0.54;
            return new VehicleStatInfo(
                Numerics.Clamp01(vehicle.SpeedStat + bearings * 0.075 + efficiency * 0.02),
                Numerics.Clamp01(vehicle.SpeedStat * 0.88 + (vehicle.Kind == VehicleDriveKind.Electric ? 0.14 : 0.0) + bearings * 0.085 + efficiency * 0.025),
                Numerics.Clamp01(vehicle.HandlingStat + tyres * 0.05 + steering * 0.055),
                Numerics.Clamp01(vehicle.ComfortStat + seat * 0.075 + canopy * 0.04),
                Numerics.Clamp01(vehicle.BrakingStat + brakes * 0.085),
                Numerics.Clamp01(0.55 + (vehicle.Kind == VehicleDriveKind.Electric ? 0.1 : 0.0) + seat * 0.11 + tyres * 0.03),
                Numerics.Clamp01(baseEfficiency + efficiency * 0.09 + bearings * 0.02));
        }

        public static int UpgradePrice(UpgradeDefinition definition, int currentLevel)
        {
            return currentLevel < 0 || currentLevel >= definition.MaxLevel || currentLevel >= definition.Prices.Length ? -1 : definition.Prices[currentLevel];
        }

        public static bool CanAfford(double balance, double price)
        {
            return double.IsFinite(balance) && double.IsFinite(price) && price >= 0.0 && balance >= price;
        }

        private static int Level(IReadOnlyDictionary<string, int> upgrades, string id, int maximum) =>
            upgrades.TryGetValue(id, out int level) ? Numerics.Clamp(level, 0, maximum) : 0;

        private static int Round(double value) => (int)Math.Round(value, MidpointRounding.AwayFromZero);
    }
}
