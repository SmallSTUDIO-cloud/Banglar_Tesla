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
        private const string IconPath = "Assets/BanglarTesla/Branding/AppIcon.png";
        /// <summary>Every runtime material in this project is created from this name via Shader.Find.</summary>
        private const string LitShaderName = "Universal Render Pipeline/Lit";

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

            // Without this the player build strips URP Lit (nothing in Assets references it --
            // every material is created at runtime from Shader.Find), and the game dies on
            // device with "URP Lit shader was not found".
            EnsureAlwaysIncludedShader(LitShaderName);
            EnsureAndroidIcons();
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
                panel.themeStyleSheet = ResolveRuntimeTheme();
                if (panel.themeStyleSheet is null)
                    Debug.LogWarning("Banglar Tesla: no UI Toolkit ThemeStyleSheet was found in Packages or Assets. " +
                                     "The HUD uses its own USS, but assign a theme if default control styling is wrong.");
            }
            EditorUtility.SetDirty(panel);
            AssetDatabase.SaveAssets();
            return panel;
        }

        /// <summary>
        /// Adds a shader to Project Settings > Graphics > Always Included Shaders.
        /// Shader.Find only resolves shaders that actually made it into the player build. This
        /// project has no material or shader asset referencing URP Lit, so the stripper removes
        /// it and every runtime-created material fails on device. This is the remedy Unity
        /// documents on Shader.Find ("add it under Always Included Shaders").
        /// ProjectSettings/GraphicsSettings.asset is not committed, so it cannot be fixed by hand
        /// once -- it has to be applied in the build workspace before the player build runs.
        /// </summary>
        public static void EnsureAlwaysIncludedShader(string shaderName)
        {
            Shader? shader = Shader.Find(shaderName);
            if (shader is null)
                throw new System.InvalidOperationException(
                    $"Shader '{shaderName}' is not in the project. The URP package is missing or was renamed.");
            GraphicsSettings? settings = AssetDatabase.LoadAssetAtPath<GraphicsSettings>("ProjectSettings/GraphicsSettings.asset");
            if (settings is null)
            {
                Debug.LogError("Banglar Tesla: ProjectSettings/GraphicsSettings.asset could not be loaded; " +
                               $"'{shaderName}' may be stripped from the player build.");
                return;
            }
            var serialized = new SerializedObject(settings);
            SerializedProperty? list = serialized.FindProperty("m_AlwaysIncludedShaders");
            if (list is null)
            {
                Debug.LogError("Banglar Tesla: Always Included Shaders could not be edited; " +
                               $"'{shaderName}' may be stripped from the player build.");
                return;
            }
            for (int index = 0; index < list.arraySize; index++)
            {
                if (list.GetArrayElementAtIndex(index).objectReferenceValue == shader)
                {
                    Debug.Log($"Banglar Tesla: '{shaderName}' is already in Always Included Shaders.");
                    return;
                }
            }
            list.InsertArrayElementAtIndex(list.arraySize);
            list.GetArrayElementAtIndex(list.arraySize - 1).objectReferenceValue = shader;
            serialized.ApplyModifiedProperties();
            AssetDatabase.SaveAssets();
            Debug.Log($"Banglar Tesla: added '{shaderName}' to Always Included Shaders so runtime materials survive stripping.");
        }

        /// <summary>
        /// Assigns the launcher icon for every Android icon slot. PlayerSettings in
        /// ProjectSettings.asset carries no icon, so the build ships Unity's default logo.
        /// Unity requires one texture per slot returned by GetIconSizes; the same 1024px source is
        /// reused for every slot and Unity scales it down.
        /// </summary>
        public static void EnsureAndroidIcons()
        {
            Texture2D? icon = AssetDatabase.LoadAssetAtPath<Texture2D>(IconPath);
            if (icon is null)
            {
                Debug.LogError($"Banglar Tesla: launcher icon not found at {IconPath}; the build will keep Unity's default icon.");
                return;
            }
            int[] sizes = PlayerSettings.GetIconSizes(NamedBuildTarget.Android, IconKind.Application);
            if (sizes.Length == 0)
            {
                Debug.LogError("Banglar Tesla: the Editor reported no Android icon slots; " +
                               "install Android Build Support or the launcher icon will stay Unity's default.");
                return;
            }
            var textures = new Texture2D[sizes.Length];
            for (int index = 0; index < textures.Length; index++) textures[index] = icon;
            PlayerSettings.SetIcons(NamedBuildTarget.Android, textures, IconKind.Application);
            Debug.Log($"Banglar Tesla: Android launcher icon set from {IconPath} for {textures.Length} icon slots.");
        }

        /// <summary>
        /// Finds the UI Toolkit runtime theme without hard-coding a package path. The previous
        /// hard-coded path pointed at com.unity.ui, which this project does not install.
        /// </summary>
        public static ThemeStyleSheet? ResolveRuntimeTheme()
        {
            ThemeStyleSheet? direct = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(ThemePath);
            if (direct is not null) return direct;
            string[] guids = AssetDatabase.FindAssets("t:ThemeStyleSheet", new[] { "Packages", "Assets" });
            foreach (string guid in guids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.Contains("DefaultRuntimeTheme") && !path.Contains("RuntimeTheme")) continue;
                ThemeStyleSheet? found = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(path);
                if (found is not null) return found;
            }
            return null;
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
            if (PlayerSettings.GetIcons(NamedBuildTarget.Android, IconKind.Application).Length == 0)
                issues.Add("The Android launcher icon is unset; the build would ship Unity's default logo.");
            Shader? lit = Shader.Find(LitShaderName);
            if (lit is null) issues.Add($"Shader '{LitShaderName}' is missing; runtime materials cannot be created.");
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
