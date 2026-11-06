using System;

namespace BanglarTesla.Domain
{
    public enum StuntKind { NearMiss, TiltSkill, Drift, Speed, Impact, Destruction }
    public readonly struct ScoreInput
    {
        public readonly double Tilt, Lateral, Speed;
        public ScoreInput(double tilt, double lateral, double speed) { Tilt = tilt; Lateral = lateral; Speed = speed; }
    }
    public readonly struct StuntEvent
    {
        public readonly StuntKind Kind;
        public readonly int Points, Combo;
        public readonly string LabelBn, LabelEn;
        public StuntEvent(StuntKind kind, int points, int combo, string labelBn, string labelEn)
        { Kind = kind; Points = points; Combo = combo; LabelBn = labelBn; LabelEn = labelEn; }
    }

    public sealed class ScoreSystem
    {
        private static readonly int[] BasePoints = { 12, 18, 15, 10, 8, 20 };
        private static readonly string[] LabelsBn = { "প্রায় ছুঁয়ে গেল!", "দুর্দান্ত ব্যালেন্স!", "দারুণ ড্রিফট!", "গতির ধারা!", "শক্ত ধাক্কা!", "ধ্বংসের ঝড়!" };
        private static readonly string[] LabelsEn = { "Near miss!", "Great balance!", "Smooth drift!", "Speed streak!", "Solid impact!", "Destruction combo!" };
        private int combo, bestCombo;
        private double comboTimer, driftTimer, tiltTimer, speedTimer;
        public int CurrentCombo => combo;
        public int Best => bestCombo;
        public event Action<StuntEvent>? Stunt;
        public event Action<int>? ComboEnded;

        public void Update(double dt, ScoreInput input)
        {
            if (!double.IsFinite(dt) || dt <= 0.0) return;
            if (input.Tilt > 0.62 && input.Speed > 3.2)
            {
                tiltTimer += dt;
                if (tiltTimer > 1.15) { tiltTimer = -0.9; Emit(StuntKind.TiltSkill); }
            }
            else tiltTimer = Math.Max(0.0, tiltTimer - dt * 0.85);
            if (Math.Abs(input.Lateral) > 2.6 && input.Speed > 4.0)
            {
                driftTimer += dt;
                if (driftTimer > 1.05) { driftTimer = -0.85; Emit(StuntKind.Drift); }
            }
            else driftTimer = Math.Max(0.0, driftTimer - dt);
            if (input.Speed > 11.5)
            {
                speedTimer += dt;
                if (speedTimer > 6.0) { speedTimer = 0.0; Emit(StuntKind.Speed); }
            }
            else speedTimer = Math.Max(0.0, speedTimer - dt * 0.6);
            if (combo > 0)
            {
                comboTimer -= dt;
                if (comboTimer <= 0.0)
                {
                    bestCombo = Math.Max(bestCombo, combo);
                    ComboEnded?.Invoke(bestCombo);
                    combo = 0;
                }
            }
        }

        public void Register(StuntKind kind) => Emit(kind);
        public void Reset() { combo = 0; comboTimer = driftTimer = tiltTimer = speedTimer = 0.0; }

        private void Emit(StuntKind kind)
        {
            combo++;
            comboTimer = 6.2;
            bestCombo = Math.Max(bestCombo, combo);
            double multiplier = 1.0 + Math.Min(2.5, (combo - 1) * 0.22);
            int points = (int)Math.Round(BasePoints[(int)kind] * multiplier, MidpointRounding.AwayFromZero);
            Stunt?.Invoke(new StuntEvent(kind, points, combo, LabelsBn[(int)kind], LabelsEn[(int)kind]));
        }
    }
}
