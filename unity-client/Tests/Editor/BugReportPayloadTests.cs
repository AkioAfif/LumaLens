using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace LumaLens.Tests
{
    public class BugReportPayloadTests
    {
        private static BugReportPayload Minimal() => new()
        {
            Title = "Buildings not see-through",
            Severity = Severity.High,
            Source = Source.Manual,
            IsEditor = false,
            BuildVersion = "0.3.1",
            Platform = "windows",
        };

        [Test]
        public void MinimalReportHasOnlyRequiredFields()
        {
            Assert.AreEqual(
                "{\"title\":\"Buildings not see-through\",\"severity\":\"high\",\"source\":\"manual\",\"engine\":\"unity\"," +
                "\"runContext\":\"build\",\"buildVersion\":\"0.3.1\",\"platform\":\"windows\"}",
                Minimal().ToJson());
        }

        [Test]
        public void EditorRunAndAutoSource()
        {
            var p = Minimal();
            p.IsEditor = true;
            p.Source = Source.Auto;
            StringAssert.Contains("\"runContext\":\"editor\"", p.ToJson());
            StringAssert.Contains("\"source\":\"auto\"", p.ToJson());
        }

        [Test]
        public void Position3dWritesZAndCoordSpace()
        {
            var p = Minimal();
            p.Position = new Vector3(1.5f, 0f, -2f);
            StringAssert.EndsWith(",\"posX\":1.5,\"posY\":0,\"posZ\":-2,\"coordSpace\":\"3d\"}", p.ToJson());
        }

        [Test]
        public void Position2dLeavesOutZ()
        {
            var p = Minimal();
            p.Position = new Vector3(3f, 4f, 99f);
            p.CoordSpace = CoordSpace.TwoD;
            StringAssert.EndsWith(",\"posX\":3,\"posY\":4,\"coordSpace\":\"2d\"}", p.ToJson());
        }

        [Test]
        public void ClipsTextToApiLimits()
        {
            var p = Minimal();
            p.Title = new string('t', 500);
            p.Description = new string('d', 5000);
            p.Scene = new string('s', 300);
            p.BuildVersion = new string('v', 100);
            string json = p.ToJson();
            StringAssert.Contains("\"title\":\"" + new string('t', BugReportPayload.TitleMax - 1) + "…\"", json);
            StringAssert.Contains("\"description\":\"" + new string('d', BugReportPayload.DescriptionMax - 1) + "…\"", json);
            StringAssert.Contains("\"scene\":\"" + new string('s', BugReportPayload.SceneMax - 1) + "…\"", json);
            StringAssert.Contains("\"buildVersion\":\"" + new string('v', BugReportPayload.BuildVersionMax - 1) + "…\"", json);
        }

        [Test]
        public void EmptyValuesFallBackOrAreLeftOut()
        {
            var p = Minimal();
            p.Title = " ";
            p.BuildVersion = "";
            p.Description = "";
            p.Scene = "";
            p.EnvSnapshot = new Dictionary<string, object>();
            string json = p.ToJson();
            StringAssert.Contains("\"title\":\"(no title)\"", json);
            StringAssert.Contains("\"buildVersion\":\"unknown\"", json);
            StringAssert.DoesNotContain("description", json);
            StringAssert.DoesNotContain("scene", json);
            StringAssert.DoesNotContain("envSnapshot", json);
        }

        [Test]
        public void EnvSnapshotIsWrittenAsObject()
        {
            var p = Minimal();
            p.EnvSnapshot = new Dictionary<string, object> { ["locale"] = "id-ID", ["fps"] = 60f };
            StringAssert.EndsWith(",\"envSnapshot\":{\"locale\":\"id-ID\",\"fps\":60}}", p.ToJson());
        }

        [TestCase(RuntimePlatform.WindowsPlayer, "windows")]
        [TestCase(RuntimePlatform.WindowsEditor, "windows")]
        [TestCase(RuntimePlatform.OSXPlayer, "mac")]
        [TestCase(RuntimePlatform.LinuxPlayer, "linux")]
        [TestCase(RuntimePlatform.WebGLPlayer, "webgl")]
        [TestCase(RuntimePlatform.Android, "android")]
        [TestCase(RuntimePlatform.IPhonePlayer, null)]
        public void MapsPlatforms(RuntimePlatform platform, string expected)
        {
            Assert.AreEqual(expected, BugReportPayload.PlatformWire(platform));
        }

        [TestCase(Severity.Low, "low")]
        [TestCase(Severity.Medium, "medium")]
        [TestCase(Severity.High, "high")]
        [TestCase(Severity.Crash, "crash")]
        public void MapsSeverities(Severity severity, string expected)
        {
            Assert.AreEqual(expected, BugReportPayload.SeverityWire(severity));
        }
    }
}
