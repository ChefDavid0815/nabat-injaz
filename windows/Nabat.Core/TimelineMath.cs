namespace Nabat.Core;

public static class TimelineMath
{
    public static double X(DateTimeOffset time, DateTimeOffset first, DateTimeOffset last, double width) => Math.Clamp((time - first).TotalMilliseconds / Math.Max(1, (last - first).TotalMilliseconds), 0, 1) * Math.Max(0, width);
}
