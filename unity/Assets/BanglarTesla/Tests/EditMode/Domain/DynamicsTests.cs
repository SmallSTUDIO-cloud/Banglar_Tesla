using System;
using BanglarTesla.Domain;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class DynamicsTests
    {
        private const double Dt = 1.0 / 60.0;

        [Test]
        public void PedalAcceleratesAndRemainsBelowDerivedCap()
        {
            var vehicle = new RickshawDynamics();
            for (int i = 0; i < 600; i++) vehicle.Step(Dt, new DriveInput { Throttle = 1.0 });
            Assert.That(vehicle.Speed, Is.GreaterThan(4.0));
            Assert.That(vehicle.Speed, Is.LessThanOrEqualTo(5.650001));
            Assert.That(vehicle.DistanceDriven, Is.GreaterThan(20.0));
        }

        [Test]
        public void BrakeStopsThenHoldEngagesReverse()
        {
            var vehicle = new RickshawDynamics { Speed = 4.0 };
            for (int i = 0; i < 90; i++) vehicle.Step(Dt, new DriveInput { Brake = 1.0 });
            Assert.That(vehicle.Speed, Is.LessThan(0.0));
            Assert.That(vehicle.Speed, Is.GreaterThanOrEqualTo(-RickshawDynamics.MaxReverse));
        }

        [Test]
        public void RightSteeringDecreasesYaw()
        {
            var vehicle = new RickshawDynamics();
            vehicle.Reset(0, 0, 1.0);
            for (int i = 0; i < 90; i++) vehicle.Step(Dt, new DriveInput { Throttle = 1.0 });
            double yaw = vehicle.Yaw;
            for (int i = 0; i < 30; i++) vehicle.Step(Dt, new DriveInput { Throttle = 1.0, Steer = 1.0 });
            Assert.That(vehicle.Yaw, Is.LessThan(yaw));
        }

        [Test]
        public void TurboIsHoldToBoostAndSeparateFromStamina()
        {
            var vehicle = new RickshawDynamics();
            int engageEvents = 0;
            vehicle.TurboStateChanged += (active, reason) => { if (active && reason == TurboChangeReason.Engage) engageEvents++; };
            for (int i = 0; i < 120; i++) vehicle.Step(Dt, new DriveInput { Throttle = 1.0, Turbo = true });
            Assert.That(vehicle.TurboActive, Is.True);
            Assert.That(vehicle.TurboCharge, Is.LessThan(55.0));
            Assert.That(vehicle.Stamina, Is.EqualTo(100.0).Within(1e-9));
            vehicle.Step(Dt, new DriveInput { Throttle = 1.0 });
            Assert.That(vehicle.TurboActive, Is.False);
            vehicle.ForceStopTurbo();
            Assert.That(engageEvents, Is.EqualTo(1));
        }

        [Test]
        public void PedalBoostConsumesThenRecoversStamina()
        {
            var vehicle = new RickshawDynamics();
            Assert.That(vehicle.SetTanActive(true), Is.True);
            for (int i = 0; i < 60; i++) vehicle.Step(Dt, new DriveInput { Throttle = 1.0 });
            Assert.That(vehicle.Stamina, Is.LessThan(100.0));
            vehicle.SetTanActive(false);
            for (int i = 0; i < 120; i++) vehicle.Step(Dt, new DriveInput());
            Assert.That(vehicle.Stamina, Is.GreaterThan(90.0));
        }

        [Test]
        public void CircleObbContactHasOutwardNormalAndNoFalsePositive()
        {
            ObbHitResult hit = RickshawCollision.TestCircleVsObb(0, 0, 0.5, 0, 0, 1, 1, 0);
            Assert.That(hit.Hit, Is.True);
            Assert.That(hit.NormalX, Is.EqualTo(-1.0).Within(1e-12));
            Assert.That(hit.PushX, Is.LessThan(-1.0));
            Assert.That(RickshawCollision.TestCircleVsObb(4, 4, 0.5, 0, 0, 1, 1, 0).Hit, Is.False);
        }

        [Test]
        public void InvalidPhysicsDeltaFailsClosed()
        {
            var vehicle = new RickshawDynamics();
            Assert.Throws<ArgumentOutOfRangeException>(() => vehicle.Step(double.NaN, default));
            Assert.Throws<ArgumentOutOfRangeException>(() => vehicle.Step(0, default));
        }
    }
}
