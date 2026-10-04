using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Nabat.Core;
using System.Text.Json;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private DataTemplate PlantRowTemplate() => (DataTemplate)Microsoft.UI.Xaml.Markup.XamlReader.Load("""
        <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><Grid Padding="2,14" ColumnSpacing="14"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="72"/></Grid.ColumnDefinitions>
        <StackPanel Spacing="4"><TextBlock Text="{Binding Name}" FontSize="17" Foreground="{ThemeResource NabatTextBrush}"/><TextBlock Text="{Binding Code}" FontSize="12" Foreground="{ThemeResource NabatMutedBrush}"/><TextBlock Text="{Binding LocationText}" FontSize="13" Foreground="{ThemeResource NabatMutedBrush}"/><TextBlock Text="{Binding WhyNow}" FontSize="13" TextWrapping="Wrap" Foreground="{ThemeResource NabatTextBrush}"/></StackPanel>
        <StackPanel Grid.Column="1" Spacing="4" HorizontalAlignment="Right"><TextBlock Text="{Binding ScoreText}" FontSize="24" Foreground="{ThemeResource NabatTextBrush}"/><TextBlock Text="{Binding TrendText}" FontSize="13" Foreground="#915010"/></StackPanel></Grid></DataTemplate>
        """);
    private void ShowToday()
    {
        var all = _snapshot!.Tasks; var filter = new ComboBox { ItemsSource = new[] { "All work", "My work", "Unassigned", "Completed" }, SelectedIndex = _todayAssignee is null ? 0 : 1, MinWidth = 160 };
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single, ItemTemplate = (DataTemplate)Microsoft.UI.Xaml.Markup.XamlReader.Load("""
            <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><StackPanel Padding="8,14" Spacing="6"><TextBlock Text="{Binding Title}" FontSize="17" Foreground="{ThemeResource NabatTextBrush}"/><TextBlock Text="{Binding PlantName}" FontSize="14" Foreground="{ThemeResource NabatTextBrush}"/><TextBlock Text="{Binding Detail}" FontSize="13" Foreground="{ThemeResource NabatMutedBrush}"/><TextBlock Text="{Binding Status}" Foreground="#3D641D"/></StackPanel></DataTemplate>
            """) };
        void Apply() { list.ItemsSource = all.Where(t => filter.SelectedIndex switch { 1 => t.AssigneeId == (_todayAssignee ?? _api!.Session!.Actor.Id) && t.Status != "completed", 2 => t.AssigneeId is null && t.Status != "completed", 3 => t.Status == "completed", _ => true }).ToList(); }
        Apply(); filter.SelectionChanged += (_, _) => Apply();
        var toolbar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; toolbar.Children.Add(filter);
        toolbar.Children.Add(NativeUi.Button("Open plant", (_, _) => { if (list.SelectedItem is OperationTask t) { var plant = _snapshot.Plants.FirstOrDefault(p => p.Id == t.PlantId); if (plant is not null) OpenPlant(plant); } }));
        toolbar.Children.Add(NativeUi.Button("Log matching care", async (_, _) => { if (list.SelectedItem is not OperationTask task) { Message("Choose a task first."); return; } if (task.Kind is not ("watered" or "fertilised" or "inspected")) { Message("Open the plant and save the requested observation or care evidence."); return; } try { await _sync!.QueueCareAsync(_org, new(task.PlantId, task.Kind, Guid.NewGuid().ToString(), DateTimeOffset.UtcNow.ToString("O"), TaskId: task.Id, SessionId: _sessionPlants.Contains(task.PlantId) ? _sessionId : null)); Message("Care saved on this device."); await _sync.SyncAsync(_org); await RefreshAsync(); } catch (Exception ex) { Message(ex.Message, true); } }));
        toolbar.Children.Add(NativeUi.Button("Refresh", async (_, _) => await RefreshAsync()));
        var sessions = NativeUi.Stack(NativeUi.Text("Maintenance sessions", 22, true));
        foreach (var session in _snapshot.Sessions.Take(6))
        {
            sessions.Children.Add(NativeUi.Text(session.Display));
            if (session.Status == "active" && session.OwnerId == _api!.Session!.Actor.Id) sessions.Children.Add(NativeUi.Button("Resume / finish session", async (_, _) => await ResumeSession(session)));
        }
        if (!all.Any()) list.Header = NativeUi.Text("All clear. No work is currently scheduled.", 20, true);
        var grid = new Grid { RowSpacing = 16 }; grid.RowDefinitions.Add(new() { Height = GridLength.Auto }); grid.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) }); grid.Children.Add(toolbar);
        var panes = new Grid { ColumnSpacing = 16 }; panes.ColumnDefinitions.Add(new() { Width = new(3, GridUnitType.Star) }); panes.ColumnDefinitions.Add(new() { Width = new(2, GridUnitType.Star) }); panes.Children.Add(NativeUi.Panel(list)); var panel = NativeUi.Panel(new ScrollViewer { Content = sessions }); Grid.SetColumn(panel, 1); panes.Children.Add(panel); Grid.SetRow(panes, 1); grid.Children.Add(panes); SetView(grid);
    }
    private async Task StartMaintenanceAsync()
    {
        if (_snapshot is null || _snapshot.Workspace.Role == "viewer") return; if (_sync!.WorkingOffline) { Message("Connect to start a session. Existing sessions and care remain available offline."); return; }
        var locations = new ComboBox { Header = "Location", ItemsSource = _snapshot.Locations, DisplayMemberPath = "Name", SelectedIndex = 0, MinWidth = 300 };
        var owner = new ComboBox { Header = "Session owner", ItemsSource = _snapshot.Team.Where(m => m.Role != "viewer").ToList(), DisplayMemberPath = "Name", SelectedItem = _snapshot.Team.FirstOrDefault(m => m.UserId == _api!.Session!.Actor.Id), MinWidth = 300, IsEnabled = CanManage };
        var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Start maintenance session", Content = NativeUi.Stack(NativeUi.Caption("The session records your visits and care. Choose the location you are working in."), locations, owner), PrimaryButtonText = "Start session", CloseButtonText = "Cancel" };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary || locations.SelectedItem is not Location location) return;
        try { using var result = JsonDocument.Parse(await _api!.PostAsync($"{_org}/sessions", new { locationId = location.Id, ownerId = (owner.SelectedItem as Member)?.UserId, idempotencyKey = Guid.NewGuid().ToString() })); _sessionId = (owner.SelectedItem as Member)?.UserId == _api.Session!.Actor.Id ? result.RootElement.GetProperty("id").GetString() : null; _sessionPlants = result.RootElement.GetProperty("plants").EnumerateArray().Select(v => v.GetString()!).ToHashSet(); await _store.SetPreferenceAsync($"active-session:{_api.Scope(_org)}", _sessionId ?? ""); _section = "Today"; await RefreshAsync(); Message($"Session started · {_sessionPlants.Count} plants assigned."); } catch (Exception ex) { Message(ex.Message, true); }
    }
    private async Task ResumeSession(MaintenanceSession session)
    {
        try
        {
            using var detail = JsonDocument.Parse(await _api!.GetAsync($"{_org}/sessions/{session.Id}")); _sessionId = session.Id; _sessionPlants = detail.RootElement.GetProperty("plants").EnumerateArray().Select(v => v.GetProperty("plant_id").GetString()!).ToHashSet();
            var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Maintenance progress", Content = NativeUi.Stack(NativeUi.Text(session.Display, 20, true), NativeUi.Caption("Pending local care must sync before the session can finish.")), PrimaryButtonText = "Finish session", SecondaryButtonText = "Continue working", CloseButtonText = "Close" };
            if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
            await _sync!.SyncAsync(_org); if ((await _store.OutboxAsync(_api.Scope(_org))).Count > 0) { Message("Sync or review pending care before finishing this session."); return; }
            await _api.PostAsync($"{_org}/sessions/{session.Id}/finish", new { revision = session.Revision, action = "complete", idempotencyKey = Guid.NewGuid().ToString() }); _sessionId = null; _sessionPlants.Clear(); await RefreshAsync();
        }
        catch (Exception ex) { Message(ex.Message, true); }
    }
    private void ShowSettings()
    {
        var offline = new ToggleSwitch { Header = "Work offline", IsOn = _sync!.WorkingOffline, OnContent = "Care stays in the local outbox", OffContent = "Automatic cloud sync" };
        offline.Toggled += async (_, _) => { _sync.WorkingOffline = offline.IsOn; SyncText.Text = offline.IsOn ? "Working offline" : "Connecting"; if (!offline.IsOn) await RefreshAsync(false); };
        var rtl = new ToggleSwitch { Header = "Arabic / right-to-left layout", IsOn = Root.FlowDirection == FlowDirection.RightToLeft }; rtl.Toggled += async (_, _) => { ApplyLocale(rtl.IsOn); await _store.SetPreferenceAsync("rtl", rtl.IsOn.ToString()); };
        var pending = new ListView { DisplayMemberPath = "Display", SelectionMode = ListViewSelectionMode.Single }; _ = PopulatePending(); async Task PopulatePending() { pending.ItemsSource = (await _store.OutboxAsync(_api!.Scope(_org))).Select(p => new PendingRow(p)).ToList(); }
        var panel = NativeUi.Stack(NativeUi.Text("Workspace continuity", 24, true), NativeUi.Caption(_api!.BaseUri.ToString()), offline, rtl, SystemSettings(), NativeUi.Button("Sync now", async (_, _) => { await _sync.SyncAsync(_org); await RefreshAsync(false); await PopulatePending(); }), NativeUi.Text("Pending changes", 20, true), pending, NativeUi.Button("Review selected change", async (_, _) => { if (pending.SelectedItem is PendingRow row) { await ReviewPending(row.Change); await PopulatePending(); } }), NativeUi.Caption("Ctrl+K Commands · Ctrl+N New plant · Ctrl+F Plants · Ctrl+Shift+T Today · Ctrl+Shift+A Alerts · Ctrl+, Settings"), NativeUi.Button("Sign out", async (_, _) => { try { await _api.SendAsync("session", HttpMethod.Delete); } catch (HttpRequestException) { } catch (ApiException) { } catch (TaskCanceledException) { } foreach (var window in App.Windows.Where(w => !ReferenceEquals(w, this)).ToList()) window.Close(); _vault.Clear(); _timer.Stop(); _snapshot = null; if (_tray is not null) { _tray.Critical = 0; _tray.Tasks = 0; _tray.Sync = "Signed out"; _tray.Update(); } _api.Session = null; ShowSignIn(); }));
        SetView(new ScrollViewer { Content = NativeUi.Panel(panel) });
    }
    private record PendingRow(OutboxMutation Change) { public string Display => Change.State + " · " + (Change.Error ?? "Captured care is waiting to sync"); }
    private async Task ReviewPending(OutboxMutation change)
    {
        using var data = JsonDocument.Parse(change.Payload); var care = data.RootElement;
        var content = NativeUi.Stack(NativeUi.Text(care.GetProperty("type").GetString()!, 22, true), NativeUi.Caption(care.GetProperty("occurredAt").GetString()!), NativeUi.Caption(change.Error ?? "The captured record is safe on this device."), NativeUi.Caption("Retry preserves the original time and request identity. Export keeps a copy for review."));
        var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Review pending care", Content = content, PrimaryButtonText = "Retry unchanged", SecondaryButtonText = "Export record", CloseButtonText = "Close" };
        var result = await dialog.ShowAsync();
        if (result == ContentDialogResult.Primary) { await _store.MarkAsync(change.Id, "pending", null, change.Attempts, DateTimeOffset.UtcNow); await _sync!.SyncAsync(_org); }
        if (result == ContentDialogResult.Secondary) { var picker = new global::Windows.Storage.Pickers.FileSavePicker(); WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this)); picker.SuggestedFileName = "NABAT-pending-care"; picker.FileTypeChoices.Add("JSON", new[] { ".json" }); var file = await picker.PickSaveFileAsync(); if (file is not null) await global::Windows.Storage.FileIO.WriteTextAsync(file, JsonSerializer.Serialize(care, new JsonSerializerOptions { WriteIndented = true })); }
    }
}
