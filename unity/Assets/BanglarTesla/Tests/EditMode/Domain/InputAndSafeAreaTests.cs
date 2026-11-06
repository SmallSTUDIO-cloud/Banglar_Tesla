using BanglarTesla.Domain;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class InputAndSafeAreaTests
    {
        [Test]
        public void ReleasingOneFingerDoesNotReleaseAnotherFinger()
        {
            var input = new DrivingInputState();
            input.Press(HudControlId.Pedal, 1);
            input.Press(HudControlId.SteerLeft, 2);
            input.Release(HudControlId.SteerLeft, 2);
            Assert.That(input.ToDriveInput().Throttle, Is.EqualTo(1.0));
            Assert.That(input.ToDriveInput().Steer, Is.Zero);
        }

        [Test]
        public void WrongPointerCannotReleaseOrStealAControl()
        {
            var input = new DrivingInputState();
            Assert.That(input.Press(HudControlId.Brake, 4), Is.True);
            Assert.That(input.Press(HudControlId.Brake, 5), Is.False);
            Assert.That(input.Release(HudControlId.Brake, 5), Is.False);
            Assert.That(input.IsPressed(HudControlId.Brake), Is.True);
            input.CancelPointer(4);
            Assert.That(input.IsPressed(HudControlId.Brake), Is.False);
        }

        [Test]
        public void FocusLossEquivalentReleasesTurboPedalAndSteering()
        {
            var input = new DrivingInputState();
            input.Press(HudControlId.Pedal, 1);
            input.Press(HudControlId.Turbo, 2);
            input.Press(HudControlId.SteerRight, 3);
            input.ReleaseAll();
            DriveInput drive = input.ToDriveInput();
            Assert.That(drive.Throttle, Is.Zero);
            Assert.That(drive.Steer, Is.Zero);
            Assert.That(drive.Turbo, Is.False);
        }

        [Test]
        public void AndroidCutoutConvertsToTopLeftLogicalCoordinates()
        {
            var screen = new LogicalRect(0, 0, 2400, 1080);
            var safe = new LogicalRect(120, 0, 2280, 1080);
            var panel = new LogicalRect(0, 0, 1200, 540);
            LogicalRect result = SafeAreaCalculator.ToLogicalPanel(screen, safe, panel);
            Assert.That(result.X, Is.EqualTo(60).Within(1e-9));
            Assert.That(result.Width, Is.EqualTo(1140).Within(1e-9));
            Assert.That(result.Y, Is.Zero);
        }
    }
}
