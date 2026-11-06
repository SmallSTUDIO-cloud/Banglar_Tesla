using System;
using System.Collections.Generic;
using System.Globalization;

namespace BanglarTesla.Domain
{
    public sealed class TimeEventRegistration
    {
        public string Id = string.Empty;
        public int TriggerMinute;
        public Action<int, string>? Callback;
    }

    public static class TimeOfDay
    {
        public const double DefaultStartMinutes = 450.0;
        public static string PhaseForMinutes(double minutes)
        {
            double value = Numerics.NormalizeMinutes(minutes);
            if (value >= 330.0 && value < 630.0) return "morning";
            if (value >= 630.0 && value < 960.0) return "noon";
            if (value >= 960.0 && value < 1080.0) return "golden";
            if (value >= 1080.0 && value < 1170.0) return "blue";
            return "night";
        }

        public static string FormatGameClock(double minutes)
        {
            int whole = (int)Math.Floor(Numerics.NormalizeMinutes(minutes));
            int hour24 = whole / 60 % 24;
            int minute = whole % 60;
            int hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12;
            return string.Format(CultureInfo.InvariantCulture, "{0:00}:{1:00} {2}", hour12, minute, hour24 >= 12 ? "PM" : "AM");
        }
    }

    public sealed class GameTimeSystem
    {
        private readonly List<TimeEventRegistration> events = new();
        private double minutes, ratePerSecond;
        private int cachedWholeMinute = -1, lastHour = -1;
        private string cachedFormatted = "07:30 AM", currentPhase;

        public GameTimeSystem(double initialMinutes = 450.0, double ratePerSecond = 0.5)
        {
            minutes = Numerics.NormalizeMinutes(initialMinutes);
            this.ratePerSecond = Math.Max(0.0, ratePerSecond);
            currentPhase = TimeOfDay.PhaseForMinutes(minutes);
            SyncCache();
        }

        public double MinutesOfDay => minutes;
        public int WholeMinute => cachedWholeMinute;
        public string Formatted => cachedFormatted;
        public string Phase => currentPhase;
        public bool IsNight => currentPhase is "night" or "blue";
        public event Action<string, double>? PhaseChanged;
        public event Action<int, string>? HourChanged;

        public void SetRate(double value)
        {
            if (double.IsFinite(value) && value >= 0.0) ratePerSecond = value;
        }

        public void SetMinutes(double value, bool silent = false)
        {
            minutes = Numerics.NormalizeMinutes(value);
            string previous = currentPhase;
            currentPhase = TimeOfDay.PhaseForMinutes(minutes);
            SyncCache();
            if (!silent && currentPhase != previous) PhaseChanged?.Invoke(currentPhase, minutes);
        }

        public void SyncToPhase(string phase, bool silent = false)
        {
            if (currentPhase == phase) return;
            SetMinutes(GameProgress.CanonicalMinutesForPhase(phase), silent);
        }

        public Action RegisterEvent(TimeEventRegistration registration)
        {
            events.Add(registration);
            return () => events.Remove(registration);
        }

        public bool Update(double dt)
        {
            if (!double.IsFinite(dt) || dt <= 0.0 || ratePerSecond <= 0.0) return false;
            int previousMinute = cachedWholeMinute;
            minutes = Numerics.NormalizeMinutes(minutes + dt * ratePerSecond);
            bool changed = (int)Math.Floor(minutes) != previousMinute;
            if (!changed) return false;
            SyncCache();
            string nextPhase = TimeOfDay.PhaseForMinutes(minutes);
            if (nextPhase != currentPhase)
            {
                currentPhase = nextPhase;
                PhaseChanged?.Invoke(currentPhase, minutes);
            }
            int hour = cachedWholeMinute / 60;
            if (hour != lastHour)
            {
                lastHour = hour;
                HourChanged?.Invoke(hour, currentPhase);
            }
            foreach (TimeEventRegistration registration in events)
                if (registration.TriggerMinute == cachedWholeMinute)
                    registration.Callback?.Invoke(cachedWholeMinute, currentPhase);
            return true;
        }

        private void SyncCache()
        {
            int whole = (int)Math.Floor(minutes);
            if (whole == cachedWholeMinute) return;
            cachedWholeMinute = whole;
            cachedFormatted = TimeOfDay.FormatGameClock(whole);
            lastHour = whole / 60;
        }
    }
}
