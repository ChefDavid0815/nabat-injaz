using Microsoft.UI.Xaml;
using Nabat.Core;
using System.Text.Json;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private readonly Dictionary<Window, WindowContext> _windowContexts = [];
    private bool _restoredWindows, _shuttingDown;
    private record WindowContext(string Kind, string Entity, string Organisation, int X, int Y, int Width, int Height);
    private async Task PersistWindows()
    {
        if (_api?.Session is null || _org.Length == 0) return;
        await _store.SetPreferenceAsync("open-windows:" + _api.Scope(_org), JsonSerializer.Serialize(_windowContexts.Values.ToList()));
    }
    private void TrackContext(Window window, string kind, string entity, string? organisation = null)
    {
        var org = organisation ?? _org; _windowContexts[window] = new(kind, entity, org, window.AppWindow.Position.X, window.AppWindow.Position.Y, window.AppWindow.Size.Width, window.AppWindow.Size.Height);
        window.AppWindow.Changed += async (_, e) => { if (e.DidSizeChange || e.DidPositionChange) { _windowContexts[window] = new(kind, entity, org, window.AppWindow.Position.X, window.AppWindow.Position.Y, window.AppWindow.Size.Width, window.AppWindow.Size.Height); if (!_shuttingDown) await PersistWindows(); } };
        window.Closed += async (_, _) => { if (!_shuttingDown) { _windowContexts.Remove(window); await PersistWindows(); } };
        _ = PersistWindows();
    }
    private async Task RestoreWindows()
    {
        if (_restoredWindows || _api?.Session is null || _snapshot is null) return; _restoredWindows = true;
        var value = await _store.PreferenceAsync("open-windows:" + _api.Scope(_org)); if (value is null) return;
        List<WindowContext>? contexts; try { contexts = JsonSerializer.Deserialize<List<WindowContext>>(value); } catch (JsonException) { return; }
        foreach (var context in (contexts ?? []).Take(8))
        {
            try
            {
                Window? window = null;
                if (context.Kind == "plant") { using var doc = JsonDocument.Parse(await _api.GetAsync($"{context.Organisation}/plants/{context.Entity}")); var plant = Contracts.Read<PlantSummary>(doc.RootElement.GetProperty("plant")); window = new PlantWindow(_api, _store, _sync!, context.Organisation, plant, null, _api.Session.Workspaces.First(w => w.Id == context.Organisation).Role != "viewer", _api.Session.Workspaces.First(w => w.Id == context.Organisation).Role is "owner" or "admin" or "manager"); }
                if (context.Kind == "map") { var location = _snapshot.Locations.FirstOrDefault(l => l.Id == context.Entity); if (location is not null) window = new FloorPlanWindow(_api, context.Organisation, location, CanManage, OpenPlant); }
                if (context.Kind == "report" && int.TryParse(context.Entity, out var days)) window = new ReportWindow(_api, context.Organisation, days);
                if (context.Kind == "import" && _snapshot.Workspace.Role != "viewer") window = new ImportWindow(_api, _store, context.Organisation);
                if (window is null) continue; TrackWindow(window); var area = Microsoft.UI.Windowing.DisplayArea.GetFromWindowId(window.AppWindow.Id, Microsoft.UI.Windowing.DisplayAreaFallback.Nearest).WorkArea; var w = Math.Clamp(context.Width, 640, area.Width); var h = Math.Clamp(context.Height, 480, area.Height); window.AppWindow.Resize(new global::Windows.Graphics.SizeInt32(w, h)); window.AppWindow.Move(new global::Windows.Graphics.PointInt32(Math.Clamp(context.X, area.X, area.X + area.Width - w), Math.Clamp(context.Y, area.Y, area.Y + area.Height - h))); TrackContext(window, context.Kind, context.Entity, context.Organisation);
            }
            catch (Exception ex) { _telemetry.Record("window.restore.failed", new { type = ex.GetType().Name, kind = context.Kind }); }
        }
    }
    private async Task PrepareShutdown() { if (_shuttingDown) return; _shuttingDown = true; await PersistWindows(); foreach (var window in _windowContexts.Keys.ToList()) window.Close(); }
}
