using CommunityToolkit.WinUI.UI.Controls;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Nabat.Core;
using System.Text.Json;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private async Task BulkDialog(DataGrid grid, string action)
    {
        var selected = grid.SelectedItems.OfType<PlantSummary>().ToList(); if (selected.Count is 0 or > 100) { Message("Select 1–100 plants for one batch."); return; }
        var target = new ComboBox { MinWidth = 300, DisplayMemberPath = "Name", ItemsSource = action == "assign" ? (object)_snapshot!.Team.Where(m => m.Role != "viewer").ToList() : _snapshot!.Locations, SelectedIndex = 0 };
        var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = $"Review bulk {action}", Content = NativeUi.Stack(NativeUi.Text($"{selected.Count} plants selected", 20, true), NativeUi.Caption(string.Join(", ", selected.Select(p => p.Code))), target, NativeUi.Caption("The server checks every revision and applies the entire batch atomically.")), PrimaryButtonText = $"Apply {action}", CloseButtonText = "Cancel" };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var targetId = target.SelectedItem switch { Member member => member.UserId, Location location => location.Id, _ => "" };
        try { await _api!.PostAsync($"{_org}/bulk", new { action, targetId, plants = selected.Select(p => new { id = p.Id, revision = p.OperationsRevision }), idempotencyKey = Guid.NewGuid().ToString() }); await RefreshAsync(); Message($"{selected.Count} plants updated."); } catch (Exception ex) { Message(ex.Message, true); }
    }
    private static void Copy(string value) { var package = new global::Windows.ApplicationModel.DataTransfer.DataPackage(); package.SetText(value); global::Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(package); }
    private async Task ExportCsv(List<PlantSummary> rows) { var picker = new global::Windows.Storage.Pickers.FileSavePicker(); WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this)); picker.SuggestedFileName = "NABAT-plants"; picker.FileTypeChoices.Add("CSV", new[] { ".csv" }); var file = await picker.PickSaveFileAsync(); if (file is null) return; static string Cell(string value) => "\"" + (value.Length > 0 && "=+-@".Contains(value[0]) ? "'" : "") + value.Replace("\"", "\"\"") + "\""; await global::Windows.Storage.FileIO.WriteTextAsync(file, "Plant,Code,Location,Health,State,Caretaker\r\n" + string.Join("\r\n", rows.Select(p => string.Join(",", new[] { p.Name, p.Code, p.LocationText, p.ScoreText, p.HealthState, p.CaretakerText }.Select(Cell))))); Message("CSV saved."); }
}
