using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Nabat.Core;
using System.Text.Json;
namespace Nabat.Windows;

public sealed class FloorPlanWindow : Window
{
    public string LocationId => _location;
    private readonly ApiClient _api; private readonly string _org, _location; private readonly bool _manage; private readonly Action<PlantSummary> _open;
    private readonly Grid _root = new() { Padding = new(24), Background = NativeUi.Brush("#F7F6EF"), RowSpacing = 12 };
    private readonly Canvas _map = new() { Width = 1000, Height = 700, FlowDirection = FlowDirection.LeftToRight };
    private readonly StackPanel _toolbar = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly InfoBar _notice = new() { IsClosable = true }; private readonly ComboBox _plants = new() { Header = "Plant to position", MinWidth = 220, DisplayMemberPath = "Name" };
    private List<PlantSummary> _fleet = []; private JsonElement _pins; private PlantSummary? _placing;
    public FloorPlanWindow(ApiClient api, string org, Location location, bool manage, Action<PlantSummary> open)
    {
        _api = api; _org = org; _location = location.Id; _manage = manage; _open = open; Title = location.Name + " · Location map"; AppWindow.Resize(new global::Windows.Graphics.SizeInt32(1280, 900)); SystemBackdrop = new MicaBackdrop();
        for (var i = 0; i < 4; i++) _root.RowDefinitions.Add(new() { Height = i == 3 ? new(1, GridUnitType.Star) : GridLength.Auto });
        _root.Children.Add(NativeUi.Stack(NativeUi.Text(location.Name, 32, true), NativeUi.Caption("Spatial plant management · floor plan coordinates stay attached to this location.")));
        _toolbar.Children.Add(_plants); _toolbar.Children.Add(NativeUi.Button("Position selected plant", (_, _) => { if (!_manage) return; _placing = _plants.SelectedItem as PlantSummary; Notify(_placing is null ? "Choose a plant." : "Select its position on the floor plan, or use coordinate entry."); }));
        var upload = NativeUi.Button("Upload floor plan", async (_, _) => await Upload()); upload.IsEnabled = manage; _toolbar.Children.Add(upload);
        _toolbar.Children.Add(NativeUi.Button("Coordinates…", async (_, _) => await Coordinates())); _toolbar.Children.Add(NativeUi.Button("Refresh", async (_, _) => await Load()));
        var toolbarView = new ScrollViewer { Content = _toolbar, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto }; Grid.SetRow(toolbarView, 1); _root.Children.Add(toolbarView);
        Grid.SetRow(_notice, 2); _root.Children.Add(_notice);
        var scroll = new ScrollViewer { Content = _map, ZoomMode = ZoomMode.Enabled, MinZoomFactor = .5f, MaxZoomFactor = 5, HorizontalScrollMode = ScrollMode.Enabled, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto }; Grid.SetRow(scroll, 3); _root.Children.Add(scroll);
        _map.PointerPressed += async (_, e) => { if (_placing is null) return; var point = e.GetCurrentPoint(_map).Position; await Position(_placing, Math.Clamp(point.X / _map.Width, 0, 1), Math.Clamp(point.Y / _map.Height, 0, 1)); _placing = null; };
        Content = _root; NativeUi.PrepareWindow(this, _root); _root.Loaded += async (_, _) => await Load();
    }
    private void Notify(string text, bool error = false) { _notice.Title = error ? "Map needs attention" : "Location map"; _notice.Message = text; _notice.Severity = error ? InfoBarSeverity.Warning : InfoBarSeverity.Informational; _notice.IsOpen = true; }
    private async Task Load()
    {
        try
        {
            var list = new List<PlantSummary>(); int page = 0, total; do { using var json = JsonDocument.Parse(await _api.GetAsync($"{_org}/fleet?location={_location}&limit=100&page={page++}")); var result = Contracts.Read<FleetPage>(json.RootElement); list.AddRange(result.Items); total = result.Total; } while (list.Count < total && page < 100); _fleet = list; _plants.ItemsSource = _fleet;
            using var data = JsonDocument.Parse(await _api.GetAsync($"{_org}/locations/{_location}/floor-plan")); var root = data.RootElement; _pins = root.GetProperty("pins").Clone(); _map.Children.Clear(); var plan = root.GetProperty("plan");
            if (plan.ValueKind == JsonValueKind.Null) { _map.Children.Add(NativeUi.Text("Upload a floor plan to place plant pins.", 26, true)); return; }
            _map.Width = 1000; _map.Height = 1000 * plan.GetProperty("height").GetDouble() / plan.GetProperty("width").GetDouble(); var background = new Image { Width = _map.Width, Height = _map.Height, Source = await NativeUi.Bitmap(await _api.GetBytesAsync($"{_org}/floor-plans/{plan.GetProperty("id").GetString()}")), Stretch = Stretch.Fill }; _map.Children.Add(background);
            foreach (var pin in _pins.EnumerateArray()) { var plant = _fleet.FirstOrDefault(p => p.Id == pin.GetProperty("plant_id").GetString()); if (plant is null) continue; var button = NativeUi.Button(plant.Code, (_, _) => _open(plant)); button.Background = NativeUi.Brush(plant.Score switch { < 50 => "#B63427", < 70 => "#AD571D", _ => "#153D32" }); button.Foreground = NativeUi.Brush("#FFFFFF"); ToolTipService.SetToolTip(button, $"{plant.Name} · Health {plant.ScoreText}"); Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(button, $"{plant.Name}, health {plant.ScoreText}, open plant"); Canvas.SetLeft(button, Math.Max(0, (NativeUi.Number(pin, "x") ?? 0) * _map.Width - 30)); Canvas.SetTop(button, Math.Max(0, (NativeUi.Number(pin, "y") ?? 0) * _map.Height - 20)); _map.Children.Add(button); }
            var alternative = NativeUi.Caption(string.Join(" · ", _fleet.Select(p => p.Code + " " + p.Name + " health " + p.ScoreText))); Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(_map, alternative.Text);
        }
        catch (Exception ex) { Notify(ex.Message, true); }
    }
    private async Task Position(PlantSummary plant, double x, double y) { if (!_manage) return; try { int? revision = null; foreach (var pin in _pins.EnumerateArray()) if (pin.GetProperty("plant_id").GetString() == plant.Id) revision = pin.GetProperty("revision").GetInt32(); await _api.PostAsync($"{_org}/pins", new { plantId = plant.Id, locationId = _location, x, y, revision, idempotencyKey = Guid.NewGuid().ToString() }); await Load(); Notify("Plant pin saved."); } catch (Exception ex) { Notify(ex.Message, true); } }
    private async Task Coordinates() { if (!_manage || _plants.SelectedItem is not PlantSummary p) return; var x = new NumberBox { Header = "Horizontal position (0–100%)", Minimum = 0, Maximum = 100, Value = 50 }; var y = new NumberBox { Header = "Vertical position (0–100%)", Minimum = 0, Maximum = 100, Value = 50 }; var dialog = new ContentDialog { XamlRoot = _root.XamlRoot, Title = p.Name, Content = NativeUi.Stack(x, y), PrimaryButtonText = "Save position", CloseButtonText = "Cancel" }; if (await dialog.ShowAsync() == ContentDialogResult.Primary) await Position(p, x.Value / 100, y.Value / 100); }
    private async Task Upload() { if (!_manage) return; var picker = new global::Windows.Storage.Pickers.FileOpenPicker(); WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this)); foreach (var ext in new[] { ".png", ".jpg", ".jpeg", ".webp" }) picker.FileTypeFilter.Add(ext); var file = await picker.PickSingleFileAsync(); if (file is null) return; try { if ((await file.GetBasicPropertiesAsync()).Size > 4 * 1024 * 1024) throw new InvalidOperationException("Choose an image smaller than 4 MB."); var buffer = await global::Windows.Storage.FileIO.ReadBufferAsync(file); var bytes = new byte[buffer.Length]; using (var reader = global::Windows.Storage.Streams.DataReader.FromBuffer(buffer)) reader.ReadBytes(bytes); await _api.UploadAsync($"{_org}/locations/{_location}/floor-plan", bytes); await Load(); } catch (Exception ex) { Notify(ex.Message, true); } }
}
