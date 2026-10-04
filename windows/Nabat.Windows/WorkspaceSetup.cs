using Microsoft.UI.Xaml.Controls;
using Nabat.Core;
using System.Text.Json;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private async Task EnsureWorkspace()
    {
        if (_api?.Session is null) return;
        if (_api.Session.Workspaces.Count == 0) { var name = new TextBox { Header = "Organisation name", MinWidth = 320 }; var dialog = new ContentDialog { XamlRoot = Root.XamlRoot, Title = "Create your operations workspace", Content = NativeUi.Stack(NativeUi.Caption("Plants, care and team activity share the same NABAT identity."), name), PrimaryButtonText = "Create workspace", CloseButtonText = "Cancel" }; if (await dialog.ShowAsync() != ContentDialogResult.Primary) throw new InvalidOperationException("A workspace is required to begin operations."); await _api.PostAsync("workspaces", new { name = name.Text, kind = "business" }); using var identity = JsonDocument.Parse(await _api.GetAsync("session")); var workspaces = identity.RootElement.GetProperty("workspaces").Deserialize<List<Workspace>>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!; _api.Session = _api.Session with { Workspaces = workspaces }; }
        _org = _api.Session.Workspaces[0].Id; _vault.Save(_api.BaseUri.ToString(), _api.Session);
    }
}
