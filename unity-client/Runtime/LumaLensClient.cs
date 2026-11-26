using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace LumaLens
{
    /// <summary>Sends one POST /bugs request. Failures are logged as warnings, never errors, so they are not auto-captured.</summary>
    internal static class LumaLensClient
    {
        private const int TimeoutSeconds = 10;

        public static IEnumerator Send(LumaLensConfig config, BugReportPayload payload)
        {
            string url = config.apiUrl.TrimEnd('/') + "/bugs";
            string json = payload.ToJson();

            using var request = new UnityWebRequest(url, UnityWebRequest.kHttpVerbPOST)
            {
                uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json)),
                downloadHandler = new DownloadHandlerBuffer(),
                timeout = TimeoutSeconds,
            };
            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader("x-lumalens-key", config.apiKey.Trim());

            yield return request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
            {
                if (config.verboseLogging) Debug.Log($"{BugReporter.LogPrefix} Sent \"{payload.Title}\" ({request.responseCode})");
            }
            else
            {
                Debug.LogWarning($"{BugReporter.LogPrefix} Report \"{payload.Title}\" not sent: {request.responseCode} {request.error} {request.downloadHandler?.text}");
            }
        }
    }
}
