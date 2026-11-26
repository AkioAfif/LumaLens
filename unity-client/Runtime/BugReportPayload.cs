using System.Collections.Generic;
using UnityEngine;

namespace LumaLens
{
    public enum Severity { Low, Medium, High, Crash }

    public enum CoordSpace { TwoD, ThreeD }

    internal enum Source { Manual, Auto }

    /// <summary>
    /// One POST /bugs body. Limits mirror backend/src/validation.ts; values over a limit are cut, not rejected,
    /// so a long exception message still arrives instead of failing with 400.
    /// </summary>
    internal sealed class BugReportPayload
    {
        public const int TitleMax = 120;
        public const int DescriptionMax = 2000;
        public const int SceneMax = 120;
        public const int BuildVersionMax = 32;

        public string Title;
        public string Description;
        public Severity Severity;
        public Source Source;
        public bool IsEditor;
        public string BuildVersion;
        public string Platform;
        public string Scene;
        public Vector3? Position;
        public CoordSpace CoordSpace = CoordSpace.ThreeD;
        public Dictionary<string, object> EnvSnapshot;

        public string ToJson()
        {
            var fields = new List<KeyValuePair<string, object>>
            {
                new("title", Clip(OrDefault(Title, "(no title)"), TitleMax)),
                new("description", string.IsNullOrEmpty(Description) ? null : Clip(Description, DescriptionMax)),
                new("severity", SeverityWire(Severity)),
                new("source", Source == Source.Auto ? "auto" : "manual"),
                new("engine", "unity"),
                new("runContext", IsEditor ? "editor" : "build"),
                new("buildVersion", Clip(OrDefault(BuildVersion, "unknown"), BuildVersionMax)),
                new("platform", Platform),
                new("scene", string.IsNullOrEmpty(Scene) ? null : Clip(Scene, SceneMax)),
            };
            if (Position.HasValue)
            {
                var p = Position.Value;
                fields.Add(new("posX", p.x));
                fields.Add(new("posY", p.y));
                if (CoordSpace == CoordSpace.ThreeD) fields.Add(new("posZ", p.z));
                fields.Add(new("coordSpace", CoordSpace == CoordSpace.TwoD ? "2d" : "3d"));
            }
            if (EnvSnapshot != null && EnvSnapshot.Count > 0) fields.Add(new("envSnapshot", EnvSnapshot));
            return JsonWriter.Write(fields);
        }

        internal static string SeverityWire(Severity severity) => severity switch
        {
            Severity.Low => "low",
            Severity.Medium => "medium",
            Severity.High => "high",
            _ => "crash",
        };

        /// <summary>Maps Unity's platform to the API's platform enum. Null means the API has no value for it.</summary>
        internal static string PlatformWire(RuntimePlatform platform) => platform switch
        {
            RuntimePlatform.WindowsPlayer or RuntimePlatform.WindowsEditor or RuntimePlatform.WindowsServer => "windows",
            RuntimePlatform.OSXPlayer or RuntimePlatform.OSXEditor or RuntimePlatform.OSXServer => "mac",
            RuntimePlatform.LinuxPlayer or RuntimePlatform.LinuxEditor or RuntimePlatform.LinuxServer => "linux",
            RuntimePlatform.WebGLPlayer => "webgl",
            RuntimePlatform.Android => "android",
            _ => null,
        };

        internal static string Clip(string s, int max) => s.Length <= max ? s : s.Substring(0, max - 1) + "…";

        private static string OrDefault(string s, string fallback) => string.IsNullOrWhiteSpace(s) ? fallback : s;
    }
}
