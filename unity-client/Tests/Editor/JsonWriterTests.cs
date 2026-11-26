using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using NUnit.Framework;

namespace LumaLens.Tests
{
    public class JsonWriterTests
    {
        private static string Write(params (string Key, object Value)[] pairs)
        {
            var list = new List<KeyValuePair<string, object>>();
            foreach (var (key, value) in pairs) list.Add(new KeyValuePair<string, object>(key, value));
            return JsonWriter.Write(list);
        }

        [Test]
        public void LeavesOutNullAndNonFiniteValues()
        {
            Assert.AreEqual("{\"a\":1}", Write(("a", 1), ("b", null), ("c", float.NaN), ("d", double.PositiveInfinity)));
        }

        [Test]
        public void EscapesQuotesBackslashesAndControlCharacters()
        {
            Assert.AreEqual("{\"s\":\"a\\\"b\\\\c\\nd\\te\\u0001\"}", Write(("s", "a\"b\\c\nd\te\u0001")));
        }

        [Test]
        public void WritesNumbersWithDotUnderCommaDecimalLocale()
        {
            var previous = Thread.CurrentThread.CurrentCulture;
            try
            {
                Thread.CurrentThread.CurrentCulture = new CultureInfo("id-ID");
                Assert.AreEqual("{\"x\":1.5,\"y\":-2.25}", Write(("x", 1.5f), ("y", -2.25)));
            }
            finally
            {
                Thread.CurrentThread.CurrentCulture = previous;
            }
        }

        [Test]
        public void WritesNestedMapsBoolsAndLists()
        {
            var map = new Dictionary<string, object> { ["ok"] = true, ["skip"] = null, ["list"] = new[] { 1, 2 } };
            Assert.AreEqual("{\"m\":{\"ok\":true,\"list\":[1,2]}}", Write(("m", map)));
        }

        [Test]
        public void EmptyObject()
        {
            Assert.AreEqual("{}", Write());
        }
    }
}
