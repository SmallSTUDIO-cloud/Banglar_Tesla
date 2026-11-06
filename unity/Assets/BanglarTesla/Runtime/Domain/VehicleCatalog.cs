using System;
using System.Collections.Generic;
using System.Linq;

namespace BanglarTesla.Domain
{
    public enum VehicleDriveKind { Pedal, Electric, Roadster }
    public enum CosmeticCategory { Paint, Art, Tassel, Bell, Flowers, Mirror }

    [Serializable]
    public sealed class VehicleDefinition
    {
        public string Id = string.Empty;
        public string NameKey = string.Empty;
        public string DescriptionKey = string.Empty;
        public VehicleDriveKind Kind;
        public int Price;
        public bool OwnedByDefault;
        public bool ComingSoon;
        public int RidesRequired;
        public string BodyColor = "#176b52";
        public string CanopyColor = "#a82230";
        public string TrimColor = "#e8b25a";
        public string PanelColor = "#f5d47a";
        public string SeatColor = "#7a1f28";
        public float SpeedStat;
        public float HandlingStat;
        public float ComfortStat;
        public float BrakingStat;
        public double TopSpeedBonus;
        public double AccelMultiplier;
        public double BrakeBonus;
        public double GripBonus;
    }

    [Serializable]
    public sealed class UpgradeDefinition
    {
        public string Id = string.Empty;
        public string NameKey = string.Empty;
        public string DescriptionKey = string.Empty;
        public int MaxLevel;
        public int[] Prices = Array.Empty<int>();
        public int RidesRequired;
    }

    [Serializable]
    public sealed class CosmeticDefinition
    {
        public string Id = string.Empty;
        public CosmeticCategory Category;
        public string NameKey = string.Empty;
        public int Price;
        public string Value = string.Empty;
        public string SwatchA = string.Empty;
        public string SwatchB = string.Empty;
    }

    [Serializable]
    public sealed class TapeDefinition
    {
        public string Id = string.Empty;
        public string NameKey = string.Empty;
        public int UnlockRides;
    }

    public static class VehicleCatalog
    {
        public static readonly IReadOnlyList<VehicleDefinition> Vehicles = new[]
        {
            Vehicle("classic", "veh.classic", VehicleDriveKind.Pedal, 0, true, false, 0, "#176b52", "#a82230", "#e8b25a", "#f5d47a", "#7a1f28", .52, .64, .56, .58, 0, 1, 0, 0),
            Vehicle("neel", "veh.neel", VehicleDriveKind.Pedal, 1200, false, false, 2, "#123e73", "#1f5ea8", "#d9e7ff", "#5cb3ff", "#162844", .61, .72, .62, .65, .45, 1.08, .25, .04),
            Vehicle("shapla", "veh.shapla", VehicleDriveKind.Pedal, 2100, false, false, 5, "#9e1c28", "#1f6a3f", "#f4c04a", "#f66f5b", "#4c1419", .67, .74, .74, .69, .72, 1.13, .4, .06),
            Vehicle("cinema", "veh.cinema", VehicleDriveKind.Pedal, 3600, false, false, 12, "#3a1a52", "#c43e2f", "#f5c258", "#ff9b54", "#2a0f3a", .75, .78, .82, .75, 1.05, 1.18, .55, .08),
            Vehicle("electric", "veh.electric", VehicleDriveKind.Electric, 3200, false, false, 0, "#0c7c69", "#153a54", "#5df2c8", "#f2c14e", "#162d38", .86, .79, .81, .83, 2.35, 1.52, .95, .1),
            Vehicle("roadster", "veh.roadster", VehicleDriveKind.Roadster, 0, false, true, 9999, "#b81d2a", "#151922", "#ffd166", "#ff5964", "#1d1118", .98, .94, .9, .95, 4.0, 2.0, 1.5, .18),
        };

        public static readonly IReadOnlyList<UpgradeDefinition> Upgrades = new[]
        {
            Upgrade("bearings", 3, 0, 360, 820, 1500),
            Upgrade("brakes", 3, 0, 280, 680, 1300),
            Upgrade("tyres", 3, 0, 320, 720, 1400),
            Upgrade("steering", 3, 0, 300, 700, 1350),
            Upgrade("seat", 3, 0, 340, 760, 1400),
            Upgrade("efficiency", 3, 0, 340, 780, 1450),
            Upgrade("turboCap", 3, 0, 380, 860, 1550),
            Upgrade("turboRecharge", 3, 0, 350, 800, 1480),
            Upgrade("canopy", 2, 0, 400, 950),
            Upgrade("sealedDrive", 2, 3, 420, 980),
            Upgrade("lights", 2, 0, 260, 640),
        };

        public static readonly IReadOnlyList<CosmeticDefinition> Cosmetics = new[]
        {
            Cosmetic("paint.red", CosmeticCategory.Paint, 220, "#b8252f", "#b8252f", "#f4c04a"),
            Cosmetic("paint.blue", CosmeticCategory.Paint, 240, "#1e63b5", "#1e63b5", "#b9ddff"),
            Cosmetic("paint.green", CosmeticCategory.Paint, 220, "#1a7a50", "#1a7a50", "#f0cf70"),
            Cosmetic("paint.gold", CosmeticCategory.Paint, 480, "#c98d24", "#c98d24", "#fff0b2"),
            Cosmetic("paint.teal", CosmeticCategory.Paint, 320, "#157c85", "#157c85", "#ffd27a"),
            Cosmetic("paint.magenta", CosmeticCategory.Paint, 360, "#9d2463", "#9d2463", "#ffd166"),
            Cosmetic("paint.mango", CosmeticCategory.Paint, 300, "#d96b1f", "#d96b1f", "#257a4a"),
            Cosmetic("art.floral", CosmeticCategory.Art, 300, "floral", "#e04646", "#f7d060"),
            Cosmetic("art.bird", CosmeticCategory.Art, 420, "bird", "#2485c7", "#f7b24a"),
            Cosmetic("art.river", CosmeticCategory.Art, 460, "river", "#1f8c7a", "#f2d98d"),
            Cosmetic("art.cinema", CosmeticCategory.Art, 620, "cinema", "#7d2e9e", "#ff8c52"),
            Cosmetic("art.tiger", CosmeticCategory.Art, 540, "tiger", "#d97724", "#165b3a"),
            Cosmetic("tassel.red", CosmeticCategory.Tassel, 120, "#d9323a", "#d9323a", "#f5c258"),
            Cosmetic("tassel.gold", CosmeticCategory.Tassel, 160, "#e8b25a", "#e8b25a", "#ffffff"),
            Cosmetic("tassel.green", CosmeticCategory.Tassel, 140, "#2ca66b", "#2ca66b", "#f5d47a"),
            Cosmetic("tassel.cyan", CosmeticCategory.Tassel, 170, "#26b6d4", "#26b6d4", "#ffd166"),
            Cosmetic("bell.classic", CosmeticCategory.Bell, 0, "classic", "#c8c8c8", "#7a7a7a"),
            Cosmetic("bell.brass", CosmeticCategory.Bell, 180, "brass", "#d9a03b", "#8f5d14"),
            Cosmetic("bell.double", CosmeticCategory.Bell, 260, "double", "#e8b25a", "#c94a3a"),
            Cosmetic("flowers.marigold", CosmeticCategory.Flowers, 150, "#f59c24", "#f59c24", "#ffd65c"),
            Cosmetic("flowers.rose", CosmeticCategory.Flowers, 200, "#d83a56", "#d83a56", "#ff9db0"),
            Cosmetic("mirror.round", CosmeticCategory.Mirror, 140, "round", "#cfd8df", "#5a6a78"),
            Cosmetic("mirror.star", CosmeticCategory.Mirror, 240, "star", "#f5c258", "#d9323a"),
        };

        public static readonly IReadOnlyList<TapeDefinition> Tapes = new[]
        {
            new TapeDefinition { Id = "cassette", NameKey = "tape.cassette", UnlockRides = 0 },
            new TapeDefinition { Id = "radio", NameKey = "tape.radio", UnlockRides = 2 },
            new TapeDefinition { Id = "brishti", NameKey = "tape.brishti", UnlockRides = 6 },
        };

        public static VehicleDefinition VehicleById(string? id) => Vehicles.FirstOrDefault(vehicle => vehicle.Id == id) ?? Vehicles[0];
        public static UpgradeDefinition? UpgradeById(string? id) => Upgrades.FirstOrDefault(upgrade => upgrade.Id == id);
        public static CosmeticDefinition? CosmeticById(string? id) => Cosmetics.FirstOrDefault(cosmetic => cosmetic.Id == id);

        public static Dictionary<string, string> DefaultCosmetics() => new()
        {
            ["paint"] = "", ["art"] = "", ["tassel"] = "", ["bell"] = "bell.classic", ["flowers"] = "", ["mirror"] = "",
        };

        private static VehicleDefinition Vehicle(string id, string nameKey, VehicleDriveKind kind, int price, bool owned, bool comingSoon, int rides,
            string body, string canopy, string trim, string panel, string seat, double speed, double handling, double comfort, double braking,
            double speedBonus, double accel, double brake, double grip) => new()
        {
            Id = id, NameKey = nameKey, DescriptionKey = nameKey + ".desc", Kind = kind, Price = price,
            OwnedByDefault = owned, ComingSoon = comingSoon, RidesRequired = rides,
            BodyColor = body, CanopyColor = canopy, TrimColor = trim, PanelColor = panel, SeatColor = seat,
            SpeedStat = (float)speed, HandlingStat = (float)handling, ComfortStat = (float)comfort, BrakingStat = (float)braking,
            TopSpeedBonus = speedBonus, AccelMultiplier = accel, BrakeBonus = brake, GripBonus = grip,
        };

        private static UpgradeDefinition Upgrade(string id, int maxLevel, int ridesRequired, params int[] prices) => new()
        {
            Id = id, NameKey = "up." + id, DescriptionKey = "up." + id + ".desc", MaxLevel = maxLevel,
            Prices = prices, RidesRequired = ridesRequired,
        };

        private static CosmeticDefinition Cosmetic(string id, CosmeticCategory category, int price, string value, string swatchA, string swatchB) => new()
        {
            Id = id, Category = category, NameKey = "cos." + id, Price = price, Value = value, SwatchA = swatchA, SwatchB = swatchB,
        };
    }
}
