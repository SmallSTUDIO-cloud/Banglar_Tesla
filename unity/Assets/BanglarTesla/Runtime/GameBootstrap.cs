using System;
using BanglarTesla.Domain;
using BanglarTesla.Domain.Maps;
using BanglarTesla.Infrastructure;
using BanglarTesla.Presentation;
using BanglarTesla.World;
using UnityEngine;
using UnityEngine.UIElements;

namespace BanglarTesla
{
    /// <summary>Single runtime composition root for the staged Unity rewrite.</summary>
    [DisallowMultipleComponent]
    public sealed class GameBootstrap : MonoBehaviour
    {
        private static readonly string[] CameraModes = { "chase", "close", "wide", "low", "front", "cockpit", "side" };
        [SerializeField] private TextAsset? mapAsset;
        [SerializeField] private UnityEngine.UIElements.PanelSettings? hudPanelSettings;
        private IKeyValueStorage? storage;
        private GameState? state;
        private SettingsStore? settings;
        private SourcedMapWorld? world;
        private DrivingHudController? hud;
        private UnityDrivingInput? input;
        private RickshawDynamics? vehicle;
        private PlayerVehicleView? vehicleView;
        private FollowCamera? followCamera;
        private GameObject? cameraObject;
        private TrafficSimulation? traffic;
        private TrafficView? trafficView;
        private GameTimeSystem? clock;
        private WeatherDirector? weather;
        private WeatherContext weatherContext;
        private Light? sun;
        private bool ready, paused;
        private double simulationSeconds, autosaveTimer, tuningTimer, hudTimer;
        private float minX, maxX, minZ, maxZ;

        public TextAsset? MapAsset { get => mapAsset; set => mapAsset = value; }
        public UnityEngine.UIElements.PanelSettings? HudPanelSettings { get => hudPanelSettings; set => hudPanelSettings = value; }
        public bool Ready => ready;
        public GameState? State => state;
        public RickshawDynamics? Vehicle => vehicle;

        private void Start()
        {
            try { Compose(); }
            catch (Exception exception)
            {
                ready = false;
                Debug.LogException(exception, this);
                ShowFatalError(exception.Message);
            }
        }

        private void Compose()
        {
            if (mapAsset is null) throw new InvalidOperationException("Assign the sourced Mohammadpur TextAsset in the scene bootstrap.");
            storage = UnityStorage.Create();
            state = new GameState(storage);
            settings = new SettingsStore(storage);
            MapDataset dataset = MapJson.Deserialize(mapAsset.text);
            world = gameObject.AddComponent<SourcedMapWorld>();
            world.Build(dataset);
            GeoBounds bounds = dataset.bounds;
            Vector2D lower = world.Graph!.Projection.ToLocal(new GeoPoint(bounds.south, bounds.west));
            Vector2D upper = world.Graph.Projection.ToLocal(new GeoPoint(bounds.north, bounds.east));
            minX = (float)Math.Min(lower.X, upper.X); maxX = (float)Math.Max(lower.X, upper.X);
            minZ = (float)Math.Min(lower.Z, upper.Z); maxZ = (float)Math.Max(lower.Z, upper.Z);

            vehicle = new RickshawDynamics(world.Collisions, (_, _) => 0.0, world.SurfaceAt, (_, _) => 0.0);
            vehicle.SetTuning(Economy.DeriveTuning(state.Vehicle, state.Progress.Upgrades, state.Progress.Condition));
            SpawnData? savedSpawn = state.Progress.Spawn;
            if (savedSpawn is not null && world.IsInsideBoundary(savedSpawn.X, savedSpawn.Z) &&
                double.IsFinite(savedSpawn.X) && double.IsFinite(savedSpawn.Z) && double.IsFinite(savedSpawn.Yaw))
                vehicle.Reset(savedSpawn.X, savedSpawn.Z, savedSpawn.Yaw);
            else vehicle.Reset(world.SpawnPosition.x, world.SpawnPosition.z, world.SpawnYawDegrees * Mathf.Deg2Rad);

            var viewObject = new GameObject("Player rickshaw — procedural stand-in");
            viewObject.transform.SetParent(transform, false);
            vehicleView = viewObject.AddComponent<PlayerVehicleView>();
            vehicleView.Configure(state.Vehicle);
            vehicleView.Render(vehicle);
            cameraObject = new GameObject("Follow camera");
            cameraObject.transform.SetParent(transform, false);
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.nearClipPlane = 0.15f; camera.farClipPlane = 650.0f; camera.fieldOfView = 52.0f;
            cameraObject.tag = "MainCamera";
            followCamera = cameraObject.AddComponent<FollowCamera>();
            followCamera.Configure(vehicle);
            followCamera.SetMode(settings.Value.CameraMode);

            // Traffic density follows the graphics profile; the legacy density setting is not migrated yet.
            traffic = new TrafficSimulation(world.Graph!, TrafficConfigFor(settings.Value.GraphicsProfile));
            traffic.Populate(new Vector2D(world.SpawnPosition.x, world.SpawnPosition.z), traffic.Config.MaxAgents);
            var trafficObject = new GameObject("Traffic view");
            trafficObject.transform.SetParent(transform, false);
            trafficView = trafficObject.AddComponent<TrafficView>();
            trafficView.Configure(traffic.Config.MaxAgents);

            var hudObject = new GameObject("Driving HUD");
            hudObject.transform.SetParent(transform, false);
            hudObject.AddComponent<UIDocument>();
            hud = hudObject.AddComponent<DrivingHudController>();
            hud.PanelSettings = hudPanelSettings;
            hud.Configure(settings);
            hud.ControlActivated += OnHudAction;
            input = new UnityDrivingInput();
            input.PauseRequested += TogglePause;
            input.CameraRequested += CycleCamera;
            input.RecoverRequested += Recover;
            input.TanToggleRequested += () => { if (vehicle is not null) vehicle.SetTanActive(!vehicle.TanActive); };
            clock = new GameTimeSystem(state.Progress.ClockMinutes);
            WeatherKind initialWeather = Enum.TryParse(state.Progress.Weather, true, out WeatherKind parsed) ? parsed : WeatherKind.Sunny;
            weather = new WeatherDirector(initialWeather);
            weatherContext = new WeatherContext { TimeMinutes = clock.MinutesOfDay };
            CreateLighting();
            state.BeforeSave += CaptureBeforeSave;
            settings.Changed += ApplySettings;
            ApplySettings(settings.Value);
            ready = true;
            RefreshHud();
        }

        private void FixedUpdate()
        {
            if (!ready || vehicle is null || input is null || settings is null || hud is null) return;
            DriveInput drive = input.Sample(hud.Input.ToDriveInput(), settings.Value.Sensitivity, settings.Value.Deadzone);
            if (paused || hud.IsCustomizing) { hud.ReleaseAll(); return; }
            float dt = Time.fixedDeltaTime;
            simulationSeconds += dt;
            StepEvents events = vehicle.Step(dt, drive, 1.0, 0.0);
            state!.Progress.DistanceTravelled = Math.Min(1_000_000_000.0, state.Progress.DistanceTravelled + events.Distance);
            if (events.Impact > 0.4)
                state.DamageFromImpact(events.Impact * 3.2 * vehicle.Tuning.DamageMultiplier, simulationSeconds);
            traffic?.Step(dt);
            if (!world!.IsInsideBoundary(vehicle.X, vehicle.Z)) RecoverToNearestRoad();
            clock!.Update(dt);
            weatherContext.TimeMinutes = clock.MinutesOfDay;
            weather!.Update(dt, weatherContext);
            autosaveTimer += dt; tuningTimer += dt; hudTimer += dt;
            if (tuningTimer >= 0.75)
            {
                tuningTimer = 0.0;
                vehicle.SetTuning(Economy.DeriveTuning(state.Vehicle, state.Progress.Upgrades, state.Progress.Condition, weather.Blend.Wet));
            }
            if (autosaveTimer >= 12.0) { autosaveTimer = 0.0; state.Autosave(); }
        }

        private void Update()
        {
            if (!ready || vehicle is null) return;
            vehicleView!.Render(vehicle);
            if (traffic is not null && trafficView is not null && cameraObject is not null)
                trafficView.Render(traffic, cameraObject.transform.position);
            if (hudTimer >= 0.1) { hudTimer = 0.0; RefreshHud(); }
        }

        private void RefreshHud()
        {
            if (hud is null || vehicle is null || state is null || clock is null) return;
            hud.SetTelemetry(vehicle.Speed, vehicle.TurboCharge, vehicle.Stamina, vehicle.Battery, vehicle.Tuning.IsElectric);
            hud.SetStatus(state.Balance, state.Rep, state.Progress.Condition, clock.MinutesOfDay);
            hud.SetMission(paused ? "বিরতি" : "মোহাম্মদপুরে ড্রাইভ করুন", paused ? "চালিয়ে যেতে Pause চাপুন" : "মুক্ত ড্রাইভ • Unity পূর্বরূপ");
            hud.SetMapMarker(new Vector2(Mathf.InverseLerp(minX, maxX, (float)vehicle.X), 1.0f - Mathf.InverseLerp(minZ, maxZ, (float)vehicle.Z)));
            hud.SetContextAction(vehicle.Stuck ? "R • উদ্ধার" : null);
        }

        private void Recover()
        {
            if (ready) RecoverToNearestRoad();
        }

        private void RecoverToNearestRoad()
        {
            if (vehicle is null || world?.Graph is null) return;
            RoadProjection nearest = world.Graph.FindNearest(new Vector2D(vehicle.X, vehicle.Z));
            if (nearest.RoadIndex < 0 || !double.IsFinite(nearest.Distance)) return;
            double yaw = Math.Atan2(nearest.Tangent.X, nearest.Tangent.Z);
            vehicle.Respawn(nearest.Point.X, nearest.Point.Z, yaw);
            followCamera?.Snap();
            RefreshHud();
        }

        private void TogglePause()
        {
            if (!ready) return;
            paused = !paused;
            hud?.ReleaseAll();
            RefreshHud();
        }

        private void CycleCamera()
        {
            if (settings is null) return;
            int current = Array.IndexOf(CameraModes, settings.Value.CameraMode);
            string next = CameraModes[(current + 1 + CameraModes.Length) % CameraModes.Length];
            settings.Update(value => value.CameraMode = next);
        }

        private void OnHudAction(HudControlId id)
        {
            switch (id)
            {
                case HudControlId.Pause: TogglePause(); break;
                case HudControlId.Camera: CycleCamera(); break;
            }
        }

        private void ApplySettings(SettingsData value)
        {
            Application.targetFrameRate = value.FpsTarget;
            followCamera?.SetMode(value.CameraMode);
            if (sun is not null) sun.shadows = value.Shadows ? LightShadows.Soft : LightShadows.None;
            QualitySettings.shadowDistance = value.GraphicsProfile == "performance" ? 45.0f : value.GraphicsProfile == "high" ? 120.0f : 75.0f;
        }

        private static TrafficConfig TrafficConfigFor(string profile) => profile switch
        {
            "performance" => new TrafficConfig { MaxAgents = 36, SpawnRadius = 240.0, ComfortGap = 7.0 },
            "high" => new TrafficConfig { MaxAgents = 120, SpawnRadius = 380.0 },
            _ => new TrafficConfig { MaxAgents = 72, SpawnRadius = 320.0 },
        };

        private void CreateLighting()
        {
            var sunObject = new GameObject("Sun");
            sunObject.transform.SetParent(transform, false);
            sun = sunObject.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(1.0f, 0.93f, 0.80f);
            sun.intensity = 1.25f;
            sunObject.transform.rotation = Quaternion.Euler(48.0f, -32.0f, 0.0f);
            RenderSettings.sun = sun;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.48f, 0.59f, 0.68f);
            RenderSettings.ambientEquatorColor = new Color(0.32f, 0.36f, 0.32f);
            RenderSettings.ambientGroundColor = new Color(0.16f, 0.17f, 0.13f);
        }

        private void CaptureBeforeSave(ProgressData progress)
        {
            if (vehicle is not null)
            {
                progress.Spawn = new SpawnData { X = vehicle.X, Z = vehicle.Z, Yaw = vehicle.Yaw };
                if (state is not null) state.TurboCharge = vehicle.TurboCharge;
            }
            if (clock is not null) { progress.ClockMinutes = clock.MinutesOfDay; progress.DayPhase = clock.Phase; }
            if (weather is not null) progress.Weather = weather.Weather.ToString().ToLowerInvariant();
        }

        private void ShowFatalError(string message)
        {
            var errorObject = new GameObject("Startup error");
            UnityEngine.UIElements.UIDocument document = errorObject.AddComponent<UnityEngine.UIElements.UIDocument>();
            document.panelSettings = hudPanelSettings;
            var label = new UnityEngine.UIElements.Label("গেম শুরু করা যায়নি\n" + message);
            label.style.color = Color.white;
            label.style.fontSize = 22;
            label.style.marginTop = 40; label.style.marginLeft = 40; label.style.marginRight = 40;
            document.rootVisualElement?.Add(label);
        }

        private void OnApplicationPause(bool pause)
        {
            if (!pause) return;
            hud?.ReleaseAll();
            if (ready) state?.Autosave();
        }

        private void OnApplicationQuit()
        {
            if (ready) state?.SaveNow();
        }

        private void OnDestroy()
        {
            if (state is not null) state.BeforeSave -= CaptureBeforeSave;
            if (settings is not null) settings.Changed -= ApplySettings;
            if (hud is not null) hud.ControlActivated -= OnHudAction;
        }
    }
}
