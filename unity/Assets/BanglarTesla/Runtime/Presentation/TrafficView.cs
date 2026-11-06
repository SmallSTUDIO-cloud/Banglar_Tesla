using System.Collections.Generic;
using BanglarTesla.Domain;
using UnityEngine;

namespace BanglarTesla.Presentation
{
    /// <summary>
    /// Pooled presentation for <see cref="TrafficSimulation"/> agents.
    /// One shared box mesh and three shared materials keep batching friendly;
    /// renderers beyond the cull distance are disabled instead of destroyed.
    /// Traffic artwork is procedural stand-in geometry, not production vehicle art.
    /// </summary>
    public sealed class TrafficView : MonoBehaviour
    {
        private readonly List<MeshRenderer> pool = new();
        private readonly List<Transform> poolTransforms = new();
        private Material[] materials = System.Array.Empty<Material>();
        private Mesh? mesh;
        private Transform? root;
        private float cullDistance = 260.0f;

        public int Visible { get; private set; }

        public void Configure(int capacity, float distance = 260.0f)
        {
            cullDistance = Mathf.Max(40.0f, distance);
            root = new GameObject("Traffic").transform;
            root.SetParent(transform, false);
            mesh = VehicleBoxMesh();
            materials = new[]
            {
                CreateMaterial("Traffic green", new Color(0.16f, 0.42f, 0.30f)),
                CreateMaterial("Traffic sand", new Color(0.62f, 0.55f, 0.36f)),
                CreateMaterial("Traffic teal", new Color(0.13f, 0.33f, 0.42f)),
            };
            EnsureCapacity(capacity);
        }

        private void EnsureCapacity(int capacity)
        {
            if (root is null || mesh is null || materials.Length == 0) return;
            while (pool.Count < capacity)
            {
                var item = new GameObject($"Traffic agent {pool.Count}");
                item.transform.SetParent(root, false);
                MeshFilter filter = item.AddComponent<MeshFilter>();
                filter.sharedMesh = mesh;
                MeshRenderer renderer = item.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = materials[0];
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                renderer.enabled = false;
                pool.Add(renderer);
                poolTransforms.Add(item.transform);
            }
        }

        /// <summary>Pushes simulated transforms into the pool. Call once per rendered frame.</summary>
        public void Render(TrafficSimulation simulation, Vector3 viewer)
        {
            if (materials.Length == 0 || root is null) return;
            IReadOnlyList<TrafficAgent> agents = simulation.Agents;
            EnsureCapacity(agents.Count);
            float squaredCull = cullDistance * cullDistance;
            int visible = 0;
            for (int index = 0; index < pool.Count; index++)
            {
                MeshRenderer renderer = pool[index];
                if (index >= agents.Count)
                {
                    if (renderer.enabled) renderer.enabled = false;
                    continue;
                }
                TrafficAgent agent = agents[index];
                float dx = (float)agent.X - viewer.x;
                float dz = (float)agent.Z - viewer.z;
                bool inRange = dx * dx + dz * dz <= squaredCull;
                if (renderer.enabled != inRange) renderer.enabled = inRange;
                if (!inRange) continue;
                visible++;
                Material wanted = materials[agent.Variant % materials.Length];
                if (renderer.sharedMaterial != wanted) renderer.sharedMaterial = wanted;
                float length = (float)agent.Length;
                poolTransforms[index].SetPositionAndRotation(
                    new Vector3((float)agent.X, 0.55f, (float)agent.Z),
                    Quaternion.Euler(0.0f, (float)agent.Yaw * Mathf.Rad2Deg, 0.0f));
                poolTransforms[index].localScale = new Vector3(length * 0.46f, 0.9f, length);
            }
            Visible = visible;
        }

        /// <summary>Box centred on the origin. Each face lists (a, e1, e2) so the winding faces outward.</summary>
        private static Mesh VehicleBoxMesh()
        {
            var vertices = new List<Vector3>(24);
            var normals = new List<Vector3>(24);
            var triangles = new List<int>(36);
            AddFace(vertices, normals, triangles, new Vector3(1f, 0f, 0f), new Vector3(0f, 1f, 0f), new Vector3(0f, 0f, 1f));
            AddFace(vertices, normals, triangles, new Vector3(-1f, 0f, 0f), new Vector3(0f, 0f, 1f), new Vector3(0f, 1f, 0f));
            AddFace(vertices, normals, triangles, new Vector3(0f, 1f, 0f), new Vector3(0f, 0f, 1f), new Vector3(1f, 0f, 0f));
            AddFace(vertices, normals, triangles, new Vector3(0f, -1f, 0f), new Vector3(1f, 0f, 0f), new Vector3(0f, 0f, 1f));
            AddFace(vertices, normals, triangles, new Vector3(0f, 0f, 1f), new Vector3(1f, 0f, 0f), new Vector3(0f, 1f, 0f));
            AddFace(vertices, normals, triangles, new Vector3(0f, 0f, -1f), new Vector3(0f, 1f, 0f), new Vector3(1f, 0f, 0f));
            var box = new Mesh { name = "Traffic box" };
            box.SetVertices(vertices);
            box.SetNormals(normals);
            box.SetTriangles(triangles, 0);
            box.RecalculateBounds();
            return box;
        }

        private static void AddFace(List<Vector3> vertices, List<Vector3> normals, List<int> triangles,
            Vector3 normal, Vector3 along, Vector3 across)
        {
            // Corner of the unit cube on this face, then step one unit along each face axis.
            Vector3 a = normal * 0.5f - along * 0.5f - across * 0.5f;
            Vector3 b = a + along;
            Vector3 c = a + across;
            Vector3 d = a + along + across;
            int start = vertices.Count;
            vertices.Add(a); vertices.Add(b); vertices.Add(c); vertices.Add(d);
            for (int index = 0; index < 4; index++) normals.Add(normal);
            triangles.Add(start); triangles.Add(start + 1); triangles.Add(start + 2);
            triangles.Add(start + 2); triangles.Add(start + 1); triangles.Add(start + 3);
        }

        private static Material CreateMaterial(string name, Color color)
        {
            Shader? shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader is null) throw new System.InvalidOperationException("URP Lit shader was not found. Configure URP before building traffic.");
            var material = new Material(shader) { name = name, enableInstancing = true };
            material.SetColor("_BaseColor", color);
            material.SetFloat("_Smoothness", 0.2f);
            return material;
        }

        private void OnDestroy()
        {
            foreach (Material material in materials)
                if (material is not null) Destroy(material);
            if (mesh is not null) Destroy(mesh);
        }
    }
}
