using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace BanglarTesla.Domain
{
    [Serializable]
    public sealed class SpawnData
    {
        [JsonProperty("x")] public double X;
        [JsonProperty("z")] public double Z;
        [JsonProperty("yaw")] public double Yaw;
    }

    [Serializable]
    public sealed class ProgressData
    {
        [JsonProperty("version")] public int Version = GameProgress.SaveVersion;
        [JsonProperty("balance")] public int Balance = 500;
        [JsonProperty("rep")] public int Rep;
        [JsonProperty("ownedVehicles")] public List<string> OwnedVehicles = new();
        [JsonProperty("selectedVehicle")] public string SelectedVehicle = "classic";
        [JsonProperty("upgrades")] public Dictionary<string, int> Upgrades = new();
        [JsonProperty("ownedCosmetics")] public List<string> OwnedCosmetics = new();
        [JsonProperty("cosmetics")] public Dictionary<string, string> Cosmetics = VehicleCatalog.DefaultCosmetics();
        [JsonProperty("condition")] public double Condition = 86.0;
        [JsonProperty("stamina")] public double Stamina = 100.0;
        [JsonProperty("rides")] public int Rides;
        [JsonProperty("totalEarned")] public int TotalEarned;
        [JsonProperty("distanceTravelled")] public double DistanceTravelled;
        [JsonProperty("achievements")] public List<string> Achievements = new();
        [JsonProperty("tapes")] public List<string> Tapes = new();
        [JsonProperty("tutorialDone")] public bool TutorialDone;
        [JsonProperty("dailyDoneDate")] public string DailyDoneDate = string.Empty;
        [JsonProperty("lastMode")] public string LastMode = "duty";
        [JsonProperty("spawn")] public SpawnData? Spawn;
        [JsonProperty("dayPhase")] public string DayPhase = "morning";
        [JsonProperty("clockMinutes")] public double ClockMinutes = 450.0;
        [JsonProperty("weather")] public string Weather = "sunny";
        [JsonProperty("scrapbook")] public JToken Scrapbook = new JObject { ["records"] = new JArray() };
        [JsonProperty("blacklistNextRank")] public int BlacklistNextRank = 10;
        [JsonProperty("blacklistDefeated")] public List<int> BlacklistDefeated = new();
        [JsonProperty("blacklistIntroSeen")] public bool BlacklistIntroSeen;
        [JsonProperty("blacklistTasks")] public List<string> BlacklistTasks = new();
        [JsonProperty("blacklistRaceWins")] public Dictionary<string, int> BlacklistRaceWins = new();
        [JsonProperty("blacklistBounty")] public int BlacklistBounty;
        [JsonProperty("completedEvents")] public List<string> CompletedEvents = new();
        [JsonProperty("heat")] public double Heat;
        [JsonProperty("createdAt")] public double CreatedAt;
        [JsonProperty("updatedAt")] public double UpdatedAt;
    }

    public static class GameProgress
    {
        public const int SaveVersion = 5;
        public const string SaveKey = "banglar-tesla.save";
        public const string BackupKey = "banglar-tesla.save.bak";
        private static readonly Regex BlacklistTaskPattern = new("^(10|[1-9]):(race|fare|escape)$", RegexOptions.CultureInvariant | RegexOptions.Compiled);

        public static ProgressData CreateDefault(double now)
        {
            return new ProgressData
            {
                OwnedVehicles = VehicleCatalog.Vehicles.Where(vehicle => vehicle.OwnedByDefault && !vehicle.ComingSoon).Select(vehicle => vehicle.Id).ToList(),
                OwnedCosmetics = new List<string> { "bell.classic" },
                Tapes = VehicleCatalog.Tapes.Where(tape => tape.UnlockRides == 0).Select(tape => tape.Id).ToList(),
                CreatedAt = now, UpdatedAt = now,
            };
        }

        public static JToken? Migrate(JToken? raw)
        {
            if (raw is not JObject source) return raw;
            JObject data = (JObject)source.DeepClone();
            int version = (int)Number(data["version"], 1.0, 0.0, 99.0);
            if (version < 1)
            {
                data["version"] = 1;
                if (data["upgrades"] is not JObject) data["upgrades"] = new JObject();
            }
            if (version < 2)
            {
                data["version"] = 2;
                List<string> owned = Strings(data["ownedCosmetics"]);
                if (!owned.Contains("bell.classic")) owned.Add("bell.classic");
                data["ownedCosmetics"] = JArray.FromObject(owned);
                if (data["dailyDoneDate"]?.Type != JTokenType.String) data["dailyDoneDate"] = string.Empty;
                if (!IsOneOf(data["dayPhase"], "morning", "noon", "golden", "blue", "night")) data["dayPhase"] = "morning";
                if (!IsOneOf(data["lastMode"], "duty", "free", "daily")) data["lastMode"] = "duty";
            }
            if (version < 3)
            {
                data["version"] = 3;
                if (data["weather"]?.Value<string>() == "clear") data["weather"] = "sunny";
                if (!IsOneOf(data["weather"], "sunny", "overcast", "rain", "windy", "storm")) data["weather"] = "sunny";
                if (data["scrapbook"] is not JObject) data["scrapbook"] = new JObject { ["records"] = new JArray() };
            }
            if (version < 4)
            {
                data["version"] = 4;
                if (data["blacklistTasks"] is not JArray) data["blacklistTasks"] = new JArray();
            }
            if (version < 5)
            {
                data["version"] = 5;
                int rank = data["blacklistNextRank"]?.Type == JTokenType.Integer ? data["blacklistNextRank"]!.Value<int>() : 10;
                List<string> tasks = Strings(data["blacklistTasks"]);
                data["blacklistRaceWins"] = rank >= 1 && rank <= 10 && tasks.Contains(rank + ":race")
                    ? new JObject { [rank.ToString()] = BlacklistRequirements.RaceWinsRequired(rank) } : new JObject();
                data["blacklistBounty"] = rank >= 1 && rank <= 7 && tasks.Contains(rank + ":escape")
                    ? BlacklistRequirements.BountyRequired(rank) : 0;
            }
            return data;
        }

        public static ProgressData Sanitize(JToken? raw, double now)
        {
            ProgressData defaults = CreateDefault(now);
            if (raw is not JObject data) return defaults;
            var validVehicles = new HashSet<string>(VehicleCatalog.Vehicles.Where(vehicle => !vehicle.ComingSoon).Select(vehicle => vehicle.Id));
            var ownedVehicles = new List<string>();
            foreach (string id in Strings(data["ownedVehicles"]))
                if (validVehicles.Contains(id) && !ownedVehicles.Contains(id)) ownedVehicles.Add(id);
            if (!ownedVehicles.Contains("classic")) ownedVehicles.Insert(0, "classic");
            string selected = data["selectedVehicle"]?.Type == JTokenType.String ? data["selectedVehicle"]!.Value<string>()! : defaults.SelectedVehicle;
            string selectedVehicle = ownedVehicles.Contains(selected) ? selected : ownedVehicles[0];

            var upgrades = new Dictionary<string, int>();
            if (data["upgrades"] is JObject upgradeObject)
            {
                foreach (JProperty property in upgradeObject.Properties())
                {
                    int cap = VehicleCatalog.UpgradeById(property.Name)?.MaxLevel ?? 3;
                    int level = (int)Math.Floor(Number(property.Value, 0.0, 0.0, cap));
                    if (level > 0) upgrades[property.Name] = level;
                }
            }

            Dictionary<string, string> cosmetics = VehicleCatalog.DefaultCosmetics();
            if (data["cosmetics"] is JObject cosmeticObject)
            {
                foreach (string key in cosmetics.Keys.ToArray())
                {
                    JToken? token = cosmeticObject[key];
                    if (token?.Type == JTokenType.String && VehicleCatalog.CosmeticById(token.Value<string>()) is not null)
                        cosmetics[key] = token.Value<string>()!;
                }
            }
            List<string> ownedCosmetics = Strings(data["ownedCosmetics"]).Where(id => VehicleCatalog.CosmeticById(id) is not null).ToList();
            foreach (string id in cosmetics.Values)
                if (!string.IsNullOrEmpty(id) && !ownedCosmetics.Contains(id)) ownedCosmetics.Add(id);

            SpawnData? spawn = null;
            if (data["spawn"] is JObject spawnObject)
                spawn = new SpawnData
                {
                    X = Number(spawnObject["x"], 0.0, -500.0, 500.0), Z = Number(spawnObject["z"], 0.0, -500.0, 500.0),
                    Yaw = Number(spawnObject["yaw"], 0.0, -Math.PI * 4.0, Math.PI * 4.0),
                };

            string dayPhase = IsOneOf(data["dayPhase"], "morning", "noon", "golden", "blue", "night") ? data["dayPhase"]!.Value<string>()! : "morning";
            double clock = IsNumber(data["clockMinutes"]) ? Numerics.NormalizeMinutes(data["clockMinutes"]!.Value<double>()) : CanonicalMinutesForPhase(dayPhase);
            var defeatedSet = new HashSet<int>();
            if (data["blacklistDefeated"] is JArray defeatedArray)
                foreach (JToken token in defeatedArray)
                    if (IsNumber(token)) { int rank = (int)Math.Floor(token.Value<double>()); if (rank is >= 1 and <= 10) defeatedSet.Add(rank); }
            List<int> defeated = defeatedSet.OrderByDescending(rank => rank).ToList();
            int derivedNext = 10;
            while (derivedNext >= 1 && defeatedSet.Contains(derivedNext)) derivedNext--;
            int rawNext = IsNumber(data["blacklistNextRank"]) ? (int)Math.Floor(Numerics.Clamp(data["blacklistNextRank"]!.Value<double>(), 0.0, 10.0)) : derivedNext;
            int nextRank = Math.Min(rawNext, derivedNext);
            int rides = Math.Max(0, (int)Math.Floor(Number(data["rides"], 0.0, 0.0, 1_000_000.0)));
            double legacyRep = IsNumber(data["rep"]) ? 0.0 : rides * 45.0;
            var raceWins = new Dictionary<string, int>();
            if (data["blacklistRaceWins"] is JObject raceObject)
                for (int rank = 1; rank <= 10; rank++)
                {
                    int wins = (int)Math.Floor(Number(raceObject[rank.ToString()], 0.0, 0.0, 1000.0));
                    if (wins > 0) raceWins[rank.ToString()] = wins;
                }

            JToken scrapbook = data["scrapbook"] is JObject or JArray
                ? data["scrapbook"]!.DeepClone() : new JObject { ["records"] = new JArray() };
            return new ProgressData
            {
                Balance = Math.Max(0, (int)Math.Floor(Number(data["balance"], defaults.Balance, 0.0, 10_000_000.0))),
                Rep = Math.Max(0, (int)Math.Floor(Number(data["rep"], legacyRep, 0.0, 100_000_000.0))),
                OwnedVehicles = ownedVehicles, SelectedVehicle = selectedVehicle, Upgrades = upgrades,
                OwnedCosmetics = ownedCosmetics, Cosmetics = cosmetics,
                Condition = Number(data["condition"], defaults.Condition, 5.0, 100.0),
                Stamina = Number(data["stamina"], defaults.Stamina, 0.0, 100.0), Rides = rides,
                TotalEarned = Math.Max(0, (int)Math.Floor(Number(data["totalEarned"], 0.0, 0.0, 1_000_000_000.0))),
                DistanceTravelled = Math.Max(0.0, Number(data["distanceTravelled"], 0.0, 0.0, 1e9)),
                Achievements = Strings(data["achievements"]).Take(64).ToList(),
                Tapes = Strings(data["tapes"]).Where(id => VehicleCatalog.Tapes.Any(tape => tape.Id == id)).ToList(),
                TutorialDone = data["tutorialDone"]?.Type == JTokenType.Boolean && data["tutorialDone"]!.Value<bool>(),
                DailyDoneDate = Slice(data["dailyDoneDate"]?.Type == JTokenType.String ? data["dailyDoneDate"]!.Value<string>()! : string.Empty, 10),
                LastMode = IsOneOf(data["lastMode"], "free", "daily") ? data["lastMode"]!.Value<string>()! : "duty",
                Spawn = spawn, DayPhase = dayPhase, ClockMinutes = clock,
                Weather = IsOneOf(data["weather"], "sunny", "overcast", "rain", "windy", "storm") ? data["weather"]!.Value<string>()! : "sunny",
                Scrapbook = scrapbook, BlacklistNextRank = nextRank, BlacklistDefeated = defeated,
                BlacklistIntroSeen = data["blacklistIntroSeen"]?.Type == JTokenType.Boolean && data["blacklistIntroSeen"]!.Value<bool>(),
                BlacklistTasks = Strings(data["blacklistTasks"]).Where(id => BlacklistTaskPattern.IsMatch(id)).Distinct().Take(30).ToList(),
                BlacklistRaceWins = raceWins,
                BlacklistBounty = (int)Math.Floor(Number(data["blacklistBounty"], 0.0, 0.0, 100_000_000.0)),
                CompletedEvents = Strings(data["completedEvents"]).Take(128).ToList(),
                Heat = Number(data["heat"], 0.0, 0.0, 5.0),
                CreatedAt = Number(data["createdAt"], now, 0.0, 9e15), UpdatedAt = Number(data["updatedAt"], now, 0.0, 9e15),
            };
        }

        public static ProgressData DeserializeAndMigrate(string json, double now)
        {
            return Sanitize(Migrate(JToken.Parse(json)), now);
        }

        public static string Serialize(ProgressData progress)
        {
            progress.Version = SaveVersion;
            return JsonConvert.SerializeObject(progress, Formatting.None);
        }

        public static double CanonicalMinutesForPhase(string phase) => phase switch
        {
            "noon" => 750.0, "golden" => 1005.0, "blue" => 1105.0, "night" => 1275.0, _ => 450.0,
        };

        private static bool IsNumber(JToken? token) => token?.Type is JTokenType.Integer or JTokenType.Float;
        private static bool IsOneOf(JToken? token, params string[] choices) => token?.Type == JTokenType.String && choices.Contains(token.Value<string>());
        private static string Slice(string value, int length) => value.Length <= length ? value : value.Substring(0, length);
        private static List<string> Strings(JToken? token) => token is JArray array ? array.Where(item => item.Type == JTokenType.String).Select(item => item.Value<string>()!).ToList() : new List<string>();

        private static double Number(JToken? token, double fallback, double minimum, double maximum)
        {
            if (!IsNumber(token)) return fallback;
            double value = token!.Value<double>();
            return double.IsFinite(value) ? Numerics.Clamp(value, minimum, maximum) : fallback;
        }
    }
}
