using System;
using System.Collections;
using LumaLens;
using UnityEngine;

namespace LumaLens.E2E
{
    /// <summary>
    /// Sends the three report kinds the client supports: a manual report with a position, a Debug.LogError and an
    /// uncaught exception. Run from a PlayMode test (runContext editor) and from a Windows player (runContext build)
    /// with the same LUMALENS_E2E_BUILD so scripts/unity-e2e/run.mjs can find and compare both sets.
    /// </summary>
    public static class E2EDriver
    {
        public const string ManualTitle = "E2E manual report";
        public const string ErrorMessage = "E2E auto error";
        public const string ExceptionMessage = "E2E auto exception";
        private const float SendWaitSeconds = 12f;

        public static IEnumerator Run(string apiUrl, string apiKey, string buildVersion)
        {
            var config = ScriptableObject.CreateInstance<LumaLensConfig>();
            config.name = "E2EConfig";
            config.apiUrl = apiUrl;
            config.apiKey = apiKey;
            config.buildVersionOverride = buildVersion;
            config.autoCapture = true;
            config.sendFromEditor = true;
            config.maxReportsPerMinute = 20;
            config.verboseLogging = true;
            BugReporter.Initialize(config);
            if (!BugReporter.IsReady) throw new InvalidOperationException("BugReporter did not initialize");

            BugReporter.Report(ManualTitle, Severity.Low, "Sent by scripts/unity-e2e.", new Vector3(1.5f, 0f, -2f));
            yield return null;

            Debug.LogError(ErrorMessage);
            yield return null;

            new GameObject("E2E Thrower").AddComponent<Thrower>();
            yield return null;
            yield return null;

            yield return new WaitForSecondsRealtime(SendWaitSeconds);
            Debug.Log("[LumaLens] E2E driver done");
        }

        public static string Env(string name)
        {
            string value = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void BootPlayer()
        {
            if (Application.isEditor) return;
            new GameObject("E2E Player").AddComponent<PlayerHost>();
        }

        private sealed class Thrower : MonoBehaviour
        {
            private void Start() => throw new InvalidOperationException(ExceptionMessage);
        }

        private sealed class PlayerHost : MonoBehaviour
        {
            private IEnumerator Start()
            {
                string url = Env("LUMALENS_API_URL"), key = Env("LUMALENS_KEY"), build = Env("LUMALENS_E2E_BUILD");
                if (url == null || key == null || build == null)
                {
                    Debug.LogWarning("[LumaLens] E2E player: LUMALENS_API_URL, LUMALENS_KEY or LUMALENS_E2E_BUILD missing");
                    Application.Quit(2);
                    yield break;
                }
                yield return E2EDriver.Run(url, key, build);
                Application.Quit(0);
            }
        }
    }
}
