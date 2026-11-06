using System;
using System.Collections.Generic;
using System.Linq;

namespace BanglarTesla.Domain
{
    public enum HudControlId
    {
        SteerLeft,
        SteerRight,
        Pedal,
        Brake,
        Turbo,
        Horn,
        Pause,
        Camera,
        Blacklist,
        Minimap,
        ContextAction,
    }

    [Serializable]
    public sealed class ControlPlacement
    {
        public string Id = string.Empty;
        public double X;
        public double Y;
        public float Scale = 1.0f;

        public ControlPlacement Clone() => new() { Id = Id, X = X, Y = Y, Scale = Scale };
    }

    [Serializable]
    public sealed class ControlLayoutData
    {
        public const int CurrentVersion = 1;

        public int Version = CurrentVersion;
        public float GlobalScale = 1.0f;
        public float Opacity = 0.94f;
        public bool LeftHanded;
        public List<ControlPlacement> Controls = new();

        public ControlLayoutData Clone()
        {
            return new ControlLayoutData
            {
                Version = Version,
                GlobalScale = GlobalScale,
                Opacity = Opacity,
                LeftHanded = LeftHanded,
                Controls = Controls.Select(control => control.Clone()).ToList(),
            };
        }
    }

    public readonly struct LogicalRect
    {
        public readonly double X;
        public readonly double Y;
        public readonly double Width;
        public readonly double Height;

        public LogicalRect(double x, double y, double width, double height)
        {
            X = x;
            Y = y;
            Width = Math.Max(0.0, width);
            Height = Math.Max(0.0, height);
        }

        public double Right => X + Width;
        public double Bottom => Y + Height;
        public double CenterX => X + Width * 0.5;
        public double CenterY => Y + Height * 0.5;
        public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Width) && double.IsFinite(Height);

        public bool Intersects(LogicalRect other, double padding = 0.0)
        {
            return X < other.Right + padding && Right + padding > other.X &&
                   Y < other.Bottom + padding && Bottom + padding > other.Y;
        }
    }

    public readonly struct HudControlDefinition
    {
        public readonly HudControlId Id;
        public readonly double Width;
        public readonly double Height;
        public readonly bool DrivingControl;

        public HudControlDefinition(HudControlId id, double width, double height, bool drivingControl)
        {
            Id = id;
            Width = width;
            Height = height;
            DrivingControl = drivingControl;
        }
    }

    public static class HudControls
    {
        private static readonly HudControlDefinition[] Definitions =
        {
            new(HudControlId.SteerLeft, 116, 116, true),
            new(HudControlId.SteerRight, 116, 116, true),
            new(HudControlId.Pedal, 148, 148, true),
            new(HudControlId.Brake, 112, 112, true),
            new(HudControlId.Turbo, 108, 108, true),
            new(HudControlId.Horn, 80, 80, true),
            new(HudControlId.Pause, 64, 64, false),
            new(HudControlId.Camera, 64, 64, false),
            new(HudControlId.Blacklist, 64, 64, false),
            new(HudControlId.Minimap, 196, 156, true),
            new(HudControlId.ContextAction, 184, 64, true),
        };

        public static IReadOnlyList<HudControlDefinition> All => Definitions;

        public static HudControlDefinition Get(HudControlId id) => Definitions[(int)id];

        public static bool TryGet(string? id, out HudControlDefinition definition)
        {
            if (Enum.TryParse(id, false, out HudControlId parsed) && Enum.IsDefined(typeof(HudControlId), parsed))
            {
                definition = Get(parsed);
                return true;
            }
            definition = default;
            return false;
        }
    }

    public static class ControlLayoutDefaults
    {
        private static readonly Dictionary<HudControlId, (double X, double Y)> Positions = new()
        {
            [HudControlId.SteerLeft] = (0.065, 0.855),
            [HudControlId.SteerRight] = (0.190, 0.855),
            [HudControlId.Pedal] = (0.932, 0.835),
            [HudControlId.Brake] = (0.805, 0.875),
            [HudControlId.Turbo] = (0.918, 0.565),
            [HudControlId.Horn] = (0.690, 0.875),
            [HudControlId.Pause] = (0.962, 0.075),
            [HudControlId.Camera] = (0.887, 0.075),
            [HudControlId.Blacklist] = (0.812, 0.075),
            [HudControlId.Minimap] = (0.105, 0.485),
            [HudControlId.ContextAction] = (0.500, 0.830),
        };

        public static ControlLayoutData Create(bool leftHanded = false)
        {
            var layout = new ControlLayoutData { LeftHanded = leftHanded };
            foreach (HudControlDefinition definition in HudControls.All)
            {
                (double x, double y) = Positions[definition.Id];
                if (leftHanded && definition.DrivingControl)
                    x = 1.0 - x;
                layout.Controls.Add(new ControlPlacement
                {
                    Id = definition.Id.ToString(), X = x, Y = y, Scale = 1.0f,
                });
            }
            return layout;
        }
    }

    public static class ControlLayoutSanitizer
    {
        public static ControlLayoutData Sanitize(ControlLayoutData? input)
        {
            ControlLayoutData output = ControlLayoutDefaults.Create(input?.LeftHanded ?? false);
            if (input is null)
                return output;

            output.GlobalScale = float.IsFinite(input.GlobalScale) ? Numerics.Clamp(input.GlobalScale, 0.8f, 1.35f) : 1.0f;
            output.Opacity = float.IsFinite(input.Opacity) ? Numerics.Clamp(input.Opacity, 0.45f, 1.0f) : 0.94f;
            if (input.Controls is null)
                return output;

            var supplied = new Dictionary<string, ControlPlacement>(StringComparer.Ordinal);
            foreach (ControlPlacement? control in input.Controls)
            {
                if (control is null || !HudControls.TryGet(control.Id, out _) || supplied.ContainsKey(control.Id))
                    continue;
                supplied.Add(control.Id, control);
            }
            foreach (ControlPlacement target in output.Controls)
            {
                if (!supplied.TryGetValue(target.Id, out ControlPlacement? source))
                    continue;
                target.X = double.IsFinite(source.X) ? Numerics.Clamp01(source.X) : target.X;
                target.Y = double.IsFinite(source.Y) ? Numerics.Clamp01(source.Y) : target.Y;
                target.Scale = float.IsFinite(source.Scale) ? Numerics.Clamp(source.Scale, 0.7f, 1.6f) : 1.0f;
            }
            output.Version = ControlLayoutData.CurrentVersion;
            return output;
        }

        public static void SetHandedness(ControlLayoutData layout, bool leftHanded)
        {
            if (layout.LeftHanded == leftHanded)
                return;
            foreach (ControlPlacement control in layout.Controls)
            {
                if (HudControls.TryGet(control.Id, out HudControlDefinition definition) && definition.DrivingControl)
                    control.X = 1.0 - control.X;
            }
            layout.LeftHanded = leftHanded;
        }
    }

    public static class ControlLayoutEngine
    {
        public const double GridPixels = 8.0;

        public static LogicalRect ComputeRect(ControlPlacement placement, HudControlDefinition definition, LogicalRect safeArea, float globalScale)
        {
            if (safeArea.Width <= 0.0 || safeArea.Height <= 0.0 || !safeArea.IsFinite)
                return new LogicalRect(safeArea.X, safeArea.Y, 0.0, 0.0);
            double scale = Math.Max(0.1, placement.Scale * globalScale);
            double width = definition.Width * scale;
            double height = definition.Height * scale;
            double fit = Math.Min(1.0, Math.Min(safeArea.Width / width, safeArea.Height / height));
            width *= fit;
            height *= fit;
            double centerX = safeArea.X + Numerics.Clamp01(placement.X) * safeArea.Width;
            double centerY = safeArea.Y + Numerics.Clamp01(placement.Y) * safeArea.Height;
            centerX = Numerics.Clamp(centerX, safeArea.X + width * 0.5, safeArea.Right - width * 0.5);
            centerY = Numerics.Clamp(centerY, safeArea.Y + height * 0.5, safeArea.Bottom - height * 0.5);
            return new LogicalRect(centerX - width * 0.5, centerY - height * 0.5, width, height);
        }

        public static LogicalRect MoveControl(ControlPlacement placement, HudControlDefinition definition, double desiredCenterX, double desiredCenterY, LogicalRect safeArea, float globalScale, bool snap = true)
        {
            if (safeArea.Width <= 0.0 || safeArea.Height <= 0.0)
                return ComputeRect(placement, definition, safeArea, globalScale);
            double x = (desiredCenterX - safeArea.X) / safeArea.Width;
            double y = (desiredCenterY - safeArea.Y) / safeArea.Height;
            if (snap)
            {
                x = Math.Round(x * safeArea.Width / GridPixels) * GridPixels / safeArea.Width;
                y = Math.Round(y * safeArea.Height / GridPixels) * GridPixels / safeArea.Height;
            }
            placement.X = Numerics.Clamp01(x);
            placement.Y = Numerics.Clamp01(y);
            LogicalRect rect = ComputeRect(placement, definition, safeArea, globalScale);
            // Store the actually clamped position so reload does not move a control again.
            placement.X = (rect.CenterX - safeArea.X) / safeArea.Width;
            placement.Y = (rect.CenterY - safeArea.Y) / safeArea.Height;
            return rect;
        }

        public static int CountOverlaps(ControlLayoutData layout, LogicalRect safeArea)
        {
            ControlLayoutData clean = ControlLayoutSanitizer.Sanitize(layout);
            var rects = new List<LogicalRect>(clean.Controls.Count);
            foreach (ControlPlacement control in clean.Controls)
            {
                if (HudControls.TryGet(control.Id, out HudControlDefinition definition))
                    rects.Add(ControlLayoutEngine.ComputeRect(control, definition, safeArea, clean.GlobalScale));
            }
            int overlaps = 0;
            for (int i = 0; i < rects.Count; i++)
            for (int j = i + 1; j < rects.Count; j++)
                if (rects[i].Intersects(rects[j], 2.0))
                    overlaps++;
            return overlaps;
        }
    }
}
