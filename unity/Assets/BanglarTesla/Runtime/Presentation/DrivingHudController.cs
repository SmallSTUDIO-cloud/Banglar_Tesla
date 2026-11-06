using System;
using System.Collections.Generic;
using System.Globalization;
using BanglarTesla.Domain;
using UnityEngine;
using UnityEngine.UIElements;

namespace BanglarTesla.Presentation
{
    /// <summary>Runtime UI Toolkit driving HUD. Gameplay truth remains in the domain/application layers.</summary>
    [RequireComponent(typeof(UIDocument))]
    [DisallowMultipleComponent]
    public sealed class DrivingHudController : MonoBehaviour
    {
        private readonly Dictionary<HudControlId, HudControlElement> controls = new();
        private readonly DrivingInputState input = new();
        private UIDocument? document;
        private SettingsStore? settings;
        private VisualElement? root, safeLayer, controlLayer, missionCard;
        private VisualElement? topStrip;
        private Label? balanceLabel, repLabel, conditionLabel, clockLabel, speedLabel, missionTitle, missionSubtitle;
        private HudCustomizationPanel? customization;
        private Button? customizeButton;
        private ControlLayoutData layout = ControlLayoutDefaults.Create();
        private LogicalRect currentSafeArea;
        private HudControlId selectedControl = HudControlId.Pedal;
        private bool built, layoutDirty = true, applyingSettings, editMode, ownsPanelSettings;
        private int lastScreenWidth = -1, lastScreenHeight = -1, lastSpeed = -1;
        private Rect lastSafeArea;

        /// <summary>
        /// Authored by the editor setup menu. A runtime-created panel has no theme style
        /// sheet or blit shaders, so UI is unstyled or invisible in a player build.
        /// </summary>
        [SerializeField] private PanelSettings? panelSettings;

        public PanelSettings? PanelSettings { get => panelSettings; set => panelSettings = value; }
        public DrivingInputState Input => input;
        public bool IsCustomizing => editMode;
        public event Action<HudControlId>? ControlActivated;

        public void Configure(SettingsStore store)
        {
            if (ReferenceEquals(settings, store)) return;
            if (settings is not null) settings.Changed -= ApplySettings;
            settings = store ?? throw new ArgumentNullException(nameof(store));
            if (!built) return;
            settings.Changed += ApplySettings;
            ApplySettings(settings.Value);
        }

        private void Start() => Build();

        private void Build()
        {
            if (built) return;
            document = GetComponent<UIDocument>();
            if (panelSettings is not null) document.panelSettings = panelSettings;
            if (document.panelSettings is null)
            {
                Debug.LogWarning("Banglar Tesla HUD: no authored PanelSettings. Run 'Banglar Tesla/Setup/Configure Unity Project' " +
                                 "to generate one; a runtime panel has no theme or blit shaders and may not render.");
                document.panelSettings = CreatePanelSettings();
                ownsPanelSettings = true;
            }
            root = document.rootVisualElement;
            if (root is null)
            {
                Debug.LogError("Banglar Tesla HUD: UIDocument did not create a root visual element.");
                return;
            }
            settings ??= new SettingsStore(null);
            settings.Changed += ApplySettings;
            root.Clear();
            root.AddToClassList("hud-root");
            root.pickingMode = PickingMode.Ignore;
            StyleSheet? styleSheet = Resources.Load<StyleSheet>("UI/HudStyles");
            if (styleSheet is not null && !root.styleSheets.Contains(styleSheet)) root.styleSheets.Add(styleSheet);
            Font? font = Resources.Load<Font>("Fonts/HindSiliguri-Regular");
            if (font is not null) root.style.unityFont = font;
            root.RegisterCallback<GeometryChangedEvent>(_ => layoutDirty = true);

            safeLayer = Layer("hud-safe");
            controlLayer = Layer("hud-layer");
            root.Add(safeLayer);
            root.Add(controlLayer);
            BuildStatus();
            BuildMission();
            BuildControls();
            customization = new HudCustomizationPanel { style = { display = DisplayStyle.None } };
            customization.GlobalScaleChanged += value => { layout.GlobalScale = value; layoutDirty = true; };
            customization.OpacityChanged += value => { layout.Opacity = value; layoutDirty = true; };
            customization.SelectedScaleChanged += SetSelectedScale;
            customization.HandednessChanged += value =>
            {
                ControlLayoutSanitizer.SetHandedness(layout, value);
                layoutDirty = true;
                RefreshCustomizationValues();
            };
            customization.ResetRequested += ResetCustomization;
            customization.DoneRequested += SaveCustomization;
            root.Add(customization);
            built = true;
            ApplySettings(settings.Value);
        }

        private static PanelSettings CreatePanelSettings()
        {
            var panel = ScriptableObject.CreateInstance<PanelSettings>();
            panel.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            panel.referenceResolution = new Vector2(1568, 720);
            panel.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            panel.match = 0.5f;
            panel.referenceDpi = 96.0f;
            panel.fallbackDpi = 96.0f;
            return panel;
        }

        private VisualElement Layer(string className)
        {
            var layer = new VisualElement { pickingMode = PickingMode.Ignore };
            layer.AddToClassList(className);
            return layer;
        }

        private void BuildStatus()
        {
            topStrip = new VisualElement { pickingMode = PickingMode.Ignore };
            topStrip.AddToClassList("hud-top-strip");
            balanceLabel = Stat(true);
            repLabel = Stat(false);
            conditionLabel = Stat(false);
            clockLabel = Stat(false);
            speedLabel = Stat(true);
            topStrip.Add(balanceLabel);
            topStrip.Add(repLabel);
            topStrip.Add(conditionLabel);
            topStrip.Add(clockLabel);
            topStrip.Add(speedLabel);
            customizeButton = new Button(BeginCustomization) { text = "⚙", name = "customize-controls" };
            customizeButton.AddToClassList("hud-customize");
            topStrip.Add(customizeButton);
            safeLayer!.Add(topStrip);
        }

        private static Label Stat(bool accent)
        {
            var label = new Label { pickingMode = PickingMode.Ignore };
            label.AddToClassList("hud-stat");
            if (accent) label.AddToClassList("hud-stat-accent");
            return label;
        }

        private void BuildMission()
        {
            missionCard = new VisualElement { pickingMode = PickingMode.Ignore };
            missionCard.AddToClassList("hud-mission");
            var kicker = new Label("মোহাম্মদপুর ডিউটি") { pickingMode = PickingMode.Ignore };
            kicker.AddToClassList("hud-mission-kicker");
            missionTitle = new Label("যাত্রী খুঁজুন") { pickingMode = PickingMode.Ignore };
            missionTitle.AddToClassList("hud-mission-title");
            missionSubtitle = new Label("নিরাপদে গন্তব্যে পৌঁছে দিন") { pickingMode = PickingMode.Ignore };
            missionSubtitle.AddToClassList("hud-mission-subtitle");
            missionCard.Add(kicker);
            missionCard.Add(missionTitle);
            missionCard.Add(missionSubtitle);
            safeLayer!.Add(missionCard);
        }

        private void BuildControls()
        {
            foreach (HudControlDefinition definition in HudControls.All)
            {
                HudControlId id = definition.Id;
                string resource = id == HudControlId.Minimap ? "UI/mohammadpur-minimap" : "UI/Icons/" + IconName(id);
                Texture2D? texture = Resources.Load<Texture2D>(resource);
                bool hold = id is HudControlId.SteerLeft or HudControlId.SteerRight or HudControlId.Pedal or HudControlId.Brake or HudControlId.Turbo or HudControlId.Horn;
                var control = new HudControlElement(id, texture, LabelFor(id, "bn"), hold);
                control.HoldChanged += OnHoldChanged;
                control.Activated += OnActivated;
                control.Selected += OnSelected;
                control.Dragged += OnDragged;
                if (id == HudControlId.ContextAction) control.style.display = DisplayStyle.None;
                controls.Add(id, control);
                controlLayer!.Add(control);
            }
        }

        private void OnHoldChanged(HudControlId id, bool pressed, int pointerId)
        {
            if (pressed)
            {
                if (input.Press(id, pointerId) && id == HudControlId.Horn && !editMode) ControlActivated?.Invoke(id);
            }
            else input.Release(id, pointerId);
        }

        private void OnActivated(HudControlId id)
        {
            if (!editMode) ControlActivated?.Invoke(id);
        }

        private void OnSelected(HudControlId id)
        {
            selectedControl = id;
            foreach (KeyValuePair<HudControlId, HudControlElement> pair in controls) pair.Value.SetSelected(pair.Key == id);
            RefreshCustomizationValues();
        }

        private void OnDragged(HudControlId id, Vector2 panelPosition)
        {
            if (!editMode || currentSafeArea.Width <= 0.0) return;
            selectedControl = id;
            ControlPlacement placement = controlsPlacement(id);
            ControlLayoutEngine.MoveControl(placement, HudControls.Get(id), panelPosition.x, panelPosition.y, currentSafeArea, layout.GlobalScale);
            layoutDirty = true;
        }

        private ControlPlacement controlsPlacement(HudControlId id)
        {
            string key = id.ToString();
            foreach (ControlPlacement placement in layout.Controls) if (placement.Id == key) return placement;
            throw new InvalidOperationException("Missing sanitized HUD placement: " + key);
        }

        private void ApplySettings(SettingsData value)
        {
            if (!built && root is null) return;
            applyingSettings = true;
            layout = ControlLayoutSanitizer.Sanitize(value.ControlLayout);
            layout.GlobalScale = value.HudScale;
            foreach (KeyValuePair<HudControlId, HudControlElement> pair in controls)
                pair.Value.Label.text = LabelFor(pair.Key, value.Language);
            if (root is not null) root.style.fontSize = 16.0f * value.TextScale;
            RefreshCustomizationValues();
            applyingSettings = false;
            layoutDirty = true;
        }

        private void Update()
        {
            if (!built) return;
            Rect safe = Screen.safeArea;
            if (Screen.width != lastScreenWidth || Screen.height != lastScreenHeight || safe != lastSafeArea)
            {
                lastScreenWidth = Screen.width;
                lastScreenHeight = Screen.height;
                lastSafeArea = safe;
                layoutDirty = true;
            }
            if (layoutDirty) ApplyLayout();
        }

        private void ApplyLayout()
        {
            if (root is null || root.contentRect.width <= 0.0f || root.contentRect.height <= 0.0f) return;
            layoutDirty = false;
            Rect rootRect = root.contentRect;
            currentSafeArea = SafeAreaCalculator.ToLogicalPanel(
                new LogicalRect(0, 0, Screen.width, Screen.height),
                new LogicalRect(Screen.safeArea.x, Screen.safeArea.y, Screen.safeArea.width, Screen.safeArea.height),
                new LogicalRect(rootRect.x, rootRect.y, rootRect.width, rootRect.height));
            if (safeLayer is not null)
            {
                safeLayer.style.left = (float)currentSafeArea.X;
                safeLayer.style.top = (float)currentSafeArea.Y;
                safeLayer.style.width = (float)currentSafeArea.Width;
                safeLayer.style.height = (float)currentSafeArea.Height;
            }
            UpdateResponsiveStatus();
            foreach (KeyValuePair<HudControlId, HudControlElement> pair in controls)
            {
                ControlPlacement placement = controlsPlacement(pair.Key);
                LogicalRect rect = ControlLayoutEngine.ComputeRect(placement, pair.Value.Definition, currentSafeArea, layout.GlobalScale);
                pair.Value.style.left = (float)rect.X;
                pair.Value.style.top = (float)rect.Y;
                pair.Value.style.width = (float)rect.Width;
                pair.Value.style.height = (float)rect.Height;
                pair.Value.style.opacity = layout.Opacity;
                pair.Value.SetVisualScale((float)(rect.Width / pair.Value.Definition.Width));
            }
            if (customization is not null)
            {
                customization.style.left = (float)(currentSafeArea.X + 12.0);
                customization.style.top = (float)(currentSafeArea.Y + 108.0);
            }
        }

        private void UpdateResponsiveStatus()
        {
            if (topStrip is null || missionCard is null) return;
            bool compact = currentSafeArea.Width < 760.0;
            topStrip.style.left = compact ? 8.0f : 236.0f;
            topStrip.style.right = compact ? 8.0f : 244.0f;
            topStrip.style.top = compact ? 106.0f : 12.0f;
            topStrip.style.flexWrap = compact ? Wrap.Wrap : Wrap.NoWrap;
            missionCard.style.width = compact ? 176.0f : 214.0f;
        }

        public void SetTelemetry(double speedMetersPerSecond, double turboCharge, double stamina, double battery, bool electric)
        {
            int speed = Mathf.RoundToInt((float)(speedMetersPerSecond * 3.6));
            if (speed != lastSpeed && speedLabel is not null)
            {
                lastSpeed = speed;
                speedLabel.text = LocalizeDigits(speed.ToString(CultureInfo.InvariantCulture)) + " কিমি/ঘণ্টা";
            }
            if (controls.TryGetValue(HudControlId.Turbo, out HudControlElement? turbo)) turbo.SetCharge((float)(turboCharge / 100.0));
            if (controls.TryGetValue(HudControlId.Pedal, out HudControlElement? pedal))
                pedal.Label.text = electric ? "থ্রটল" : "পেডাল";
        }

        public void SetStatus(int balance, int rep, double condition, double clockMinutes)
        {
            if (balanceLabel is not null) balanceLabel.text = "৳ " + LocalizeDigits(balance.ToString("N0", CultureInfo.InvariantCulture));
            if (repLabel is not null) repLabel.text = "REP " + LocalizeDigits(rep.ToString("N0", CultureInfo.InvariantCulture));
            if (conditionLabel is not null) conditionLabel.text = "অবস্থা " + LocalizeDigits(Mathf.RoundToInt((float)condition).ToString()) + "%";
            if (clockLabel is not null) clockLabel.text = TimeOfDay.FormatGameClock(clockMinutes);
        }

        public void SetMission(string title, string subtitle)
        {
            if (missionTitle is not null && missionTitle.text != title) missionTitle.text = title;
            if (missionSubtitle is not null && missionSubtitle.text != subtitle) missionSubtitle.text = subtitle;
        }

        public void SetContextAction(string? text)
        {
            if (!controls.TryGetValue(HudControlId.ContextAction, out HudControlElement? context)) return;
            context.style.display = string.IsNullOrEmpty(text) ? DisplayStyle.None : DisplayStyle.Flex;
            if (!string.IsNullOrEmpty(text)) context.Label.text = text;
        }

        public void SetMapMarker(Vector2 normalizedPosition)
        {
            if (!controls.TryGetValue(HudControlId.Minimap, out HudControlElement? map) || map.MapMarker is null) return;
            map.MapMarker.style.left = new Length(Mathf.Clamp01(normalizedPosition.x) * 100.0f, LengthUnit.Percent);
            map.MapMarker.style.top = new Length(Mathf.Clamp01(normalizedPosition.y) * 100.0f, LengthUnit.Percent);
        }

        public void BeginCustomization()
        {
            if (!built || customization is null) return;
            ReleaseAll();
            editMode = true;
            customizeButton?.SetEnabled(false);
            customization.style.display = DisplayStyle.Flex;
            foreach (HudControlElement control in controls.Values) control.SetEditMode(true);
            OnSelected(selectedControl);
        }

        private void SaveCustomization()
        {
            if (settings is not null)
                settings.Update(value =>
                {
                    value.ControlLayout = layout.Clone();
                    value.HudScale = layout.GlobalScale;
                    value.Handedness = layout.LeftHanded ? "left" : "right";
                });
            editMode = false;
            customizeButton?.SetEnabled(true);
            foreach (HudControlElement control in controls.Values)
            {
                control.SetEditMode(false);
                control.SetSelected(false);
            }
            if (customization is not null) customization.style.display = DisplayStyle.None;
            ReleaseAll();
        }

        private void ResetCustomization()
        {
            layout = ControlLayoutDefaults.Create(layout.LeftHanded);
            layoutDirty = true;
            RefreshCustomizationValues();
        }

        private void SetSelectedScale(float value)
        {
            controlsPlacement(selectedControl).Scale = value;
            layoutDirty = true;
        }

        private void RefreshCustomizationValues()
        {
            if (customization is null || applyingSettings) return;
            customization.SetValues(layout, selectedControl, controlsPlacement(selectedControl).Scale);
        }

        public void ReleaseAll()
        {
            foreach (HudControlElement control in controls.Values) control.Cancel();
            input.ReleaseAll();
        }

        private string LocalizeDigits(string value)
        {
            if (settings?.Value.Language != "bn") return value;
            char[] characters = value.ToCharArray();
            for (int i = 0; i < characters.Length; i++) if (characters[i] is >= '0' and <= '9') characters[i] = (char)('০' + characters[i] - '0');
            return new string(characters);
        }

        private static string IconName(HudControlId id) => id switch
        {
            HudControlId.SteerLeft => "steer-left", HudControlId.SteerRight => "steer-right",
            HudControlId.Pedal => "pedal", HudControlId.Brake => "brake", HudControlId.Turbo => "turbo",
            HudControlId.Horn => "horn", HudControlId.Pause => "pause", HudControlId.Camera => "camera",
            HudControlId.Blacklist => "blacklist", HudControlId.ContextAction => "context", _ => "context",
        };

        private static string LabelFor(HudControlId id, string language) => (id, language) switch
        {
            (HudControlId.SteerLeft, "en") => "LEFT", (HudControlId.SteerRight, "en") => "RIGHT",
            (HudControlId.Pedal, "en") => "PEDAL", (HudControlId.Brake, "en") => "BRAKE",
            (HudControlId.Turbo, "en") => "TURBO", (HudControlId.Horn, "en") => "HORN",
            (HudControlId.ContextAction, "en") => "PASSENGER", (HudControlId.Minimap, _) => "© OpenStreetMap",
            (HudControlId.SteerLeft, _) => "বাম", (HudControlId.SteerRight, _) => "ডান",
            (HudControlId.Pedal, _) => "পেডাল", (HudControlId.Brake, _) => "ব্রেক",
            (HudControlId.Turbo, _) => "টার্বো", (HudControlId.Horn, _) => "হর্ণ",
            (HudControlId.ContextAction, _) => "যাত্রী", _ => string.Empty,
        };

        private void OnApplicationPause(bool paused) { if (paused) ReleaseAll(); }
        private void OnApplicationFocus(bool focused) { if (!focused) ReleaseAll(); }

        private void OnDestroy()
        {
            if (settings is not null) settings.Changed -= ApplySettings;
            ReleaseAll();
            if (ownsPanelSettings && document is not null && document.panelSettings is not null)
                Destroy(document.panelSettings);
        }
    }
}
