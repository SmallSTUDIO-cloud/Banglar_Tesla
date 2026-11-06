using System;
using BanglarTesla.Domain;
using UnityEngine.UIElements;

namespace BanglarTesla.Presentation
{
    public sealed class HudCustomizationPanel : VisualElement
    {
        private readonly Slider globalScale, opacity, selectedScale;
        private readonly Toggle handedness;
        private readonly Label selectedLabel;
        private bool suppress;

        public HudCustomizationPanel()
        {
            AddToClassList("hud-customize");
            pickingMode = PickingMode.Position;
            Add(new Label("কন্ট্রোল সাজান") { name = "customize-title" });
            this.Q<Label>("customize-title").AddToClassList("hud-customize-title");
            var help = new Label("বোতাম টেনে সাজান। আকার ও অপাসিটি বদলান; শেষে সংরক্ষণ করুন।");
            help.AddToClassList("hud-customize-help");
            Add(help);
            selectedLabel = new Label("নির্বাচিত: পেডাল");
            selectedLabel.AddToClassList("hud-customize-row");
            Add(selectedLabel);
            globalScale = CreateSlider("সব বোতামের আকার", 0.8f, 1.3f, value => GlobalScaleChanged?.Invoke(value));
            opacity = CreateSlider("অপাসিটি", 0.45f, 1.0f, value => OpacityChanged?.Invoke(value));
            selectedScale = CreateSlider("নির্বাচিত বোতাম", 0.7f, 1.6f, value => SelectedScaleChanged?.Invoke(value));
            handedness = new Toggle("বাম হাতের বিন্যাস");
            handedness.AddToClassList("hud-customize-row");
            handedness.RegisterValueChangedCallback(evt => { if (!suppress) HandednessChanged?.Invoke(evt.newValue); });
            Add(handedness);
            var actions = new VisualElement();
            actions.AddToClassList("hud-customize-actions");
            var reset = new Button(() => ResetRequested?.Invoke()) { text = "রিসেট" };
            var done = new Button(() => DoneRequested?.Invoke()) { text = "সংরক্ষণ" };
            actions.Add(reset);
            actions.Add(done);
            Add(actions);
        }

        public event Action<float>? GlobalScaleChanged;
        public event Action<float>? OpacityChanged;
        public event Action<float>? SelectedScaleChanged;
        public event Action<bool>? HandednessChanged;
        public event Action? ResetRequested;
        public event Action? DoneRequested;

        public void SetValues(ControlLayoutData layout, HudControlId selected, float scale)
        {
            suppress = true;
            globalScale.SetValueWithoutNotify(layout.GlobalScale);
            opacity.SetValueWithoutNotify(layout.Opacity);
            selectedScale.SetValueWithoutNotify(scale);
            handedness.SetValueWithoutNotify(layout.LeftHanded);
            selectedLabel.text = "নির্বাচিত: " + selected;
            suppress = false;
        }

        private Slider CreateSlider(string label, float minimum, float maximum, Action<float> changed)
        {
            var slider = new Slider { label = label, lowValue = minimum, highValue = maximum };
            slider.AddToClassList("hud-customize-row");
            slider.RegisterValueChangedCallback(evt => { if (!suppress) changed(evt.newValue); });
            Add(slider);
            return slider;
        }
    }
}
