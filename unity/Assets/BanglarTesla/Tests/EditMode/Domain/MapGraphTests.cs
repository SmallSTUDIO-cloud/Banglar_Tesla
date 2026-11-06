using System.Collections.Generic;
using System.Linq;
using BanglarTesla.Domain;
using BanglarTesla.Domain.Maps;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class MapGraphTests
    {
        [Test]
        public void ProjectionRoundTripsWithinSubMillimetreAtDistrictScale()
        {
            var projection = new GeoProjection(new GeoPoint(23.758, 90.358));
            var point = new GeoPoint(23.7592, 90.3591);
            GeoPoint roundTrip = projection.ToGeo(projection.ToLocal(point));
            Assert.That(roundTrip.Latitude, Is.EqualTo(point.Latitude).Within(1e-10));
            Assert.That(roundTrip.Longitude, Is.EqualTo(point.Longitude).Within(1e-10));
            Assert.That(GeoProjection.GreatCircleDistanceMeters(point, roundTrip), Is.LessThan(0.001));
        }

        [Test]
        public void SharedOsmNodesCreateRoutesAndOneWayOrderIsRespected()
        {
            MapDataset map = CreateMap("yes");
            var graph = new RoadGraph(map);
            IReadOnlyList<Vector2D> forward = graph.FindRoute(1, 3);
            Assert.That(forward, Has.Count.EqualTo(3));
            Assert.That(graph.FindRoute(3, 1), Is.Empty);
            Assert.That(graph.IsInsideBoundary(Vector2D.Zero), Is.True);
        }

        [Test]
        public void TwoWayRoadCanRouteInBothDirections()
        {
            var graph = new RoadGraph(CreateMap("no"));
            Assert.That(graph.FindRoute(1, 3), Has.Count.EqualTo(3));
            Assert.That(graph.FindRoute(3, 1), Has.Count.EqualTo(3));
        }

        [Test]
        public void NearestRoadProjectionPreservesWidthProvenance()
        {
            var graph = new RoadGraph(CreateMap("no"));
            RoadProjection projection = graph.FindNearest(new Vector2D(20, 10));
            Assert.That(graph.Roads[projection.RoadIndex].Data.widthSource, Is.EqualTo("osm:width"));
            Assert.That(graph.Roads[projection.RoadIndex].Data.sourceWidthMeters, Is.EqualTo(6.0));
            Assert.That(projection.Distance, Is.GreaterThan(0));
        }

        [Test]
        public void ExplicitWidthWithoutSourceMeasurementIsRejected()
        {
            MapDataset map = CreateMap("no");
            map.roads[0].sourceWidthMeters = 0;
            Assert.That(map.Validate().Any(error => error.Contains("explicit source width")), Is.True);
        }

        private static MapDataset CreateMap(string oneWay)
        {
            var map = new MapDataset
            {
                origin = new GeoCoordinate(23.758, 90.358),
                source = new MapSource { license = "ODbL-1.0" },
                boundary = new List<GeoCoordinate>
                {
                    new(23.757, 90.357), new(23.759, 90.357), new(23.759, 90.360),
                    new(23.757, 90.360), new(23.757, 90.357),
                },
            };
            map.roads.Add(Road(1, 1, 2, new GeoCoordinate(23.758, 90.358), new GeoCoordinate(23.758, 90.359), oneWay));
            map.roads.Add(Road(2, 2, 3, new GeoCoordinate(23.758, 90.359), new GeoCoordinate(23.759, 90.359), oneWay));
            return map;
        }

        private static RoadData Road(long id, long from, long to, GeoCoordinate a, GeoCoordinate b, string oneWay) => new()
        {
            id = id, nodeIds = new List<long> { from, to }, geometry = new List<GeoCoordinate> { a, b },
            driveable = true, highway = "residential", widthMeters = 6.0, sourceWidthMeters = 6.0,
            widthSource = "osm:width", oneWay = oneWay,
        };
    }
}
