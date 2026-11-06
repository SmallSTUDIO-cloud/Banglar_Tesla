using System;
using System.Runtime.CompilerServices;

namespace BanglarTesla.Domain
{
    internal static class Numerics
    {
        internal const double Tau = Math.PI * 2.0;
        internal const double EarthRadiusMeters = 6378137.0;

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal static double Clamp(double value, double minimum, double maximum)
        {
            return value < minimum ? minimum : value > maximum ? maximum : value;
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal static float Clamp(float value, float minimum, float maximum)
        {
            return value < minimum ? minimum : value > maximum ? maximum : value;
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal static int Clamp(int value, int minimum, int maximum)
        {
            return value < minimum ? minimum : value > maximum ? maximum : value;
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal static double Clamp01(double value) => Clamp(value, 0.0, 1.0);

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal static double Lerp(double from, double to, double amount) => from + (to - from) * amount;

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal static double MoveTowards(double value, double target, double maximumDelta)
        {
            if (Math.Abs(target - value) <= maximumDelta)
                return target;
            return value + Math.Sign(target - value) * maximumDelta;
        }

        internal static double Damp(double value, double target, double rate, double deltaTime)
        {
            return value + (target - value) * (1.0 - Math.Exp(-rate * deltaTime));
        }

        internal static double NormalizeMinutes(double minutes)
        {
            if (!double.IsFinite(minutes))
                return 480.0;
            minutes %= 1440.0;
            return minutes < 0.0 ? minutes + 1440.0 : minutes;
        }

        internal static double NormalizeAngle(double radians)
        {
            radians %= Tau;
            return radians < 0.0 ? radians + Tau : radians;
        }
    }

    [Serializable]
    public struct Vector2D : IEquatable<Vector2D>
    {
        public double X;
        public double Z;

        public Vector2D(double x, double z)
        {
            X = x;
            Z = z;
        }

        public static Vector2D Zero => default;
        public double LengthSquared => X * X + Z * Z;
        public double Length => Math.Sqrt(LengthSquared);
        public static double DistanceSquared(Vector2D a, Vector2D b) => (a - b).LengthSquared;
        public static double Distance(Vector2D a, Vector2D b) => (a - b).Length;
        public static double Dot(Vector2D a, Vector2D b) => a.X * b.X + a.Z * b.Z;

        public Vector2D Normalized()
        {
            double length = Length;
            return length > 1e-12 ? this / length : Zero;
        }

        public bool IsFinite => double.IsFinite(X) && double.IsFinite(Z);

        public bool Equals(Vector2D other) => X.Equals(other.X) && Z.Equals(other.Z);
        public override bool Equals(object? obj) => obj is Vector2D other && Equals(other);
        public override int GetHashCode() => HashCode.Combine(X, Z);
        public override string ToString() => FormattableString.Invariant($"({X:0.###}, {Z:0.###})");

        public static Vector2D operator +(Vector2D a, Vector2D b) => new(a.X + b.X, a.Z + b.Z);
        public static Vector2D operator -(Vector2D a, Vector2D b) => new(a.X - b.X, a.Z - b.Z);
        public static Vector2D operator -(Vector2D value) => new(-value.X, -value.Z);
        public static Vector2D operator *(Vector2D value, double scale) => new(value.X * scale, value.Z * scale);
        public static Vector2D operator *(double scale, Vector2D value) => value * scale;
        public static Vector2D operator /(Vector2D value, double divisor) => new(value.X / divisor, value.Z / divisor);
        public static bool operator ==(Vector2D a, Vector2D b) => a.Equals(b);
        public static bool operator !=(Vector2D a, Vector2D b) => !a.Equals(b);
    }

    [Serializable]
    public struct GeoPoint
    {
        public double Latitude;
        public double Longitude;

        public GeoPoint(double latitude, double longitude)
        {
            Latitude = latitude;
            Longitude = longitude;
        }

        public bool IsValid =>
            double.IsFinite(Latitude) && double.IsFinite(Longitude) &&
            Latitude is >= -90.0 and <= 90.0 && Longitude is >= -180.0 and <= 180.0;
    }

    /// <summary>Local equirectangular projection for the small Mohammadpur district.</summary>
    public sealed class GeoProjection
    {
        private readonly double longitudeScale;

        public GeoProjection(GeoPoint origin)
        {
            if (!origin.IsValid)
                throw new ArgumentException("Projection origin must be a valid geographic coordinate.", nameof(origin));
            Origin = origin;
            longitudeScale = Math.Cos(origin.Latitude * Math.PI / 180.0);
            if (Math.Abs(longitudeScale) < 1e-8)
                throw new ArgumentException("Projection is undefined at a pole.", nameof(origin));
        }

        public GeoPoint Origin { get; }

        public Vector2D ToLocal(GeoPoint point)
        {
            if (!point.IsValid)
                throw new ArgumentException("Invalid geographic coordinate.", nameof(point));
            const double degreesToRadians = Math.PI / 180.0;
            return new Vector2D(
                (point.Longitude - Origin.Longitude) * degreesToRadians * Numerics.EarthRadiusMeters * longitudeScale,
                (point.Latitude - Origin.Latitude) * degreesToRadians * Numerics.EarthRadiusMeters);
        }

        public GeoPoint ToGeo(Vector2D point)
        {
            if (!point.IsFinite)
                throw new ArgumentException("Invalid local coordinate.", nameof(point));
            const double radiansToDegrees = 180.0 / Math.PI;
            return new GeoPoint(
                Origin.Latitude + point.Z / Numerics.EarthRadiusMeters * radiansToDegrees,
                Origin.Longitude + point.X / (Numerics.EarthRadiusMeters * longitudeScale) * radiansToDegrees);
        }

        public static double GreatCircleDistanceMeters(GeoPoint a, GeoPoint b)
        {
            const double degreesToRadians = Math.PI / 180.0;
            double lat1 = a.Latitude * degreesToRadians;
            double lat2 = b.Latitude * degreesToRadians;
            double dLat = (b.Latitude - a.Latitude) * degreesToRadians;
            double dLon = (b.Longitude - a.Longitude) * degreesToRadians;
            double sinLat = Math.Sin(dLat * 0.5);
            double sinLon = Math.Sin(dLon * 0.5);
            double h = sinLat * sinLat + Math.Cos(lat1) * Math.Cos(lat2) * sinLon * sinLon;
            return 2.0 * Numerics.EarthRadiusMeters * Math.Asin(Math.Min(1.0, Math.Sqrt(h)));
        }
    }
}
