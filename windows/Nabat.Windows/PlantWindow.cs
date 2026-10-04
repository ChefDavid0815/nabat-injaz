using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Nabat.Core;
using System.Text.Json;
namespace Nabat.Windows;

public sealed class PlantWindow : Window
{
    private readonly ApiClient _api; private readonly LocalStore _store; private readonly SyncEngine _sync; private readonly string _org; private readonly PlantSummary _plant; private readonly string? _session;
    private readonly Grid _root = new() { Background = NativeUi.Brush("#F7F6EF"), Padding = new(28), RowSpacing = 20 }; private readonly InfoBar _notice = new() { IsClosable = true }; private readonly StackPanel _body = NativeUi.Stack(); private JsonElement? _details;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(30) };
    private readonly bool _canWrite, _canManage;
    public PlantWindow(ApiClient api, LocalStore store, SyncEngine sync, string org, PlantSummary plant, string? session, bool canWrite = true, bool canManage = false)
    {
        _api = api; _store = store; _sync = sync; _org = org; _plant = plant; _session = session; _canWrite = canWrite; _canManage = canManage; Title = $"{plant.Name} · NABAT"; AppWindow.Resize(new global::Windows.Graphics.SizeInt32(1180, 900)); SystemBackdrop = new MicaBackdrop();
        _root.RowDefinitions.Add(new() { Height = GridLength.Auto }); _root.RowDefinitions.Add(new() { Height = GridLength.Auto }); _root.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        _root.Children.Add(NativeUi.Stack(NativeUi.Text(plant.Name, 36, true), NativeUi.Caption($"{plant.ScientificName} · {plant.Code} · {plant.LocationText}"))); Grid.SetRow(_notice, 1); _root.Children.Add(_notice); var scroll = new ScrollViewer { Content = _body }; Grid.SetRow(scroll, 2); _root.Children.Add(scroll); Content = _root; NativeUi.PrepareWindow(this, _root);
        _root.Loaded += async (_, _) => { await Load(); _timer.Start(); }; _timer.Tick += async (_, _) => { if (!_sync.WorkingOffline) await Load(); }; Closed += (_, _) => _timer.Stop(); _root.AllowDrop = true; _root.DragOver += (_, e) => { e.AcceptedOperation = global::Windows.ApplicationModel.DataTransfer.DataPackageOperation.Copy; e.DragUIOverride.Caption = "Save photos as plant observations"; }; _root.Drop += async (_, e) => { try { if (e.DataView.Contains(global::Windows.ApplicationModel.DataTransfer.StandardDataFormats.StorageItems)) { var files = await e.DataView.GetStorageItemsAsync(); foreach (var file in files.OfType<global::Windows.Storage.StorageFile>().Take(20)) await Upload(file); } } catch (Exception ex) { Notify(ex.Message, true); } };
    }
    private void Notify(string text, bool error = false) { _notice.Title = error ? "Observation needs attention" : "Plant record"; _notice.Message = text; _notice.Severity = error ? InfoBarSeverity.Warning : InfoBarSeverity.Informational; _notice.IsOpen = true; }
    private async Task Load()
    {
        var key = _api.Scope(_org) + ":plant:" + _plant.Id;
        try
        {
            var cached = await _store.ReadCacheAsync(key); if (cached is not null) { using var doc = JsonDocument.Parse(cached); _details = doc.RootElement.Clone(); Render(); }
            if (_sync.WorkingOffline) { if (_details is null) Render(); Notify("Working offline. Photos and history reflect the last cached record."); return; }
            var json = await _api.GetAsync($"{_org}/plants/{_plant.Id}"); await _store.SaveCacheAsync(key, json); using var details = JsonDocument.Parse(json); _details = details.RootElement.Clone(); Render();
        }
        catch (Exception ex) { Render(); Notify(ex.Message, true); }
    }
    private void Render()
    {
        _body.Children.Clear(); var hero = new Grid { ColumnSpacing = 24 }; hero.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); hero.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        var current = _details is null ? _plant : Contracts.Read<PlantSummary>(_details.Value.GetProperty("plant"));
        var photo = NativeUi.Image(_sync.WorkingOffline ? _plant.Image : current.Image, _api.BaseUri, 360, 300); photo.Width = double.NaN; photo.MaxWidth = 360;
        var identity = NativeUi.Stack(photo, NativeUi.Caption(current.SpeciesName), NativeUi.Caption("Caretaker: " + current.CaretakerText));
        var score = _details?.GetProperty("plant").GetProperty("score"); var confidence = _details?.GetProperty("plant").GetProperty("confidence");
        var state = current.Score switch { null => "baseline", < 50 => "critical", < 70 => "attention", < 80 => "watch", _ => "healthy" };
        var health = NativeUi.Stack(NativeUi.Text($"Health {((score.HasValue && score.Value.ValueKind != JsonValueKind.Null) ? score.Value.ToString() : current.ScoreText)}", 34, true), NativeUi.Text(state + " · " + current.TrendText, 20), NativeUi.Caption(confidence.HasValue && confidence.Value.ValueKind != JsonValueKind.Null ? $"Observation confidence {double.Parse(confidence.Value.ToString(), System.Globalization.CultureInfo.InvariantCulture):P0}" : "Health baseline · no analysed observation"), NativeUi.Caption("Why it changed"));
        if (_details is not null) { var reasons = _details.Value.GetProperty("plant").GetProperty("reasons"); if (reasons.ValueKind == JsonValueKind.Array) foreach (var reason in reasons.EnumerateArray().Take(5)) health.Children.Add(NativeUi.Text(reason.GetProperty("text").GetString()!)); }
        var actions = new Grid { RowSpacing = 8, ColumnSpacing = 8 }; actions.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); actions.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); actions.RowDefinitions.Add(new() { Height = GridLength.Auto }); actions.RowDefinitions.Add(new() { Height = GridLength.Auto }); foreach (var action in new[] { "watered", "fertilised", "inspected", "repotted" }) { var kind = action; actions.Children.Add(NativeUi.Button(char.ToUpper(kind[0]) + kind[1..], async (sender, _) => { if (!_canWrite) { Notify("Your role is read only."); return; } ((Button)sender).IsEnabled = false; try { await _sync.QueueCareAsync(_org, new(_plant.Id, kind, Guid.NewGuid().ToString(), DateTimeOffset.UtcNow.ToString("O"), SessionId: _session)); Notify("Care saved on this device · pending sync."); await _sync.SyncAsync(_org); if (!_sync.WorkingOffline) await Load(); } catch (Exception ex) { Notify(ex.Message, true); } finally { ((Button)sender).IsEnabled = true; } })); }
        for (var i = 0; i < actions.Children.Count; i++) { Grid.SetColumn((FrameworkElement)actions.Children[i], i % 2); Grid.SetRow((FrameworkElement)actions.Children[i], i / 2); }
        health.Children.Add(actions);
        health.Children.Add(NativeUi.Button("Add photo observation", async (_, _) => { var picker = new global::Windows.Storage.Pickers.FileOpenPicker(); WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this)); foreach (var ext in new[] { ".jpg", ".jpeg", ".png", ".webp" }) picker.FileTypeFilter.Add(ext); var file = await picker.PickSingleFileAsync(); if (file is not null) try { await Upload(file); } catch (Exception ex) { Notify(ex.Message, true); } }));
        health.Children.Add(NativeUi.Button("Score breakdown", async (_, _) => { try { using var details = JsonDocument.Parse(await _api.GetAsync($"{_org}/plants/{_plant.Id}/score")); var root = details.RootElement; var content = NativeUi.Stack(); if (root.TryGetProperty("boundary", out var boundary) && boundary.ValueKind == JsonValueKind.String) content.Children.Add(NativeUi.Caption(boundary.GetString()!)); if (root.TryGetProperty("components", out var components)) foreach (var component in components.EnumerateArray()) content.Children.Add(NativeUi.Text($"{component.GetProperty("label")}: {component.GetProperty("value")} · change {component.GetProperty("change")}")); var dialog = new ContentDialog { XamlRoot = _root.XamlRoot, Title = "Why it changed", Content = new ScrollViewer { Content = content }, CloseButtonText = "Close" }; await dialog.ShowAsync(); } catch (Exception ex) { Notify(ex.Message, true); } }));
        health.Children.Add(NativeUi.Button("Report issue", async (_, _) => { if (!_canWrite) return; var note = new TextBox { Header = "Issue observed", AcceptsReturn = true, MaxLength = 2000, MinWidth = 320 }; var severity = new ComboBox { Header = "Severity", ItemsSource = new[] { "watch", "attention", "critical" }, SelectedIndex = 1 }; var dialog = new ContentDialog { XamlRoot = _root.XamlRoot, Title = "Report plant issue", Content = NativeUi.Stack(note, severity), PrimaryButtonText = "Save issue", CloseButtonText = "Cancel" }; if (await dialog.ShowAsync() != ContentDialogResult.Primary) return; try { await _api.PostAsync($"{_org}/issues", new { plantId = _plant.Id, note = note.Text, severity = severity.SelectedItem.ToString(), sessionId = _session, idempotencyKey = Guid.NewGuid().ToString() }); Notify("Issue saved and alert created."); await Load(); } catch (Exception ex) { Notify(ex.Message, true); } }));
        health.Children.Add(NativeUi.Button("Compare observations", (_, _) => { if (_details is null) { Notify("Connect to load observation evidence first."); return; } var window = new CompareWindow(_plant, _details.Value, _api.BaseUri, _api, _org); App.Windows.Add(window); window.Closed += (_, _) => App.Windows.Remove(window); window.Activate(); }));
        foreach (var button in actions.Children.OfType<Button>()) button.IsEnabled = _canWrite && current.LifecycleStatus == "active";
        foreach (var button in health.Children.OfType<Button>().Where(b => b.Content?.ToString() == LocaleService.T("Add photo observation") || b.Content?.ToString() == LocaleService.T("Report issue"))) button.IsEnabled = _canWrite && current.LifecycleStatus == "active";
        if (_canManage && current.LifecycleStatus == "active") health.Children.Add(NativeUi.Button("Record lifecycle outcome", async (_, _) => await Lifecycle(current)));
        if (current.LifecycleStatus != "active") health.Children.Add(NativeUi.Caption("Lifecycle: " + current.LifecycleStatus + " · historical record preserved"));
        var right = NativeUi.Panel(health); Grid.SetColumn(right, 1); var identityPanel = NativeUi.Panel(identity); hero.Children.Add(identityPanel); hero.Children.Add(right); hero.SizeChanged += (_, _) => { if (hero.ActualWidth < 720) { if (hero.RowDefinitions.Count == 0) { hero.RowDefinitions.Add(new() { Height = GridLength.Auto }); hero.RowDefinitions.Add(new() { Height = GridLength.Auto }); hero.RowSpacing = 20; } Grid.SetColumnSpan(identityPanel, 2); Grid.SetColumn(right, 0); Grid.SetColumnSpan(right, 2); Grid.SetRow(right, 1); photo.Height = 240; } else { hero.RowDefinitions.Clear(); Grid.SetColumnSpan(identityPanel, 1); Grid.SetRow(right, 0); Grid.SetColumn(right, 1); Grid.SetColumnSpan(right, 1); photo.Height = 300; } }; _body.Children.Add(hero);
        if (_details is null) { _body.Children.Add(NativeUi.Caption("Health history has not been cached yet.")); return; }
        var history = _details.Value.GetProperty("history").EnumerateArray().Select(h => h.Clone()).ToList(); var chart = new Canvas { Height = 180, MinWidth = 300 }; var hint = NativeUi.Caption("Hover the timeline to inspect an exact saved score.");
        var firstTime = history.Count > 0 ? history[0].GetProperty("created_at").GetDateTimeOffset() : DateTimeOffset.UtcNow;
        var lastTime = history.Count > 0 ? history[^1].GetProperty("created_at").GetDateTimeOffset() : firstTime;
        var events = _details.Value.GetProperty("timeline").EnumerateArray().Where(e => e.GetProperty("at").GetDateTimeOffset() >= firstTime && e.GetProperty("at").GetDateTimeOffset() <= lastTime).Select(e => e.Clone()).ToList();
        void Draw() { chart.Children.Clear(); if (history.Count == 0) return; var width = Math.Max(300, chart.ActualWidth) - 48; var line = new Polyline { Stroke = NativeUi.Green, StrokeThickness = 2 }; for (var i = 0; i < history.Count; i++) line.Points.Add(new global::Windows.Foundation.Point(40 + TimelineMath.X(history[i].GetProperty("created_at").GetDateTimeOffset(), firstTime, lastTime, width), 160 - history[i].GetProperty("score").GetInt32() * 1.4)); chart.Children.Add(line); foreach (var score in new[] { 0, 25, 50, 75, 100 }) { var label = NativeUi.Caption(score.ToString()); Canvas.SetTop(label, 152 - score * 1.4); chart.Children.Add(label); } foreach (var item in events) { var dot = new Ellipse { Width = 8, Height = 8, Fill = NativeUi.Brush(item.GetProperty("type").GetString() == "observation" ? "#AD571D" : "#153D32") }; Canvas.SetLeft(dot, 36 + TimelineMath.X(item.GetProperty("at").GetDateTimeOffset(), firstTime, lastTime, width)); Canvas.SetTop(dot, 165); ToolTipService.SetToolTip(dot, item.GetProperty("type").GetString() + " · " + NativeUi.Date(item.GetProperty("at").GetDateTimeOffset())); chart.Children.Add(dot); } }
        chart.SizeChanged += (_, _) => Draw(); chart.PointerMoved += (_, e) => { if (history.Count == 0) return; var x = e.GetCurrentPoint(chart).Position.X - 40; var width = Math.Max(300, chart.ActualWidth) - 48; var point = history.OrderBy(h => Math.Abs(TimelineMath.X(h.GetProperty("created_at").GetDateTimeOffset(), firstTime, lastTime, width) - x)).First(); hint.Text = NativeUi.Date(point.GetProperty("created_at").GetDateTimeOffset()) + " · Health " + point.GetProperty("score") + " · Engine " + point.GetProperty("engine_version").GetString(); }; var scoreAlternative = new Expander { Header = "Saved scores and engine provenance", Content = new ListView { ItemsSource = history.Select(h => $"{NativeUi.Date(h.GetProperty("created_at").GetDateTimeOffset())} · Health {h.GetProperty("score")} · {h.GetProperty("engine_version").GetString()}").ToList() } };
        _body.Children.Add(NativeUi.Panel(NativeUi.Stack(NativeUi.Text("Health timeline", 26, true), chart, hint, scoreAlternative)));
        var timeline = NativeUi.Stack(NativeUi.Text("A living history", 26, true)); foreach (var item in _details.Value.GetProperty("timeline").EnumerateArray().Take(20)) { timeline.Children.Add(NativeUi.Text($"{item.GetProperty("type").GetString()} · {item.GetProperty("at").GetDateTimeOffset().ToLocalTime():dd MMM HH:mm}")); timeline.Children.Add(NativeUi.Caption(item.GetProperty("note").GetString()!)); }
        _body.Children.Add(NativeUi.Panel(timeline));
    }
    private async Task Lifecycle(PlantSummary current)
    {
        var kind = new ComboBox { Header = "Lifecycle action", ItemsSource = new[] { "retired", "replaced" }, SelectedIndex = 0, MinWidth = 340 };
        var outcome = new ComboBox { Header = "Recorded outcome", ItemsSource = new[] { "died", "relocated", "replaced", "other" }, SelectedIndex = 0, MinWidth = 340 };
        var reason = new TextBox { Header = "Reason", AcceptsReturn = true, MaxLength = 1000, MinWidth = 340 };
        var replacement = new TextBox { Header = "Replacement plant ID (for replacement)", MinWidth = 340 };
        var dialog = new ContentDialog { XamlRoot = _root.XamlRoot, Title = "Review plant lifecycle outcome", Content = NativeUi.Stack(kind, outcome, reason, replacement, NativeUi.Caption("This closes pending work and retires the active tag. The plant history remains available.")), PrimaryButtonText = "Record outcome", CloseButtonText = "Cancel" };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        try { await _api.PostAsync($"{_org}/plants/{current.Id}/lifecycle", new { kind = kind.SelectedItem.ToString(), outcome = outcome.SelectedItem.ToString(), reason = reason.Text, replacementPlantId = kind.SelectedItem.ToString() == "replaced" ? replacement.Text : null, revision = current.OperationsRevision, idempotencyKey = Guid.NewGuid().ToString() }); Notify("Lifecycle outcome recorded. History preserved."); await Load(); }
        catch (Exception ex) { Notify(ex.Message, true); }
    }
    private async Task Upload(global::Windows.Storage.StorageFile file)
    {
        if (!_canWrite) throw new InvalidOperationException("Your role is read only."); if (_sync.WorkingOffline) throw new InvalidOperationException("Photo upload requires a connection. Your file remains on this device.");
        if ((await file.GetBasicPropertiesAsync()).Size > 4 * 1024 * 1024) throw new InvalidOperationException("Choose a JPEG, PNG or WebP smaller than 4 MB.");
        var matched = new CheckBox { Content = "Same viewpoint and similar lighting", IsChecked = false }; var note = new TextBox { Header = "Observation note", MaxLength = 2000 };
        var dialog = new ContentDialog { XamlRoot = _root.XamlRoot, Title = "Save photo observation", Content = NativeUi.Stack(NativeUi.Caption(file.Name), note, matched), PrimaryButtonText = "Save observation", CloseButtonText = "Cancel" }; if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        Notify("Saving observation…"); using var reservation = JsonDocument.Parse(await _api.PostAsync($"{_org}/observations/sign", new { plantId = _plant.Id, note = note.Text, matchedView = matched.IsChecked == true }));
        var buffer = await global::Windows.Storage.FileIO.ReadBufferAsync(file); var bytes = new byte[buffer.Length]; using (var reader = global::Windows.Storage.Streams.DataReader.FromBuffer(buffer)) reader.ReadBytes(bytes);
        await _api.UploadAsync(reservation.RootElement.GetProperty("route").GetString()!, bytes); Notify("Observation saved. Analysis has been queued independently."); await Load();
    }
}
