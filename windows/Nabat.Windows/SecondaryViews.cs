using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Nabat.Core;
using System.Text;
using System.Text.Json;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private void ShowAlerts()
    {
        var content = NativeUi.Stack(); var active = _snapshot!.Alerts.EnumerateArray().Where(a => a.GetProperty("status").GetString() != "resolved").ToList();
        if (active.Count == 0) { content.Children.Add(NativeUi.Text("All clear.", 32, true)); content.Children.Add(NativeUi.Caption("Plant fleet is stable. Last checked " + _snapshot.ServerTime.ToLocalTime().ToString("HH:mm"))); }
        foreach (var alert in active) { var item = alert.Clone(); content.Children.Add(NativeUi.Panel(NativeUi.Stack(NativeUi.Text($"{item.GetProperty("plant_name").GetString()} · {item.GetProperty("severity").GetString()}", 20, true), NativeUi.Text(item.GetProperty("reason").GetString()!), NativeUi.Caption($"{item.GetProperty("status").GetString()} · {item.GetProperty("recommended_action").GetString()}"), NativeUi.Button("Update alert", async (_, _) => await AlertDialog(item))))); }
        SetView(new ScrollViewer { Content = content });
    }
    private async Task AlertDialog(JsonElement alert)
    {
        var status = new ComboBox { ItemsSource = new[] { "acknowledged", "assigned", "in_progress", "resolved", "reopened" }, SelectedIndex = 0, Header = "Next status", MinWidth = 320 };
        var assignee = new ComboBox { ItemsSource = _snapshot!.Team, DisplayMemberPath = "Name", Header = "Assignee (for assignment)", MinWidth = 320 }; var note = new TextBox { Header = "Resolution note", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MaxLength = 2000 };
        var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = alert.GetProperty("plant_name").GetString(), Content = NativeUi.Stack(status, assignee, note), PrimaryButtonText = "Save alert", CloseButtonText = "Cancel" };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        try { await _api!.PostAsync($"{_org}/alerts/{alert.GetProperty("id").GetString()}", new { status = status.SelectedItem.ToString(), assigneeId = (assignee.SelectedItem as Member)?.UserId, revision = alert.GetProperty("revision").GetInt32(), resolutionNote = note.Text, idempotencyKey = Guid.NewGuid().ToString() }); await RefreshAsync(); } catch (Exception ex) { Message(ex.Message, true); }
    }
    private record Choice(string Id, string Name);
    private async Task NewPlant()
    {
        if (_snapshot is null) return;
        if (!CanManage) { Message("Only a workspace manager can create plant identities."); return; }
        var name = new TextBox { Header = "Plant name", MaxLength = 120, MinWidth = 340 };
        var species = new ComboBox { Header = "Species", ItemsSource = _snapshot.Species.EnumerateArray().Select(s => new Choice(s.GetProperty("id").GetString()!, s.GetProperty("common_name").GetString()!)).ToList(), DisplayMemberPath = "Name", SelectedIndex = 0, MinWidth = 340 };
        var location = new ComboBox { Header = "Location", ItemsSource = _snapshot.Locations, DisplayMemberPath = "Name", MinWidth = 340 };
        var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Create a plant identity", Content = NativeUi.Stack(name, species, location), PrimaryButtonText = "Create plant", CloseButtonText = "Cancel" };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary || species.SelectedItem is not Choice chosen) return;
        try { await _api!.PostAsync($"{_org}/plants", new { name = name.Text, speciesId = chosen.Id, locationId = (location.SelectedItem as Location)?.Id }); _section = "Plants"; await RefreshAsync(); Message("Plant identity created with a stable tag resolver."); } catch (Exception ex) { Message(ex.Message, true); }
    }
    private TagPrinting? _printing;
}
