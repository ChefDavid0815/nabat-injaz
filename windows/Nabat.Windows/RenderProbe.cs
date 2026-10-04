// Opt-in test instrumentation: captures this application's XAML tree, never the desktop.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media.Imaging;
using Nabat.Core;
using System.Text.Json;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private async Task RunRenderProbe(string directory)
    {
        Directory.CreateDirectory(directory);
        try
        {
            using var client = new ApiClient("http://127.0.0.1:3001"); var session = await client.SignInAsync("owner@nabat.demo", "NabatDemo2026!"); Connect(client.BaseUri.ToString(), session); _org = session.Workspaces[0].Id;
            var scale = Root.XamlRoot.RasterizationScale; AppWindow.Resize(new global::Windows.Graphics.SizeInt32((int)(1536 * scale), (int)(1024 * scale))); await RefreshAsync();
            if (_snapshot is null) throw new InvalidDataException("The native workspace did not load.");
            var plant = _snapshot.Plants[0]; var requestId = Guid.NewGuid().ToString(); var occurredAt = DateTimeOffset.UtcNow.ToString("O"); _sync!.WorkingOffline = true;
            await _sync.QueueCareAsync(_org, new(plant.Id, "inspected", requestId, occurredAt, "Native offline smoke")); await _sync.SyncAsync(_org);
            if (!(await new LocalStore(Path.Combine(_data, "operations.db")).OutboxAsync(_api!.Scope(_org))).Any(i => i.Id == requestId)) throw new InvalidDataException("Pending care did not survive a store restart.");
            _sync.WorkingOffline = false; await _sync.SyncAsync(_org);
            if ((await _store.OutboxAsync(_api.Scope(_org))).Any(i => i.Id == requestId)) throw new InvalidDataException("The online sync did not acknowledge care.");
            using var replay = JsonDocument.Parse(await _api.PostAsync($"{_org}/care", new { plantId = plant.Id, type = "inspected", idempotencyKey = requestId, occurredAt, note = "Native offline smoke", expectedActorId = session.Actor.Id }));
            using var profile = JsonDocument.Parse(await _api.GetAsync($"{_org}/plants/{plant.Id}")); var careId = replay.RootElement.GetProperty("id").GetString();
            if (profile.RootElement.GetProperty("timeline").EnumerateArray().Count(e => e.GetProperty("id").GetString() == careId) != 1) throw new InvalidDataException("Care replay was not exactly once.");
            using var maintenance = JsonDocument.Parse(await _api.PostAsync($"{_org}/sessions", new { plantIds = new[] { plant.Id }, idempotencyKey = Guid.NewGuid().ToString() }));
            var sessionId = maintenance.RootElement.GetProperty("id").GetString()!; await _sync.QueueCareAsync(_org, new(plant.Id, "fertilised", Guid.NewGuid().ToString(), DateTimeOffset.UtcNow.ToString("O"), SessionId: sessionId)); await _sync.SyncAsync(_org);
            using var summary = JsonDocument.Parse(await _api.PostAsync($"{_org}/sessions/{sessionId}/finish", new { revision = 0, action = "complete", idempotencyKey = Guid.NewGuid().ToString() }));
            if (summary.RootElement.GetProperty("summary").GetProperty("plants_visited").GetInt32() != 1) throw new InvalidDataException("Maintenance visit count was not persisted.");
            await File.WriteAllTextAsync(Path.Combine(directory, "native-live-flow.json"), JsonSerializer.Serialize(new { offlineCareSaved = true, storeRestartRecovered = true, reconnectedAndSynced = true, replayedExactlyOnce = true, maintenanceVisited = 1, maintenanceCompleted = true, requestId, careId }, new JsonSerializerOptions { WriteIndented = true }));
            await RefreshAsync();
            foreach (var section in new[] { "Home", "Today", "Plants", "Locations", "Alerts", "Analytics", "Team", "Settings", "Tags" })
            {
                Navigate(section); await Task.Delay(section is "Tags" or "Locations" or "Analytics" or "Team" or "Plants" ? 1600 : 250); await Capture(Path.Combine(directory, section.ToLowerInvariant() + "-native.png"));
            }
            ApplyLocale(true); Navigate("Settings"); await Task.Delay(250); await Capture(Path.Combine(directory, "settings-rtl-native.png")); ApplyLocale(false);
            async Task Child(Window window, string name) { window.AppWindow.Resize(new global::Windows.Graphics.SizeInt32((int)(1180 * scale), (int)(950 * scale))); window.Activate(); var element = (FrameworkElement)window.Content; for (var n = 0; !element.IsLoaded && n < 100; n++) await Task.Delay(20); await Task.Delay(1600); await Capture(Path.Combine(directory, name + "-native.png"), element); window.Close(); }
            await Child(new PlantWindow(_api, _store, _sync, _org, plant, null, true, true), "profile");
            await Child(new CompareWindow(plant, profile.RootElement, _api.BaseUri, _api, _org), "compare");
            await Child(new FloorPlanWindow(_api, _org, _snapshot.Locations[0], true, OpenPlant), "floor-plan");
            await Child(new ReportWindow(_api, _org, 30), "report");
            await Child(new ImportWindow(_api, _store, _org), "import");
            using var tags = JsonDocument.Parse(await _api.GetAsync($"{_org}/tags")); var tag = tags.RootElement.EnumerateArray().First(t => t.GetProperty("state").GetString() == "active");
            var url = tag.GetProperty("resolver_url").GetString()!; var adapter = new SimulatedNfcAdapter(); await adapter.WriteAsync(NdefUri.Encode(url)); var readBack = NdefUri.Decode(await adapter.ReadAsync()); if (readBack != url) throw new InvalidDataException("Simulated NDEF mismatch.");
            await _api.PostAsync($"{_org}/tags/{tag.GetProperty("id")}/programming", new { reader = "Native probe simulated adapter", uid = "53494D", verification = "simulated", url, idempotencyKey = Guid.NewGuid().ToString() });
            await File.WriteAllTextAsync(Path.Combine(directory, "nfc-simulation.json"), JsonSerializer.Serialize(new { adapter = "SimulatedNfcAdapter", encodedAndReadBack = true, serverAuditSaved = true, physicalTagWritten = false }));
            AppWindow.Resize(new global::Windows.Graphics.SizeInt32((int)(900 * scale), (int)(760 * scale))); Navigate("Home"); await Task.Delay(250); await Capture(Path.Combine(directory, "home-narrow-native.png")); AppWindow.Resize(new global::Windows.Graphics.SizeInt32((int)(1536 * scale), (int)(1024 * scale)));
            Navigate("Home"); await Task.Delay(250); await File.WriteAllTextAsync(Path.Combine(directory, "native-render-proof.json"), JsonSerializer.Serialize(new { framework = "WinUI 3 / Windows App SDK 2.5.1", render = "RenderTargetBitmap of the running application's XAML tree; OS frame and compositor backdrop excluded", width = Root.ActualWidth, height = Root.ActualHeight, scale, plants = _snapshot!.TotalPlants, server = client.BaseUri.ToString(), screens = 16 }, new JsonSerializerOptions { WriteIndented = true }));
            _vault.Save(client.BaseUri.ToString(), session); await _store.SetPreferenceAsync($"org:{session.Actor.Id}", _org); await _store.SetPreferenceAsync($"section:{_api.Scope(_org)}", "Plants");
            var restartKey = Guid.NewGuid().ToString(); _sync.WorkingOffline = true; await _sync.QueueCareAsync(_org, new(plant.Id, "inspected", restartKey, DateTimeOffset.UtcNow.ToString("O"), "Process restart proof"));
            OpenPlant(plant); await Task.Delay(300); await File.WriteAllTextAsync(Path.Combine(directory, "resume-expect.json"), JsonSerializer.Serialize(new { key = restartKey, plant = plant.Id, organisation = _org })); await PrepareShutdown(); Close();
        }
        catch (Exception ex) { await File.WriteAllTextAsync(Path.Combine(directory, "native-render-error.txt"), ex.ToString()); Message(ex.Message, true); }
    }
    private async Task RunResumeProbe(string directory)
    {
        try
        {
            using var expected = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "resume-expect.json"))); var key = expected.RootElement.GetProperty("key").GetString()!; var plant = expected.RootElement.GetProperty("plant").GetString()!;
            var saved = _vault.Load() ?? throw new InvalidDataException("Restart session did not recover."); Connect(saved.BaseUrl, saved.Session); _org = await _store.PreferenceAsync($"org:{saved.Session.Actor.Id}") ?? throw new InvalidDataException("Workspace did not recover.");
            var scope = _api!.Scope(_org); if (!(await _store.OutboxAsync(scope)).Any(p => p.Id == key)) throw new InvalidDataException("Pending care was lost across process restart.");
            _snapshot = OperationsSnapshot.Parse(await _store.ReadCacheAsync(scope) ?? throw new InvalidDataException("Workspace cache was lost.")); _section = await _store.PreferenceAsync($"section:{scope}") ?? "Home"; BindWorkspace(); Navigate(_section); await RestoreWindows();
            if (!_windowContexts.Values.Any(c => c.Kind == "plant" && c.Entity == plant)) throw new InvalidDataException("Plant window context did not restore.");
            await RefreshAsync(); if ((await _store.OutboxAsync(scope)).Any(p => p.Id == key)) throw new InvalidDataException("Recovered care did not sync.");
            using var receipt = JsonDocument.Parse(await _api.GetAsync($"{_org}/care-receipts/{key}")); if (receipt.RootElement.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Recovered care receipt missing.");
            await File.WriteAllTextAsync(Path.Combine(directory, "process-restart-proof.json"), JsonSerializer.Serialize(new { actualProcessRestart = true, credentialRecovered = true, workspaceRecovered = true, navigationRecovered = _section, windowContextRecovered = true, pendingCareRecovered = true, reconnectedAndSynced = true }, new JsonSerializerOptions { WriteIndented = true }));
            await PrepareShutdown(); Close();
        }
        catch (Exception ex) { await File.WriteAllTextAsync(Path.Combine(directory, "resume-error.txt"), ex.ToString()); Close(); }
    }
    private async Task RunCloudProbe(string directory, string credentialFile)
    {
        Directory.CreateDirectory(directory);
        try
        {
            var bytes = System.Security.Cryptography.ProtectedData.Unprotect(await File.ReadAllBytesAsync(credentialFile), null, System.Security.Cryptography.DataProtectionScope.CurrentUser);
            using var data = JsonDocument.Parse(bytes); var values = data.RootElement;
            using var client = new ApiClient(values.GetProperty("base").GetString()!); var session = await client.SignInAsync(values.GetProperty("email").GetString()!, values.GetProperty("password").GetString()!);
            Connect(client.BaseUri.ToString(), session); _org = values.GetProperty("organisation").GetString()!; await RefreshAsync();
            if (_snapshot is null || _snapshot.Workspace.Id != _org) throw new InvalidDataException("The cloud workspace did not load.");
            var plantId = values.GetProperty("plant").GetString()!; var key = Guid.NewGuid().ToString(); _sync!.WorkingOffline = true;
            await _sync.QueueCareAsync(_org, new(plantId, "inspected", key, DateTimeOffset.UtcNow.ToString("O"), "Native cloud bridge verification"));
            if (!(await _store.OutboxAsync(_api!.Scope(_org))).Any(p => p.Id == key)) throw new InvalidDataException("Cloud-bound care was not saved locally.");
            _sync.WorkingOffline = false; await _sync.SyncAsync(_org); using var receipt = JsonDocument.Parse(await _api.GetAsync($"{_org}/care-receipts/{key}"));
            if (receipt.RootElement.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Cloud care receipt missing.");
            await RefreshAsync(); Navigate("Home"); await Task.Delay(250); await Capture(Path.Combine(directory, "cloud-home-native.png"));
            await File.WriteAllTextAsync(Path.Combine(directory, "native-cloud-proof.json"), JsonSerializer.Serialize(new { origin = client.BaseUri.ToString(), nativeWinUiRunning = true, nativeBearerSignIn = true, sharedSnapshotParsed = true, sqliteCareQueued = true, reconnectedToCloud = true, careReceiptAcknowledged = true, modelCalls = 0, physicalNfc = false }, new JsonSerializerOptions { WriteIndented = true }));
            await PrepareShutdown(); Close();
        }
        catch (Exception ex) { await File.WriteAllTextAsync(Path.Combine(directory, "cloud-error.txt"), ex.ToString()); Close(); }
    }
    private async Task Capture(string filename, FrameworkElement? element = null)
    {
        var bitmap = new RenderTargetBitmap(); await bitmap.RenderAsync(element ?? Root); var buffer = await bitmap.GetPixelsAsync(); var bytes = new byte[buffer.Length]; using (var reader = global::Windows.Storage.Streams.DataReader.FromBuffer(buffer)) reader.ReadBytes(bytes);
        var folder = await global::Windows.Storage.StorageFolder.GetFolderFromPathAsync(Path.GetDirectoryName(filename)!); var file = await folder.CreateFileAsync(Path.GetFileName(filename), global::Windows.Storage.CreationCollisionOption.ReplaceExisting);
        using var stream = await file.OpenAsync(global::Windows.Storage.FileAccessMode.ReadWrite); var encoder = await global::Windows.Graphics.Imaging.BitmapEncoder.CreateAsync(global::Windows.Graphics.Imaging.BitmapEncoder.PngEncoderId, stream);
        encoder.SetPixelData(global::Windows.Graphics.Imaging.BitmapPixelFormat.Bgra8, global::Windows.Graphics.Imaging.BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, bytes); await encoder.FlushAsync();
    }
}
