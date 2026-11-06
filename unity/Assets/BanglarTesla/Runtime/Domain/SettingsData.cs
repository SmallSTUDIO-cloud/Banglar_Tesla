using System;
using System.Collections.Generic;

namespace BanglarTesla.Domain
{
    [Serializable]
    public sealed class SettingsData
    {
        public string Language = "bn";
        public string Quality = "balanced";
        public string WeatherPreference = "auto";
        public string GraphicsProfile = "balanced";
        public string RainMode = "normal";
        public string RainDensity = "medium";
        public bool WetRoad = true;
        public bool LightningEffects = true;
        public float RenderScale = 1.0f;
        public bool Shadows = true;
        public int FpsTarget = 60;
        public float Master = 0.85f;
        public float Music = 0.62f;
        public float Sfx = 0.8f;
        public float Ambience = 0.7f;
        public float Traffic = 0.6f;
        public float Vehicle = 0.75f;
        public float Dialogue = 0.85f;
        public float Ui = 0.7f;
        public bool Muted;
        public bool MusicEnabled = true;
        public bool SfxEnabled = true;
        public bool ReduceNoisyAmbience;
        public string RadioMode = "both";
        public string Steering = "buttons";
        public string Handedness = "right";
        public float Sensitivity = 0.9f;
        public float Deadzone = 0.12f;
        public bool CameraShake = true;
        public bool LowFlash;
        public bool Haptics = true;
        public float TextScale = 1.0f;
        public float HudScale = 1.0f;
        public bool ReduceEffects;
        public bool Subtitles = true;
        public string CameraMode = "chase";
        public bool ShowPerformance;
        public ControlLayoutData ControlLayout = ControlLayoutDefaults.Create();

        public static SettingsData CreateDefault() => new();

        public static SettingsData Sanitize(SettingsData? source, SettingsData? baseline = null)
        {
            SettingsData defaults = baseline ?? CreateDefault();
            if (source is null)
                return Sanitize(defaults, null);
            SettingsData output = new SettingsData();

            output.Language = Allowed(source.Language, "bn", "en") ? source.Language : defaults.Language;
            output.Quality = Allowed(source.Quality, "low", "balanced", "high", "pc_high") ? source.Quality : defaults.Quality;
            output.WeatherPreference = Allowed(source.WeatherPreference, "auto", "sunny", "overcast", "rain", "windy", "storm") ? source.WeatherPreference : defaults.WeatherPreference;
            output.GraphicsProfile = Allowed(source.GraphicsProfile, "performance", "balanced", "high", "custom")
                ? source.GraphicsProfile
                : source.Quality == "low" ? "performance" : source.Quality == "high" ? "high" : defaults.GraphicsProfile;
            output.RainMode = Allowed(source.RainMode, "normal", "dynamic") ? source.RainMode : defaults.RainMode;
            output.RainDensity = Allowed(source.RainDensity, "low", "medium", "high") ? source.RainDensity : defaults.RainDensity;
            output.RadioMode = Allowed(source.RadioMode, "both", "music", "street") ? source.RadioMode : defaults.RadioMode;
            output.Steering = Allowed(source.Steering, "buttons", "wheel") ? source.Steering : defaults.Steering;
            output.CameraMode = Allowed(source.CameraMode, "chase", "close", "wide", "low", "front", "cockpit", "side") ? source.CameraMode : defaults.CameraMode;
            output.FpsTarget = source.FpsTarget is 30 or 60 ? source.FpsTarget : defaults.FpsTarget;

            output.WetRoad = source.WetRoad;
            output.LightningEffects = source.LightningEffects;
            output.Shadows = source.Shadows;
            output.Muted = source.Muted;
            output.MusicEnabled = source.MusicEnabled;
            output.SfxEnabled = source.SfxEnabled;
            output.ReduceNoisyAmbience = source.ReduceNoisyAmbience;
            output.CameraShake = source.CameraShake;
            output.LowFlash = source.LowFlash;
            output.Haptics = source.Haptics;
            output.ReduceEffects = source.ReduceEffects;
            output.Subtitles = source.Subtitles;
            output.ShowPerformance = source.ShowPerformance;

            output.RenderScale = Finite(source.RenderScale, 0.6f, 1.2f, defaults.RenderScale);
            output.Master = Finite(source.Master, 0.0f, 1.0f, defaults.Master);
            output.Music = Finite(source.Music, 0.0f, 1.0f, defaults.Music);
            output.Sfx = Finite(source.Sfx, 0.0f, 1.0f, defaults.Sfx);
            output.Ambience = Finite(source.Ambience, 0.0f, 1.0f, defaults.Ambience);
            output.Traffic = Finite(source.Traffic, 0.0f, 1.0f, defaults.Traffic);
            output.Vehicle = Finite(source.Vehicle, 0.0f, 1.0f, defaults.Vehicle);
            output.Dialogue = Finite(source.Dialogue, 0.0f, 1.0f, defaults.Dialogue);
            output.Ui = Finite(source.Ui, 0.0f, 1.0f, defaults.Ui);
            output.Sensitivity = Finite(source.Sensitivity, 0.35f, 1.8f, defaults.Sensitivity);
            output.Deadzone = Finite(source.Deadzone, 0.0f, 0.4f, defaults.Deadzone);
            output.TextScale = Finite(source.TextScale, 0.85f, 1.4f, defaults.TextScale);
            output.HudScale = Finite(source.HudScale, 0.8f, 1.3f, defaults.HudScale);

            output.ControlLayout = ControlLayoutSanitizer.Sanitize(source.ControlLayout);
            output.Handedness = output.ControlLayout.LeftHanded ? "left" : "right";
            // Keep the legacy HUD slider and the new layout scale in lockstep.
            output.ControlLayout.GlobalScale = output.HudScale;
            return output;
        }

        private static bool Allowed(string? value, params string[] choices)
        {
            return value is not null && ((IList<string>)choices).Contains(value);
        }

        private static float Finite(float value, float minimum, float maximum, float fallback)
        {
            return float.IsFinite(value) ? Numerics.Clamp(value, minimum, maximum) : fallback;
        }
    }
}
