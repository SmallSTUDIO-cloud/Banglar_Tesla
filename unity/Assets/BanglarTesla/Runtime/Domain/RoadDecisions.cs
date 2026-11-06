using System;

namespace BanglarTesla.Domain
{
    public sealed class SafeDetourProgress
    {
        private double distance, time;
        private int initialHits;
        private bool armed, failed, paid;
        public bool Paid => paid;
        public bool Failed => failed;
        public void Reset() { distance = time = 0.0; initialHits = 0; armed = failed = paid = false; }
        public void Arm(int hits)
        {
            if (armed || failed || paid) return;
            armed = true; initialHits = hits;
        }
        public void Disqualify() => failed = true;
        public bool Advance(double dt, double travelled, int hits, bool onSidewalk, bool validRoute)
        {
            if (!armed || paid || failed || !validRoute) return false;
            if (onSidewalk || hits > initialHits) { failed = true; return false; }
            if (!double.IsFinite(dt) || !double.IsFinite(travelled) || dt <= 0.0 || travelled < 0.0) return false;
            double step = Math.Min(dt, 0.1);
            time += step;
            distance += Math.Min(20.0 * step, travelled);
            if (time < 8.0 || distance < 35.0) return false;
            paid = true;
            return true;
        }
    }

    public static class RoadDecisions
    {
        public static bool IsUnsafeClosePass(double speed, double distanceSquared, double vehicleHalfWidth, double cooldown)
        {
            double threshold = vehicleHalfWidth + 1.35;
            return cooldown <= 0.0 && double.IsFinite(distanceSquared) && Math.Abs(speed) >= 5.2 && distanceSquared < threshold * threshold;
        }
        public static int ContextualCareBonus(string? goal, bool wet, double mood, int impacts, int hardBrakes) =>
            goal != "rain" || !wet || mood < 75.0 || impacts > 0 || hardBrakes > 1 ? 0 : 12;
    }
}
