using System;
using BanglarTesla.Domain;
using UnityEngine;
using UnityEngine.UIElements;

namespace BanglarTesla.Presentation
{
    /// <summary>One pointer-owned HUD control with separate hold, click and customization-drag behavior.</summary>
    public sealed class HudControlElement : VisualElement
    {
        private int activePointer = -1;
        private Vector2 downPosition;
        private bool dragging, editMode, holdPressed;

        public HudControlElement(HudControlId id, Texture2D? iconTexture, string text, bool isHold)
        {
            Id = id;
            Definition = HudControls.Get(id);
            IsHold = isHold;
            AddToClassList("hud-control");
            switch (id)
            {
                case HudControlId.SteerLeft:
                case HudControlId.SteerRight: AddToClassList("steering"); break;
                case HudControlId.Pedal: AddToClassList("pedal"); AddToClassList("round"); break;
                case HudControlId.Brake: AddToClassList("brake"); AddToClassList("round"); break;
                case HudControlId.Turbo: AddToClassList("turbo"); AddToClassList("round"); break;
                case HudControlId.Horn: AddToClassList("round"); break;
                case HudControlId.Minimap: AddToClassList("minimap"); break;
                case HudControlId.ContextAction: AddToClassList("context"); break;
                default: AddToClassList("utility"); break;
            }
            pickingMode = PickingMode.Position;
            Icon = new Image { image = iconTexture, scaleMode = ScaleMode.ScaleToFit, pickingMode = PickingMode.Ignore };
            Icon.AddToClassList("control-icon");
            Add(Icon);
            Label = new Label(text) { pickingMode = PickingMode.Ignore };
            Label.AddToClassList("control-label");
            Add(Label);
            if (id == HudControlId.Minimap)
            {
                MapMarker = new VisualElement { pickingMode = PickingMode.Ignore };
                MapMarker.AddToClassList("map-marker");
                Add(MapMarker);
            }
            if (id == HudControlId.Turbo)
            {
                var track = new VisualElement { pickingMode = PickingMode.Ignore };
                track.AddToClassList("charge-track");
                ChargeFill = new VisualElement { pickingMode = PickingMode.Ignore };
                ChargeFill.AddToClassList("charge-fill");
                track.Add(ChargeFill);
                Add(track);
            }

            RegisterCallback<PointerDownEvent>(OnPointerDown);
            RegisterCallback<PointerMoveEvent>(OnPointerMove);
            RegisterCallback<PointerUpEvent>(OnPointerUp);
            RegisterCallback<PointerCancelEvent>(OnPointerCancel);
            RegisterCallback<DetachFromPanelEvent>(_ => Cancel());
        }

        public HudControlId Id { get; }
        public HudControlDefinition Definition { get; }
        public bool IsHold { get; }
        public Image Icon { get; }
        public Label Label { get; }
        public VisualElement? MapMarker { get; }
        public VisualElement? ChargeFill { get; }
        public event Action<HudControlId, bool, int>? HoldChanged;
        public event Action<HudControlId>? Activated;
        public event Action<HudControlId>? Selected;
        public event Action<HudControlId, Vector2>? Dragged;

        public void SetEditMode(bool enabled)
        {
            if (editMode == enabled) return;
            Cancel();
            editMode = enabled;
            EnableInClassList("edit-mode", enabled);
        }

        public void SetSelected(bool selected) => EnableInClassList("selected", selected);
        public void SetCharge(float charge)
        {
            if (ChargeFill is not null)
                ChargeFill.style.width = new Length(Mathf.Clamp01(charge) * 100.0f, LengthUnit.Percent);
        }

        public void SetVisualScale(float scale)
        {
            if (Id != HudControlId.Minimap)
                Label.style.fontSize = Mathf.Clamp(13.0f * scale, 10.0f, 22.0f);
        }

        public void Cancel()
        {
            if (activePointer < 0) return;
            int pointer = activePointer;
            if (holdPressed) HoldChanged?.Invoke(Id, false, pointer);
            holdPressed = false;
            activePointer = -1;
            dragging = false;
            RemoveFromClassList("pressed");
            if (PointerCaptureHelper.HasPointerCapture(this, pointer)) PointerCaptureHelper.ReleasePointer(this, pointer);
        }

        private void OnPointerDown(PointerDownEvent evt)
        {
            if (activePointer >= 0 || evt.button != 0) return;
            activePointer = evt.pointerId;
            downPosition = evt.position;
            dragging = false;
            AddToClassList("pressed");
            PointerCaptureHelper.CapturePointer(this, evt.pointerId);
            if (IsHold && !editMode)
            {
                holdPressed = true;
                HoldChanged?.Invoke(Id, true, evt.pointerId);
            }
            evt.StopPropagation();
        }

        private void OnPointerMove(PointerMoveEvent evt)
        {
            if (!editMode || evt.pointerId != activePointer) return;
            Vector2 position = evt.position;
            if (!dragging && Vector2.Distance(position, downPosition) >= 5.0f) dragging = true;
            if (dragging) Dragged?.Invoke(Id, position);
            evt.StopPropagation();
        }

        private void OnPointerUp(PointerUpEvent evt)
        {
            if (evt.pointerId != activePointer) return;
            bool activate = !editMode && !IsHold && !dragging;
            bool select = editMode && !dragging;
            Cancel();
            if (activate) Activated?.Invoke(Id);
            if (select) Selected?.Invoke(Id);
            evt.StopPropagation();
        }

        private void OnPointerCancel(PointerCancelEvent evt)
        {
            if (evt.pointerId != activePointer) return;
            Cancel();
            evt.StopPropagation();
        }
    }
}
