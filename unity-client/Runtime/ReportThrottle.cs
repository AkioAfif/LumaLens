using System;
using System.Collections.Generic;

namespace LumaLens
{
    /// <summary>
    /// Decides whether a report may be sent: each fingerprint once per session (an error in Update would
    /// otherwise fire every frame), and at most <c>maxPerMinute</c> reports in any 60 s window.
    /// Thread-safe, because Unity calls the threaded log callback from any thread.
    /// </summary>
    internal sealed class ReportThrottle
    {
        private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

        private readonly object gate = new();
        private readonly HashSet<string> seenFingerprints = new();
        private readonly Queue<DateTime> sentTimes = new();
        private readonly Func<DateTime> clock;
        private readonly int maxPerMinute;

        public ReportThrottle(int maxPerMinute, Func<DateTime> clock = null)
        {
            this.maxPerMinute = Math.Max(1, maxPerMinute);
            this.clock = clock ?? (() => DateTime.UtcNow);
        }

        /// <param name="fingerprint">Null skips the duplicate check (manual reports).</param>
        public bool TryAcquire(string fingerprint)
        {
            lock (gate)
            {
                var now = clock();
                while (sentTimes.Count > 0 && now - sentTimes.Peek() >= Window) sentTimes.Dequeue();
                if (fingerprint != null && seenFingerprints.Contains(fingerprint)) return false;
                if (sentTimes.Count >= maxPerMinute) return false;
                if (fingerprint != null) seenFingerprints.Add(fingerprint);
                sentTimes.Enqueue(now);
                return true;
            }
        }
    }
}
