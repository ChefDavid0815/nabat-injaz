using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Nabat.Core;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private void ShowHome()
    {
        var snapshot = _snapshot!; var body = NativeUi.Stack();
        var fleet = new Grid { ColumnSpacing = 20 }; for (var i = 0; i < 5; i++) fleet.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        var metrics = new[] { ("Total plants", "total"), ("Healthy", "healthy"), ("Watch", "watch"), ("Attention", "attention"), ("Critical", "critical") };
        for (var i = 0; i < metrics.Length; i++) { var stat = NativeUi.Stack(NativeUi.Caption(metrics[i].Item1), NativeUi.Text(NativeUi.Metric(snapshot.Metrics, metrics[i].Item2), 28)); stat.Spacing = 6; Grid.SetColumn(stat, i); fleet.Children.Add(stat); }
        body.Children.Add(NativeUi.Panel(fleet, new(18, 12, 18, 12)));
        var workspace = new Grid { ColumnSpacing = 16 }; workspace.ColumnDefinitions.Add(new() { Width = new(3, GridUnitType.Star) }); workspace.ColumnDefinitions.Add(new() { Width = new(1.75, GridUnitType.Star), MinWidth = 280 });
        var rows = snapshot.Plants.Take(5).Select(p => new PriorityRow(p, _api!.BaseUri, OpenPlant)).ToList();
        var list = new ListView { SelectionMode = ListViewSelectionMode.None, ItemsSource = rows, ItemTemplate = (DataTemplate)Microsoft.UI.Xaml.Markup.XamlReader.Load("""
            <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
            <Grid Padding="0,8" ColumnSpacing="12"><Grid.ColumnDefinitions><ColumnDefinition Width="2.2*"/><ColumnDefinition Width="1*"/><ColumnDefinition Width="0.65*"/><ColumnDefinition Width="1.65*"/><ColumnDefinition Width="70"/></Grid.ColumnDefinitions>
            <Grid ColumnSpacing="12"><Grid.ColumnDefinitions><ColumnDefinition Width="44"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions><Image Source="{Binding ImageUri}" Width="44" Height="48" Stretch="UniformToFill"/><StackPanel Grid.Column="1" VerticalAlignment="Center" Spacing="4"><TextBlock Text="{Binding Name}" ToolTipService.ToolTip="{Binding Name}" FontSize="14" FontWeight="SemiBold" Foreground="{ThemeResource NabatTextBrush}" TextTrimming="CharacterEllipsis"/><TextBlock Text="{Binding Code}" FontSize="12" Foreground="{ThemeResource NabatMutedBrush}"/></StackPanel></Grid>
            <TextBlock Grid.Column="1" Text="{Binding Location}" FontSize="13" TextWrapping="Wrap" Foreground="{ThemeResource NabatTextBrush}" VerticalAlignment="Center"/>
            <StackPanel Grid.Column="2" VerticalAlignment="Center" Spacing="4"><TextBlock Text="{Binding Score}" FontSize="18" FontWeight="SemiBold" Foreground="{ThemeResource NabatTextBrush}"/><TextBlock Text="{Binding Trend}" FontSize="12" Foreground="#915010"/></StackPanel>
            <TextBlock Grid.Column="3" Text="{Binding WhyNow}" FontSize="13" TextWrapping="Wrap" MaxLines="3" Foreground="{ThemeResource NabatTextBrush}" VerticalAlignment="Center"/>
            <Button Grid.Column="4" Content="Inspect" Command="{Binding OpenCommand}" VerticalAlignment="Center" Padding="8,6"/>
            </Grid></DataTemplate>
            """) };
        var header = new Grid { ColumnSpacing = 12, Padding = new(12, 0, 12, 0) }; foreach (var width in new[] { 2.2, 1, .65, 1.65 }) header.ColumnDefinitions.Add(new() { Width = new(width, GridUnitType.Star) }); header.ColumnDefinitions.Add(new() { Width = new(70) }); var labels = new[] { "Plant", "Location", "Health", "Why now", "Action" }; for (var i = 0; i < labels.Length; i++) { var label = NativeUi.Caption(labels[i]); Grid.SetColumn(label, i); header.Children.Add(label); }
        var left = NativeUi.Stack(NativeUi.Text("Priority queue", 25, true), NativeUi.Caption("Care that needs a decision today."), header, list);
        var done = snapshot.Tasks.Count(t => t.Status == "completed"); var remaining = snapshot.Tasks.Count(t => t.Status is "pending" or "in_progress");
        var tasks = NativeUi.Stack(); foreach (var task in snapshot.Tasks.Where(t => t.Status != "completed").Take(5)) { var row = new Grid { ColumnSpacing = 12, Padding = new(0, 8, 0, 8) }; row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); var title = NativeUi.Caption(task.Title); title.MaxLines = 2; row.Children.Add(NativeUi.Stack(NativeUi.Text(task.PlantName, 14), title)); var p = snapshot.Plants.FirstOrDefault(p => p.Id == task.PlantId); if (p is not null) { var plant = p; var button = NativeUi.Button("Open", (_, _) => OpenPlant(plant)); Grid.SetColumn(button, 1); row.Children.Add(button); } tasks.Children.Add(row); }
        var right = NativeUi.Stack(NativeUi.Text("Today's care", 25, true), NativeUi.Text($"{done} / {done + remaining} complete", 20), new ProgressBar { Minimum = 0, Maximum = Math.Max(1, done + remaining), Value = done, Height = 8 }, NativeUi.Caption($"{remaining} remaining · {snapshot.Tasks.Count(t => (t.Status is "pending" or "in_progress") && t.AssigneeId is null)} unassigned"), NativeUi.Button("Open Today", (_, _) => Navigate("Today")), tasks);
        workspace.Children.Add(NativeUi.Panel(left)); var rightPanel = NativeUi.Panel(right); Grid.SetColumn(rightPanel, 1); workspace.Children.Add(rightPanel);
        workspace.SizeChanged += (_, _) => { var first = (FrameworkElement)workspace.Children[0]; if (workspace.ActualWidth < 1020) { if (workspace.RowDefinitions.Count == 0) { workspace.RowDefinitions.Add(new() { Height = GridLength.Auto }); workspace.RowDefinitions.Add(new() { Height = GridLength.Auto }); workspace.RowSpacing = 16; } Grid.SetColumnSpan(first, 2); Grid.SetColumn(rightPanel, 0); Grid.SetColumnSpan(rightPanel, 2); Grid.SetRow(rightPanel, 1); } else { workspace.RowDefinitions.Clear(); Grid.SetColumnSpan(first, 1); Grid.SetColumn(rightPanel, 1); Grid.SetColumnSpan(rightPanel, 1); Grid.SetRow(rightPanel, 0); } }; body.Children.Add(workspace);
        var lower = new Grid { ColumnSpacing = 16 }; lower.ColumnDefinitions.Add(new() { Width = new(1.4, GridUnitType.Star) }); lower.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        var recent = NativeUi.Stack(NativeUi.Text("Recent significant changes", 22, true)); foreach (var item in snapshot.Recent.EnumerateArray().Take(4)) recent.Children.Add(NativeUi.Text($"{NativeUi.Date(item.GetProperty("occurred_at").GetDateTimeOffset(), snapshot.Workspace.Timezone)}    {item.GetProperty("plant_name").GetString()} · {item.GetProperty("type").GetString()}", 13));
        var risk = NativeUi.Stack(NativeUi.Text("Locations at risk", 22, true)); foreach (var location in snapshot.Locations.Where(l => l.CriticalCount + l.AttentionCount > 0).OrderByDescending(l => l.CriticalCount + l.AttentionCount).Take(3)) risk.Children.Add(NativeUi.Button($"{location.Name} · {location.CriticalCount + location.AttentionCount} attention plants", (_, _) => { _fleetLocation = location.Id; Navigate("Plants"); }));
        lower.Children.Add(NativeUi.Panel(recent)); var riskPanel = NativeUi.Panel(risk); Grid.SetColumn(riskPanel, 1); lower.Children.Add(riskPanel); body.Children.Add(lower); SetView(new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
    }
}
