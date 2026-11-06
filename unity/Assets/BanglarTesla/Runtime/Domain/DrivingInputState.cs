using System.Collections.Generic;

namespace BanglarTesla.Domain
{
    /// <summary>Pointer-owned hold inputs. UI and keyboard adapters are combined by the application layer.</summary>
    public sealed class DrivingInputState
    {
        private static readonly HudControlId[] HoldControls =
        {
            HudControlId.SteerLeft, HudControlId.SteerRight, HudControlId.Pedal,
            HudControlId.Brake, HudControlId.Turbo, HudControlId.Horn,
        };
        private readonly Dictionary<HudControlId, int> owners = new();

        public bool Press(HudControlId control, int pointerId)
        {
            if (!IsHoldControl(control)) return false;
            if (owners.TryGetValue(control, out int owner)) return owner == pointerId;
            owners.Add(control, pointerId);
            return true;
        }

        public bool Release(HudControlId control, int pointerId)
        {
            if (!owners.TryGetValue(control, out int owner) || owner != pointerId) return false;
            owners.Remove(control);
            return true;
        }

        public void CancelPointer(int pointerId)
        {
            foreach (HudControlId control in HoldControls) Release(control, pointerId);
        }

        public void ReleaseAll() => owners.Clear();
        public bool IsPressed(HudControlId control) => owners.ContainsKey(control);

        public DriveInput ToDriveInput()
        {
            bool left = IsPressed(HudControlId.SteerLeft), right = IsPressed(HudControlId.SteerRight);
            return new DriveInput
            {
                Steer = left == right ? 0.0 : left ? -1.0 : 1.0,
                Throttle = IsPressed(HudControlId.Pedal) ? 1.0 : 0.0,
                Brake = IsPressed(HudControlId.Brake) ? 1.0 : 0.0,
                Turbo = IsPressed(HudControlId.Turbo),
                Horn = IsPressed(HudControlId.Horn),
                Handbrake = false,
            };
        }

        private static bool IsHoldControl(HudControlId control)
        {
            foreach (HudControlId candidate in HoldControls) if (candidate == control) return true;
            return false;
        }
    }
}
