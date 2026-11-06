using BanglarTesla.Domain;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class TimeWeatherScoreTests
    {
        [Test]
        public void ClockFormatsAndUsesReleasedPhaseBoundaries()
        {
            Assert.That(TimeOfDay.FormatGameClock(450), Is.EqualTo("07:30 AM"));
            Assert.That(TimeOfDay.FormatGameClock(1110), Is.EqualTo("06:30 PM"));
            Assert.That(TimeOfDay.PhaseForMinutes(330), Is.EqualTo("morning"));
            Assert.That(TimeOfDay.PhaseForMinutes(630), Is.EqualTo("noon"));
            Assert.That(TimeOfDay.PhaseForMinutes(960), Is.EqualTo("golden"));
            Assert.That(TimeOfDay.PhaseForMinutes(1080), Is.EqualTo("blue"));
            Assert.That(TimeOfDay.PhaseForMinutes(1170), Is.EqualTo("night"));
        }

        [Test]
        public void MinuteEventFiresOnlyWhenCrossed()
        {
            var time = new GameTimeSystem(449.99, 0.5);
            int calls = 0;
            time.RegisterEvent(new TimeEventRegistration { TriggerMinute = 450, Callback = (_, _) => calls++ });
            Assert.That(time.Update(0.04), Is.True);
            Assert.That(calls, Is.EqualTo(1));
            Assert.That(time.Update(0.01), Is.False);
            Assert.That(calls, Is.EqualTo(1));
        }

        [Test]
        public void WeatherTransitionsGraduallyThenCompletes()
        {
            var weather = new WeatherDirector(WeatherKind.Sunny, () => 0.0);
            var context = new WeatherContext { TimeMinutes = 720 };
            Assert.That(weather.Update(1, context), Is.False);
            Assert.That(weather.IsTransitioning, Is.True);
            Assert.That(weather.Update(31, context), Is.True);
            Assert.That(weather.Weather, Is.EqualTo(WeatherKind.Overcast));
            Assert.That(weather.Blend.Overcast, Is.EqualTo(0.55));
        }

        [Test]
        public void FinalRaceStretchSuppressesUnauthoredStorm()
        {
            var weather = new WeatherDirector(WeatherKind.Windy, () => 0.999);
            var context = new WeatherContext { TimeMinutes = 720, InRace = true, RaceFinalStretch = true };
            weather.Update(1, context);
            weather.Update(31, context);
            Assert.That(weather.Weather, Is.Not.EqualTo(WeatherKind.Storm));
        }

        [Test]
        public void LightningStillHasIntensityWhenFlashIsDisabled()
        {
            var weather = new WeatherDirector(WeatherKind.Sunny, () => 0.0);
            bool? flashAllowed = null;
            weather.Lightning += (_, allowed) => flashAllowed = allowed;
            weather.SetWeatherImmediate(WeatherKind.Storm);
            weather.Update(4.1, new WeatherContext { LowFlash = true, EventOverride = true });
            Assert.That(flashAllowed, Is.False);
        }

        [Test]
        public void ComboPointsAndDecayMatchReleasedRules()
        {
            var score = new ScoreSystem();
            StuntEvent last = default;
            score.Stunt += value => last = value;
            score.Register(StuntKind.NearMiss);
            Assert.That(last.Points, Is.EqualTo(12));
            score.Register(StuntKind.Drift);
            Assert.That(last.Points, Is.EqualTo(18));
            Assert.That(last.Combo, Is.EqualTo(2));
            score.Update(7, default);
            Assert.That(score.CurrentCombo, Is.Zero);
            Assert.That(score.Best, Is.EqualTo(2));
        }

        [Test]
        public void SafeDetourRequiresTimeDistanceAndCleanRoute()
        {
            var detour = new SafeDetourProgress();
            detour.Arm(0);
            bool paid = false;
            for (int i = 0; i < 100 && !paid; i++) paid = detour.Advance(0.1, 2, 0, false, true);
            Assert.That(paid, Is.True);
            Assert.That(detour.Advance(0.1, 2, 0, false, true), Is.False);
            var failed = new SafeDetourProgress();
            failed.Arm(0);
            Assert.That(failed.Advance(0.1, 1, 0, true, true), Is.False);
            Assert.That(failed.Failed, Is.True);
        }
    }
}
