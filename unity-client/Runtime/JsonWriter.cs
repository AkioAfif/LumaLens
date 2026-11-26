using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace LumaLens
{
    /// <summary>
    /// Minimal JSON writer. JsonUtility writes every field (so an unset posX becomes 0 and an unset scene becomes "")
    /// and cannot write dictionaries; Newtonsoft can be stripped by IL2CPP. The API rejects nulls and unknown keys,
    /// so this writer only emits what is set. Numbers always use the invariant culture.
    /// </summary>
    internal static class JsonWriter
    {
        /// <summary>Writes an object. Entries whose value is null, or a non-finite number, are left out.</summary>
        public static string Write(IEnumerable<KeyValuePair<string, object>> fields)
        {
            var sb = new StringBuilder(256);
            WriteObject(sb, fields);
            return sb.ToString();
        }

        private static void WriteObject(StringBuilder sb, IEnumerable<KeyValuePair<string, object>> fields)
        {
            sb.Append('{');
            bool isFirst = true;
            foreach (var pair in fields)
            {
                if (!IsWritable(pair.Value)) continue;
                if (!isFirst) sb.Append(',');
                isFirst = false;
                WriteString(sb, pair.Key);
                sb.Append(':');
                WriteValue(sb, pair.Value);
            }
            sb.Append('}');
        }

        private static bool IsWritable(object value)
        {
            switch (value)
            {
                case null: return false;
                case float f: return !float.IsNaN(f) && !float.IsInfinity(f);
                case double d: return !double.IsNaN(d) && !double.IsInfinity(d);
                default: return true;
            }
        }

        private static void WriteValue(StringBuilder sb, object value)
        {
            switch (value)
            {
                case string s: WriteString(sb, s); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case float f: sb.Append(f.ToString("R", CultureInfo.InvariantCulture)); break;
                case double d: sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); break;
                case int or long or short or byte or uint or ulong or ushort or sbyte or decimal:
                    sb.Append(Convert.ToString(value, CultureInfo.InvariantCulture)); break;
                case Enum e: WriteString(sb, e.ToString()); break;
                case IEnumerable<KeyValuePair<string, object>> map: WriteObject(sb, map); break;
                case IEnumerable list:
                    sb.Append('[');
                    bool isFirst = true;
                    foreach (var item in list)
                    {
                        if (!IsWritable(item)) continue;
                        if (!isFirst) sb.Append(',');
                        isFirst = false;
                        WriteValue(sb, item);
                    }
                    sb.Append(']');
                    break;
                default: WriteString(sb, Convert.ToString(value, CultureInfo.InvariantCulture)); break;
            }
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
