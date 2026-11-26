using System;
using NUnit.Framework;

namespace LumaLens.Tests
{
    public class ReportThrottleTests
    {
        private DateTime now;
        private ReportThrottle Create(int maxPerMinute) => new(maxPerMinute, () => now);

        [SetUp]
        public void SetUp() => now = new DateTime(2026, 11, 26, 12, 0, 0, DateTimeKind.Utc);

        [Test]
        public void SameFingerprintIsSentOnce()
        {
            var throttle = Create(10);
            Assert.IsTrue(throttle.TryAcquire("NullReferenceException|Update"));
            Assert.IsFalse(throttle.TryAcquire("NullReferenceException|Update"));
            now = now.AddMinutes(5);
            Assert.IsFalse(throttle.TryAcquire("NullReferenceException|Update"));
        }

        [Test]
        public void ManualReportsAreNotDeduplicated()
        {
            var throttle = Create(10);
            Assert.IsTrue(throttle.TryAcquire(null));
            Assert.IsTrue(throttle.TryAcquire(null));
        }

        [Test]
        public void RateLimitBlocksUntilWindowPasses()
        {
            var throttle = Create(2);
            Assert.IsTrue(throttle.TryAcquire("a"));
            Assert.IsTrue(throttle.TryAcquire("b"));
            Assert.IsFalse(throttle.TryAcquire("c"));
            now = now.AddSeconds(59);
            Assert.IsFalse(throttle.TryAcquire("c"));
            now = now.AddSeconds(1);
            Assert.IsTrue(throttle.TryAcquire("c"));
        }

        [Test]
        public void RateLimitedFingerprintCanBeSentLater()
        {
            var throttle = Create(1);
            Assert.IsTrue(throttle.TryAcquire("a"));
            Assert.IsFalse(throttle.TryAcquire("b"));
            now = now.AddMinutes(1);
            Assert.IsTrue(throttle.TryAcquire("b"));
        }
    }
}
