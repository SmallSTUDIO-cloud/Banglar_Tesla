using System;
using System.Collections.Generic;

namespace BanglarTesla.Domain
{
    public enum WeatherKind { Sunny, Overcast, Rain, Windy, Storm }

    public static class WeatherKinds
    {
        public static string Key(WeatherKind weather) => weather.ToString().ToLowerInvariant();
        public static WeatherKind Parse(string? value) => value switch
        {
            "overcast" => WeatherKind.Overcast, "rain" => WeatherKind.Rain,
            "windy" => WeatherKind.Windy, "storm" => WeatherKind.Storm, _ => WeatherKind.Sunny,
        };
    }

    [Serializable]
    public sealed class WeatherBlend
    {
        public double Overcast, Wet, Wind, Rain, Lightning;
        public WeatherBlend Clone() => new() { Overcast = Overcast, Wet = Wet, Wind = Wind, Rain = Rain, Lightning = Lightning };
        public void CopyFrom(WeatherBlend other)
        { Overcast = other.Overcast; Wet = other.Wet; Wind = other.Wind; Rain = other.Rain; Lightning = other.Lightning; }
    }

    public struct WeatherContext
    {
        public double TimeMinutes;
        public bool InRace, RaceFinalStretch, EventOverride, ReduceEffects, LowFlash;
    }

    public sealed class WeatherDirector
    {
        private static readonly WeatherBlend[] Targets =
        {
            new() { Overcast = 0, Wet = 0, Wind = 0.15, Rain = 0, Lightning = 0 },
            new() { Overcast = 0.55, Wet = 0.12, Wind = 0.38, Rain = 0, Lightning = 0 },
            new() { Overcast = 0.72, Wet = 1, Wind = 0.82, Rain = 1, Lightning = 0 },
            new() { Overcast = 0.18, Wet = 0, Wind = 1.0, Rain = 0, Lightning = 0 },
            new() { Overcast = 1, Wet = 1, Wind = 1.35, Rain = 1, Lightning = 1 },
        };
        private static readonly (double Low, double High)[] HoldSeconds = { (110, 240), (90, 200), (80, 170), (80, 170), (60, 120) };
        private static readonly WeatherKind[][] Neighbours =
        {
            new[] { WeatherKind.Overcast, WeatherKind.Windy },
            new[] { WeatherKind.Sunny, WeatherKind.Rain, WeatherKind.Windy },
            new[] { WeatherKind.Overcast, WeatherKind.Storm, WeatherKind.Windy },
            new[] { WeatherKind.Sunny, WeatherKind.Overcast, WeatherKind.Storm },
            new[] { WeatherKind.Rain, WeatherKind.Windy },
        };
        private readonly Func<double> rng;
        private WeatherKind current;
        private double holdTimer, blendTimer, blendRate = 0.055, lightningTimer = 4.0, stormStrikeCount;
        private WeatherKind? transitioningTo;

        public WeatherDirector(WeatherKind initial = WeatherKind.Sunny, Func<double>? rng = null)
        {
            current = initial;
            this.rng = rng ?? new Random().NextDouble;
            Blend = TargetBlendFor(initial);
        }

        public WeatherBlend Blend { get; }
        public WeatherKind Weather => current;
        public bool IsTransitioning => transitioningTo.HasValue;
        public event Action<WeatherKind>? WeatherChanged;
        public event Action<double, bool>? Lightning;

        public static WeatherBlend TargetBlendFor(WeatherKind weather) => Targets[(int)weather].Clone();

        private WeatherKind PickNext(WeatherContext context)
        {
            double hour = context.TimeMinutes / 60.0;
            var candidates = new List<(WeatherKind Kind, double Weight)>();
            foreach (WeatherKind candidate in Neighbours[(int)current])
            {
                double weight = 1.0;
                if (candidate == WeatherKind.Sunny) weight += hour >= 6.0 && hour <= 16.0 ? 1.2 : 0.25;
                if (candidate == WeatherKind.Overcast) weight += 0.8;
                if (candidate == WeatherKind.Windy) weight += 0.45;
                if (candidate == WeatherKind.Rain) weight += hour >= 14.0 ? 0.9 : 0.3;
                if (candidate == WeatherKind.Storm)
                {
                    if (context.RaceFinalStretch && !context.EventOverride) continue;
                    weight += hour >= 15.0 && hour <= 21.0 ? 0.22 : 0.06;
                }
                if (context.InRace && !context.EventOverride && candidate is WeatherKind.Storm or WeatherKind.Rain) weight *= 0.35;
                candidates.Add((candidate, weight));
            }
            double total = 0.0;
            foreach ((_, double weight) in candidates) total += weight;
            double random = rng() * total;
            foreach ((WeatherKind candidate, double weight) in candidates)
            {
                random -= weight;
                if (random <= 0.0) return candidate;
            }
            return current;
        }

        public bool Update(double dt, WeatherContext context)
        {
            if (!double.IsFinite(dt) || dt <= 0.0) return false;
            bool changed = false;
            if (transitioningTo.HasValue)
            {
                WeatherBlend target = Targets[(int)transitioningTo.Value];
                Blend.Overcast = Numerics.Damp(Blend.Overcast, target.Overcast, blendRate * 1.15, dt);
                Blend.Wet = Numerics.Damp(Blend.Wet, target.Wet, blendRate * 0.8, dt);
                Blend.Wind = Numerics.Damp(Blend.Wind, target.Wind, blendRate * 1.35, dt);
                Blend.Rain = Numerics.Damp(Blend.Rain, target.Rain, blendRate * 1.25, dt);
                Blend.Lightning = Numerics.Damp(Blend.Lightning, target.Lightning, blendRate, dt);
                blendTimer += dt;
                double difference = Math.Abs(Blend.Overcast - target.Overcast) + Math.Abs(Blend.Wet - target.Wet) * 0.7 + Math.Abs(Blend.Rain - target.Rain);
                if (difference < 0.025 || blendTimer > 30.0)
                {
                    Blend.CopyFrom(target);
                    current = transitioningTo.Value;
                    transitioningTo = null;
                    (double low, double high) = HoldSeconds[(int)current];
                    holdTimer = low + rng() * (high - low);
                    WeatherChanged?.Invoke(current);
                    changed = true;
                }
            }
            else
            {
                holdTimer -= dt;
                if (holdTimer <= 0.0 && !context.EventOverride)
                {
                    WeatherKind next = PickNext(context);
                    if (next != current)
                    {
                        transitioningTo = next;
                        blendTimer = 0.0;
                        blendRate = 0.045 + rng() * 0.02;
                    }
                    else
                    {
                        (double low, double high) = HoldSeconds[(int)current];
                        holdTimer = low + rng() * (high - low);
                    }
                }
            }

            if (Blend.Lightning > 0.45)
            {
                lightningTimer -= dt;
                if (lightningTimer <= 0.0)
                {
                    lightningTimer = 5.0 + rng() * 9.0;
                    stormStrikeCount = Math.Min(2.0, stormStrikeCount + 1.0);
                    double intensity = 0.55 + rng() * 0.45;
                    Lightning?.Invoke(intensity, !context.LowFlash && !context.ReduceEffects);
                }
            }
            else stormStrikeCount = Math.Max(0.0, stormStrikeCount - dt * 0.2);
            return changed;
        }

        public void SetWeatherImmediate(WeatherKind weather)
        {
            current = weather;
            transitioningTo = null;
            Blend.CopyFrom(TargetBlendFor(weather));
            (double low, double high) = HoldSeconds[(int)current];
            holdTimer = low + rng() * (high - low);
            WeatherChanged?.Invoke(weather);
        }
    }
}
