using System;
using System.Collections.Generic;
using System.Linq;

namespace BanglarTesla.Domain.Maps
{
    // These DTO field names intentionally match the versioned importer JSON contract.
    [Serializable] public sealed class MapSource
    {
        public string provider = string.Empty;
        public string license = string.Empty;
        public string copyright = string.Empty;
        public string licenseUrl = string.Empty;
        public string attributionUrl = string.Empty;
        public string boundaryUrl = string.Empty;
        public string overpassUrl = string.Empty;
        public long boundaryWayId;
        public string retrievedAt = string.Empty;
        public string boundarySha256 = string.Empty;
        public string overpassSha256 = string.Empty;
        public string query = string.Empty;
    }

    [Serializable] public struct GeoCoordinate
    {
        public double lat;
        public double lon;
        public GeoCoordinate(double latitude, double longitude) { lat = latitude; lon = longitude; }
        public GeoPoint ToGeoPoint() => new(lat, lon);
    }

    [Serializable] public struct GeoBounds
    {
        public double south;
        public double north;
        public double west;
        public double east;
    }

    [Serializable] public sealed class RoadData
    {
        public long id;
        public List<long> nodeIds = new();
        public List<GeoCoordinate> geometry = new();
        public string name = string.Empty;
        public string nameBn = string.Empty;
        public string nameEn = string.Empty;
        public string highway = string.Empty;
        public double widthMeters;
        public double sourceWidthMeters;
        public string widthSource = "estimated:road-class";
        public int lanes;
        public string oneWay = "no";
        public string surface = "unknown";
        public bool driveable;
        public bool HasExplicitWidth => widthSource == "osm:width";
    }

    [Serializable] public sealed class PoiData
    {
        public long id;
        public string osmType = "node";
        public string name = string.Empty;
        public string nameBn = string.Empty;
        public string nameEn = string.Empty;
        public GeoCoordinate center;
        public List<long> nodeIds = new();
        public List<GeoCoordinate> geometry = new();
    }

    [Serializable] public sealed class BoundaryExitData
    {
        public long wayId;
        public int roadSegmentIndex;
        public int boundarySegmentIndex;
        public GeoCoordinate point;
    }

    [Serializable] public sealed class MapDataset
    {
        public int schemaVersion = 1;
        public string district = string.Empty;
        public string status = string.Empty;
        public MapSource source = new();
        public GeoBounds bounds;
        public GeoCoordinate origin;
        public List<GeoCoordinate> boundary = new();
        public List<RoadData> roads = new();
        public List<PoiData> pois = new();
        public List<BoundaryExitData> boundaryExits = new();

        public List<string> Validate()
        {
            var errors = new List<string>();
            if (schemaVersion != 1) errors.Add("Unsupported map schema version.");
            if (source is null || source.license != "ODbL-1.0") errors.Add("ODbL source metadata is required.");
            if (origin.ToGeoPoint().IsValid == false) errors.Add("Invalid map origin.");
            if (boundary is null || boundary.Count < 4) errors.Add("A closed boundary with at least four points is required.");
            if (roads is null || roads.Count == 0) errors.Add("At least one road is required.");
            if (roads is not null)
            {
                var ids = new HashSet<long>();
                foreach (RoadData? road in roads)
                {
                    if (road is null || !ids.Add(road.id)) { errors.Add("Road IDs must be present and unique."); continue; }
                    if (road.geometry is null || road.geometry.Count < 2) errors.Add($"Road {road.id} has insufficient geometry.");
                    if (!double.IsFinite(road.widthMeters) || road.widthMeters <= 0.0) errors.Add($"Road {road.id} has invalid width.");
                    if (road.HasExplicitWidth && (!double.IsFinite(road.sourceWidthMeters) || road.sourceWidthMeters <= 0.0))
                        errors.Add($"Road {road.id} is missing its explicit source width.");
                    if (road.geometry is not null && road.geometry.Any(point => !point.ToGeoPoint().IsValid))
                        errors.Add($"Road {road.id} contains invalid coordinates.");
                }
            }
            return errors;
        }
    }

    public readonly struct RoadProjection
    {
        public readonly int RoadIndex;
        public readonly int SegmentIndex;
        public readonly Vector2D Point;
        public readonly Vector2D Tangent;
        public readonly double Distance;
        public readonly double DistanceAlongRoad;

        public RoadProjection(int roadIndex, int segmentIndex, Vector2D point, Vector2D tangent, double distance, double distanceAlongRoad)
        {
            RoadIndex = roadIndex; SegmentIndex = segmentIndex; Point = point; Tangent = tangent;
            Distance = distance; DistanceAlongRoad = distanceAlongRoad;
        }
    }

    public sealed class RoadModel
    {
        public RoadModel(RoadData data, IReadOnlyList<Vector2D> points)
        {
            Data = data; Points = points;
            CumulativeLengths = new double[points.Count];
            for (int i = 1; i < points.Count; i++)
                CumulativeLengths[i] = CumulativeLengths[i - 1] + Vector2D.Distance(points[i - 1], points[i]);
        }
        public RoadData Data { get; }
        public IReadOnlyList<Vector2D> Points { get; }
        public double[] CumulativeLengths { get; }
        public double Length => CumulativeLengths.Length == 0 ? 0.0 : CumulativeLengths[^1];
    }

    public sealed class RoadNode
    {
        public RoadNode(long id, Vector2D position) { Id = id; Position = position; }
        public long Id { get; }
        public Vector2D Position { get; }
        public List<(long To, double Cost)> Edges { get; } = new();
    }

    /// <summary>Source-preserving local road geometry and a junction graph for deterministic routing.</summary>
    public sealed class RoadGraph
    {
        private readonly Dictionary<long, RoadNode> nodes = new();

        public RoadGraph(MapDataset dataset)
        {
            Dataset = dataset ?? throw new ArgumentNullException(nameof(dataset));
            List<string> errors = dataset.Validate();
            if (errors.Count > 0)
                throw new ArgumentException("Invalid map dataset: " + string.Join(" ", errors), nameof(dataset));
            Projection = new GeoProjection(dataset.origin.ToGeoPoint());
            Roads = dataset.roads.Select(road => new RoadModel(road, road.geometry.Select(point => Projection.ToLocal(point.ToGeoPoint())).ToArray())).ToArray();
            BuildNodes();
        }

        public MapDataset Dataset { get; }
        public GeoProjection Projection { get; }
        public IReadOnlyList<RoadModel> Roads { get; }
        public IReadOnlyDictionary<long, RoadNode> Nodes => nodes;

        private void BuildNodes()
        {
            foreach (RoadModel road in Roads)
            {
                if (!road.Data.driveable) continue;
                for (int i = 0; i < road.Data.nodeIds.Count && i < road.Points.Count; i++)
                {
                    long id = road.Data.nodeIds[i];
                    if (!nodes.TryGetValue(id, out RoadNode? node))
                    {
                        node = new RoadNode(id, road.Points[i]);
                        nodes.Add(id, node);
                    }
                }
            }
            foreach (RoadModel road in Roads)
            {
                if (!road.Data.driveable) continue;
                int count = Math.Min(road.Data.nodeIds.Count, road.Points.Count);
                for (int i = 0; i + 1 < count; i++)
                {
                    long fromId = road.Data.nodeIds[i];
                    long toId = road.Data.nodeIds[i + 1];
                    if (!nodes.TryGetValue(fromId, out RoadNode? from) || !nodes.TryGetValue(toId, out RoadNode? to)) continue;
                    double cost = Vector2D.Distance(from.Position, to.Position);
                    if (cost < 0.001) continue;
                    bool reverseOnly = road.Data.oneWay == "-1";
                    bool oneWay = road.Data.oneWay is "yes" or "true" or "1" or "-1";
                    if (!oneWay || !reverseOnly) from.Edges.Add((toId, cost));
                    if (!oneWay || reverseOnly) to.Edges.Add((fromId, cost));
                }
            }
        }

        public RoadProjection FindNearest(Vector2D point, bool driveableOnly = true)
        {
            RoadProjection best = default;
            double bestDistanceSquared = double.PositiveInfinity;
            for (int roadIndex = 0; roadIndex < Roads.Count; roadIndex++)
            {
                RoadModel road = Roads[roadIndex];
                if (driveableOnly && !road.Data.driveable) continue;
                for (int segment = 0; segment + 1 < road.Points.Count; segment++)
                {
                    Vector2D a = road.Points[segment];
                    Vector2D b = road.Points[segment + 1];
                    Vector2D delta = b - a;
                    double lengthSquared = delta.LengthSquared;
                    if (lengthSquared < 1e-10) continue;
                    double t = Numerics.Clamp01(Vector2D.Dot(point - a, delta) / lengthSquared);
                    Vector2D projected = a + delta * t;
                    double distanceSquared = Vector2D.DistanceSquared(point, projected);
                    if (distanceSquared >= bestDistanceSquared) continue;
                    double length = Math.Sqrt(lengthSquared);
                    bestDistanceSquared = distanceSquared;
                    best = new RoadProjection(roadIndex, segment, projected, delta / length, Math.Sqrt(distanceSquared), road.CumulativeLengths[segment] + length * t);
                }
            }
            return best;
        }

        public RoadNode? NearestNode(Vector2D point)
        {
            RoadNode? nearest = null;
            double best = double.PositiveInfinity;
            foreach (RoadNode node in nodes.Values)
            {
                double distance = Vector2D.DistanceSquared(point, node.Position);
                if (distance < best) { best = distance; nearest = node; }
            }
            return nearest;
        }

        public IReadOnlyList<Vector2D> FindRoute(long startId, long destinationId)
        {
            if (!nodes.TryGetValue(startId, out RoadNode? start) || !nodes.TryGetValue(destinationId, out RoadNode? destination))
                return Array.Empty<Vector2D>();
            var distance = new Dictionary<long, double> { [startId] = 0.0 };
            var previous = new Dictionary<long, long>();
            var open = new HashSet<long> { startId };
            var closed = new HashSet<long>();
            while (open.Count > 0)
            {
                long current = open.OrderBy(id => distance[id] + Vector2D.Distance(nodes[id].Position, destination.Position)).First();
                open.Remove(current);
                if (current == destinationId) break;
                closed.Add(current);
                foreach ((long to, double cost) in nodes[current].Edges)
                {
                    if (closed.Contains(to)) continue;
                    double candidate = distance[current] + cost;
                    if (distance.TryGetValue(to, out double old) && candidate >= old) continue;
                    distance[to] = candidate;
                    previous[to] = current;
                    open.Add(to);
                }
            }
            if (!distance.ContainsKey(destinationId)) return Array.Empty<Vector2D>();
            var route = new List<Vector2D> { destination.Position };
            long cursor = destinationId;
            while (cursor != startId)
            {
                cursor = previous[cursor];
                route.Add(nodes[cursor].Position);
            }
            route.Reverse();
            return route;
        }

        public bool IsInsideBoundary(Vector2D point)
        {
            bool inside = false;
            IReadOnlyList<GeoCoordinate> source = Dataset.boundary;
            for (int i = 0, j = source.Count - 1; i < source.Count; j = i++)
            {
                Vector2D a = Projection.ToLocal(source[i].ToGeoPoint());
                Vector2D b = Projection.ToLocal(source[j].ToGeoPoint());
                if ((a.Z > point.Z) != (b.Z > point.Z) &&
                    point.X < (b.X - a.X) * (point.Z - a.Z) / (b.Z - a.Z) + a.X)
                    inside = !inside;
            }
            return inside;
        }
    }
}
