using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.UI;
namespace Nabat.Windows;

public static class NativeUi
{
    public static SolidColorBrush Green => Brush("#153D32");
    public static SolidColorBrush Muted => Brush("#64706B");
    public static SolidColorBrush Brush(string hex) { if (new global::Windows.UI.ViewManagement.AccessibilitySettings().HighContrast) { var settings = new global::Windows.UI.ViewManagement.UISettings(); return new(settings.GetColorValue(hex is "#FFFFFF" or "#F7F6EF" ? global::Windows.UI.ViewManagement.UIColorType.Background : global::Windows.UI.ViewManagement.UIColorType.Foreground)); } hex = hex.TrimStart('#'); return new(Color.FromArgb(255, Convert.ToByte(hex[..2], 16), Convert.ToByte(hex.Substring(2, 2), 16), Convert.ToByte(hex.Substring(4, 2), 16))); }
    public static TextBlock Text(string text, double size = 14, bool serif = false) => new() { Text = LocaleService.T(text), FontSize = size, FontFamily = new(serif && !LocaleService.Arabic ? "Georgia" : "Segoe UI"), Foreground = Green, TextWrapping = TextWrapping.Wrap };
    public static TextBlock Caption(string text) => new() { Text = LocaleService.T(text), FontSize = 13, Foreground = Muted, TextWrapping = TextWrapping.Wrap };
    public static Button Button(string text, RoutedEventHandler action) { var button = new Button { Content = LocaleService.T(text), MinHeight = 40 }; button.Click += action; return button; }
    public static Border Panel(UIElement content, Thickness? padding = null) => new() { Background = Brush("#FFFFFF"), BorderBrush = Brush("#E5E8DF"), BorderThickness = new(1), CornerRadius = new(6), Padding = padding ?? new(18), Child = content };
    public static StackPanel Stack(params UIElement[] children) { var stack = new StackPanel { Spacing = 12 }; foreach (var child in children) stack.Children.Add(child); return stack; }
    public static Uri? ImageUri(string? source, Uri baseUri) { if (source is null) return null; if (source.StartsWith("/images/", StringComparison.Ordinal)) { var file = Path.Combine(AppContext.BaseDirectory, "Assets", "Images", Path.GetFileName(source)); if (File.Exists(file)) return new Uri(file); } var uri = new Uri(baseUri, source); if (uri.IsFile) { var path = Path.GetFullPath(uri.LocalPath); var cache = Path.Combine(App.DataDirectory, "images") + Path.DirectorySeparatorChar; var bundled = Path.Combine(AppContext.BaseDirectory, "Assets", "Images") + Path.DirectorySeparatorChar; if (!path.StartsWith(cache, StringComparison.OrdinalIgnoreCase) && !path.StartsWith(bundled, StringComparison.OrdinalIgnoreCase)) return null; } return uri; }
    public static Image Image(string? source, Uri baseUri, double width = 52, double height = 52) => new() { Width = width, Height = height, Stretch = Stretch.UniformToFill, Source = ImageUri(source, baseUri) is { } uri ? new BitmapImage(uri) { DecodePixelWidth = 1200 } : null };
    public static string Metric(System.Text.Json.JsonElement metrics, string name) => metrics.TryGetProperty(name, out var value) && value.ValueKind != System.Text.Json.JsonValueKind.Null ? value.ToString() : "—";
    public static double? Number(System.Text.Json.JsonElement row, string name) => row.TryGetProperty(name, out var value) && value.ValueKind != System.Text.Json.JsonValueKind.Null && double.TryParse(value.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number) ? number : null;
    public static async Task<BitmapImage> Bitmap(byte[] bytes) { var image = new BitmapImage(); using var stream = new global::Windows.Storage.Streams.InMemoryRandomAccessStream(); using (var writer = new global::Windows.Storage.Streams.DataWriter(stream)) { writer.WriteBytes(bytes); await writer.StoreAsync(); writer.DetachStream(); } stream.Seek(0); await image.SetSourceAsync(stream); return image; }
    public static string Date(DateTimeOffset at, string? timezone = null, string format = "dd MMM HH:mm") { try { return TimeZoneInfo.ConvertTime(at, TimeZoneInfo.FindSystemTimeZoneById(timezone ?? Nabat.Core.PresentationCulture.Timezone)).ToString(format, Nabat.Core.PresentationCulture.Current); } catch (TimeZoneNotFoundException) { return at.ToString(format, System.Globalization.CultureInfo.InvariantCulture); } }
    public static void PrepareWindow(Window window, FrameworkElement root, int width = 1180, int height = 900)
    {
        root.Loaded += (_, _) =>
        {
            root.Language = LocaleService.Arabic ? "ar-AE" : "en-GB"; root.FlowDirection = LocaleService.Arabic ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;
            LocaleService.Apply(root);
            if (Environment.GetEnvironmentVariable("NABAT_UI_PROBE_DIR") is not null) return;
            var scale = root.XamlRoot.RasterizationScale;
            var area = Microsoft.UI.Windowing.DisplayArea.GetFromWindowId(window.AppWindow.Id, Microsoft.UI.Windowing.DisplayAreaFallback.Nearest).WorkArea;
            window.AppWindow.Resize(new global::Windows.Graphics.SizeInt32(Math.Min(area.Width, (int)(width * scale)), Math.Min(area.Height, (int)(height * scale))));
        };
    }
}
