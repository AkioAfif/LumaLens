using System;
using System.Collections.Concurrent;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace LumaLens
{
    /// <summary>
    /// Entry point. Loads <see cref="LumaLensConfig"/> from Resources before the first scene, hooks the log for
    /// automatic capture, and sends reports from a hidden DontDestroyOnLoad object.
    /// </summary>
    public static class BugReporter
    {
        public const string LogPrefix = "[LumaLens]";

        private static LumaLensConfig config;
        private static ReportThrottle throttle;
        private static LumaLensRunner runner;
        private static readonly ConcurrentQueue<PendingReport> pendingQueue = new();
        private static bool isLogHooked;
        private static bool hasWarnedNotReady;

        /// <summary>True once a usable config is loaded and reports will be sent.</summary>
        public static bool IsReady => config != null && runner != null;

        /// <summary>Sends a manual report (source "manual"). Safe to call from any thread.</summary>
        /// <param name="position">Player position, if the game wants reports placed on the map.</param>
        public static void Report(string title, Severity severity = Severity.Medium, string description = null,
            Vector3? position = null, CoordSpace coordSpace = CoordSpace.ThreeD)
        {
            if (!IsReady)
            {
                if (!hasWarnedNotReady) Debug.LogWarning($"{LogPrefix} Not initialized; report \"{title}\" dropped. Add a LumaLensConfig asset to a Resources folder.");
                hasWarnedNotReady = true;
                return;
            }
            if (!throttle.TryAcquire(null))
            {
                Debug.LogWarning($"{LogPrefix} Rate limit reached; report \"{title}\" dropped.");
                return;
            }
            pendingQueue.Enqueue(new PendingReport(title, description, severity, Source.Manual, position, coordSpace));
        }

        /// <summary>Starts reporting with the given config. Called automatically when a config is found in Resources.</summary>
        public static void Initialize(LumaLensConfig newConfig)
        {
            if (newConfig == null) throw new ArgumentNullException(nameof(newConfig));
            Shutdown();

            if (!newConfig.IsUsable)
            {
                Debug.LogWarning($"{LogPrefix} Config \"{newConfig.name}\" has no API URL or key; reporting is off.");
                return;
            }
            if (Application.isEditor && !newConfig.sendFromEditor) return;

            config = newConfig;
            throttle = new ReportThrottle(newConfig.maxReportsPerMinute);
            var go = new GameObject("[LumaLens]");
            UnityEngine.Object.DontDestroyOnLoad(go);
            runner = go.AddComponent<LumaLensRunner>();

            if (newConfig.autoCapture)
            {
                Application.logMessageReceivedThreaded += OnLogMessage;
                isLogHooked = true;
            }
        }

        /// <summary>Stops reporting and unhooks the log. Reports still queued are dropped.</summary>
        public static void Shutdown()
        {
            if (isLogHooked) Application.logMessageReceivedThreaded -= OnLogMessage;
            isLogHooked = false;
            var oldRunner = runner;
            runner = null;
            config = null;
            throttle = null;
            while (pendingQueue.TryDequeue(out _)) { }
            if (oldRunner != null) UnityEngine.Object.Destroy(oldRunner.gameObject);
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics()
        {
            // Static state survives exiting Play Mode when domain reload is disabled.
            if (isLogHooked) Application.logMessageReceivedThreaded -= OnLogMessage;
            isLogHooked = false;
            runner = null;
            config = null;
            throttle = null;
            hasWarnedNotReady = false;
            while (pendingQueue.TryDequeue(out _)) { }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void AutoInitialize()
        {
            var found = Resources.Load<LumaLensConfig>(LumaLensConfig.ResourceName);
            if (found != null) Initialize(found);
        }

        internal static void OnLogMessage(string condition, string stackTrace, LogType type)
        {
            if (type != LogType.Error && type != LogType.Exception && type != LogType.Assert) return;
            if (condition != null && condition.StartsWith(LogPrefix, StringComparison.Ordinal)) return;
            var currentThrottle = throttle;
            if (currentThrottle == null) return;
            if (!currentThrottle.TryAcquire(type + "|" + condition + "|" + stackTrace)) return;

            string message = string.IsNullOrEmpty(condition) ? type.ToString() : condition;
            int newline = message.IndexOf('\n');
            string title = newline >= 0 ? message.Substring(0, newline).TrimEnd('\r') : message;
            string description = string.IsNullOrEmpty(stackTrace) ? message : message + "\n\n" + stackTrace;
            var severity = type == LogType.Exception ? Severity.High : Severity.Medium;
            pendingQueue.Enqueue(new PendingReport(title, description, severity, Source.Auto, null, CoordSpace.ThreeD));
        }

        /// <summary>Main thread: turns queued reports into payloads and starts sending them.</summary>
        internal static void Drain(LumaLensRunner owner, float averageFps)
        {
            if (owner != runner || config == null) return;
            string platform = BugReportPayload.PlatformWire(Application.platform);
            while (pendingQueue.TryDequeue(out var pending))
            {
                if (platform == null)
                {
                    Debug.LogWarning($"{LogPrefix} Platform {Application.platform} is not supported by the API; report \"{pending.Title}\" dropped.");
                    continue;
                }
                var payload = new BugReportPayload
                {
                    Title = pending.Title,
                    Description = pending.Description,
                    Severity = pending.Severity,
                    Source = pending.Source,
                    IsEditor = Application.isEditor,
                    BuildVersion = string.IsNullOrWhiteSpace(config.buildVersionOverride) ? Application.version : config.buildVersionOverride,
                    Platform = platform,
                    Scene = SceneManager.GetActiveScene().name,
                    Position = pending.Position,
                    CoordSpace = pending.CoordSpace,
                    EnvSnapshot = EnvSnapshot.Capture(averageFps),
                };
                owner.StartCoroutine(LumaLensClient.Send(config, payload));
            }
        }

        internal static void OnRunnerDestroyed(LumaLensRunner owner)
        {
            if (owner == runner) Shutdown();
        }

        private readonly struct PendingReport
        {
            public readonly string Title;
            public readonly string Description;
            public readonly Severity Severity;
            public readonly Source Source;
            public readonly Vector3? Position;
            public readonly CoordSpace CoordSpace;

            public PendingReport(string title, string description, Severity severity, Source source, Vector3? position, CoordSpace coordSpace)
            {
                Title = title;
                Description = description;
                Severity = severity;
                Source = source;
                Position = position;
                CoordSpace = coordSpace;
            }
        }
    }
}
