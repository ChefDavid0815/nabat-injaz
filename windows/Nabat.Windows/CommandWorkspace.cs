using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Nabat.Core;
using System.Text.Json;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private record CommandItem(string Name, Func<Task> Execute);
    private async Task CommandPalette()
    {
        if (_snapshot is null) return;
        var search = new TextBox { PlaceholderText = "Plant name, code, move plant, print tag…", MinWidth = Math.Min(440, Math.Max(240, Root.ActualWidth - 100)) };
        var list = new ListView { MaxHeight = 420, DisplayMemberPath = "Name", SelectionMode = ListViewSelectionMode.Single }; var prompt = NativeUi.Caption("Navigate, search the full fleet, or run an operation."); var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) }; int generation = 0;
        async Task Search()
        {
            var version = ++generation; var query = search.Text.Trim(); var lower = query.ToLowerInvariant(); var items = new List<CommandItem>();
            foreach (var section in new[] { "Home", "Today", "Plants", "Locations", "Alerts", "Analytics", "Tags", "Team", "Settings" }) { var target = section; if (target.Contains(query, StringComparison.OrdinalIgnoreCase)) items.Add(new(target, () => { Navigate(target); return Task.CompletedTask; })); }
            if ("critical plants".Contains(lower)) items.Add(new("Critical plants", () => { _fleetState = "critical"; Navigate("Plants"); return Task.CompletedTask; }));
            if ("care overdue".Contains(lower)) items.Add(new("Care overdue", () => { _fleetOverdue = true; Navigate("Plants"); return Task.CompletedTask; }));
            if ("new plant".Contains(lower) && CanManage) items.Add(new("New plant", NewPlant));
            if ("print tag".Contains(lower) && CanManage) items.Add(new("Print tag", () => { Navigate("Tags"); return Task.CompletedTask; }));
            if ("import photos".Contains(lower)) items.Add(new("Import photos", () => { OpenImport(); return Task.CompletedTask; }));
            if ("start maintenance".Contains(lower)) items.Add(new("Start maintenance", StartMaintenanceAsync));
            var moving = lower.StartsWith("move "); var printing = lower.StartsWith("print tag "); var text = moving ? query[5..] : printing ? query[10..] : query;
            if (text.Length > 0) { try { using var data = JsonDocument.Parse(await _api!.GetAsync($"{_org}/fleet?search={Uri.EscapeDataString(text)}&limit=8")); var plants = Contracts.Read<FleetPage>(data.RootElement).Items; foreach (var plant in plants) { var p = plant; items.Add(new((moving ? "Move " : printing ? "Print tag for " : "Open ") + p.Name + " · " + p.Code, async () => { if (moving) await MovePlant(p); else if (printing) { _tagPlant = p.Id; Navigate("Tags"); } else OpenPlant(p); })); } } catch (Exception ex) when (ex is HttpRequestException or ApiException) { prompt.Text = "Search is using the cached fleet."; foreach (var p in _snapshot.Plants.Where(p => $"{p.Name} {p.Code}".Contains(text, StringComparison.OrdinalIgnoreCase)).Take(8)) items.Add(new(p.Name + " · " + p.Code, () => { OpenPlant(p); return Task.CompletedTask; })); } }
            if (version != generation) return; list.ItemsSource = items; list.SelectedIndex = items.Count > 0 ? 0 : -1;
        }
        timer.Tick += async (_, _) => { timer.Stop(); await Search(); }; search.TextChanged += (_, _) => { timer.Stop(); timer.Start(); }; await Search();
        var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Search or command", Content = NativeUi.Stack(search, prompt, list), PrimaryButtonText = "Run", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary };
        var result = await dialog.ShowAsync(); timer.Stop(); generation++; if (result == ContentDialogResult.Primary && list.SelectedItem is CommandItem command) await command.Execute();
    }
    private async Task MovePlant(PlantSummary plant) { if (!CanManage) { Message("Your role cannot move plants."); return; } var location = new ComboBox { Header = "Destination", ItemsSource = _snapshot!.Locations, DisplayMemberPath = "Name", SelectedIndex = 0, MinWidth = 300 }; var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Move " + plant.Name, Content = NativeUi.Stack(NativeUi.Caption(plant.Code + " · currently " + plant.LocationText), location), PrimaryButtonText = "Move plant", CloseButtonText = "Cancel" }; if (await dialog.ShowAsync() != ContentDialogResult.Primary || location.SelectedItem is not Location target) return; try { await _api!.PostAsync($"{_org}/bulk", new { action = "move", targetId = target.Id, plants = new[] { new { id = plant.Id, revision = plant.OperationsRevision } }, idempotencyKey = Guid.NewGuid().ToString() }); await RefreshAsync(); } catch (Exception ex) { Message(ex.Message, true); } }
}
