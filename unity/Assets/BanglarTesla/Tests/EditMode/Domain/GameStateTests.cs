using System.Collections.Generic;
using BanglarTesla.Domain;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class GameStateTests
    {
        [Test]
        public void UpgradePurchaseIsAtomicAndSecondLevelHonorsPriceAndFunds()
        {
            GameState state = NewState();
            PurchaseResult bought = state.BuyUpgrade("brakes");
            Assert.That(bought.Ok, Is.True);
            Assert.That(state.Balance, Is.EqualTo(220));
            Assert.That(state.UpgradeLevel("brakes"), Is.EqualTo(1));
            PurchaseResult insufficient = state.BuyUpgrade("brakes");
            Assert.That(insufficient.Reason, Is.EqualTo(PurchaseFailure.Insufficient));
            Assert.That(insufficient.Shortage, Is.EqualTo(460));
            Assert.That(state.UpgradeLevel("brakes"), Is.EqualTo(1));
            Assert.That(state.Balance, Is.EqualTo(220));
        }

        [Test]
        public void LockedUpgradeAndComingSoonVehicleCannotBeBought()
        {
            GameState state = NewState(5000);
            Assert.That(state.BuyUpgrade("sealedDrive").Reason, Is.EqualTo(PurchaseFailure.Locked));
            Assert.That(state.BuyVehicle("roadster").Reason, Is.EqualTo(PurchaseFailure.ComingSoon));
            Assert.That(state.Balance, Is.EqualTo(5000));
        }

        [Test]
        public void VehicleAndCosmeticPurchasesEquipWithoutDoubleSpending()
        {
            GameState state = NewState(5000);
            Assert.That(state.BuyVehicle("electric").Ok, Is.True);
            Assert.That(state.Progress.SelectedVehicle, Is.EqualTo("electric"));
            Assert.That(state.BuyVehicle("electric").Reason, Is.EqualTo(PurchaseFailure.Owned));
            Assert.That(state.BuyCosmetic("paint.red").Ok, Is.True);
            Assert.That(state.Progress.Cosmetics["paint"], Is.EqualTo("paint.red"));
            Assert.That(state.Balance, Is.EqualTo(1580));
            Assert.That(state.EquipCosmetic("", CosmeticCategory.Paint).Ok, Is.True);
            Assert.That(state.Progress.Cosmetics["paint"], Is.Empty);
        }

        [Test]
        public void RideRecordsFarePreparationRewardsAndAchievements()
        {
            GameState state = NewState();
            state.RecordRide(new RideCompletion(200, 500, 90, 0, "duty", true));
            Assert.That(state.Progress.Rides, Is.EqualTo(1));
            Assert.That(state.Balance, Is.EqualTo(700));
            Assert.That(state.Rep, Is.EqualTo(100));
            Assert.That(state.Progress.BlacklistTasks, Does.Contain("10:fare"));
            Assert.That(state.Progress.Achievements, Does.Contain("ach.firstRide"));
            Assert.That(state.Progress.Achievements, Does.Contain("ach.cleanRun"));
            Assert.That(state.Progress.Achievements, Does.Contain("ach.rainRide"));
        }

        [Test]
        public void BossVictoryValidatesEventAndPaysOnlyOnce()
        {
            GameState state = NewState(500, new FakeRivalCatalog());
            state.Progress.BlacklistRaceWins["10"] = 1;
            state.Progress.BlacklistTasks.Add("10:race");
            state.Progress.BlacklistTasks.Add("10:fare");
            Assert.That(state.RecordEventVictory("wrong", 260, 120, 10), Is.False);
            Assert.That(state.RecordEventVictory("bl_boss_10", 260, 120, 10), Is.True);
            Assert.That(state.Balance, Is.EqualTo(760));
            Assert.That(state.Progress.BlacklistNextRank, Is.EqualTo(9));
            Assert.That(state.RecordEventVictory("bl_boss_10", 260, 120, 10), Is.False);
            Assert.That(state.Balance, Is.EqualTo(760));
        }

        private static GameState NewState(int balance = 500, IRivalProgressionCatalog? catalog = null)
        {
            double now = 1000;
            var state = new GameState(null, () => now, catalog);
            state.Progress.Balance = balance;
            return state;
        }

        private sealed class FakeRivalCatalog : IRivalProgressionCatalog
        {
            public bool TryGetRival(int rank, out RivalProgressionInfo info)
            {
                info = new RivalProgressionInfo("bl_boss_10", 0);
                return rank == 10;
            }
            public bool IsOpenStreetEvent(string eventId) => eventId == "open_race";
        }
    }
}
