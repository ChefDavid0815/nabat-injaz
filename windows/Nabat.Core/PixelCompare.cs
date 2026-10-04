namespace Nabat.Core;

public static class PixelCompare
{
    public static byte[] Heatmap(byte[] beforeRgba, byte[] afterRgba)
    {
        if (beforeRgba.Length != afterRgba.Length || beforeRgba.Length % 4 != 0) throw new ArgumentException("Compare equally sized RGBA images.");
        var result = new byte[beforeRgba.Length]; for (var i = 0; i < result.Length; i += 4) { var difference = (Math.Abs(beforeRgba[i] - afterRgba[i]) + Math.Abs(beforeRgba[i + 1] - afterRgba[i + 1]) + Math.Abs(beforeRgba[i + 2] - afterRgba[i + 2])) / 3; var alpha = Math.Clamp((difference - 12) * 2, 0, 210); result[i] = (byte)(69 * alpha / 255); result[i + 1] = (byte)(140 * alpha / 255); result[i + 2] = (byte)(220 * alpha / 255); result[i + 3] = (byte)alpha; }
        return result;
    }
    public static (double X, double Y, double Width, double Height) Fit(double width, double height, double targetWidth, double targetHeight) { if (width <= 0 || height <= 0) throw new ArgumentException("Image dimensions must be positive."); var scale = Math.Min(targetWidth / width, targetHeight / height); return ((targetWidth - width * scale) / 2, (targetHeight - height * scale) / 2, width * scale, height * scale); }
}
