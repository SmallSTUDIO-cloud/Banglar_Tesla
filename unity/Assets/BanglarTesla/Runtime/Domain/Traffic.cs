using System;
using System.Collections.Generic;
using BanglarTesla.Domain.Maps;

namespace BanglarTesla.Domain
{
    /// <summary>Density and speed envelope for one graphics/quality profile.</summary>
    [Serializable]
    public sealed class TrafficConfig
    {
        public int MaxAgents = 90;
        public double SpawnRadius = 340.0;
        public double MinimumSpeed = 5.0;
        public double MaximumSpeed = 11.0;
        public double Acceleration = 2.2;
        public double Braking = 6.5;
        public double ComfortGap = 6.0;
        public double StoppingGap = 2.2;
    }

    /// <summary>One simulated road user. Position is derived from road geometry each step.</summary>
    public sealed class TrafficAgent
    {
        public int RoadIndex;
        /// <summary>+1 follows the road point order, -1 opposes it.</summary>
        public int Direction = 1;
        /// <summary>Metres travelled from the entry end of the current road, in travel direction.</summary>
        public double Along;
        public double Speed;
        public double DesiredSpeed = 8.0;
        public double Length = 3.1;
        public double HalfWidth = 0.62;
        public double LaneOffset;
        public double X, Z, Yaw;
        public int Variant;

        public Vector2D Position => new(X, Z);
    }

    /// <summary>
    /// Deterministic lane-following traffic on the sourced road graph.
    /// Left-hand traffic: agents are offset to the left of their travel direction.
    /// Engine-free so the behaviour is covered by plain .NET tests.
    /// </summary>
    public sealed class TrafficSimulation
    {
        private const int MaximumTransitionsPerStep = 6;

        private readonly RoadGraph graph;
        private readonly Func<double> rng;
        private readonly TrafficConfig config;
        private readonly List<TrafficAgent> agents = new();
        private readonly Dictionary<long, List<Entry>> entries = new();
        private readonly List<int> spawnRoads = new();
        private int[] sorted = Array.Empty<int>();
        private Comparison<int>? orderComparison;

        public TrafficSimulation(RoadGraph graph, TrafficConfig? config = null, Func<double>? rng = null)
        {
            this.graph = graph ?? throw new ArgumentNullException(nameof(graph));
            this.config = config ?? new TrafficConfig();
            this.rng = rng ?? new Random(20261106).NextDouble;
            BuildEntries();
        }

        public IReadOnlyList<TrafficAgent> Agents => agents;
        public int Count => agents.Count;
        public TrafficConfig Config => config;

        /// <summary>A road end that can be entered, and the direction entered in.</summary>
        private readonly struct Entry
        {
            public Entry(int roadIndex, int direction) { RoadIndex = roadIndex; Direction = direction; }
            public int RoadIndex { get; }
            public int Direction { get; }
        }

        private static bool IsOneWay(RoadData data) => data.oneWay is "yes" or "true" or "1" or "-1";

        private static bool AllowForward(RoadData data) => data.driveable && (!IsOneWay(data) || data.oneWay is not "-1");

        private static bool AllowBackward(RoadData data) => data.driveable && (!IsOneWay(data) || data.oneWay is "-1");

        private static int NodeCount(RoadModel road) => Math.Min(road.Data.nodeIds.Count, road.Points.Count);

        private static long TerminalNode(RoadModel road, int direction)
        {
            int count = NodeCount(road);
            if (count == 0) return long.MinValue;
            return direction > 0 ? road.Data.nodeIds[count - 1] : road.Data.nodeIds[0];
        }

        /// <summary>Maps each road end to the road ends that can be entered from it.</summary>
        private void BuildEntries()
        {
            for (int roadIndex = 0; roadIndex < graph.Roads.Count; roadIndex++)
            {
                RoadModel road = graph.Roads[roadIndex];
                if (!road.Data.driveable || NodeCount(road) < 2) continue;
                if (AllowForward(road.Data)) Add(TerminalNode(road, -1), new Entry(roadIndex, 1));
                if (AllowBackward(road.Data)) Add(TerminalNode(road, 1), new Entry(roadIndex, -1));
            }
        }

        private void Add(long node, Entry entry)
        {
            if (node == long.MinValue) return;
            if (!entries.TryGetValue(node, out List<Entry>? list)) entries[node] = list = new List<Entry>();
            list.Add(entry);
        }

        /// <summary>Places agents on driveable roads near <paramref name="center"/>.</summary>
        public int Populate(Vector2D center, int count)
        {
            agents.Clear();
            spawnRoads.Clear();
            List<int> candidates = spawnRoads;
            for (int roadIndex = 0; roadIndex < graph.Roads.Count; roadIndex++)
            {
                RoadModel road = graph.Roads[roadIndex];
                if (!road.Data.driveable || road.Length < 8.0 || NodeCount(road) < 2) continue;
                Sample(road, road.Length * 0.5, out Vector2D midpoint, out _);
                if (Vector2D.Distance(center, midpoint) > config.SpawnRadius) continue;
                candidates.Add(roadIndex);
            }
            if (candidates.Count == 0) return 0;
            int target = Math.Min(Math.Max(0, count), config.MaxAgents);
            for (int index = 0; index < target; index++)
            {
                int roadIndex = candidates[(int)(rng() * candidates.Count) % candidates.Count];
                RoadModel road = graph.Roads[roadIndex];
                bool forward = AllowForward(road.Data);
                bool backward = AllowBackward(road.Data);
                int direction = forward && backward ? (rng() < 0.5 ? 1 : -1) : forward ? 1 : -1;
                TrafficAgent? agent = null;
                for (int attempt = 0; attempt < 12 && agent is null; attempt++)
                {
                    double along = rng() * road.Length;
                    double desired = config.MinimumSpeed + rng() * (config.MaximumSpeed - config.MinimumSpeed);
                    double length = 2.8 + rng() * 1.6;
                    if (TooClose(roadIndex, direction, along, length)) continue;
                    agent = new TrafficAgent
                    {
                        RoadIndex = roadIndex,
                        Direction = direction,
                        Along = along,
                        DesiredSpeed = desired,
                        LaneOffset = LaneOffsetFor(road),
                        Variant = (int)(rng() * 3.0),
                        Length = length,
                    };
                }
                if (agent is null) continue;
                agent.Speed = agent.DesiredSpeed * 0.6;
                UpdateTransform(agent);
                agents.Add(agent);
            }
            return agents.Count;
        }

        private bool TooClose(int roadIndex, int direction, double along, double length)
        {
            foreach (TrafficAgent other in agents)
            {
                if (other.RoadIndex != roadIndex || other.Direction != direction) continue;
                if (Math.Abs(other.Along - along) < (other.Length + length) * 0.5 + config.StoppingGap) return true;
            }
            return false;
        }

        public void Clear() => agents.Clear();

        /// <summary>Advances every agent by one fixed step.</summary>
        public void Step(double dt)
        {
            if (!double.IsFinite(dt) || dt <= 0.0 || agents.Count == 0) return;
            SortAgents();
            for (int index = 0; index < sorted.Length; index++)
            {
                TrafficAgent agent = agents[sorted[index]];
                double gap = double.PositiveInfinity;
                TrafficAgent? leader = null;
                if (index + 1 < sorted.Length)
                {
                    TrafficAgent ahead = agents[sorted[index + 1]];
                    if (ahead.RoadIndex == agent.RoadIndex && ahead.Direction == agent.Direction)
                    {
                        leader = ahead;
                        gap = ahead.Along - agent.Along - (ahead.Length + agent.Length) * 0.5;
                    }
                }
                if (leader is not null && gap < 0.0)
                {
                    // Queue up instead of interpenetrating; the leader has already moved this step.
                    agent.Along = Math.Max(0.0, leader.Along - (leader.Length + agent.Length) * 0.5 - 0.05);
                    agent.Speed = Math.Min(agent.Speed, leader.Speed);
                    UpdateTransform(agent);
                    continue;
                }
                double target = TargetSpeed(agent, gap);
                agent.Speed = Numerics.MoveTowards(
                    agent.Speed, target, (target > agent.Speed ? config.Acceleration : config.Braking) * dt);
                if (agent.Speed < 0.0) agent.Speed = 0.0;
                Advance(agent, dt);
                UpdateTransform(agent);
            }
        }

        private double TargetSpeed(TrafficAgent agent, double gap)
        {
            if (double.IsPositiveInfinity(gap)) return agent.DesiredSpeed;
            if (gap <= config.StoppingGap) return 0.0;
            if (gap >= config.ComfortGap) return agent.DesiredSpeed;
            double factor = (gap - config.StoppingGap) / (config.ComfortGap - config.StoppingGap);
            return agent.DesiredSpeed * Numerics.Clamp01(factor);
        }

        private void SortAgents()
        {
            if (sorted.Length != agents.Count) sorted = new int[agents.Count];
            for (int index = 0; index < agents.Count; index++) sorted[index] = index;
            orderComparison ??= (left, right) =>
            {
                TrafficAgent a = agents[left], b = agents[right];
                int comparison = a.RoadIndex.CompareTo(b.RoadIndex);
                if (comparison != 0) return comparison;
                comparison = a.Direction.CompareTo(b.Direction);
                return comparison != 0 ? comparison : a.Along.CompareTo(b.Along);
            };
            Array.Sort(sorted, orderComparison);
        }

        private void Advance(TrafficAgent agent, double dt)
        {
            agent.Along += agent.Speed * dt;
            int transitions = 0;
            while (agent.Along > graph.Roads[agent.RoadIndex].Length && transitions++ < MaximumTransitionsPerStep)
            {
                RoadModel current = graph.Roads[agent.RoadIndex];
                double overflow = agent.Along - current.Length;
                if (!TryEnter(agent, current))
                {
                    // A one-way dead end has no legal continuation. Recycling keeps the
                    // road from being blocked forever; two-way dead ends turn around in TryEnter.
                    if (!Recycle(agent)) { agent.Speed = 0.0; agent.Along = current.Length; }
                    return;
                }
                agent.Along = overflow;
            }
            if (transitions >= MaximumTransitionsPerStep) agent.Along = graph.Roads[agent.RoadIndex].Length;
        }

        private bool TryEnter(TrafficAgent agent, RoadModel from)
        {
            long node = TerminalNode(from, agent.Direction);
            if (node == long.MinValue || !entries.TryGetValue(node, out List<Entry>? options) || options.Count == 0) return false;

            // Two allocation-free passes: total the eligible weights, then pick one.
            bool allowUTurn = options.Count == 1;
            double total = 0.0;
            int eligible = 0;
            foreach (Entry option in options)
            {
                bool uturn = option.RoadIndex == agent.RoadIndex;
                if (uturn && !allowUTurn) continue;
                double weight = uturn ? 0.05 : ContinuationWeight(from.Data, graph.Roads[option.RoadIndex].Data);
                if (weight <= 0.0) continue;
                total += weight;
                eligible++;
            }
            if (eligible == 0 || total <= 0.0) return false;

            double roll = rng() * total;
            Entry chosen = default;
            bool picked = false;
            Entry last = default;
            foreach (Entry option in options)
            {
                bool uturn = option.RoadIndex == agent.RoadIndex;
                if (uturn && !allowUTurn) continue;
                double weight = uturn ? 0.05 : ContinuationWeight(from.Data, graph.Roads[option.RoadIndex].Data);
                if (weight <= 0.0) continue;
                last = option;
                if (picked) continue;
                roll -= weight;
                if (roll <= 0.0) { chosen = option; picked = true; }
            }
            if (!picked) chosen = last;

            // Queue at the junction instead of driving into an occupied road entry.
            if (TooClose(chosen.RoadIndex, chosen.Direction, 0.0, agent.Length)) return false;
            agent.RoadIndex = chosen.RoadIndex;
            agent.Direction = chosen.Direction;
            agent.LaneOffset = LaneOffsetFor(graph.Roads[chosen.RoadIndex]);
            return true;
        }

        /// <summary>Moves an agent to a fresh spawn point. Returns false when no road is free.</summary>
        private bool Recycle(TrafficAgent agent)
        {
            if (spawnRoads.Count == 0) return false;
            for (int attempt = 0; attempt < 16; attempt++)
            {
                int roadIndex = spawnRoads[(int)(rng() * spawnRoads.Count) % spawnRoads.Count];
                RoadModel road = graph.Roads[roadIndex];
                bool forward = AllowForward(road.Data), backward = AllowBackward(road.Data);
                if (!forward && !backward) continue;
                int direction = forward && backward ? (rng() < 0.5 ? 1 : -1) : forward ? 1 : -1;
                double along = rng() * Math.Max(1.0, road.Length);
                if (OccupiedAt(roadIndex, direction, along, agent.Length)) continue;
                agent.RoadIndex = roadIndex;
                agent.Direction = direction;
                agent.Along = along;
                agent.LaneOffset = LaneOffsetFor(road);
                agent.Speed = agent.DesiredSpeed * 0.5;
                UpdateTransform(agent);
                return true;
            }
            return false;
        }

        private bool OccupiedAt(int roadIndex, int direction, double along, double length)
        {
            foreach (TrafficAgent other in agents)
            {
                if (other.RoadIndex != roadIndex || other.Direction != direction) continue;
                if (Math.Abs(other.Along - along) < (other.Length + length) * 0.5 + config.StoppingGap) return true;
            }
            return false;
        }

        private static double ContinuationWeight(RoadData from, RoadData to)
        {
            double weight = 1.0;
            if (from.name.Length > 0 && from.name == to.name) weight += 4.0;
            weight += Rank(to.highway);
            return weight;
        }

        private static double Rank(string highway) => highway switch
        {
            "trunk" or "primary" => 2.4,
            "secondary" => 1.8,
            "tertiary" => 1.2,
            "residential" or "unclassified" or "living_street" => 0.6,
            _ => 0.0,
        };

        private static double LaneOffsetFor(RoadModel road) =>
            Numerics.Clamp(road.Data.widthMeters * 0.25, 0.9, 2.4);

        private void UpdateTransform(TrafficAgent agent)
        {
            RoadModel road = graph.Roads[agent.RoadIndex];
            double along = Numerics.Clamp(agent.Along, 0.0, road.Length);
            double distanceFromStart = agent.Direction > 0 ? along : road.Length - along;
            Sample(road, distanceFromStart, out Vector2D position, out Vector2D tangent);
            if (agent.Direction < 0) tangent = -tangent;
            Vector2D left = new(-tangent.Z, tangent.X);
            Vector2D placed = position + left * agent.LaneOffset;
            agent.X = placed.X;
            agent.Z = placed.Z;
            agent.Yaw = Math.Atan2(tangent.X, tangent.Z);
        }

        /// <summary>Interpolates the road polyline, returning position and direction of increasing distance.</summary>
        private static void Sample(RoadModel road, double distance, out Vector2D position, out Vector2D tangent)
        {
            IReadOnlyList<Vector2D> points = road.Points;
            if (points.Count == 0) { position = Vector2D.Zero; tangent = new Vector2D(0.0, 1.0); return; }
            if (points.Count == 1) { position = points[0]; tangent = new Vector2D(0.0, 1.0); return; }
            double[] cumulative = road.CumulativeLengths;
            double clamped = Numerics.Clamp(distance, 0.0, road.Length);
            int low = 1, high = cumulative.Length - 1;
            while (low < high)
            {
                int middle = (low + high) / 2;
                if (cumulative[middle] < clamped) low = middle + 1; else high = middle;
            }
            int segment = low - 1;
            double segmentLength = cumulative[segment + 1] - cumulative[segment];
            double t = segmentLength > 1e-9 ? (clamped - cumulative[segment]) / segmentLength : 0.0;
            Vector2D a = points[segment], b = points[segment + 1];
            position = a + (b - a) * Numerics.Clamp01(t);
            tangent = (b - a).Normalized();
        }
    }
}
