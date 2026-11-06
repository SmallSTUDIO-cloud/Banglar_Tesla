using System;
using System.Collections.Generic;
using BanglarTesla.Domain;
using BanglarTesla.Domain.Maps;
using UnityEngine;
using UnityEngine.Rendering;

namespace BanglarTesla.World
{
    /// <summary>Builds chunked render geometry from sourced roads; widths remain labeled estimates where applicable.</summary>
    public sealed class SourcedMapWorld : MonoBehaviour
    {
        private readonly Dictionary<(int X, int Z, int Material), MeshAccumulator> roadChunks = new();
        private readonly List<BoxColliderData> barrierColliders = new();
        private readonly List<Material> materials = new();
        private readonly List<Mesh> meshes = new();
        private GameObject? worldRoot;
        private bool built;

        public RoadGraph? Graph { get; private set; }
        public CollisionWorld? Collisions { get; private set; }
        public Vector3 SpawnPosition { get; private set; }
        public float SpawnYawDegrees { get; private set; }

        public void Build(MapDataset dataset)
        {
            if (built) throw new InvalidOperationException("The sourced world has already been built.");
            built = true;
            Graph = new RoadGraph(dataset);
            worldRoot = new GameObject("Sourced Mohammadpur");
            worldRoot.transform.SetParent(transform, false);
            materials.Add(CreateMaterial("Ground", new Color(0.12f, 0.20f, 0.16f)));
            materials.Add(CreateMaterial("Minor roads", new Color(0.22f, 0.25f, 0.24f)));
            materials.Add(CreateMaterial("Major roads", new Color(0.27f, 0.29f, 0.28f)));
            materials.Add(CreateMaterial("Paths", new Color(0.26f, 0.25f, 0.21f)));
            materials.Add(CreateMaterial("Barricade orange", new Color(0.85f, 0.28f, 0.10f)));
            materials.Add(CreateMaterial("Barricade reflector", new Color(0.94f, 0.88f, 0.65f)));
            BuildGround(dataset);
            BuildRoads();
            BuildBarricades(dataset);
            Collisions = new CollisionWorld(barrierColliders);
            RoadProjection spawn = Graph.FindNearest(Graph.Projection.ToLocal(new GeoPoint(23.7569928, 90.3617359)));
            if (spawn.RoadIndex < 0 || !double.IsFinite(spawn.Distance)) throw new InvalidOperationException("No sourced driveable spawn road was found near Mohammadpur Bus Stand.");
            SpawnPosition = new Vector3((float)spawn.Point.X, 0.12f, (float)spawn.Point.Z);
            SpawnYawDegrees = Mathf.Atan2((float)spawn.Tangent.X, (float)spawn.Tangent.Z) * Mathf.Rad2Deg;
        }

        public RoadSurface SurfaceAt(double x, double z)
        {
            if (Graph is null) return RoadSurface.Offroad;
            RoadProjection nearest = Graph.FindNearest(new Vector2D(x, z));
            if (nearest.RoadIndex < 0) return RoadSurface.Offroad;
            double halfWidth = Graph.Roads[nearest.RoadIndex].Data.widthMeters * 0.5;
            return nearest.Distance <= halfWidth ? RoadSurface.Road : nearest.Distance <= halfWidth + 1.2 ? RoadSurface.Sidewalk : RoadSurface.Offroad;
        }

        public bool IsInsideBoundary(double x, double z) => Graph?.IsInsideBoundary(new Vector2D(x, z)) == true;

        private void BuildGround(MapDataset dataset)
        {
            GeoBounds bounds = dataset.bounds;
            Vector2D a = Graph!.Projection.ToLocal(new GeoPoint(bounds.south, bounds.west));
            Vector2D b = Graph.Projection.ToLocal(new GeoPoint(bounds.north, bounds.east));
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "District ground (procedural, not elevation data)";
            ground.transform.SetParent(worldRoot!.transform, false);
            ground.transform.position = new Vector3((float)((a.X + b.X) * 0.5), -0.06f, (float)((a.Z + b.Z) * 0.5));
            ground.transform.localScale = new Vector3((float)(Math.Abs(b.X - a.X) + 240.0) / 10.0f, 1.0f, (float)(Math.Abs(b.Z - a.Z) + 240.0) / 10.0f);
            ground.GetComponent<MeshRenderer>().sharedMaterial = materials[0];
            ground.isStatic = true;
        }

        private void BuildRoads()
        {
            foreach (RoadModel road in Graph!.Roads)
            {
                int material = road.Data.driveable ? road.Data.highway is "primary" or "trunk" or "secondary" or "tertiary" ? 2 : 1 : 3;
                for (int segment = 0; segment + 1 < road.Points.Count; segment++)
                {
                    Vector2D a = road.Points[segment];
                    Vector2D b = road.Points[segment + 1];
                    Vector2D delta = b - a;
                    double length = delta.Length;
                    if (length < 0.01) continue;
                    Vector2D perpendicular = new Vector2D(-delta.Z / length, delta.X / length);
                    double halfWidth = Math.Max(0.5, road.Data.widthMeters * 0.5);
                    Vector2D midpoint = (a + b) * 0.5;
                    var key = ((int)Math.Floor(midpoint.X / 256.0), (int)Math.Floor(midpoint.Z / 256.0), material);
                    if (!roadChunks.TryGetValue(key, out MeshAccumulator? mesh)) roadChunks[key] = mesh = new MeshAccumulator();
                    Vector3 leftA = Point(a + perpendicular * halfWidth);
                    Vector3 rightA = Point(a - perpendicular * halfWidth);
                    Vector3 leftB = Point(b + perpendicular * halfWidth);
                    Vector3 rightB = Point(b - perpendicular * halfWidth);
                    mesh.AddQuad(leftA, leftB, rightA, rightB, Vector3.up);
                }
            }
            foreach (KeyValuePair<(int X, int Z, int Material), MeshAccumulator> chunk in roadChunks)
                CreateMeshObject($"Road cell {chunk.Key.X}:{chunk.Key.Z} mat {chunk.Key.Material}", chunk.Value, materials[chunk.Key.Material]);
        }

        private void BuildBarricades(MapDataset dataset)
        {
            var byId = new Dictionary<long, RoadModel>();
            foreach (RoadModel road in Graph!.Roads) byId[road.Data.id] = road;
            var orange = new MeshAccumulator();
            var reflector = new MeshAccumulator();
            foreach (BoundaryExitData exit in dataset.boundaryExits)
            {
                if (!byId.TryGetValue(exit.wayId, out RoadModel? road) || exit.roadSegmentIndex < 0 || exit.roadSegmentIndex + 1 >= road.Points.Count) continue;
                Vector2D center = Graph.Projection.ToLocal(exit.point.ToGeoPoint());
                Vector2D tangent = (road.Points[exit.roadSegmentIndex + 1] - road.Points[exit.roadSegmentIndex]).Normalized();
                Vector2D across = new Vector2D(-tangent.Z, tangent.X);
                double width = Math.Max(5.0, road.Data.widthMeters + 1.0);
                double yaw = Math.Atan2(-across.Z, across.X);
                for (int stripe = 0; stripe < 8; stripe++)
                {
                    double offset = (stripe - 3.5) * width / 8.0;
                    Vector2D position = center + across * offset;
                    AddBox(stripe % 2 == 0 ? orange : reflector, position, 0.72, width / 8.0, 0.22, 0.32, yaw);
                }
                foreach (double side in new[] { -1.0, 1.0 })
                    AddBox(orange, center + across * (side * width * 0.48), 0.55, 0.20, 0.55, 0.20, yaw);
                double reach = Math.Sqrt(width * width * 0.25 + 0.32 * 0.32);
                barrierColliders.Add(new BoxColliderData
                {
                    MinX = center.X - reach, MaxX = center.X + reach, MinZ = center.Z - reach, MaxZ = center.Z + reach,
                    Height = 1.2, Oriented = true, CenterX = center.X, CenterZ = center.Z,
                    HalfX = width * 0.5, HalfZ = 0.32, Yaw = yaw,
                });
            }
            CreateMeshObject("Gameplay exit barricades — orange", orange, materials[4]);
            CreateMeshObject("Gameplay exit barricades — reflectors", reflector, materials[5]);
        }

        private static Vector3 Point(Vector2D point) => new((float)point.X, 0.015f, (float)point.Z);

        private static void AddBox(MeshAccumulator mesh, Vector2D center, double y, double halfX, double halfY, double halfZ, double yaw)
        {
            double cosine = Math.Cos(yaw), sine = Math.Sin(yaw);
            var vertices = new Vector3[8];
            int[] xSigns = { -1, 1, 1, -1, -1, 1, 1, -1 };
            int[] ySigns = { -1, -1, -1, -1, 1, 1, 1, 1 };
            int[] zSigns = { -1, -1, 1, 1, -1, -1, 1, 1 };
            for (int index = 0; index < vertices.Length; index++)
            {
                double localX = xSigns[index] * halfX, localZ = zSigns[index] * halfZ;
                vertices[index] = new Vector3(
                    (float)(center.X + localX * cosine + localZ * sine),
                    (float)(y + ySigns[index] * halfY),
                    (float)(center.Z - localX * sine + localZ * cosine));
            }
            mesh.AddBox(vertices);
        }

        private void CreateMeshObject(string name, MeshAccumulator accumulator, Material material)
        {
            if (accumulator.Vertices.Count == 0) return;
            var child = new GameObject(name);
            child.transform.SetParent(worldRoot!.transform, false);
            MeshFilter filter = child.AddComponent<MeshFilter>();
            MeshRenderer renderer = child.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            Mesh mesh = accumulator.ToMesh();
            meshes.Add(mesh);
            filter.sharedMesh = mesh;
            child.isStatic = true;
        }

        private static Material CreateMaterial(string name, Color color)
        {
            Shader? shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader is null) throw new InvalidOperationException("URP Lit shader was not found. Configure URP before building the sourced world.");
            var material = new Material(shader) { name = name };
            material.SetColor("_BaseColor", color);
            material.SetFloat("_Smoothness", 0.12f);
            return material;
        }

        private void OnDestroy()
        {
            if (worldRoot is not null)
            {
                if (Application.isPlaying) Destroy(worldRoot); else DestroyImmediate(worldRoot);
            }
            foreach (Material material in materials) if (material is not null)
            {
                if (Application.isPlaying) Destroy(material); else DestroyImmediate(material);
            }
            foreach (Mesh mesh in meshes) if (mesh is not null)
            {
                if (Application.isPlaying) Destroy(mesh); else DestroyImmediate(mesh);
            }
        }

        private sealed class MeshAccumulator
        {
            private static readonly int[] BoxTriangles =
            {
                0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
                0, 5, 1, 0, 4, 5, 3, 2, 6, 3, 6, 7,
                0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
            };
            public List<Vector3> Vertices { get; } = new();
            private List<Vector3> Normals { get; } = new();
            private List<int> Triangles { get; } = new();

            public void AddQuad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 normal)
            {
                int start = Vertices.Count;
                Vertices.Add(a); Vertices.Add(b); Vertices.Add(c); Vertices.Add(d);
                for (int i = 0; i < 4; i++) Normals.Add(normal);
                Triangles.Add(start); Triangles.Add(start + 1); Triangles.Add(start + 2);
                Triangles.Add(start + 2); Triangles.Add(start + 1); Triangles.Add(start + 3);
            }

            public void AddBox(Vector3[] vertices)
            {
                int start = Vertices.Count;
                Vertices.AddRange(vertices);
                foreach (int triangle in BoxTriangles) Triangles.Add(start + triangle);
            }

            public Mesh ToMesh()
            {
                var mesh = new Mesh { indexFormat = IndexFormat.UInt32 };
                mesh.SetVertices(Vertices);
                mesh.SetTriangles(Triangles, 0);
                if (Normals.Count == Vertices.Count) mesh.SetNormals(Normals);
                else mesh.RecalculateNormals();
                mesh.RecalculateBounds();
                return mesh;
            }
        }
    }
}
