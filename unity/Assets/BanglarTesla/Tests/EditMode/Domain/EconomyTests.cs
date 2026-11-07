using System.Collections.Generic;
using BanglarTesla.Domain;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class EconomyTests
    {
        [Test]
        public void FareMatchesReleasedFormula()
        {
            FareBreakdown fare = Economy.ComputeFare(420, 60, 60, 88, 0, 1.25, 12);
            // Assert.Multiple is NUnit 3.7+; Unity's bundled NUnit is 3.5, so the
            // assertions run sequentially. Every assertion is still executed on a
            // passing run; only the aggregate-failure-reporting behaviour differs.
            Assert.That(fare.Base, Is.EqualTo(30));
            Assert.That(fare.Distance, Is.EqualTo(92));
            Assert.That(fare.Time, Is.EqualTo(20));
            Assert.That(fare.Smooth, Is.EqualTo(19));
            Assert.That(fare.Tip, Is.EqualTo(21));
            Assert.That(fare.Total, Is.EqualTo(243));
            Assert.That(fare.Stars, Is.EqualTo(5));
            Assert.That(fare.OnTime, Is.True);
        }

        [Test]
        public void DamageCannotProduceNegativeFareAndRepairHasOnePointThreshold()
        {
            FareBreakdown fare = Economy.ComputeFare(0, 500, 10, 0, 100, 0);
            Assert.That(fare.Total, Is.Zero);
            Assert.That(fare.Stars, Is.EqualTo(1));
            Assert.That(Economy.RepairCost(80), Is.EqualTo(44));
            Assert.That(Economy.RepairCost(99.5), Is.Zero);
            Assert.That(Economy.RepairCost(-10), Is.EqualTo(220));
        }

        [Test]
        public void DriverLevelsUseReleasedThresholds()
        {
            Assert.That(Economy.LevelForRides(0).Level, Is.EqualTo(1));
            Assert.That(Economy.LevelForRides(0).NextAt, Is.EqualTo(5));
            Assert.That(Economy.LevelForRides(5).TitleKey, Is.EqualTo("title.regular"));
            Assert.That(Economy.LevelForRides(25).Level, Is.EqualTo(4));
            Assert.That(Economy.LevelForRides(100).NextAt, Is.Null);
        }

        [Test]
        public void DefaultClassicTuningMatchesRideConstants()
        {
            VehicleTuning tuning = Economy.DeriveTuning(VehicleCatalog.VehicleById("classic"), null, 100);
            Assert.That(tuning.MaxSpeed, Is.EqualTo(5.65).Within(1e-12));
            Assert.That(tuning.Accel, Is.EqualTo(2.95).Within(1e-12));
            Assert.That(tuning.BrakeDecel, Is.EqualTo(5.4).Within(1e-12));
            Assert.That(tuning.Grip, Is.EqualTo(0.64).Within(1e-12));
            Assert.That(tuning.IsElectric, Is.False);
        }

        [Test]
        public void WetWeatherUpgradesHaveMeasurableEffects()
        {
            VehicleDefinition electric = VehicleCatalog.VehicleById("electric");
            var basic = new Dictionary<string, int>();
            var upgraded = new Dictionary<string, int> { ["sealedDrive"] = 2, ["tyres"] = 3, ["efficiency"] = 3 };
            VehicleTuning before = Economy.DeriveTuning(electric, basic, 100, 1);
            VehicleTuning after = Economy.DeriveTuning(electric, upgraded, 100, 1);
            Assert.That(after.Accel, Is.GreaterThan(before.Accel));
            Assert.That(after.Grip, Is.GreaterThan(before.Grip));
            Assert.That(after.BatteryDrainMultiplier, Is.EqualTo(0.52).Within(1e-12));
            Assert.That(after.RegenFactor, Is.EqualTo(0.45).Within(1e-12));
        }

        [Test]
        public void PurchaseGuardsRejectInvalidTransactions()
        {
            Assert.That(Economy.CanAfford(100, 100), Is.True);
            Assert.That(Economy.CanAfford(99, 100), Is.False);
            Assert.That(Economy.CanAfford(double.NaN, 100), Is.False);
            Assert.That(Economy.CanAfford(100, -1), Is.False);
            UpgradeDefinition definition = VehicleCatalog.UpgradeById("brakes")!;
            Assert.That(Economy.UpgradePrice(definition, 0), Is.EqualTo(280));
            Assert.That(Economy.UpgradePrice(definition, 3), Is.EqualTo(-1));
        }
    }
}
