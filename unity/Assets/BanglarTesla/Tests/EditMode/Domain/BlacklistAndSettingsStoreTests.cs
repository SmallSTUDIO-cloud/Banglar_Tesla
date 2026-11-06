using System.Collections.Generic;
using BanglarTesla.Domain;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class BlacklistAndSettingsStoreTests
    {
        [Test]
        public void ChecklistRequiresEveryActiveTierPreparation()
        {
            ProgressData progress = GameProgress.CreateDefault(0);
            progress.BlacklistNextRank = 6;
            progress.Rep = 900;
            progress.BlacklistRaceWins["6"] = 3;
            progress.BlacklistBounty = 300;
            progress.BlacklistTasks.Add("6:race");
            progress.BlacklistTasks.Add("6:fare");
            BlacklistChecklist checklist = BlacklistRequirements.Checklist(progress, 6, 800);
            Assert.That(checklist.Ready, Is.False);
            progress.BlacklistTasks.Add("6:escape");
            checklist = BlacklistRequirements.Checklist(progress, 6, 800);
            Assert.That(checklist.Ready, Is.True);
            Assert.That(checklist.RaceTarget, Is.EqualTo(3));
            Assert.That(checklist.BountyTarget, Is.EqualTo(300));
        }

        [Test]
        public void SettingsPersistControlLayoutIndependentlyFromProgress()
        {
            var storage = new MemoryStorage();
            var store = new SettingsStore(storage);
            store.Update(settings =>
            {
                settings.Language = "en";
                settings.HudScale = 1.15f;
                settings.ControlLayout.Controls[0].X = 0.25;
            });
            var reloaded = new SettingsStore(storage);
            Assert.That(reloaded.Value.Language, Is.EqualTo("en"));
            Assert.That(reloaded.Value.HudScale, Is.EqualTo(1.15f).Within(1e-6));
            Assert.That(reloaded.Value.ControlLayout.GlobalScale, Is.EqualTo(1.15f).Within(1e-6));
            Assert.That(reloaded.Value.ControlLayout.Controls[0].X, Is.EqualTo(0.25).Within(1e-12));
            Assert.That(storage.GetItem(SettingsStore.SettingsKey), Does.Contain("\"controlLayout\""));
        }

        private sealed class MemoryStorage : IKeyValueStorage
        {
            private readonly Dictionary<string, string> values = new();
            public string? GetItem(string key) => values.TryGetValue(key, out string? value) ? value : null;
            public void SetItem(string key, string value) => values[key] = value;
            public void RemoveItem(string key) => values.Remove(key);
        }
    }
}
