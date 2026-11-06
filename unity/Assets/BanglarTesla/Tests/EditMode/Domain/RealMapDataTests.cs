#if NET8_0
using System;
using System.IO;
using System.Linq;
using BanglarTesla.Domain;
using BanglarTesla.Domain.Maps;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class RealMapDataTests
    {
        [Test]
        public void GeneratedOsmDatasetDeserializesAndBuildsTheRealRoadGraph()
        {
            string path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "mohammadpur.osm.json");
            MapDataset dataset = MapJson.Deserialize(File.ReadAllText(path));
            Assert.That(dataset.roads.Count, Is.GreaterThan(1000));
            Assert.That(dataset.boundaryExits.Count, Is.GreaterThan(0));
            Assert.That(dataset.pois.Single(poi => poi.id == 13990591896).nameEn, Is.EqualTo("Chanmia Housing"));
            var graph = new RoadGraph(dataset);
            Assert.That(graph.Nodes.Count, Is.GreaterThan(1000));
            Vector2D busStand = graph.Projection.ToLocal(new GeoPoint(23.7569928, 90.3617359));
            RoadProjection nearest = graph.FindNearest(busStand);
            Assert.That(nearest.Distance, Is.LessThan(100.0));
        }

        [Test]
        public void SpatialRoadQueriesMatchExhaustiveNearestSegmentResults()
        {
            string path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "mohammadpur.osm.json");
            var graph = new RoadGraph(MapJson.Deserialize(File.ReadAllText(path)));
            Vector2D[] queries = new[]
            {
                graph.Projection.ToLocal(new GeoPoint(23.7569928, 90.3617359)),
                Vector2D.Zero, new Vector2D(100.0, -200.0), new Vector2D(-500.0, 700.0),
                new Vector2D(10000.0, -8000.0),
            };
            foreach (Vector2D query in queries)
            {
                RoadProjection actual = graph.FindNearest(query);
                RoadProjection expected = ExhaustiveNearest(graph, query);
                Assert.That(actual.Distance, Is.EqualTo(expected.Distance).Within(1e-8), $"Distance at {query}");
                Assert.That(actual.Point.X, Is.EqualTo(expected.Point.X).Within(1e-7), $"X at {query}");
                Assert.That(actual.Point.Z, Is.EqualTo(expected.Point.Z).Within(1e-7), $"Z at {query}");
            }
        }

        private static RoadProjection ExhaustiveNearest(RoadGraph graph, Vector2D point)
        {
            RoadProjection best = default;
            double bestDistance = double.PositiveInfinity;
            for (int roadIndex = 0; roadIndex < graph.Roads.Count; roadIndex++)
            {
                RoadModel road = graph.Roads[roadIndex];
                if (!road.Data.driveable) continue;
                for (int segment = 0; segment + 1 < road.Points.Count; segment++)
                {
                    Vector2D a = road.Points[segment], delta = road.Points[segment + 1] - a;
                    double lengthSquared = delta.LengthSquared;
                    if (lengthSquared < 1e-10) continue;
                    double t = Math.Clamp(Vector2D.Dot(point - a, delta) / lengthSquared, 0.0, 1.0);
                    Vector2D projected = a + delta * t;
                    double distance = Vector2D.DistanceSquared(point, projected);
                    if (distance >= bestDistance) continue;
                    double length = Math.Sqrt(lengthSquared);
                    bestDistance = distance;
                    best = new RoadProjection(roadIndex, segment, projected, delta / length, Math.Sqrt(distance), road.CumulativeLengths[segment] + length * t);
                }
            }
            return best;
        }
    }
}
#endif
