using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Nabat.Core;
using System.Text.Json;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private TrayService? _tray; private bool _forceQuit, _notificationsEnabled, _systemsBooted, _notificationBaseline; private readonly HashSet<string> _knownAlerts = [];
    private readonly ITelemetryService _telemetry = App.Services.GetRequiredService<ITelemetryService>();
    private readonly INotificationService _notifications = App.Services.GetRequiredService<INotificationService>();
    private async Task BootSystems()
    {
        if (_systemsBooted) return; _systemsBooted = true; _tray = new(WinRT.Interop.WindowNative.GetWindowHandle(this), Path.Combine(AppContext.BaseDirectory, "Assets", "Nabat.ico"), action => DispatcherQueue.TryEnqueue(async () =>
        {
            Activate(); AppWindow.Show(); switch (action) { case "critical": _fleetState = "critical"; Navigate("Plants"); break; case "today": Navigate("Today"); break; case "add": await NewPlant(); break; case "sync": await RefreshAsync(); break; case "quit": _forceQuit = true; foreach (var window in App.Windows.ToList()) window.Close(); break; }
        }));
        AppWindow.Closing += async (_, e) => { if (_tray.Enabled && !_forceQuit) { e.Cancel = true; AppWindow.Hide(); } else if (!_shuttingDown) { e.Cancel = true; await PrepareShutdown(); Close(); } };
        Closed += (_, _) => { _tray.Dispose(); _notifications.Dispose(); };
        _notifications.Activated += (_, link) => DispatcherQueue.TryEnqueue(() => { AppWindow.Show(); Activate(); OpenProtocol(link); });
        try { _tray.SetEnabled(await _store.PreferenceAsync("tray.enabled") == "true"); _notificationsEnabled = await _store.PreferenceAsync("notifications.enabled") == "true"; _notifications.Enable(_notificationsEnabled); } catch (Exception ex) { _telemetry.Record("integration.unavailable", new { type = ex.GetType().Name }); }
        AppWindow.Changed += async (_, e) => { if ((e.DidPositionChange || e.DidSizeChange) && _api?.Session is not null && _org.Length > 0) await _store.SetPreferenceAsync("main.bounds:" + _api.Scope(_org), JsonSerializer.Serialize(new WindowBounds(AppWindow.Position.X, AppWindow.Position.Y, AppWindow.Size.Width, AppWindow.Size.Height))); };
    }
    private record WindowBounds(int X, int Y, int Width, int Height);
    private async Task RestoreBounds() { if (_api?.Session is null) return; var value = await _store.PreferenceAsync("main.bounds:" + _api.Scope(_org)); if (value is null) return; try { var saved = JsonSerializer.Deserialize<WindowBounds>(value); if (saved is null) return; var area = Microsoft.UI.Windowing.DisplayArea.GetFromWindowId(AppWindow.Id, Microsoft.UI.Windowing.DisplayAreaFallback.Nearest).WorkArea; var width = Math.Clamp(saved.Width, 640, area.Width); var height = Math.Clamp(saved.Height, 480, area.Height); AppWindow.Resize(new global::Windows.Graphics.SizeInt32(width, height)); AppWindow.Move(new global::Windows.Graphics.PointInt32(Math.Clamp(saved.X, area.X, area.X + area.Width - width), Math.Clamp(saved.Y, area.Y, area.Y + area.Height - height))); } catch (JsonException) { } }
    private readonly HashSet<string> _knownChanges = []; private string? _notificationScope;
    private void UpdateSystems()
    {
        if (_snapshot is null) return; var scope = _api!.Scope(_org); if (_notificationScope != scope) { _notificationScope = scope; _knownAlerts.Clear(); _knownChanges.Clear(); _notificationBaseline = false; }
        var critical = _snapshot.Alerts.EnumerateArray().Where(a => a.GetProperty("severity").GetString() == "critical" && a.GetProperty("status").GetString() != "resolved").ToList();
        if (_tray is not null) { _tray.Critical = critical.Count; _tray.Tasks = _snapshot.Tasks.Count(t => t.Status is "pending" or "in_progress"); _tray.Sync = _sync?.Status ?? "Offline"; _tray.Update(); }
        foreach (var alert in critical) { var id = alert.GetProperty("id").GetString()!; if (_notificationBaseline && _notificationsEnabled && !_knownAlerts.Contains(id)) { try { _notifications.Show(alert.GetProperty("plant_code").GetString()!, "A plant requires attention. Open NABAT to review the alert."); } catch (Exception ex) { _telemetry.Record("notification.failed", new { type = ex.GetType().Name }); } } _knownAlerts.Add(id); }
        foreach (var plant in _snapshot.Plants.Where(p => p.Delta <= -8 && p.Confidence >= .7)) { var key = "decline:" + plant.Id + ":" + plant.Score + ":" + plant.Delta; if (_notificationBaseline && _notificationsEnabled && !_knownChanges.Contains(key)) try { _notifications.Show(plant.Code, "A rapid health decline was recorded. Open NABAT to review the evidence."); } catch (Exception ex) { _telemetry.Record("notification.failed", new { type = ex.GetType().Name }); } _knownChanges.Add(key); }
        foreach (var task in _snapshot.Tasks.Where(t => t.AssigneeId == _api.Session!.Actor.Id && t.Status is "pending" or "in_progress")) { var key = "assignment:" + task.Id; if (_notificationBaseline && _notificationsEnabled && !_knownChanges.Contains(key)) try { _notifications.Show(task.PlantCode, "New work is assigned to you. Open NABAT to review today's tasks."); } catch (Exception ex) { _telemetry.Record("notification.failed", new { type = ex.GetType().Name }); } _knownChanges.Add(key); }
        _notificationBaseline = true;
    }
    private StackPanel SystemSettings()
    {
        var tray = new ToggleSwitch { Header = "Stay available in the system tray", IsOn = _tray?.Enabled == true, OnContent = "Close hides the main window", OffContent = "Close exits the main window" }; tray.Toggled += async (_, _) => { try { _tray?.SetEnabled(tray.IsOn); await _store.SetPreferenceAsync("tray.enabled", tray.IsOn ? "true" : "false"); } catch (Exception ex) { Message(ex.Message, true); } };
        var notifications = new ToggleSwitch { Header = "Windows notifications", IsOn = _notificationsEnabled, OnContent = "Critical alerts, rapid decline and new work", OffContent = "Notifications disabled" }; notifications.Toggled += async (_, _) => { try { _notifications.Enable(notifications.IsOn); _notificationsEnabled = notifications.IsOn; await _store.SetPreferenceAsync("notifications.enabled", notifications.IsOn ? "true" : "false"); } catch (Exception ex) { Message(ex.Message, true); } };
        return NativeUi.Stack(NativeUi.Text("Windows integration", 24, true), tray, notifications, NativeUi.Caption("Notifications contain operational summaries. Photos and care notes are never included."));
    }
}
