using System;
using System.Globalization;
using LumaLens;
using UnityEngine;

/// <summary>
/// Add to any GameObject in a scene. Shows buttons that exercise each report path, so you can check
/// the reports arrive in DynamoDB from both the Editor and a build.
/// </summary>
public class LumaLensDemo : MonoBehaviour
{
    [Tooltip("Optional: reports are placed at this transform's position.")]
    public Transform player;

    private string status = "";

    private void OnGUI()
    {
        GUILayout.BeginArea(new Rect(10, 10, 320, 260), GUI.skin.box);
        GUILayout.Label($"LumaLens ready: {BugReporter.IsReady}");

        if (GUILayout.Button("Send manual report"))
        {
            BugReporter.Report("Demo manual report", Severity.Low, "Sent from the LumaLens demo.",
                player != null ? player.position : null);
            status = "Manual report queued";
        }
        if (GUILayout.Button("Debug.LogError"))
        {
            Debug.LogError("Demo error: something went wrong");
            status = "Error logged";
        }
        if (GUILayout.Button("Throw exception"))
        {
            status = "Exception thrown";
            throw new InvalidOperationException("Demo exception from LumaLensDemo");
        }
        if (GUILayout.Button("float.Parse(\"1.5\") with id-ID locale"))
        {
            // Build-only bug #4 from the plan: comma-decimal locales parse "1.5" as 15.
            float value = float.Parse("1.5", new CultureInfo("id-ID"));
            if (Math.Abs(value - 1.5f) > 0.001f) Debug.LogError($"Locale parse bug: \"1.5\" became {value}");
            status = $"Parsed {value}";
        }

        GUILayout.Label(status);
        GUILayout.EndArea();
    }
}
