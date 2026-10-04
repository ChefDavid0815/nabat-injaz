using System.Globalization;
namespace Nabat.Core;

public static class PresentationCulture
{
    public static CultureInfo Current { get; set; } = CultureInfo.GetCultureInfo("en-GB");
    public static string Timezone { get; set; } = "Asia/Dubai";
    public static string Date(DateTimeOffset at, string format) { try { return TimeZoneInfo.ConvertTime(at, TimeZoneInfo.FindSystemTimeZoneById(Timezone)).ToString(format, Current); } catch (TimeZoneNotFoundException) { return at.ToUniversalTime().ToString(format, Current); } }
}
