using BanglarTesla.Domain;
using UnityEngine;

namespace BanglarTesla.Presentation
{
    public sealed class FollowCamera : MonoBehaviour
    {
        private RickshawDynamics? target;
        private Vector3 velocity;
        private string mode = "chase";
        private bool snap = true;

        public void Configure(RickshawDynamics dynamics) => target = dynamics;
        public void Snap() => snap = true;
        public void SetMode(string value)
        {
            string next = value is "close" or "wide" or "low" or "front" or "cockpit" or "side" ? value : "chase";
            if (mode == next) return;
            mode = next;
            snap = true;
        }

        private void LateUpdate()
        {
            if (target is null) return;
            Vector3 forward = new((float)System.Math.Sin(target.Yaw), 0.0f, (float)System.Math.Cos(target.Yaw));
            Vector3 right = new(-forward.z, 0.0f, forward.x);
            Vector3 focus = new((float)target.X, (float)target.Y + 1.05f, (float)target.Z);
            float speed = Mathf.Abs((float)target.Speed);
            float distance = mode == "close" ? 4.1f : mode == "wide" ? 9.4f : 6.2f;
            float height = mode == "low" ? 1.55f : mode == "wide" ? 5.0f : mode == "close" ? 2.5f : 3.5f;
            Vector3 desired = focus - forward * (distance + speed * 0.08f) + Vector3.up * (height + speed * 0.025f);
            Vector3 lookDirection = focus - desired;
            if (mode == "front") { desired = focus + forward * 5.2f + Vector3.up * 2.3f; lookDirection = focus - desired; }
            else if (mode == "side") { desired = focus + right * 6.2f + Vector3.up * 2.5f; lookDirection = focus - desired; }
            else if (mode == "cockpit")
            {
                desired = focus + forward * 0.36f + Vector3.up * 0.46f;
                lookDirection = forward + Vector3.down * 0.045f;
                velocity = Vector3.zero;
            }
            if (snap || mode == "cockpit")
            {
                transform.position = desired;
                velocity = Vector3.zero;
                snap = false;
            }
            else transform.position = Vector3.SmoothDamp(transform.position, desired, ref velocity, 0.12f, 80.0f, Time.deltaTime);
            if (!snap && mode != "cockpit") lookDirection = focus - transform.position;
            if (lookDirection.sqrMagnitude > 0.001f) transform.rotation = Quaternion.LookRotation(lookDirection.normalized, Vector3.up);
        }
    }
}
