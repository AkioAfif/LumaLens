using System;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;

/// <summary>Build half of the E2E run: an empty-scene Windows player; E2EDriver boots itself after the scene loads.</summary>
public static class E2EBuild
{
    private const string ScenePath = "Assets/E2E/E2E.unity";

    // Unity -batchmode -quit -executeMethod E2EBuild.Build -e2eOut <path to .exe>
    public static void Build()
    {
        string outPath = ArgAfter("-e2eOut") ?? throw new ArgumentException("-e2eOut <path> is required");

        var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
        EditorSceneManager.SaveScene(scene, ScenePath);

        PlayerSettings.productName = "LumaLensE2E";
        PlayerSettings.bundleVersion = "e2e";
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = new[] { ScenePath },
            locationPathName = outPath,
            target = BuildTarget.StandaloneWindows64,
            options = BuildOptions.None,
        });
        if (report.summary.result != BuildResult.Succeeded)
        {
            UnityEngine.Debug.LogError($"E2E build failed: {report.summary.result}");
            EditorApplication.Exit(1);
        }
    }

    private static string ArgAfter(string name)
    {
        string[] args = Environment.GetCommandLineArgs();
        int i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }
}
