using System.Collections.Generic;
using BanglarTesla.Domain;
using UnityEngine;

namespace BanglarTesla.Presentation
{
    /// <summary>Original procedural stand-in vehicle; production art and cosmetic variants are a later parity stage.</summary>
    public sealed class PlayerVehicleView : MonoBehaviour
    {
        private readonly List<Material> materials = new();
        private Transform? body;
        private Transform[] wheels = System.Array.Empty<Transform>();

        public void Configure(VehicleDefinition vehicle)
        {
            Material bodyMaterial = Material("Body", vehicle.BodyColor);
            Material canopyMaterial = Material("Canopy", vehicle.CanopyColor);
            Material trimMaterial = Material("Trim", vehicle.TrimColor);
            Material seatMaterial = Material("Seat", vehicle.SeatColor);
            Material rubber = Material("Tyres", "#15191b");
            Material metal = Material("Metal", "#78858a");
            body = new GameObject("Vehicle body").transform;
            body.SetParent(transform, false);
            Box("Frame", new Vector3(0.0f, 0.58f, -0.05f), new Vector3(1.18f, 0.16f, 1.95f), metal);
            Box("Passenger bench", new Vector3(0.0f, 0.86f, -0.50f), new Vector3(1.14f, 0.30f, 0.72f), seatMaterial);
            Box("Decorated rear panel", new Vector3(0.0f, 1.10f, -0.92f), new Vector3(1.20f, 0.74f, 0.10f), bodyMaterial);
            Box("Canopy", new Vector3(0.0f, 1.83f, -0.30f), new Vector3(1.46f, 0.12f, 1.58f), canopyMaterial);
            Box("Canopy trim", new Vector3(0.0f, 1.75f, 0.47f), new Vector3(1.48f, 0.13f, 0.08f), trimMaterial);
            foreach (float x in new[] { -0.64f, 0.64f })
                Box("Canopy support", new Vector3(x, 1.34f, -0.80f), new Vector3(0.055f, 0.95f, 0.055f), metal);
            Box("Handlebar", new Vector3(0.0f, 1.16f, 0.64f), new Vector3(0.78f, 0.055f, 0.055f), metal);
            Capsule("Driver placeholder", new Vector3(0.0f, 1.13f, 0.24f), new Vector3(0.30f, 0.43f, 0.30f), bodyMaterial);
            wheels = new[]
            {
                Wheel("Front wheel", new Vector3(0.0f, 0.43f, 0.82f), rubber, metal),
                Wheel("Rear left wheel", new Vector3(-0.70f, 0.43f, -0.66f), rubber, metal),
                Wheel("Rear right wheel", new Vector3(0.70f, 0.43f, -0.66f), rubber, metal),
            };
        }

        public void Render(RickshawDynamics dynamics)
        {
            transform.SetPositionAndRotation(
                new Vector3((float)dynamics.X, (float)dynamics.Y, (float)dynamics.Z),
                Quaternion.Euler((float)(dynamics.Pitch + dynamics.BodyPitchOffset) * Mathf.Rad2Deg,
                    (float)dynamics.Yaw * Mathf.Rad2Deg, (float)dynamics.Roll * Mathf.Rad2Deg));
            float wheelAngle = (float)(dynamics.DistanceDriven / 0.43 * 57.29578);
            foreach (Transform wheel in wheels) wheel.localRotation = Quaternion.Euler(0.0f, 0.0f, 90.0f) * Quaternion.Euler(0.0f, wheelAngle, 0.0f);
        }

        private Transform Wheel(string name, Vector3 position, Material rubber, Material metal)
        {
            GameObject wheel = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            wheel.name = name;
            RemoveCollider(wheel);
            wheel.transform.SetParent(transform, false);
            wheel.transform.localPosition = position;
            wheel.transform.localRotation = Quaternion.Euler(0.0f, 0.0f, 90.0f);
            wheel.transform.localScale = new Vector3(0.43f, 0.065f, 0.43f);
            wheel.GetComponent<MeshRenderer>().sharedMaterial = rubber;
            return wheel.transform;
        }

        private void Box(string name, Vector3 position, Vector3 scale, Material material)
        {
            GameObject part = GameObject.CreatePrimitive(PrimitiveType.Cube);
            part.name = name;
            RemoveCollider(part);
            part.transform.SetParent(body, false);
            part.transform.localPosition = position;
            part.transform.localScale = scale;
            part.GetComponent<MeshRenderer>().sharedMaterial = material;
        }

        private void Capsule(string name, Vector3 position, Vector3 scale, Material material)
        {
            GameObject part = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            part.name = name;
            RemoveCollider(part);
            part.transform.SetParent(body, false);
            part.transform.localPosition = position;
            part.transform.localScale = scale;
            part.GetComponent<MeshRenderer>().sharedMaterial = material;
        }

        private Material Material(string name, string html)
        {
            Color color = ColorUtility.TryParseHtmlString(html, out Color parsed) ? parsed : Color.white;
            Shader? shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader is null)
                throw new System.InvalidOperationException(
                    "URP Lit shader was not found. Configure URP before building the rickshaw.");
            var material = new Material(shader) { name = name };
            material.SetColor("_BaseColor", color);
            material.SetFloat("_Smoothness", 0.2f);
            materials.Add(material);
            return material;
        }

        private static void RemoveCollider(GameObject target)
        {
            Collider? collider = target.GetComponent<Collider>();
            if (collider is not null) Destroy(collider);
        }

        private void OnDestroy()
        {
            foreach (Material material in materials)
            {
                if (material is null) continue;
                if (Application.isPlaying) Destroy(material); else DestroyImmediate(material);
            }
        }
    }
}
