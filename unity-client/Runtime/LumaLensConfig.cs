using UnityEngine;

namespace LumaLens
{
    /// <summary>
    /// Per-game settings. Create one with Assets > Create > LumaLens > Config and name it "LumaLensConfig"
    /// inside a Resources folder so it is loaded automatically before the first scene.
    /// </summary>
    [CreateAssetMenu(fileName = ResourceName, menuName = "LumaLens/Config")]
    public class LumaLensConfig : ScriptableObject
    {
        public const string ResourceName = "LumaLensConfig";

        [Tooltip("Base URL of the LumaLens API, without a trailing slash. Example: https://abc123.lambda-url.us-east-1.on.aws")]
        public string apiUrl = "";

        [Tooltip("Sent as the x-lumalens-key header. It ships inside the build and can be extracted, so treat it as a spam filter, not a secret.")]
        public string apiKey = "";

        [Tooltip("Leave empty to use Application.version (Project Settings > Player > Version).")]
        public string buildVersionOverride = "";

        [Tooltip("Send errors, exceptions and failed asserts as reports with source 'auto'.")]
        public bool autoCapture = true;

        [Tooltip("Also send reports while playing in the Editor. Needed for the editor vs build diff.")]
        public bool sendFromEditor = true;

        [Tooltip("Upper limit of reports one client sends per minute. Extra reports are dropped.")]
        [Min(1)] public int maxReportsPerMinute = 10;

        [Tooltip("Log a line to the Console for every report sent.")]
        public bool verboseLogging = true;

        internal bool IsUsable => !string.IsNullOrWhiteSpace(apiUrl) && !string.IsNullOrWhiteSpace(apiKey);
    }
}
