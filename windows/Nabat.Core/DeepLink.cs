namespace Nabat.Core;

public record PlantDeepLink(string PlantCode)
{
    public static PlantDeepLink? Parse(string value)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(value, @"^nabat://plant/[A-Za-z0-9-]{1,64}$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "nabat" || uri.Host != "plant" || uri.Query.Length > 0 || uri.Fragment.Length > 0 || !string.IsNullOrEmpty(uri.UserInfo)) return null;
        var code = Uri.UnescapeDataString(uri.AbsolutePath.Trim('/'));
        return code.Length is > 0 and <= 64 && code.All(c => char.IsAsciiLetterOrDigit(c) || c == '-') ? new(code) : null;
    }
}
