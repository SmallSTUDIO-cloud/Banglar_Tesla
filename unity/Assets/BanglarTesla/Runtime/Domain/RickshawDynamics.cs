using System;

namespace BanglarTesla.Domain
{
    public enum RoadSurface { Road, Sidewalk, Offroad }
    public enum TurboChangeReason { Engage, Release, Empty }
    public enum TanStopReason { Stamina, Battery }

    public struct DriveInput
    {
        public double Throttle, Brake, Steer;
        public bool Handbrake, Turbo, Horn;
    }

    public struct StepEvents
    {
        public double Impact, ImpactX, ImpactZ, ContactX, ContactZ, Distance, RoughBump;
        public bool OnSidewalk, Stuck;
    }

    /// <summary>Engine-free fixed-step rickshaw dynamics, ported from the released v0.6.7 tuning.</summary>
    public sealed class RickshawDynamics
    {
        public const double Wheelbase = 1.48, FrontAxleZ = 0.8, RearAxleZ = -0.68;
        public const double MaxReverse = 1.95, AccelFalloff = 0.56, CoastDrag = 0.64, RollingDrag = 0.068;
        public const double HandbrakeDecel = 6.8, SteerRate = 4.4, SteerReturn = 5.8;
        public const double LateralGrip = 9.2, LateralGripWet = 6.6, ReverseHold = 0.28;
        public const double TurboSpeedMultiplier = 3.0, TurboMaxSpeedCap = 18.0, TurboAccelMultiplier = 2.4;
        public const double TurboDrainPerSecond = 25.0, TurboRechargeMoving = 4.4, TurboRechargeIdle = 1.8, TurboMinimumCharge = 8.0;

        private readonly CollisionWorld? collisionWorld;
        private readonly Func<double, double, double> heightAt;
        private readonly Func<double, double, RoadSurface> surfaceAt;
        private readonly Func<double, double, double> potholeDepthAt;
        private readonly bool[] potholeContacts = new bool[3];
        private readonly double[] potholeWheelX = new double[3], potholeWheelZ = new double[3];
        private double previousSpeed, previousFrontHeight, stuckWindow, stuckAnchorX, stuckAnchorZ;

        public RickshawDynamics(CollisionWorld? collisionWorld = null,
            Func<double, double, double>? heightAt = null,
            Func<double, double, RoadSurface>? surfaceAt = null,
            Func<double, double, double>? potholeDepthAt = null)
        {
            this.collisionWorld = collisionWorld;
            this.heightAt = heightAt ?? ((_, _) => 0.0);
            this.surfaceAt = surfaceAt ?? ((_, _) => RoadSurface.Road);
            this.potholeDepthAt = potholeDepthAt ?? ((_, _) => 0.0);
            Tuning = new VehicleTuning();
        }

        public VehicleTuning Tuning { get; private set; }
        public double X, Z, Yaw, Speed, SteerAngle, Y, Pitch, BodyPitchOffset, Roll;
        public double LateralAccel, LateralSlip, Acceleration, FrontHeight, RearHeight, DistanceDriven;
        public double ReverseTimer, StuckTimer, Battery = 100.0, Stamina = 100.0;
        public double TanBlend, TurboCharge = 100.0, TurboBlend, ScufflePenaltyTimer, CrashRecoveryTimer;
        public bool Stuck, TanActive, TurboActive, OnSidewalk;
        public int Hits, HardBrakes;
        public double LastImpact;
        public ContactDebugInfo LastContact;
        public event Action<TanStopReason>? TanAutoStop;
        public event Action<bool, TurboChangeReason>? TurboStateChanged;
        public Vector2D Forward => new(Math.Sin(Yaw), Math.Cos(Yaw));
        public Vector2D Right => new(-Math.Cos(Yaw), Math.Sin(Yaw));
        public Vector2D Left => new(Math.Cos(Yaw), -Math.Sin(Yaw));

        public void SetTuning(VehicleTuning tuning) => Tuning = tuning ?? throw new ArgumentNullException(nameof(tuning));
        public void RechargeBattery(double amount = 100.0) => Battery = Numerics.Clamp(Battery + amount, 0.0, 100.0);
        public void RestoreStamina(double amount = 100.0) => Stamina = Numerics.Clamp(Stamina + amount, 0.0, 100.0);
        public void AddTurboCharge(double amount)
        {
            if (double.IsFinite(amount) && amount > 0.0) TurboCharge = Numerics.Clamp(TurboCharge + amount, 0.0, 100.0);
        }

        public void ForceStopTurbo()
        {
            if (TurboActive) TurboStateChanged?.Invoke(false, TurboChangeReason.Release);
            TurboActive = false;
            TurboBlend = 0.0;
        }

        public bool SetTanActive(bool active)
        {
            if (!active) { TanActive = false; return false; }
            if (Tuning.IsElectric && Battery <= 2.5 || !Tuning.IsElectric && Stamina < 12.0)
            {
                TanActive = false;
                return false;
            }
            TanActive = true;
            return true;
        }

        public void ApplyScufflePenalty()
        {
            ScufflePenaltyTimer = 4.0;
            TanActive = false;
            ForceStopTurbo();
            if (Tuning.IsElectric) Battery = Numerics.Clamp(Battery - 18.0, 5.0, 100.0);
            else Stamina = Numerics.Clamp(Stamina - 55.0, 8.0, 100.0);
        }

        public void ApplyCrashImpulse(double yawKickRadians, double recoverySeconds)
        {
            Yaw = Numerics.NormalizeAngle(Yaw + Numerics.Clamp(yawKickRadians, -0.22, 0.22));
            CrashRecoveryTimer = Math.Max(CrashRecoveryTimer, Numerics.Clamp(recoverySeconds, 0.0, 0.55));
        }

        public void Reset(double x, double z, double yaw)
        {
            Respawn(x, z, yaw);
            Hits = 0; HardBrakes = 0; DistanceDriven = 0.0;
            Battery = 100.0; Stamina = 100.0; TurboCharge = 100.0;
        }

        /// <summary>Recover transform and motion without erasing career/session resources or odometer totals.</summary>
        public void Respawn(double x, double z, double yaw)
        {
            X = x; Z = z; Yaw = Numerics.NormalizeAngle(yaw); Speed = 0.0; LateralSlip = 0.0; SteerAngle = 0.0;
            double fx = Math.Sin(Yaw), fz = Math.Cos(Yaw);
            double front = heightAt(x + fx * FrontAxleZ, z + fz * FrontAxleZ);
            double rear = heightAt(x + fx * RearAxleZ, z + fz * RearAxleZ);
            FrontHeight = front; RearHeight = rear; previousFrontHeight = front; previousSpeed = 0.0;
            Array.Clear(potholeContacts, 0, potholeContacts.Length);
            Y = rear + (front - rear) * (-RearAxleZ / Wheelbase);
            Pitch = -Math.Atan2(front - rear, Wheelbase); BodyPitchOffset = 0.0; Roll = 0.0;
            Stuck = false; StuckTimer = 0.0; stuckWindow = 0.0; stuckAnchorX = x; stuckAnchorZ = z;
            ReverseTimer = 0.0; TanActive = false; TanBlend = 0.0; ForceStopTurbo();
            ScufflePenaltyTimer = 0.0; CrashRecoveryTimer = 0.0; LastImpact = 0.0; LastContact = default;
        }

        public CollisionResult ResolveWorldCollisions(bool applyVelocityResponse = false) =>
            collisionWorld?.Resolve(this, applyVelocityResponse) ?? new CollisionResult { ContactX = X, ContactZ = Z };

        public StepEvents Step(double dt, DriveInput input, double steeringSensitivity = 1.0, double deadzone = 0.0)
        {
            if (!double.IsFinite(dt) || dt <= 0.0 || dt > 0.1) throw new ArgumentOutOfRangeException(nameof(dt));
            VehicleTuning t = Tuning;
            ScufflePenaltyTimer = Math.Max(0.0, ScufflePenaltyTimer - dt);
            CrashRecoveryTimer = Math.Max(0.0, CrashRecoveryTimer - dt);
            RoadSurface surface = surfaceAt(X, Z);
            OnSidewalk = surface == RoadSurface.Sidewalk;
            double surfacePenalty = surface == RoadSurface.Road ? 1.0 : surface == RoadSurface.Sidewalk ? t.RoughSurfaceKeep : Math.Max(0.64, t.RoughSurfaceKeep - 0.12);
            double rawThrottle = Numerics.Clamp01(input.Throttle), brake = Numerics.Clamp01(input.Brake);

            bool wantTurbo = input.Turbo && brake < 0.2 && Speed >= -0.25 && ScufflePenaltyTimer <= 0.0;
            bool wasTurbo = TurboActive;
            if (wantTurbo)
            {
                if (TurboActive && TurboCharge <= 0.02)
                {
                    TurboCharge = 0.0; TurboActive = false; TurboStateChanged?.Invoke(false, TurboChangeReason.Empty);
                }
                else if (!TurboActive && TurboCharge >= TurboMinimumCharge)
                {
                    TurboActive = true; TurboStateChanged?.Invoke(true, TurboChangeReason.Engage);
                }
            }
            else if (TurboActive)
            {
                TurboActive = false; TurboStateChanged?.Invoke(false, TurboChangeReason.Release);
            }
            if (TurboActive)
            {
                TurboCharge = Math.Max(0.0, TurboCharge - TurboDrainPerSecond * t.TurboDrainMultiplier * dt);
                if (TurboCharge <= 0.01)
                {
                    TurboCharge = 0.0; TurboActive = false;
                    if (wasTurbo) TurboStateChanged?.Invoke(false, TurboChangeReason.Empty);
                }
            }
            else if (!input.Turbo)
            {
                double recharge = Math.Abs(Speed) > 1.2 ? TurboRechargeMoving : TurboRechargeIdle;
                TurboCharge = Math.Min(100.0, TurboCharge + recharge * t.TurboRechargeMultiplier * dt);
            }
            double throttle = TurboActive ? Math.Max(rawThrottle, 0.96) : rawThrottle;

            bool activelyTan = TanActive && !TurboActive && throttle > 0.04 && Speed >= -0.05;
            if (!t.IsElectric)
            {
                if (activelyTan)
                {
                    Stamina = Math.Max(0.0, Stamina - 13.5 * dt);
                    if (Stamina <= 0.01) { Stamina = 0.0; TanActive = false; TanAutoStop?.Invoke(TanStopReason.Stamina); }
                }
                else if (!TanActive) Stamina = Math.Min(100.0, Stamina + (rawThrottle > 0.1 ? 4.6 : 9.4) * dt);
                else if (Math.Abs(Speed) < 0.25) Stamina = Math.Min(100.0, Stamina + 3.0 * dt);
            }
            else if (TanActive && Battery <= 2.0)
            {
                TanActive = false; TanAutoStop?.Invoke(TanStopReason.Battery);
            }
            TanBlend = Numerics.MoveTowards(TanBlend, TanActive ? 1.0 : 0.0, (TanActive ? 7.5 : 6.0) * dt);
            TurboBlend = Numerics.MoveTowards(TurboBlend, TurboActive ? 1.0 : 0.0, (TurboActive ? 9.5 : 12.0) * dt);
            double tanSpeedMultiplier = Numerics.Lerp(1.0, 1.95, TanBlend);
            double boostSpeedMultiplier = Numerics.Lerp(tanSpeedMultiplier, TurboSpeedMultiplier, TurboBlend);
            double tanAccelMultiplier = TanActive && throttle > 0.04 ? 2.15 : 1.0;
            double boostAccelMultiplier = TurboActive ? Math.Max(tanAccelMultiplier, TurboAccelMultiplier) : tanAccelMultiplier;
            double scuffleScale = ScufflePenaltyTimer > 0.0 ? 0.76 : 1.0;
            double batteryScale = t.IsElectric ? Battery > 8.0 ? 1.0 : 0.72 + 0.28 * Battery / 8.0 : 1.0;
            double rawMaxSpeed = t.MaxSpeed * boostSpeedMultiplier * scuffleScale * surfacePenalty * batteryScale;
            double maxSpeed = TurboBlend > 0.01 ? Math.Min(rawMaxSpeed, TurboMaxSpeedCap) : rawMaxSpeed;

            double speedFactor = Numerics.Clamp01(Math.Abs(Speed) / Math.Max(0.1, t.MaxSpeed));
            double ultraSpeedFactor = Numerics.Clamp01((Math.Abs(Speed) - t.MaxSpeed) / Math.Max(1.0, t.MaxSpeed * 1.8));
            double highSteerCap = Numerics.Lerp(t.SteerMaxHigh, t.SteerMaxHigh * 0.74, ultraSpeedFactor);
            double steerMax = Numerics.Lerp(t.SteerMaxLow, highSteerCap, speedFactor);
            double rawSteer = Math.Abs(input.Steer) < deadzone ? 0.0 : Numerics.Clamp(input.Steer, -1.0, 1.0);
            double eased = Math.Sign(rawSteer) * Math.Pow(Numerics.Clamp01(Math.Abs(rawSteer)), 1.18);
            double target = Numerics.Clamp(eased * steerMax * Numerics.Clamp(steeringSensitivity, 0.4, 1.6), -steerMax * 1.12, steerMax * 1.12);
            double rate = (Math.Abs(target) < 0.01 ? SteerReturn : SteerRate) * t.SteerRateMultiplier;
            SteerAngle = Numerics.MoveTowards(SteerAngle, target, rate * dt * steerMax * 3.6);

            if (brake > 0.02)
            {
                if (Speed > 0.02)
                {
                    double before = Speed;
                    double speedBrakeBonus = 1.0 + Numerics.Clamp01(Speed / 12.0) * 0.18;
                    double decel = (input.Handbrake ? Math.Max(t.BrakeDecel, HandbrakeDecel) : t.BrakeDecel) * speedBrakeBonus * brake * dt;
                    Speed = Math.Max(0.0, Speed - decel);
                    if (t.IsElectric && t.RegenFactor > 0.0) Battery = Numerics.Clamp(Battery + (before - Speed) * t.RegenFactor * 0.45, 0.0, 100.0);
                    if (Speed < 0.05) Speed = 0.0;
                    if (before > 3.4 && Speed < before - 2.4) HardBrakes++;
                    ReverseTimer = 0.0;
                }
                else if (throttle < 0.05)
                {
                    ReverseTimer += dt;
                    if (ReverseTimer > ReverseHold) Speed = Math.Max(-MaxReverse, Speed - t.Accel * 0.58 * dt);
                }
            }
            else ReverseTimer = 0.0;

            if (throttle > 0.02 && Speed >= -0.02)
            {
                double falloffCurve = t.IsElectric ? AccelFalloff * 0.72 : AccelFalloff;
                double ratio = Numerics.Clamp01(Speed / Math.Max(0.1, maxSpeed));
                double falloff = 1.0 - ratio * ratio * falloffCurve;
                Speed += t.Accel * boostAccelMultiplier * scuffleScale * batteryScale * throttle * Math.Max(0.12, falloff) * dt;
                if (t.IsElectric && !TurboActive)
                {
                    double tanDrain = TanActive ? 3.2 : 1.0;
                    Battery = Numerics.Clamp(Battery - (0.35 + 0.26 * speedFactor) * rawThrottle * t.BatteryDrainMultiplier * tanDrain * dt, 0.0, 100.0);
                    if (TanActive && Battery <= 2.0) { TanActive = false; TanAutoStop?.Invoke(TanStopReason.Battery); }
                }
            }
            else if (throttle > 0.02 && Speed < -0.02) Speed = Math.Min(0.0, Speed + t.BrakeDecel * 0.82 * dt);
            else if (t.IsElectric && Math.Abs(Speed) < 0.15) Battery = Numerics.Clamp(Battery + 0.24 * dt, 0.0, 100.0);

            if (throttle < 0.02 && brake < 0.02)
            {
                double drag = (CoastDrag + RollingDrag * Math.Abs(Speed)) * t.RollingDragScale * dt;
                Speed = Math.Abs(Speed) <= drag ? 0.0 : Speed - Math.Sign(Speed) * drag;
            }
            else if (Speed > maxSpeed) Speed = Math.Max(maxSpeed, Speed - (3.8 + (Speed - maxSpeed) * 0.65) * dt);
            Speed = Numerics.Clamp(Speed, -MaxReverse, Math.Max(maxSpeed, 0.5));

            double gripFactor = 0.72 + 0.34 * t.Grip;
            double yawRate = Numerics.Clamp(-(Speed / Wheelbase) * Math.Tan(SteerAngle) * gripFactor, -2.65, 2.65);
            Yaw = Numerics.NormalizeAngle(Yaw + yawRate * dt);
            double lateralAcceleration = Speed * -yawRate;
            LateralAccel = lateralAcceleration;
            double lateralGrip = Numerics.Lerp(LateralGripWet, LateralGrip, Numerics.Clamp01((t.Grip - 0.38) / 0.56)) * (input.Handbrake ? 0.58 : 1.0);
            double slipInput = Math.Abs(Speed) > 4.2 ? -lateralAcceleration * 0.045 : 0.0;
            LateralSlip = Numerics.Clamp((LateralSlip + slipInput * dt) * Math.Exp(-lateralGrip * dt), -1.35, 1.35);

            double previousX = X, previousZ = Z;
            double fx = Math.Sin(Yaw), fz = Math.Cos(Yaw), rx = -fz, rz = fx;
            X += fx * Speed * dt + rx * LateralSlip * dt;
            Z += fz * Speed * dt + rz * LateralSlip * dt;
            CollisionResult impact = ResolveWorldCollisions(true);
            double moved = Math.Sqrt((X - previousX) * (X - previousX) + (Z - previousZ) * (Z - previousZ));
            DistanceDriven += moved; LastImpact = impact.Magnitude;
            if (impact.Magnitude > 0.4) Hits++;

            double front = heightAt(X + fx * FrontAxleZ, Z + fz * FrontAxleZ);
            double rear = heightAt(X + fx * RearAxleZ, Z + fz * RearAxleZ);
            double roughBump = Math.Abs(front - previousFrontHeight) * Math.Abs(Speed);
            previousFrontHeight = front; FrontHeight = front; RearHeight = rear;
            Y += (rear + (front - rear) * (-RearAxleZ / Wheelbase) - Y) * Numerics.Clamp01(dt * 24.0);
            double suspensionDamp = 1.0 - Numerics.Clamp01(t.SuspensionSmoothing * 0.35);
            Pitch += (-Math.Atan2(front - rear, Wheelbase) - Pitch) * Numerics.Clamp01(dt * 16.0);
            Acceleration = (Speed - previousSpeed) / Math.Max(dt, 0.0001); previousSpeed = Speed;
            double targetPitchOffset = Numerics.Clamp(-Acceleration * 0.0042 * suspensionDamp, -0.036, 0.038);
            BodyPitchOffset += (targetPitchOffset - BodyPitchOffset) * Numerics.Clamp01(dt * 10.0);
            double targetRoll = Numerics.Clamp(-lateralAcceleration * 0.014 * suspensionDamp, -0.072, 0.072) +
                (surface == RoadSurface.Sidewalk ? Math.Sin(DistanceDriven * 9.0) * 0.0032 * suspensionDamp : 0.0);
            Roll += (targetRoll - Roll) * Numerics.Clamp01(dt * 10.0);

            potholeWheelX[0] = X + fx * FrontAxleZ; potholeWheelZ[0] = Z + fz * FrontAxleZ;
            potholeWheelX[1] = X + fx * RearAxleZ + rx * 0.55; potholeWheelZ[1] = Z + fz * RearAxleZ + rz * 0.55;
            potholeWheelX[2] = X + fx * RearAxleZ - rx * 0.55; potholeWheelZ[2] = Z + fz * RearAxleZ - rz * 0.55;
            for (int wheel = 0; wheel < 3; wheel++)
            {
                double depth = potholeDepthAt(potholeWheelX[wheel], potholeWheelZ[wheel]);
                bool touching = depth > 0.012;
                if (touching && !potholeContacts[wheel])
                {
                    double bump = RickshawCollision.PotholeWheelImpulse(Speed, depth, t.SuspensionSmoothing, t.IsElectric ? 1.1 : 1.0);
                    BodyPitchOffset += (wheel == 0 ? -1.0 : 0.65) * bump * 0.028;
                    Roll += (wheel == 0 ? 0.0 : wheel == 1 ? 1.0 : -1.0) * bump * 0.038;
                    Roll = Numerics.Clamp(Roll, -0.11, 0.11); BodyPitchOffset = Numerics.Clamp(BodyPitchOffset, -0.08, 0.08);
                    Speed *= 1.0 - Math.Min(0.018, bump * 0.012); roughBump = Math.Max(roughBump, bump);
                }
                potholeContacts[wheel] = touching;
            }

            stuckWindow += dt;
            if (stuckWindow >= 0.5)
            {
                double dx = X - stuckAnchorX, dz = Z - stuckAnchorZ;
                double movedPerSecond = Math.Sqrt(dx * dx + dz * dz) / stuckWindow;
                if (throttle > 0.4 && brake < 0.1 && movedPerSecond < 0.32) StuckTimer += stuckWindow;
                else StuckTimer = Math.Max(0.0, StuckTimer - stuckWindow * 1.8);
                stuckWindow = 0.0; stuckAnchorX = X; stuckAnchorZ = Z;
            }
            Stuck = StuckTimer > 2.2;
            return new StepEvents
            {
                Impact = impact.Magnitude, ImpactX = impact.NormalX, ImpactZ = impact.NormalZ,
                ContactX = impact.ContactX, ContactZ = impact.ContactZ, Distance = moved,
                OnSidewalk = OnSidewalk, Stuck = Stuck, RoughBump = roughBump,
            };
        }
    }
}
