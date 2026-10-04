using CommunityToolkit.WinUI.UI.Controls;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Nabat.Core;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Text.Json;
namespace Nabat.Windows;

public sealed class ImportWindow : Window
{
    public sealed class Row : INotifyPropertyChanged
    {
        public string Id { get; set; } = ""; public string Filename { get; set; } = ""; public string LocalPath { get; set; } = ""; public string? PlantId { get; set; }
        public string? PlantName { get; set; }
        public string Status { get; set; } = "needs_review"; public int Revision { get; set; }
        public string? CapturedAt { get; set; }
        public string? UploadRoute { get; set; }
        public string? UploadExpires { get; set; }
        public string? PhotoId { get; set; }
        public string? Error { get; set; }
        public string DateText => CapturedAt is null ? "Unknown · upload time" : NativeUi.Date(DateTimeOffset.Parse(CapturedAt));
        public string Candidate => PlantName ?? "Needs review"; public string Detail => Error ?? (Status == "saved" ? "Observation saved · analysis queued" : Status.Replace('_', ' '));
        public event PropertyChangedEventHandler? PropertyChanged;
        public void Update() => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(null));
    }
    private readonly ApiClient _api; private readonly LocalStore _store; private readonly string _org, _scope;
    private readonly Grid _root = new() { Padding = new(24), RowSpacing = 16, Background = NativeUi.Brush("#F7F6EF") }; private readonly DataGrid _grid = new() { AutoGenerateColumns = false, IsReadOnly = true, SelectionMode = DataGridSelectionMode.Single, RowHeight = 56, Background = NativeUi.Brush("#FFFFFF") };
    private readonly ObservableCollection<Row> _rows = []; private readonly InfoBar _notice = new() { IsClosable = true }; private readonly TextBlock _progress = NativeUi.Caption("Drop plant photos or choose files.");
    private List<PlantSummary> _plants = []; private string _batch = ""; private bool _uploading;
    private string Key => "import:" + _scope;
    public ImportWindow(ApiClient api, LocalStore store, string org)
    {
        _api = api; _store = store; _org = org; _scope = api.Scope(org); Title = "NABAT Import Review"; AppWindow.Resize(new global::Windows.Graphics.SizeInt32(1280, 850)); SystemBackdrop = new Microsoft.UI.Xaml.Media.MicaBackdrop();
        for (var i = 0; i < 4; i++) _root.RowDefinitions.Add(new() { Height = i == 3 ? new(1, GridUnitType.Star) : GridLength.Auto }); _root.Children.Add(NativeUi.Stack(NativeUi.Text("Import Review Workspace", 32, true), _progress));
        var tools = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; tools.Children.Add(NativeUi.Button("Choose photos", async (_, _) => await Choose())); tools.Children.Add(NativeUi.Button("Review selected", async (_, _) => await Review())); tools.Children.Add(NativeUi.Button("Detect QR identity", async (_, _) => await Detect())); tools.Children.Add(NativeUi.Button("Upload ready observations", async (_, _) => await Upload())); Grid.SetRow(tools, 1); _root.Children.Add(tools); Grid.SetRow(_notice, 2); _root.Children.Add(_notice);
        foreach (var pair in new[] { ("File", "Filename", 280d), ("Candidate plant", "Candidate", 260d), ("Captured date", "DateText", 200d), ("State", "Detail", 350d) }) _grid.Columns.Add(new DataGridTextColumn { Header = pair.Item1, Binding = new Binding { Path = new(pair.Item2) }, Width = new DataGridLength(pair.Item3) }); _grid.ItemsSource = _rows; Grid.SetRow(_grid, 3); _root.Children.Add(_grid); Content = _root; NativeUi.PrepareWindow(this, _root);
        _root.AllowDrop = true; _root.DragOver += (_, e) => e.AcceptedOperation = global::Windows.ApplicationModel.DataTransfer.DataPackageOperation.Copy; _root.Drop += async (_, e) => { if (e.DataView.Contains(global::Windows.ApplicationModel.DataTransfer.StandardDataFormats.StorageItems)) await Add((await e.DataView.GetStorageItemsAsync()).OfType<global::Windows.Storage.StorageFile>().ToList()); };
        _root.Loaded += async (_, _) => { try { int page = 0, total; do { using var result = JsonDocument.Parse(await _api.GetAsync($"{_org}/fleet?limit=100&page={page++}")); var fleet = Contracts.Read<FleetPage>(result.RootElement); _plants.AddRange(fleet.Items); total = fleet.Total; } while (_plants.Count < total && page < 100); var state = await _store.PreferenceAsync(Key); if (state is not null) { var saved = JsonSerializer.Deserialize<Saved>(state); if (saved is not null) { _batch = saved.Batch; foreach (var row in saved.Rows) { if (row.Status == "uploading") row.Status = "ready"; _rows.Add(row); } Counts(); } } } catch (Exception ex) { Notice(ex.Message, true); } };
    }
    private record Saved(string Batch, List<Row> Rows);
    private Task Persist() => _store.SetPreferenceAsync(Key, JsonSerializer.Serialize(new Saved(_batch, _rows.ToList())));
    private void Notice(string text, bool error = false) { _notice.Title = error ? "Import needs attention" : "Observation import"; _notice.Message = text; _notice.Severity = error ? InfoBarSeverity.Warning : InfoBarSeverity.Informational; _notice.IsOpen = true; }
    private void Counts() => _progress.Text = $"{_rows.Count(r => r.Status == "saved")} saved · {_rows.Count(r => r.Status == "uploading")} processing · {_rows.Count(r => r.Status == "needs_review")} need review · {_rows.Count(r => r.Status == "failed")} failed";
    private async Task Choose() { var picker = new global::Windows.Storage.Pickers.FileOpenPicker(); WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this)); foreach (var ext in new[] { ".jpg", ".jpeg", ".png", ".webp" }) picker.FileTypeFilter.Add(ext); await Add((await picker.PickMultipleFilesAsync()).ToList()); }
    private async Task Add(IReadOnlyList<global::Windows.Storage.StorageFile> files)
    {
        if (_uploading) { Notice("Finish the current upload before adding another batch."); return; }
        if (files.Count is 0 or > 100) { Notice("Choose 1–100 photos.", true); return; }
        try
        {
            var staged = new List<Row>(); var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NABAT", "Operations", "imports", _scope, Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
            foreach (var file in files) { if ((await file.GetBasicPropertiesAsync()).Size > 4 * 1024 * 1024) throw new InvalidOperationException(file.Name + " exceeds 4 MB."); var path = Path.Combine(folder, Guid.NewGuid() + Path.GetExtension(file.Name)); await Task.Run(() => File.Copy(file.Path, path)); string? captured = null; try { var image = await file.Properties.GetImagePropertiesAsync(); if (image.DateTaken > DateTimeOffset.MinValue) captured = image.DateTaken.ToUniversalTime().ToString("O"); } catch (Exception ex) when (ex is IOException or System.Runtime.InteropServices.COMException) { } staged.Add(new() { Filename = file.Name, LocalPath = path, CapturedAt = captured }); }
            using var batch = JsonDocument.Parse(await _api.PostAsync($"{_org}/imports", new { files = staged.Select(r => new { filename = r.Filename, capturedAt = r.CapturedAt }), idempotencyKey = Guid.NewGuid().ToString() })); _batch = batch.RootElement.GetProperty("id").GetString()!; using var items = JsonDocument.Parse(await _api.GetAsync($"{_org}/imports/{_batch}")); _rows.Clear(); var remaining = staged.ToList(); foreach (var item in items.RootElement.EnumerateArray()) { var row = remaining.First(r => r.Filename == item.GetProperty("filename").GetString()); remaining.Remove(row); row.Id = item.GetProperty("id").GetString()!; row.PlantId = item.GetProperty("plant_id").GetString(); row.PlantName = item.GetProperty("plant_name").GetString(); row.Status = item.GetProperty("status").GetString()!; _rows.Add(row); }
            await Persist(); Counts(); Notice("Files copied into the local import queue. Originals were preserved.");
        }
        catch (Exception ex) { Notice(ex.Message, true); }
    }
    private async Task SaveMapping(Row row) { using var result = JsonDocument.Parse(await _api.PostAsync($"{_org}/import-items/{row.Id}", new { plantId = row.PlantId, revision = row.Revision, capturedAt = row.CapturedAt, idempotencyKey = Guid.NewGuid().ToString() })); row.Revision = result.RootElement.GetProperty("revision").GetInt32(); row.Status = result.RootElement.GetProperty("status").GetString()!; row.UploadRoute = null; row.Update(); await Persist(); Counts(); }
    private async Task Review() { if (_grid.SelectedItem is not Row row || row.Status == "saved") return; var choices = new ComboBox { Header = "Assign observation to plant", ItemsSource = _plants, DisplayMemberPath = "Name", MinWidth = 360, SelectedItem = _plants.FirstOrDefault(p => p.Id == row.PlantId) }; var date = new CalendarDatePicker { Header = "Captured date (optional)", Date = row.CapturedAt is null ? null : DateTimeOffset.Parse(row.CapturedAt) }; var dialog = new ContentDialog { XamlRoot = _root.XamlRoot, Title = row.Filename, Content = NativeUi.Stack(choices, date), PrimaryButtonText = "Save mapping", CloseButtonText = "Cancel" }; if (await dialog.ShowAsync() != ContentDialogResult.Primary) return; row.PlantId = (choices.SelectedItem as PlantSummary)?.Id; row.PlantName = (choices.SelectedItem as PlantSummary)?.Name; row.CapturedAt = date.Date?.ToUniversalTime().ToString("O"); try { await SaveMapping(row); } catch (Exception ex) { Notice(ex.Message, true); } }
    private async Task Detect() { if (_grid.SelectedItem is not Row row || row.Status == "saved") return; try { using var result = JsonDocument.Parse(await _api.UploadAsync($"{_org}/imports/detect", await File.ReadAllBytesAsync(row.LocalPath))); var candidate = result.RootElement.GetProperty("candidate"); if (candidate.ValueKind == JsonValueKind.Null) { Notice("QR could not establish a plant identity. Choose the mapping manually."); return; } row.PlantId = candidate.GetProperty("id").GetString(); row.PlantName = candidate.GetProperty("name").GetString(); await SaveMapping(row); } catch (Exception ex) { Notice(ex.Message, true); } }
    private async Task Upload()
    {
        if (_uploading) return; _uploading = true;
        try
        {
            foreach (var row in _rows.Where(r => r.PlantId is not null && r.Status is "ready" or "failed").ToList())
            {
                try
                {
                    row.Status = "uploading"; row.Error = null; row.Update(); Counts(); var bytes = await File.ReadAllBytesAsync(row.LocalPath);
                    if (row.UploadRoute is not null) { using var receipt = JsonDocument.Parse(await _api.GetAsync($"{_org}/upload-receipts/{row.UploadRoute.Split('/').Last()}")); if (receipt.RootElement.ValueKind == JsonValueKind.Object && receipt.RootElement.GetProperty("status").GetString() == "completed") row.PhotoId = receipt.RootElement.GetProperty("photo_id").GetString(); }
                    if (row.PhotoId is null) { if (row.UploadRoute is null || row.UploadExpires is null || DateTimeOffset.Parse(row.UploadExpires) < DateTimeOffset.UtcNow) { using var reservation = JsonDocument.Parse(await _api.PostAsync($"{_org}/observations/sign", new { plantId = row.PlantId, note = "Imported observation · " + row.Filename, matchedView = false, capturedAt = row.CapturedAt })); row.UploadRoute = reservation.RootElement.GetProperty("route").GetString(); row.UploadExpires = reservation.RootElement.GetProperty("expiresAt").GetString(); await Persist(); } using var saved = JsonDocument.Parse(await _api.UploadAsync(row.UploadRoute!, bytes)); row.PhotoId = saved.RootElement.GetProperty("id").GetString(); }
                    using var linked = JsonDocument.Parse(await _api.PostAsync($"{_org}/import-items/{row.Id}", new { plantId = row.PlantId, photoId = row.PhotoId, revision = row.Revision, idempotencyKey = Guid.NewGuid().ToString() })); row.Revision = linked.RootElement.GetProperty("revision").GetInt32(); row.Status = "saved";
                }
                catch (Exception ex) { row.Status = "failed"; row.Error = ex.Message; }
                row.Update(); await Persist(); Counts();
            }
            Notice("Import queue processed. Saved observations remain safe if analysis is unavailable.");
        }
        finally { _uploading = false; }
    }
}
