using System.Collections.Generic;
using BanglarTesla.Domain;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class ProgressTests
    {
        [Test]
        public void DefaultProgressMatchesReleasedCareerStart()
        {
            ProgressData progress = GameProgress.CreateDefault(1000);
            Assert.That(progress.Balance, Is.EqualTo(500));
            Assert.That(progress.Condition, Is.EqualTo(86));
            Assert.That(progress.OwnedVehicles, Is.EqualTo(new[] { "classic" }));
            Assert.That(progress.Tapes, Is.EqualTo(new[] { "cassette" }));
            Assert.That(progress.ClockMinutes, Is.EqualTo(450));
            Assert.That(progress.BlacklistNextRank, Is.EqualTo(10));
        }

        [Test]
        public void LegacyMigrationGrandfathersPreparationAndRejectsRoadsterInjection()
        {
            var raw = new JObject
            {
                ["version"] = 2, ["rides"] = 7, ["weather"] = "clear", ["blacklistNextRank"] = 6,
                ["blacklistTasks"] = new JArray("6:race", "6:escape", "invalid"),
                ["ownedVehicles"] = new JArray("roadster"), ["selectedVehicle"] = "roadster",
                ["upgrades"] = new JObject { ["brakes"] = 99 },
            };
            ProgressData progress = GameProgress.Sanitize(GameProgress.Migrate(raw), 5000);
            Assert.That(progress.Version, Is.EqualTo(5));
            Assert.That(progress.OwnedVehicles, Is.EqualTo(new[] { "classic" }));
            Assert.That(progress.SelectedVehicle, Is.EqualTo("classic"));
            Assert.That(progress.Upgrades["brakes"], Is.EqualTo(3));
            Assert.That(progress.Rep, Is.EqualTo(315));
            Assert.That(progress.BlacklistRaceWins["6"], Is.EqualTo(3));
            Assert.That(progress.BlacklistBounty, Is.EqualTo(300));
            Assert.That(progress.BlacklistTasks, Is.EqualTo(new[] { "6:race", "6:escape" }));
        }

        [Test]
        public void DefeatedRanksDeriveNextRankAndJsonRoundTrips()
        {
            var raw = new JObject
            {
                ["version"] = 5, ["blacklistDefeated"] = new JArray(10, 9, 8),
                ["scrapbook"] = new JObject { ["records"] = new JArray("kept") },
            };
            ProgressData progress = GameProgress.Sanitize(raw, 100);
            Assert.That(progress.BlacklistNextRank, Is.EqualTo(7));
            string json = GameProgress.Serialize(progress);
            ProgressData loaded = GameProgress.DeserializeAndMigrate(json, 200);
            Assert.That(loaded.BlacklistDefeated, Is.EqualTo(new[] { 10, 9, 8 }));
            Assert.That(loaded.Scrapbook["records"]![0]!.Value<string>(), Is.EqualTo("kept"));
            Assert.That(json, Does.Contain("\"blacklistNextRank\""));
        }

        [Test]
        public void CorruptPrimaryFallsBackToPreviousSuccessfulSave()
        {
            var storage = new MemoryStorage();
            var store = new SaveStore(storage);
            ProgressData progress = GameProgress.CreateDefault(1000);
            Assert.That(store.Save(progress, 1000), Is.True);
            progress.Balance = 700;
            Assert.That(store.Save(progress, 2000), Is.True);
            storage.SetItem(GameProgress.SaveKey, "{broken");
            LoadResult result = store.Load(3000);
            Assert.That(result.Recovered, Is.True);
            Assert.That(result.Progress!.Balance, Is.EqualTo(500));
            Assert.That(storage.Contains(GameProgress.SaveKey + ".corrupt.3000"), Is.True);
        }

        [Test]
        public void AutosaveThrottlesAndFlushWritesPendingState()
        {
            var storage = new MemoryStorage();
            var store = new SaveStore(storage);
            ProgressData progress = GameProgress.CreateDefault(0);
            Assert.That(store.Autosave(progress, 30_000), Is.True);
            progress.Balance = 650;
            Assert.That(store.Autosave(progress, 35_000), Is.False);
            Assert.That(GameProgress.DeserializeAndMigrate(storage.GetItem(GameProgress.SaveKey)!, 0).Balance, Is.EqualTo(500));
            store.Flush(progress, 40_000);
            Assert.That(GameProgress.DeserializeAndMigrate(storage.GetItem(GameProgress.SaveKey)!, 0).Balance, Is.EqualTo(650));
        }

        private sealed class MemoryStorage : IKeyValueStorage
        {
            private readonly Dictionary<string, string> values = new();
            public string? GetItem(string key) => values.TryGetValue(key, out string? value) ? value : null;
            public void SetItem(string key, string value) => values[key] = value;
            public void RemoveItem(string key) => values.Remove(key);
            public bool Contains(string key) => values.ContainsKey(key);
        }
    }
}
