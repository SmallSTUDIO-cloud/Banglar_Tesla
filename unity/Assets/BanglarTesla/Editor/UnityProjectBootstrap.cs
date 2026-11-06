using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UIElements;

namespace BanglarTesla.Editor
{
    /// <summary>Idempotent project configuration. Run once after Unity resolves the pinned packages.</summary>
    public static class UnityProjectBootstrap
    {
        public const string PackageId = "com.shostalab.banglartesla";
        private const string SettingsFolder = "Assets/BanglarTesla/Settings";
        private const string RendererPath = SettingsFolder + "/BanglarTesla-UniversalRenderer.asset";
        private const string PipelinePath = SettingsFolder + "/BanglarTesla-URP.asset";
        private const string MapPath = "Assets/BanglarTesla/Data/Maps/mohammadpur.osm.json";
        private const string ScenePath = "Assets/BanglarTesla/Scenes/Mohammadpur.unity";
        private const string PanelPath = SettingsFolder + "/BanglarTesla-HudPanel.asset";
        private const string ThemePath =
            "Packages/com.unity.ui/PackageResources/StyleSheets/Generated/DefaultRuntimeTheme.tss";

        [MenuItem("Banglar Tesla/Setup/Configure Unity Project")]
        public static void ConfigureProject()
        {
            PlayerSettings.companyName = "Shosta Lab";
            PlayerSettings.productName = "Banglar Tesla";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, PackageId);
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.WebGL, PackageId);
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24;
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARMv7 | AndroidArchitecture.ARM64;
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.SetIl2CppCompilerConfiguration(NamedBuildTarget.Android, Il2CppCompilerConfiguration.Release);
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.AutoRotation;
            PlayerSettings.allowedAutorotateToPortrait = false;
            PlayerSettings.allowedAutorotateToPortraitUpsideDown = false;
            PlayerSettings.allowedAutorotateToLandscapeLeft = true;
            PlayerSettings.allowedAutorotateToLandscapeRight = true;

            EnsureSettingsFolder();
            UniversalRendererData renderer = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(RendererPath);
            if (renderer is null)
            {
                renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
                renderer.name = "BanglarTesla-UniversalRenderer";
                AssetDatabase.CreateAsset(renderer, RendererPath);
            }
            UniversalRenderPipelineAsset pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipelinePath);
            if (pipeline is null)
            {
                pipeline = UniversalRenderPipelineAsset.Create(renderer);
                pipeline.name = "BanglarTesla-URP";
                AssetDatabase.CreateAsset(pipeline, PipelinePath);
            }

            GraphicsSettings.defaultRenderPipeline = pipeline;
            int previousQuality = QualitySettings.GetQualityLevel();
            for (int level = 0; level < QualitySettings.names.Length; level++)
            {
                QualitySettings.SetQualityLevel(level, false);
                QualitySettings.renderPipeline = pipeline;
            }
            QualitySettings.SetQualityLevel(previousQuality, false);
            EditorUtility.SetDirty(renderer);
            EditorUtility.SetDirty(pipeline);
            AssetDatabase.SaveAssets();
            EnsurePlayableScene();
            Debug.Log("Banglar Tesla: package identity, Android, URP and the sourced playable scene were configured. Run Editor/PlayMode validation before building.");
        }

        [MenuItem("Banglar Tesla/Setup/Create Sourced Playable Scene")]
        public static void CreatePlayableScene() => ConfigureProject();

        private static void EnsurePlayableScene()
        {
            TextAsset? map = AssetDatabase.LoadAssetAtPath<TextAsset>(MapPath);
            if (map is null) throw new System.IO.FileNotFoundException("The sourced Mohammadpur map must be imported before scene setup.", MapPath);
            // Never prompt in a headless build. SaveCurrentModifiedScenesIfUserWantsTo opens a
            // Save/Don't Save/Cancel dialog and is a native binding with no managed batch-mode
            // guard, so with no operator present it can either return false (silently skipping
            // scene generation) or block until the build times out. Nothing in a cloud build
            // workspace is worth preserving; the scene is written explicitly below.
            if (!Application.isBatchMode && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            if (!AssetDatabase.IsValidFolder("Assets/BanglarTesla/Scenes"))
                AssetDatabase.CreateFolder("Assets/BanglarTesla", "Scenes");
            UnityEngine.SceneManagement.Scene scene;
            if (System.IO.File.Exists(ScenePath)) scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            else scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            GameBootstrap? bootstrap = Object.FindFirstObjectByType<GameBootstrap>();
            if (bootstrap is null)
            {
                var root = new GameObject("Banglar Tesla — Application");
                bootstrap = root.AddComponent<GameBootstrap>();
            }
            bootstrap.MapAsset = map;
            PanelSettings panel = EnsurePanelSettings();
            bootstrap.HudPanelSettings = panel;
            EditorUtility.SetDirty(bootstrap);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, ScenePath);
            var scenes = new System.Collections.Generic.List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            if (!scenes.Exists(entry => entry.path == ScenePath)) scenes.Add(new EditorBuildSettingsScene(ScenePath, true));
            EditorBuildSettings.scenes = scenes.ToArray();
            AssetDatabase.SaveAssets();
        }

        /// <summary>
        /// Creates the UI Toolkit panel asset. A panel created at runtime has no theme style
        /// sheet or blit shaders, so the HUD would be unstyled or invisible in a player build.
        /// </summary>
        private static PanelSettings EnsurePanelSettings()
        {
            if (!AssetDatabase.IsValidFolder(SettingsFolder))
                AssetDatabase.CreateFolder("Assets/BanglarTesla", "Settings");
            PanelSettings? panel = AssetDatabase.LoadAssetAtPath<PanelSettings>(PanelPath);
            if (panel is null)
            {
                panel = ScriptableObject.CreateInstance<PanelSettings>();
                AssetDatabase.CreateAsset(panel, PanelPath);
            }
            panel.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            panel.referenceResolution = new Vector2Int(1568, 720);
            panel.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            panel.match = 0.5f;
            if (panel.themeStyleSheet is null)
            {
                var theme = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(ThemePath);
                if (theme is not null) panel.themeStyleSheet = theme;
                else Debug.LogWarning($"Banglar Tesla: UI Toolkit default runtime theme was not found at {ThemePath}. " +
                                      "Assign a ThemeStyleSheet to the panel before building.");
            }
            EditorUtility.SetDirty(panel);
            AssetDatabase.SaveAssets();
            return panel;
        }

        [MenuItem("Banglar Tesla/Setup/Validate Project Readiness")]
        public static void ValidateProjectReadiness()
        {
            var issues = new List<string>();
            if (PlayerSettings.GetApplicationIdentifier(NamedBuildTarget.Android) != PackageId)
                issues.Add("Android application identifier is not configured.");
            if (PlayerSettings.Android.minSdkVersion < AndroidSdkVersions.AndroidApiLevel24)
                issues.Add("Android minSdk must remain at least 24.");
            if (AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipelinePath) is null)
                issues.Add("URP pipeline asset has not been generated by the setup menu.");
            PanelSettings? panel = AssetDatabase.LoadAssetAtPath<PanelSettings>(PanelPath);
            if (panel is null) issues.Add("HUD PanelSettings asset has not been generated by the setup menu.");
            else if (panel.themeStyleSheet is null) issues.Add("HUD PanelSettings has no theme style sheet; UI may not render.");
            if (EditorBuildSettings.scenes.Length == 0)
                issues.Add("No Unity build scenes exist yet; this project is not build-ready.");
            if (issues.Count == 0)
            {
                Debug.Log("Banglar Tesla: static project checks passed. Editor/PlayMode tests and platform builds are still required.");
                return;
            }
            foreach (string issue in issues) Debug.LogWarning("Banglar Tesla readiness: " + issue);
        }

        private static void EnsureSettingsFolder()
        {
            if (!AssetDatabase.IsValidFolder("Assets/BanglarTesla"))
                AssetDatabase.CreateFolder("Assets", "BanglarTesla");
            if (!AssetDatabase.IsValidFolder(SettingsFolder))
                AssetDatabase.CreateFolder("Assets/BanglarTesla", "Settings");
        }
    }
}
