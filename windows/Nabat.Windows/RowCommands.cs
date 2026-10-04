using System.Windows.Input;
using Nabat.Core;
namespace Nabat.Windows;

public sealed class RowCommand(Action action) : ICommand
{
    public event EventHandler? CanExecuteChanged { add { } remove { } }
    public bool CanExecute(object? parameter) => true;
    public void Execute(object? parameter) => action();
}
public sealed record PriorityRow(PlantSummary Plant, Uri BaseUri, Action<PlantSummary> Open)
{
    public string Name => Plant.Name; public string Code => Plant.Code; public string Location => Plant.LocationText;
    public string Score => Plant.ScoreText; public string Trend => Plant.TrendText; public string WhyNow => Plant.WhyNow;
    public string? ImageUri => NativeUi.ImageUri(Plant.Image, BaseUri)?.ToString();
    public ICommand OpenCommand => new RowCommand(() => Open(Plant));
}
