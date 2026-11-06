using System;
using System.Collections.Generic;
using BanglarTesla.Domain;
using BanglarTesla.Domain.Maps;
using NUnit.Framework;

namespace BanglarTesla.Tests.EditMode.Domain
{
    public sealed class TrafficTests
    {
        private const double FixedStep = 1.0 / 60.0;

        [Test]
        public void PopulatePlacesEveryAgentOnADriveableRoad()
        {
            var graph = new RoadGraph(CreateGridMap());
            var traffic = new TrafficSimulation(graph, new TrafficConfig { MaxAgents = 40 }, new Random(7).NextDouble);
            int spawned = traffic.Populate(Vector2D.Zero, 30);
            Assert.That(spawned, Is.EqualTo(30));
            Assert.That(traffic.Count, Is.EqualTo(30));
            foreach (TrafficAgent agent in traffic.Agents)
            {
                Assert.That(graph.Roads[agent.RoadIndex].Data.driveable, Is.True);
                Assert.That(double.IsFinite(agent.X) && double.IsFinite(agent.Z), Is.True);
                // Lane offset is applied to the left of travel, so the agent stays within the carriageway.
                RoadProjection nearest = graph.FindNearest(agent.Position);
                Assert.That(nearest.Distance, Is.LessThan(graph.Roads[nearest.RoadIndex].Data.widthMeters * 0.5 + 0.001));
            }
        }

        [Test]
        public void SameSeedProducesIdenticalMovement()
        {
            var graph = new RoadGraph(CreateGridMap());
            var first = new TrafficSimulation(graph, new TrafficConfig { MaxAgents = 25 }, new Random(11).NextDouble);
            var second = new TrafficSimulation(graph, new TrafficConfig { MaxAgents = 25 }, new Random(11).NextDouble);
            first.Populate(Vector2D.Zero, 20);
            second.Populate(Vector2D.Zero, 20);
            for (int step = 0; step < 600; step++) { first.Step(FixedStep); second.Step(FixedStep); }
            Assert.That(second.Count, Is.EqualTo(first.Count));
            for (int index = 0; index < first.Count; index++)
            {
                Assert.That(second.Agents[index].X, Is.EqualTo(first.Agents[index].X).Within(1e-9));
                Assert.That(second.Agents[index].Z, Is.EqualTo(first.Agents[index].Z).Within(1e-9));
                Assert.That(second.Agents[index].RoadIndex, Is.EqualTo(first.Agents[index].RoadIndex));
            }
        }

        [Test]
        public void FollowingVehiclesDoNotOverlapTheVehicleAhead()
        {
            var graph = new RoadGraph(CreateGridMap());
            var traffic = new TrafficSimulation(graph, new TrafficConfig { MaxAgents = 30 }, new Random(3).NextDouble);
            traffic.Populate(Vector2D.Zero, 24);
            for (int step = 0; step < 900; step++) traffic.Step(FixedStep);
            var groups = new Dictionary<(int Road, int Direction), List<TrafficAgent>>();
            foreach (TrafficAgent agent in traffic.Agents)
            {
                var key = (agent.RoadIndex, agent.Direction);
                if (!groups.TryGetValue(key, out List<TrafficAgent>? list)) groups[key] = list = new List<TrafficAgent>();
                list.Add(agent);
            }
            foreach (List<TrafficAgent> list in groups.Values)
            {
                list.Sort((left, right) => left.Along.CompareTo(right.Along));
                for (int index = 0; index + 1 < list.Count; index++)
                {
                    TrafficAgent follower = list[index], leader = list[index + 1];
                    double centreGap = leader.Along - follower.Along;
                    double touching = (follower.Length + leader.Length) * 0.5;
                    Assert.That(centreGap, Is.GreaterThanOrEqualTo(0.0), "Traffic agents interpenetrated.");
                    Assert.That(centreGap, Is.GreaterThanOrEqualTo(touching), "Traffic agents overlapped after settling.");
                }
            }
        }

        [Test]
        public void StepKeepsSpeedsFiniteAndNonNegative()
        {
            var graph = new RoadGraph(CreateGridMap());
            var traffic = new TrafficSimulation(graph, new TrafficConfig { MaxAgents = 20 }, new Random(5).NextDouble);
            traffic.Populate(Vector2D.Zero, 15);
            for (int step = 0; step < 1200; step++)
            {
                traffic.Step(FixedStep);
                foreach (TrafficAgent agent in traffic.Agents)
                {
                    Assert.That(double.IsFinite(agent.Speed), Is.True);
                    Assert.That(double.IsFinite(agent.X) && double.IsFinite(agent.Z) && double.IsFinite(agent.Yaw), Is.True);
                    Assert.That(agent.Speed, Is.GreaterThanOrEqualTo(0.0));
                    Assert.That(agent.Speed, Is.LessThanOrEqualTo(traffic.Config.MaximumSpeed + 1e-6));
                }
            }
        }

        [Test]
        public void OneWayRoadIsOnlyTravelledForwards()
        {
            var graph = new RoadGraph(CreateGridMap(oneWay: "yes"));
            var traffic = new TrafficSimulation(graph, new TrafficConfig { MaxAgents = 20 }, new Random(9).NextDouble);
            traffic.Populate(Vector2D.Zero, 16);
            for (int step = 0; step < 600; step++)
            {
                traffic.Step(FixedStep);
                foreach (TrafficAgent agent in traffic.Agents)
                    Assert.That(agent.Direction, Is.EqualTo(1), "A one-way road must never be driven in reverse.");
            }
        }

        [Test]
        public void OneWayDeadEndsRecycleInsteadOfBlockingTheRoadForever()
        {
            // The synthetic one-way map has dead ends with no legal continuation. Without
            // recycling a vehicle would stop there permanently and block the road.
            var graph = new RoadGraph(CreateGridMap(oneWay: "yes"));
            var traffic = new TrafficSimulation(graph, new TrafficConfig { MaxAgents = 30 }, new Random(13).NextDouble);
            traffic.Populate(Vector2D.Zero, 20);
            for (int step = 0; step < 900; step++) traffic.Step(FixedStep);

            double[] startX = new double[traffic.Count], startZ = new double[traffic.Count];
            for (int index = 0; index < traffic.Count; index++)
            {
                startX[index] = traffic.Agents[index].X;
                startZ[index] = traffic.Agents[index].Z;
            }
            for (int step = 0; step < 300; step++) traffic.Step(FixedStep);

            int moved = 0;
            for (int index = 0; index < traffic.Count; index++)
            {
                double dx = traffic.Agents[index].X - startX[index];
                double dz = traffic.Agents[index].Z - startZ[index];
                if (dx * dx + dz * dz > 1.0) moved++;
            }
            Assert.That(moved, Is.GreaterThanOrEqualTo(traffic.Count / 2),
                "Traffic stalled permanently after encountering one-way dead ends.");
        }

        [Test]
        public void SpeedChangePerStepStaysWithinAccelerationLimits()
        {
            var graph = new RoadGraph(CreateGridMap());
            var traffic = new TrafficSimulation(graph, new TrafficConfig { MaxAgents = 1, Acceleration = 2.0, Braking = 6.0 }, new Random(1).NextDouble);
            traffic.Populate(Vector2D.Zero, 1);
            TrafficAgent agent = traffic.Agents[0];
            double before = agent.Speed;
            traffic.Step(FixedStep);
            Assert.That(Math.Abs(agent.Speed - before), Is.LessThanOrEqualTo(6.0 * FixedStep + 1e-9));
        }

        [Test]
        public void TrafficSurvivesAtLeastTwoThousandFixedStepsWithoutExceptions()
        {
            var graph = new RoadGraph(CreateGridMap());
            var traffic = new TrafficSimulation(graph, new TrafficConfig { MaxAgents = 40 }, new Random(21).NextDouble);
            traffic.Populate(Vector2D.Zero, 35);
            Assert.DoesNotThrow(() =>
            {
                for (int step = 0; step < 2000; step++) traffic.Step(FixedStep);
            });
            Assert.That(traffic.Count, Is.EqualTo(35));
        }

        /// <summary>
        /// Small synthetic grid: two north-south and two east-west road chains that share
        /// junction nodes, plus a closed boundary. Coordinates are illustrative, not sourced.
        /// </summary>
        private static MapDataset CreateGridMap(string oneWay = "no")
        {
            var map = new MapDataset
            {
                origin = new GeoCoordinate(23.758, 90.358),
                source = new MapSource { license = "ODbL-1.0" },
                boundary = new List<GeoCoordinate>
                {
                    new(23.754, 90.354), new(23.762, 90.354), new(23.762, 90.362),
                    new(23.754, 90.362), new(23.754, 90.354),
                },
            };
            // Horizontal chain: node 1 -> 2 -> 3(shared junction) -> 4
            map.roads.Add(Road(101, new long[] { 1, 2 }, new[] { (23.7578, 90.3555), (23.7578, 90.3580) }, "residential", oneWay));
            map.roads.Add(Road(102, new long[] { 2, 3 }, new[] { (23.7578, 90.3580), (23.7578, 90.3605) }, "secondary", oneWay));
            map.roads.Add(Road(103, new long[] { 3, 4 }, new[] { (23.7578, 90.3605), (23.7578, 90.3610) }, "residential", oneWay));
            // Vertical chain crossing at the shared node 3.
            map.roads.Add(Road(104, new long[] { 5, 3 }, new[] { (23.7568, 90.3605), (23.7578, 90.3605) }, "tertiary", oneWay));
            map.roads.Add(Road(105, new long[] { 3, 6 }, new[] { (23.7578, 90.3605), (23.7590, 90.3605) }, "tertiary", oneWay));
            // Parallel road to give the spawn sampler some variety.
            map.roads.Add(Road(106, new long[] { 7, 8, 9 }, new[] { (23.7586, 90.3560), (23.7586, 90.3585), (23.7586, 90.3608) }, "residential", oneWay));
            return map;
        }

        private static RoadData Road(long id, long[] nodes, (double Latitude, double Longitude)[] geometry, string highway, string oneWay)
        {
            var road = new RoadData
            {
                id = id,
                nodeIds = new List<long>(nodes),
                highway = highway,
                driveable = true,
                widthMeters = 7.0,
                oneWay = oneWay,
                widthSource = "estimated:road-class",
            };
            foreach ((double latitude, double longitude) in geometry)
                road.geometry.Add(new GeoCoordinate(latitude, longitude));
            return road;
        }
    }
}
