using System.Collections.Generic;
using System.Globalization;
using UnityEngine;
using UnityEngine.Rendering;

namespace LumaLens
{
    /// <summary>
    /// Settings that often differ between the Editor and a build and explain build-only bugs:
    /// graphics API and GPU, quality level and its URP asset, frame rate, locale and screen size.
    /// Must run on the main thread.
    /// </summary>
    internal static class EnvSnapshot
    {
        public static Dictionary<string, object> Capture(float averageFps)
        {
            int qualityLevel = QualitySettings.GetQualityLevel();
            string[] qualityNameArray = QualitySettings.names;
            var pipeline = GraphicsSettings.currentRenderPipeline;

            return new Dictionary<string, object>
            {
                ["unityVersion"] = Application.unityVersion,
                ["os"] = SystemInfo.operatingSystem,
                ["graphicsApi"] = SystemInfo.graphicsDeviceType.ToString(),
                ["gpu"] = SystemInfo.graphicsDeviceName,
                ["gpuMemoryMB"] = SystemInfo.graphicsMemorySize,
                ["systemMemoryMB"] = SystemInfo.systemMemorySize,
                ["qualityLevel"] = qualityLevel >= 0 && qualityLevel < qualityNameArray.Length ? qualityNameArray[qualityLevel] : qualityLevel.ToString(CultureInfo.InvariantCulture),
                ["renderPipeline"] = pipeline != null ? pipeline.name : "built-in",
                // Not measured yet on the first frame; null is left out of the JSON rather than sent as 0.
                ["fps"] = averageFps > 0f ? Mathf.Round(averageFps) : null,
                ["targetFrameRate"] = Application.targetFrameRate,
                ["vSyncCount"] = QualitySettings.vSyncCount,
                ["locale"] = CultureInfo.CurrentCulture.Name,
                ["screen"] = Screen.width + "x" + Screen.height,
                ["fullScreen"] = Screen.fullScreen,
            };
        }
    }
}
