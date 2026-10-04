using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using Nabat.Core;
using System.Text.Json;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private void TrackWindow(Window window) { if (window is FloorPlanWindow map) TrackContext(window, "map", map.LocationId); if (window is ReportWindow report) TrackContext(window, "report", report.Days.ToString()); if (window is ImportWindow) TrackContext(window, "import", ""); App.Windows.Add(window); window.Closed += (_, _) => App.Windows.Remove(window); window.Activate(); }
    private void OpenMap(Location location) { var window = new FloorPlanWindow(_api!, _org, location, CanManage, OpenPlant); TrackContext(window, "map", location.Id); TrackWindow(window); }
    private void OpenReport(int days) { var window = new ReportWindow(_api!, _org, days); TrackContext(window, "report", days.ToString()); TrackWindow(window); }
    private void OpenImport() { if (_api is null || _snapshot?.Workspace.Role == "viewer") { Message("Your role cannot import observations."); return; } TrackWindow(new ImportWindow(_api, _store, _org)); }
    private async void ShowLocations()
    {
        SetView(NativeUi.Text("Loading location operations…"));
        try
        {
            using var data = JsonDocument.Parse(await _api!.GetAsync($"{_org}/locations")); var content = NativeUi.Stack(); var create = NativeUi.Button("New location", async (_, _) => { var name = new TextBox { Header = "Location name", MinWidth = 300 }; var parent = new ComboBox { Header = "Parent location (optional)", ItemsSource = _snapshot!.Locations, DisplayMemberPath = "Name", MinWidth = 300 }; var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Create location", Content = NativeUi.Stack(name, parent), PrimaryButtonText = "Create location", CloseButtonText = "Cancel" }; if (await dialog.ShowAsync() != ContentDialogResult.Primary) return; try { await _api.PostAsync($"{_org}/locations", new { name = name.Text, parentId = (parent.SelectedItem as Location)?.Id }); await RefreshAsync(); } catch (Exception ex) { Message(ex.Message, true); } }); create.IsEnabled = CanManage; content.Children.Add(create);
            foreach (var record in data.RootElement.EnumerateArray())
            {
                var row = record.Clone(); var location = _snapshot!.Locations.First(l => l.Id == row.GetProperty("id").GetString()); var commands = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; commands.Children.Add(NativeUi.Button("Open floor plan", (_, _) => TrackWindow(new FloorPlanWindow(_api, _org, location, CanManage, OpenPlant)))); commands.Children.Add(NativeUi.Button("Explore plants", (_, _) => { _fleetLocation = location.Id; Navigate("Plants"); })); var edit = NativeUi.Button("Location settings", async (_, _) => await EditLocation(row)); edit.IsEnabled = CanManage; commands.Children.Add(edit);
                content.Children.Add(NativeUi.Panel(NativeUi.Stack(NativeUi.Text(location.Name, 24, true), NativeUi.Caption($"{row.GetProperty("kind")} · {NativeUi.Metric(row, "plant_count")} plants · {NativeUi.Metric(row, "average_health")} average health · {NativeUi.Metric(row, "open_alerts")} open alerts"), NativeUi.Caption("Default caretaker: " + (row.GetProperty("default_caretaker_name").GetString() ?? "Unassigned")), commands)));
            }
            if (!data.RootElement.EnumerateArray().Any()) content.Children.Add(NativeUi.Caption("Create a location in NABAT Web to begin organising the fleet.")); SetView(new ScrollViewer { Content = content });
        }
        catch (Exception ex) { Message(ex.Message, true); SetView(NativeUi.Caption("Location operations could not be loaded. Use Refresh to retry.")); }
    }
    private async Task EditLocation(JsonElement row)
    {
        var name = new TextBox { Header = "Location name", Text = row.GetProperty("name").GetString() }; var kinds = new ComboBox { Header = "Hierarchy level", ItemsSource = new[] { "site", "building", "floor", "zone", "room", "area" }, SelectedItem = row.GetProperty("kind").GetString(), MinWidth = 340 };
        var members = new ComboBox { Header = "Default caretaker", ItemsSource = _snapshot!.Team.Where(m => m.Role != "viewer").ToList(), DisplayMemberPath = "Name", MinWidth = 340 }; members.SelectedItem = _snapshot.Team.FirstOrDefault(m => m.UserId == row.GetProperty("default_caretaker_id").GetString()); var critical = new ToggleSwitch { Header = "Critical operational area", IsOn = row.GetProperty("critical").GetBoolean() };
        var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Location operations", Content = NativeUi.Stack(name, kinds, members, critical), PrimaryButtonText = "Save location", CloseButtonText = "Cancel" };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        try { await _api!.PostAsync($"{_org}/locations/{row.GetProperty("id")}", new { name = name.Text, kind = kinds.SelectedItem?.ToString() ?? "area", defaultCaretakerId = (members.SelectedItem as Member)?.UserId, critical = critical.IsOn, parentId = row.GetProperty("parent_id").GetString(), idempotencyKey = Guid.NewGuid().ToString() }); ShowLocations(); } catch (Exception ex) { Message(ex.Message, true); }
    }
    private string? _todayAssignee;
    private async void ShowTeam()
    {
        var content = NativeUi.Stack(NativeUi.Text("Care has an owner", 26, true));
        var add = NativeUi.Button("Add teammate", async (_, _) => await AddTeammate()); add.IsEnabled = _snapshot!.Workspace.Role is "owner" or "admin"; content.Children.Add(add);
        SetView(new ScrollViewer { Content = content });
        try
        {
            using var data = JsonDocument.Parse(await _api!.GetAsync($"{_org}/team/operations"));
            foreach (var record in data.RootElement.EnumerateArray())
            {
                var row = record.Clone(); var member = _snapshot.Team.First(m => m.UserId == row.GetProperty("user_id").GetString());
                content.Children.Add(NativeUi.Panel(NativeUi.Stack(NativeUi.Text(member.Name, 22, true),
                    NativeUi.Caption($"{member.Role} · {NativeUi.Metric(row, "assigned_plants")} assigned plants · {NativeUi.Metric(row, "remaining_tasks")} tasks remaining · {NativeUi.Metric(row, "completed_today")} completed today"),
                    NativeUi.Caption($"{NativeUi.Metric(row, "care_last_30_days")} recorded care actions in 30 days"),
                    NativeUi.Button("Assigned plants", (_, _) => { _fleetAssignee = member.UserId; Navigate("Plants"); }),
                    NativeUi.Button("View work", (_, _) => { _todayAssignee = member.UserId; Navigate("Today"); }))));
            }
        }
        catch (Exception ex) { Message(ex.Message, true); }
    }
    private async Task AddTeammate()
    {
        var email = new TextBox { Header = "Email", MinWidth = 340 }; var id = new TextBox { Header = "Confirmed NABAT account ID", MinWidth = 340 }; var role = new ComboBox { Header = "Role", ItemsSource = new[] { "caretaker", "manager", "admin", "viewer" }, SelectedIndex = 0, MinWidth = 340 };
        var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Add teammate", Content = NativeUi.Stack(NativeUi.Caption("Confirm the account ID through your usual contact channel. Access begins immediately."), email, id, role), PrimaryButtonText = "Grant workspace access", CloseButtonText = "Cancel" };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return; try { await _api!.PostAsync($"{_org}/team", new { email = email.Text, userId = id.Text, role = role.SelectedItem.ToString() }); await RefreshAsync(); } catch (Exception ex) { Message(ex.Message, true); }
    }
    private async void ShowAnalytics()
    {
        var range = new ComboBox { ItemsSource = new[] { "7 days", "30 days", "90 days", "365 days" }, SelectedIndex = 1, MinWidth = 130 }; var locations = new ComboBox { ItemsSource = new[] { new Location("", "All locations", null) }.Concat(_snapshot!.Locations).ToList(), DisplayMemberPath = "Name", SelectedIndex = 0, MinWidth = 180 };
        var body = NativeUi.Stack(); var tools = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; tools.Children.Add(range); tools.Children.Add(locations); tools.Children.Add(NativeUi.Button("Open report", (_, _) => TrackWindow(new ReportWindow(_api!, _org, int.Parse(range.SelectedItem.ToString()!.Split(' ')[0]))))); var layout = NativeUi.Stack(tools, body); SetView(new ScrollViewer { Content = layout });
        int generation = 0; async Task Load()
        {
            var version = ++generation;
            try
            {
                var days = int.Parse(range.SelectedItem.ToString()!.Split(' ')[0]); var location = ((Location)locations.SelectedItem).Id; using var doc = JsonDocument.Parse(await _api!.GetAsync($"{_org}/analytics?days={days}" + (location.Length > 0 ? "&location=" + location : ""))); if (version != generation) return; var data = doc.RootElement; body.Children.Clear(); var overview = data.GetProperty("overview"); var operations = data.GetProperty("operations"); var task = data.GetProperty("tasks");
                body.Children.Add(NativeUi.Panel(NativeUi.Stack(NativeUi.Text("Organisation overview", 26, true), NativeUi.Text("Average health " + NativeUi.Metric(overview, "average_health"), 30), NativeUi.Caption($"{NativeUi.Metric(overview, "total")} plants · {NativeUi.Metric(overview, "critical")} critical · {NativeUi.Metric(overview, "rapid_decline")} rapid declines"), NativeUi.Caption($"{NativeUi.Metric(task, "completed")} / {NativeUi.Metric(task, "scheduled")} scheduled tasks complete · Alert resolution {data.GetProperty("alertResolutionHours")} hours"))));
                var points = data.GetProperty("trend").EnumerateArray().Select(p => p.Clone()).ToList(); var canvas = new Canvas { Height = 180, MinWidth = 300 }; void Draw() { canvas.Children.Clear(); if (points.Count == 0) return; var width = Math.Max(300, canvas.ActualWidth); var line = new Polyline { Stroke = NativeUi.Green, StrokeThickness = 2 }; var start = points[0].GetProperty("period").GetDateTimeOffset(); var end = points[^1].GetProperty("period").GetDateTimeOffset(); for (var i = 0; i < points.Count; i++) { var at = points[i].GetProperty("period").GetDateTimeOffset(); if (i > 0 && (at - points[i - 1].GetProperty("period").GetDateTimeOffset()).TotalDays > 1.5) { canvas.Children.Add(line); line = new Polyline { Stroke = NativeUi.Green, StrokeThickness = 2 }; } line.Points.Add(new global::Windows.Foundation.Point(TimelineMath.X(at, start, end, width), 160 - (NativeUi.Number(points[i], "score") ?? 0) * 1.4)); } canvas.Children.Add(line); }
                canvas.SizeChanged += (_, _) => Draw(); body.Children.Add(NativeUi.Panel(NativeUi.Stack(NativeUi.Text("Health trend", 24, true), canvas, NativeUi.Caption("Scale 0–100 · latest saved score per observed plant per day"), new Expander { Header = "Trend data", Content = new ListView { ItemsSource = points.Select(p => $"{p.GetProperty("period")} · {p.GetProperty("score")} · {p.GetProperty("plants")} plants").ToList() } })));
                var performance = NativeUi.Stack(NativeUi.Text("Location performance", 24, true)); foreach (var row in data.GetProperty("locations").EnumerateArray()) { var captured = row.Clone(); performance.Children.Add(NativeUi.Button($"{captured.GetProperty("name")} · {captured.GetProperty("plants")} plants · Health {captured.GetProperty("average_health")}", (_, _) => { _fleetLocation = captured.GetProperty("id").GetString(); Navigate("Plants"); })); }
                body.Children.Add(NativeUi.Panel(performance));
                var species = NativeUi.Stack(NativeUi.Text("Species performance", 24, true)); foreach (var row in data.GetProperty("species").EnumerateArray()) species.Children.Add(NativeUi.Text($"{row.GetProperty("name")} · {row.GetProperty("plants")} plants · Health {row.GetProperty("average_health")}")); body.Children.Add(NativeUi.Panel(species));
                body.Children.Add(NativeUi.Panel(NativeUi.Stack(NativeUi.Text("Operations", 24, true), NativeUi.Text($"{NativeUi.Metric(operations, "sessions")} sessions · {NativeUi.Metric(operations, "visited")} plants visited · {NativeUi.Metric(operations, "minutes")} recorded minutes"), NativeUi.Caption(data.GetProperty("survivalRate").GetProperty("reason").GetString()!), NativeUi.Caption("Lifecycle outcome rates are not inferred from health scores."))));
            }
            catch (Exception ex) { Message(ex.Message, true); }
        }
        range.SelectionChanged += async (_, _) => await Load(); locations.SelectionChanged += async (_, _) => await Load(); await Load();
    }
}
