using BanglarTesla.Domain;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class SettingsTests
    {
        [Test]
        public void InvalidValuesFallBackOrClampWithoutRescalingRepeatedly()
        {
            SettingsData settings = SettingsData.CreateDefault();
            settings.Quality = "invented";
            settings.RenderScale = 10;
            settings.Deadzone = -2;
            settings.FpsTarget = 15;
            settings.HudScale = 1.2f;
            settings.ControlLayout = ControlLayoutDefaults.Create(true);
            SettingsData clean = SettingsData.Sanitize(settings);
            Assert.That(clean.Quality, Is.EqualTo("balanced"));
            Assert.That(clean.RenderScale, Is.EqualTo(1.2f));
            Assert.That(clean.Deadzone, Is.Zero);
            Assert.That(clean.FpsTarget, Is.EqualTo(60));
            Assert.That(clean.Handedness, Is.EqualTo("left"));
            Assert.That(clean.ControlLayout.GlobalScale, Is.EqualTo(1.2f));
            SettingsData again = SettingsData.Sanitize(clean);
            Assert.That(again.ControlLayout.GlobalScale, Is.EqualTo(1.2f));
        }

        [Test]
        public void MissingSourceUsesSuppliedLegacyBaseline()
        {
            SettingsData baseline = SettingsData.CreateDefault();
            baseline.Quality = "high";
            baseline.Language = "en";
            baseline.HudScale = 1.1f;
            SettingsData clean = SettingsData.Sanitize(null, baseline);
            Assert.That(clean.Quality, Is.EqualTo("high"));
            Assert.That(clean.Language, Is.EqualTo("en"));
            Assert.That(clean.HudScale, Is.EqualTo(1.1f));
        }
    }
}
