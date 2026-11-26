using UnityEngine;

namespace LumaLens
{
    /// <summary>Hidden helper created by <see cref="BugReporter"/>: tracks the frame rate and sends queued reports.</summary>
    [AddComponentMenu("")]
    internal sealed class LumaLensRunner : MonoBehaviour
    {
        private const float FpsSmoothing = 0.05f;
        // Longer frames are loading hitches (the first frame of a build can take seconds) and would drag the average to ~0.
        private const float MaxSampledFrameSeconds = 0.5f;
        private float averageFps;

        private void Update()
        {
            float dt = Time.unscaledDeltaTime;
            if (dt > 0f && dt < MaxSampledFrameSeconds)
            {
                float fps = 1f / dt;
                averageFps = averageFps <= 0f ? fps : Mathf.Lerp(averageFps, fps, FpsSmoothing);
            }
            BugReporter.Drain(this, averageFps);
        }

        private void OnDestroy() => BugReporter.OnRunnerDestroyed(this);
    }
}
