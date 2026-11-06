using System;
using BanglarTesla.Domain;
using UnityEngine;
using UnityEngine.InputSystem;

namespace BanglarTesla.Infrastructure
{
    /// <summary>Released keyboard/gamepad bindings combined with pointer-owned touch holds.</summary>
    public sealed class UnityDrivingInput
    {
        private bool previousGamepadCamera, previousGamepadPause, previousGamepadHorn;
        public event Action? PauseRequested;
        public event Action? CameraRequested;
        public event Action? RecoverRequested;
        public event Action? TanToggleRequested;
        public event Action? HornRequested;
        public event Action? BlacklistRequested;
        public event Action? TeaInteractRequested;

        public DriveInput Sample(DriveInput touch, float sensitivity, float deadzone)
        {
            Keyboard? keyboard = Keyboard.current;
            Gamepad? gamepad = Gamepad.current;
            int keyboardSteer = keyboard is null ? 0 :
                (KeyHeld(keyboard, Key.D, Key.RightArrow) ? 1 : 0) - (KeyHeld(keyboard, Key.A, Key.LeftArrow) ? 1 : 0);
            float keyboardThrottle = keyboard is not null && KeyHeld(keyboard, Key.W, Key.UpArrow) ? 1.0f : 0.0f;
            float keyboardBrake = keyboard is not null && KeyHeld(keyboard, Key.S, Key.DownArrow) ? 1.0f : 0.0f;
            bool keyboardTurbo = keyboard is not null && (keyboard.xKey.isPressed || keyboard.nKey.isPressed || keyboard.leftCtrlKey.isPressed);
            bool keyboardHorn = keyboard is not null && (keyboard.spaceKey.isPressed || keyboard.hKey.isPressed || keyboard.bKey.isPressed);

            float analogSteer = 0.0f, gamepadThrottle = 0.0f, gamepadBrake = 0.0f;
            bool gamepadTurbo = false, gamepadHorn = false;
            if (gamepad is not null)
            {
                Vector2 dpad = gamepad.dpad.ReadValue();
                analogSteer = Mathf.Abs(dpad.x) > 0.01f ? dpad.x : gamepad.leftStick.ReadValue().x;
                gamepadThrottle = Mathf.Max(gamepad.rightTrigger.ReadValue(), gamepad.buttonSouth.isPressed ? 1.0f : 0.0f);
                gamepadBrake = Mathf.Max(gamepad.leftTrigger.ReadValue(), gamepad.buttonEast.isPressed ? 1.0f : 0.0f);
                gamepadTurbo = gamepad.leftShoulder.isPressed || gamepad.rightShoulder.isPressed;
                gamepadHorn = gamepad.buttonWest.isPressed;
                Edge(gamepad.buttonNorth.isPressed, ref previousGamepadCamera, CameraRequested);
                Edge(gamepad.startButton.isPressed, ref previousGamepadPause, PauseRequested);
                Edge(gamepadHorn, ref previousGamepadHorn, HornRequested);
            }

            float steer;
            if (Mathf.Abs((float)touch.Steer) > 0.001f) steer = (float)touch.Steer * Mathf.Max(0.75f, sensitivity);
            else if (Mathf.Abs(analogSteer) > 0.001f)
            {
                float magnitude = Mathf.Abs(analogSteer);
                float zone = Mathf.Max(0.05f, Mathf.Clamp(deadzone, 0.0f, 0.4f));
                steer = magnitude < zone ? 0.0f : Mathf.Sign(analogSteer) * (magnitude - zone) / Mathf.Max(0.05f, 1.0f - zone);
                steer *= Mathf.Clamp(sensitivity, 0.35f, 1.8f);
            }
            else steer = keyboardSteer * Mathf.Max(0.75f, sensitivity);

            if (keyboard is not null)
            {
                if (keyboard.escapeKey.wasPressedThisFrame || keyboard.pKey.wasPressedThisFrame) PauseRequested?.Invoke();
                if (keyboard.cKey.wasPressedThisFrame || keyboard.vKey.wasPressedThisFrame) CameraRequested?.Invoke();
                if (keyboard.rKey.wasPressedThisFrame) RecoverRequested?.Invoke();
                if (keyboard.leftShiftKey.wasPressedThisFrame || keyboard.rightShiftKey.wasPressedThisFrame || keyboard.tKey.wasPressedThisFrame) TanToggleRequested?.Invoke();
                if (keyboard.kKey.wasPressedThisFrame) BlacklistRequested?.Invoke();
                if (keyboard.eKey.wasPressedThisFrame) TeaInteractRequested?.Invoke();
                if (keyboard.spaceKey.wasPressedThisFrame || keyboard.hKey.wasPressedThisFrame || keyboard.bKey.wasPressedThisFrame) HornRequested?.Invoke();
            }

            return new DriveInput
            {
                Steer = Mathf.Clamp(steer, -1.0f, 1.0f),
                Throttle = Math.Max(touch.Throttle, Math.Max(keyboardThrottle, gamepadThrottle)),
                Brake = Math.Max(touch.Brake, Math.Max(keyboardBrake, gamepadBrake)),
                Turbo = touch.Turbo || keyboardTurbo || gamepadTurbo,
                Horn = touch.Horn || keyboardHorn || gamepadHorn,
                Handbrake = touch.Handbrake,
            };
        }

        private static bool KeyHeld(Keyboard keyboard, Key first, Key second) => keyboard[first].isPressed || keyboard[second].isPressed;
        private static void Edge(bool pressed, ref bool previous, Action? action)
        {
            if (pressed && !previous) action?.Invoke();
            previous = pressed;
        }

    }
}
