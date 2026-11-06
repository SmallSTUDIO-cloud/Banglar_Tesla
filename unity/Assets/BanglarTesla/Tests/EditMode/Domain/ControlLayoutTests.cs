using System;
using System.Linq;
using BanglarTesla.Domain;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class ControlLayoutTests
    {
        [Test]
        public void DefaultsContainEveryControlOnce()
        {
            ControlLayoutData layout = ControlLayoutDefaults.Create();
            Assert.That(layout.Controls, Has.Count.EqualTo(HudControls.All.Count));
            Assert.That(layout.Controls.Select(control => control.Id).Distinct().Count(), Is.EqualTo(HudControls.All.Count));
            Assert.That(ControlLayoutEngine.CountOverlaps(layout, new LogicalRect(0, 0, 1568, 720)), Is.Zero);
        }

        [Test]
        public void SanitizerClampsNumbersAndIgnoresUnknownOrDuplicateControls()
        {
            ControlLayoutData layout = ControlLayoutDefaults.Create();
            layout.GlobalScale = float.NaN;
            layout.Opacity = -10.0f;
            layout.Controls[0].X = double.PositiveInfinity;
            layout.Controls[0].Scale = 99.0f;
            layout.Controls.Add(layout.Controls[1].Clone());
            layout.Controls.Add(new ControlPlacement { Id = "injected", X = -10, Y = -10 });
            ControlLayoutData clean = ControlLayoutSanitizer.Sanitize(layout);
            Assert.That(clean.GlobalScale, Is.EqualTo(1.0f));
            Assert.That(clean.Opacity, Is.EqualTo(0.45f));
            Assert.That(clean.Controls, Has.Count.EqualTo(HudControls.All.Count));
            Assert.That(clean.Controls[0].Scale, Is.EqualTo(1.6f));
            Assert.That(clean.Controls.Any(control => control.Id == "injected"), Is.False);
        }

        [Test]
        public void HandednessMirrorsOnlyDrivingControlsAndIsReversible()
        {
            ControlLayoutData layout = ControlLayoutDefaults.Create();
            double pedal = layout.Controls.Single(control => control.Id == nameof(HudControlId.Pedal)).X;
            double pause = layout.Controls.Single(control => control.Id == nameof(HudControlId.Pause)).X;
            ControlLayoutSanitizer.SetHandedness(layout, true);
            Assert.That(layout.Controls.Single(control => control.Id == nameof(HudControlId.Pedal)).X, Is.EqualTo(1.0 - pedal).Within(1e-12));
            Assert.That(layout.Controls.Single(control => control.Id == nameof(HudControlId.Pause)).X, Is.EqualTo(pause));
            ControlLayoutSanitizer.SetHandedness(layout, false);
            Assert.That(layout.Controls.Single(control => control.Id == nameof(HudControlId.Pedal)).X, Is.EqualTo(pedal).Within(1e-12));
        }

        [Test]
        public void EveryControlStaysInsidePortraitSafeArea()
        {
            ControlLayoutData layout = ControlLayoutDefaults.Create();
            var safe = new LogicalRect(12, 44, 366, 752);
            foreach (ControlPlacement control in layout.Controls)
            {
                HudControlDefinition definition = HudControls.Get(Enum.Parse<HudControlId>(control.Id));
                LogicalRect rect = ControlLayoutEngine.ComputeRect(control, definition, safe, layout.GlobalScale);
                Assert.That(rect.X, Is.GreaterThanOrEqualTo(safe.X - 1e-9), control.Id);
                Assert.That(rect.Y, Is.GreaterThanOrEqualTo(safe.Y - 1e-9), control.Id);
                Assert.That(rect.Right, Is.LessThanOrEqualTo(safe.Right + 1e-9), control.Id);
                Assert.That(rect.Bottom, Is.LessThanOrEqualTo(safe.Bottom + 1e-9), control.Id);
            }
        }

        [Test]
        public void DragSnapsAndStoresTheClampedPosition()
        {
            ControlPlacement placement = ControlLayoutDefaults.Create().Controls.Single(control => control.Id == nameof(HudControlId.Pedal));
            HudControlDefinition definition = HudControls.Get(HudControlId.Pedal);
            var safe = new LogicalRect(0, 0, 1280, 720);
            LogicalRect rect = ControlLayoutEngine.MoveControl(placement, definition, 2000, 360, safe, 1.0f);
            Assert.That(rect.Right, Is.EqualTo(safe.Right).Within(1e-9));
            Assert.That(placement.X, Is.EqualTo((rect.CenterX - safe.X) / safe.Width).Within(1e-12));
        }
    }
}
