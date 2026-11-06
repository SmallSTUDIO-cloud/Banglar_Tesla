using System;
using System.Collections.Generic;

namespace BanglarTesla.Domain
{
    [Serializable]
    public sealed class BoxColliderData
    {
        public double MinX, MaxX, MinZ, MaxZ, Height;
        public bool Disabled;
        public int BreakableId = -1;
        public bool Oriented;
        public double CenterX, CenterZ, HalfX, HalfZ, Yaw;
        internal int Stamp;

        public void GetShape(out double centerX, out double centerZ, out double halfX, out double halfZ, out double yaw)
        {
            centerX = Oriented ? CenterX : (MinX + MaxX) * 0.5;
            centerZ = Oriented ? CenterZ : (MinZ + MaxZ) * 0.5;
            halfX = Oriented ? HalfX : (MaxX - MinX) * 0.5;
            halfZ = Oriented ? HalfZ : (MaxZ - MinZ) * 0.5;
            yaw = Oriented ? Yaw : 0.0;
        }
    }

    public struct ContactDebugInfo
    {
        public bool Active;
        public double X, Z, NormalX, NormalZ, Magnitude;
    }

    public struct CollisionResult
    {
        public double Magnitude, NormalX, NormalZ, ContactX, ContactZ;
    }

    public struct ObbHitResult
    {
        public bool Hit;
        public double PushX, PushZ, NormalX, NormalZ, ContactX, ContactZ, Penetration;
    }

    public static class RickshawCollision
    {
        public static double PotholeWheelImpulse(double speed, double depth, double suspension, double massScale = 1.0)
        {
            if (!double.IsFinite(speed) || !double.IsFinite(depth) || depth <= 0.0) return 0.0;
            return Numerics.Clamp(Math.Abs(speed) / 8.0, 0.0, 1.4) * Numerics.Clamp01(depth / 0.065) *
                (1.0 - Numerics.Clamp01(suspension) * 0.55) * Numerics.Clamp(massScale, 0.5, 1.4);
        }

        public static ObbHitResult TestCircleVsObb(double px, double pz, double radius, double cx, double cz, double halfX, double halfZ, double yaw)
        {
            double c = Math.Cos(yaw), s = Math.Sin(yaw);
            double wx = px - cx, wz = pz - cz;
            double lx = wx * c - wz * s, lz = wx * s + wz * c;
            double clampedX = Numerics.Clamp(lx, -halfX, halfX), clampedZ = Numerics.Clamp(lz, -halfZ, halfZ);
            double dx = lx - clampedX, dz = lz - clampedZ;
            double distanceSquared = dx * dx + dz * dz;
            if (distanceSquared >= radius * radius) return default;
            double localNormalX = 0.0, localNormalZ = 0.0, penetration;
            double contactLocalX = clampedX, contactLocalZ = clampedZ;
            if (distanceSquared > 1e-8)
            {
                double distance = Math.Sqrt(distanceSquared);
                localNormalX = dx / distance; localNormalZ = dz / distance;
                penetration = radius - distance;
            }
            else
            {
                double negativeX = lx + halfX, positiveX = halfX - lx;
                double negativeZ = lz + halfZ, positiveZ = halfZ - lz;
                double minimum = Math.Min(negativeX, Math.Min(positiveX, Math.Min(negativeZ, positiveZ)));
                if (minimum == negativeX) { localNormalX = -1.0; contactLocalX = -halfX; penetration = radius + negativeX; }
                else if (minimum == positiveX) { localNormalX = 1.0; contactLocalX = halfX; penetration = radius + positiveX; }
                else if (minimum == negativeZ) { localNormalZ = -1.0; contactLocalZ = -halfZ; penetration = radius + negativeZ; }
                else { localNormalZ = 1.0; contactLocalZ = halfZ; penetration = radius + positiveZ; }
            }
            double nx = localNormalX * c + localNormalZ * s;
            double nz = -localNormalX * s + localNormalZ * c;
            return new ObbHitResult
            {
                Hit = true, NormalX = nx, NormalZ = nz, Penetration = penetration,
                PushX = nx * (penetration + 0.008), PushZ = nz * (penetration + 0.008),
                ContactX = cx + contactLocalX * c + contactLocalZ * s,
                ContactZ = cz - contactLocalX * s + contactLocalZ * c,
            };
        }

        public static ObbHitResult TestRickshawCapsuleVsObb(double rx, double rz, double rickshawYaw,
            double cx, double cz, double halfX, double halfZ, double colliderYaw)
        {
            double dx = rx - cx, dz = rz - cz;
            double maximumReach = 0.98 + Math.Sqrt(halfX * halfX + halfZ * halfZ);
            if (dx * dx + dz * dz > maximumReach * maximumReach) return default;
            double forwardX = Math.Sin(rickshawYaw), forwardZ = Math.Cos(rickshawYaw);
            ObbHitResult front = TestCircleVsObb(rx + forwardX * 0.44, rz + forwardZ * 0.44, 0.47, cx, cz, halfX, halfZ, colliderYaw);
            ObbHitResult rear = TestCircleVsObb(rx - forwardX * 0.46, rz - forwardZ * 0.46, 0.50, cx, cz, halfX, halfZ, colliderYaw);
            if (!front.Hit && !rear.Hit) return default;
            return front.Hit && (!rear.Hit || front.Penetration >= rear.Penetration) ? front : rear;
        }
    }

    /// <summary>Reusable 16 m spatial hash; no managed allocation in the fixed-step query.</summary>
    public sealed class CollisionWorld
    {
        private readonly List<BoxColliderData> colliders;
        private readonly Dictionary<int, List<BoxColliderData>> buckets = new();
        private readonly List<BoxColliderData> nearby = new();
        private int stamp;
        private bool indexed;

        public CollisionWorld(List<BoxColliderData> colliders)
        {
            this.colliders = colliders ?? new List<BoxColliderData>();
            Rebuild();
        }

        public Func<int, double, double, double, double, bool>? OnBreakableHit { get; set; }
        public IReadOnlyList<BoxColliderData> Colliders => colliders;

        public void Rebuild()
        {
            buckets.Clear();
            indexed = colliders.Count > 24;
            if (!indexed) return;
            foreach (BoxColliderData box in colliders)
            {
                if (box.Height < 0.35) continue;
                int x0 = (int)Math.Floor(box.MinX / 16.0), x1 = (int)Math.Floor(box.MaxX / 16.0);
                int z0 = (int)Math.Floor(box.MinZ / 16.0), z1 = (int)Math.Floor(box.MaxZ / 16.0);
                for (int x = x0; x <= x1; x++) for (int z = z0; z <= z1; z++)
                {
                    int key = ((x + 2048) << 12) | ((z + 2048) & 0xfff);
                    if (!buckets.TryGetValue(key, out List<BoxColliderData>? list)) buckets[key] = list = new List<BoxColliderData>();
                    list.Add(box);
                }
            }
        }

        private IReadOnlyList<BoxColliderData> Candidates(double x, double z)
        {
            if (!indexed) return colliders;
            nearby.Clear();
            stamp = (stamp + 1) & 0x3fffffff;
            int x0 = (int)Math.Floor((x - 2.4) / 16.0), x1 = (int)Math.Floor((x + 2.4) / 16.0);
            int z0 = (int)Math.Floor((z - 2.4) / 16.0), z1 = (int)Math.Floor((z + 2.4) / 16.0);
            for (int gx = x0; gx <= x1; gx++) for (int gz = z0; gz <= z1; gz++)
            {
                int key = ((gx + 2048) << 12) | ((gz + 2048) & 0xfff);
                if (!buckets.TryGetValue(key, out List<BoxColliderData>? list)) continue;
                foreach (BoxColliderData box in list)
                {
                    if (box.Stamp == stamp) continue;
                    box.Stamp = stamp;
                    nearby.Add(box);
                }
            }
            return nearby;
        }

        public CollisionResult Resolve(RickshawDynamics vehicle, bool applyVelocityResponse)
        {
            CollisionResult result = new() { ContactX = vehicle.X, ContactZ = vehicle.Z };
            if (applyVelocityResponse) vehicle.LastContact = default;
            IReadOnlyList<BoxColliderData> candidates = Candidates(vehicle.X, vehicle.Z);
            for (int pass = 0; pass < 2; pass++)
            for (int i = 0; i < candidates.Count; i++)
            {
                BoxColliderData box = candidates[i];
                if (box.Disabled || box.Height < 0.35 || vehicle.X + 0.98 < box.MinX || vehicle.X - 0.98 > box.MaxX ||
                    vehicle.Z + 0.98 < box.MinZ || vehicle.Z - 0.98 > box.MaxZ) continue;
                box.GetShape(out double cx, out double cz, out double hx, out double hz, out double yaw);
                ObbHitResult hit = RickshawCollision.TestRickshawCapsuleVsObb(vehicle.X, vehicle.Z, vehicle.Yaw, cx, cz, hx, hz, yaw);
                if (!hit.Hit) continue;
                double preSpeed = Math.Abs(vehicle.Speed);
                if (box.BreakableId >= 0 && OnBreakableHit is not null && OnBreakableHit(box.BreakableId, preSpeed, vehicle.X, vehicle.Z, vehicle.Yaw))
                {
                    box.Disabled = true;
                    double smash = Math.Min(2.6, preSpeed * 0.34 + 0.32);
                    if (smash > result.Magnitude) SetImpact(ref result, hit, smash);
                    if (applyVelocityResponse) vehicle.Speed *= 0.76;
                    continue;
                }
                vehicle.X += hit.PushX; vehicle.Z += hit.PushZ;
                if (!applyVelocityResponse) continue;
                double moveSign = vehicle.Speed >= 0.0 ? 1.0 : -1.0;
                double directionX = Math.Sin(vehicle.Yaw) * moveSign, directionZ = Math.Cos(vehicle.Yaw) * moveSign;
                double intoWall = Math.Max(0.0, -(directionX * hit.NormalX + directionZ * hit.NormalZ));
                if (intoWall <= 0.04 || preSpeed <= 0.05) continue;
                double magnitude = Math.Min(3.2, preSpeed * intoWall * 0.52 + (intoWall > 0.35 ? 0.22 : 0.05));
                if (magnitude > result.Magnitude) SetImpact(ref result, hit, magnitude);
                double tangentKeep = Math.Sqrt(Math.Max(0.0, 1.0 - intoWall * intoWall)) * 0.96;
                vehicle.Speed *= tangentKeep;
                vehicle.LateralSlip *= 0.35;
                if (Math.Abs(vehicle.Speed) < 0.05) vehicle.Speed = 0.0;
                if (intoWall > 0.15 && intoWall < 0.88 && preSpeed > 1.2)
                {
                    double cross = directionX * hit.NormalZ - directionZ * hit.NormalX;
                    vehicle.Yaw = Numerics.NormalizeAngle(vehicle.Yaw - Math.Sign(cross) * intoWall * 0.035);
                }
            }
            if (applyVelocityResponse && result.Magnitude > 0.05)
                vehicle.LastContact = new ContactDebugInfo { Active = true, X = result.ContactX, Z = result.ContactZ,
                    NormalX = result.NormalX, NormalZ = result.NormalZ, Magnitude = result.Magnitude };
            return result;
        }

        private static void SetImpact(ref CollisionResult result, ObbHitResult hit, double magnitude)
        {
            result.Magnitude = magnitude; result.NormalX = hit.NormalX; result.NormalZ = hit.NormalZ;
            result.ContactX = hit.ContactX; result.ContactZ = hit.ContactZ;
        }
    }
}
