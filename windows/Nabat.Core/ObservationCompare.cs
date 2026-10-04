using System.Text.Json;
namespace Nabat.Core;

public record SignalDelta(string Name, string Label, double PercentagePoints, double Confidence, string BeforeEvidence, string AfterEvidence);
public static class ObservationCompare
{
    private static readonly (string Key, string Label)[] Signals = [("yellowing_estimate", "Yellowing"), ("browning_estimate", "Browning"), ("visible_leaf_loss_estimate", "Visible leaf loss"), ("canopy_size_estimate", "Canopy proxy"), ("new_growth_signal", "New growth"), ("wilting_signal", "Wilting")];
    public static List<SignalDelta> Calculate(JsonElement before, JsonElement after)
    {
        var result = new List<SignalDelta>(); foreach (var (key, label) in Signals) { if (!before.TryGetProperty(key, out var a) || !after.TryGetProperty(key, out var b)) continue; result.Add(new(key, label, (b.GetProperty("value").GetDouble() - a.GetProperty("value").GetDouble()) * 100, Math.Min(a.GetProperty("confidence").GetDouble(), b.GetProperty("confidence").GetDouble()), a.GetProperty("evidence").GetString() ?? "", b.GetProperty("evidence").GetString() ?? "")); }
        return result;
    }
}
