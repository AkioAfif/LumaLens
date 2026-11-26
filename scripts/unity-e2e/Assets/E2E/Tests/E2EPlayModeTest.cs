using System.Collections;
using NUnit.Framework;
using UnityEngine.TestTools;

namespace LumaLens.E2E.Tests
{
    /// <summary>Editor half of the E2E run: Play Mode, so reports carry runContext "editor".</summary>
    public class E2EPlayModeTest
    {
        [UnityTest]
        public IEnumerator SendsReportsFromEditor()
        {
            // The driver logs an error and throws on purpose; those are the reports under test.
            LogAssert.ignoreFailingMessages = true;
            string url = E2EDriver.Env("LUMALENS_API_URL"), key = E2EDriver.Env("LUMALENS_KEY"), build = E2EDriver.Env("LUMALENS_E2E_BUILD");
            Assert.IsNotNull(url, "LUMALENS_API_URL not set");
            Assert.IsNotNull(key, "LUMALENS_KEY not set");
            Assert.IsNotNull(build, "LUMALENS_E2E_BUILD not set");
            yield return E2EDriver.Run(url, key, build);
        }
    }
}
