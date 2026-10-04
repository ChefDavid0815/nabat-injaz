using Nabat.Core;
namespace Nabat.Windows;

public sealed partial class MainWindow
{
    private async Task CacheImages(OperationsSnapshot snapshot, string scope)
    {
        if (_api is null) return; var server = _api.BaseUri; var cache = new ImageCache(Path.Combine(_data, "images"));
        await Parallel.ForEachAsync(snapshot.Plants.Where(p => p.Image?.StartsWith("/api/media/", StringComparison.Ordinal) == true).Take(20), new ParallelOptions { MaxDegreeOfParallelism = 2 }, async (plant, ct) => { try { var uri = await cache.GetAsync(plant.Image!, server, scope, ct); var index = snapshot.Plants.FindIndex(p => p.Id == plant.Id); if (index >= 0) snapshot.Plants[index] = plant with { Image = uri.ToString() }; } catch (Exception ex) when (ex is HttpRequestException or IOException or TaskCanceledException) { _telemetry.Record("image.cache.failed", new { type = ex.GetType().Name }); } });
        var json = await _store.ReadCacheAsync(scope);
        if (json is null) return;
        var document = System.Text.Json.Nodes.JsonNode.Parse(json);
        if (document?["plants"]?["items"] is not System.Text.Json.Nodes.JsonArray items) return;
        foreach (var item in items)
        {
            var cached = snapshot.Plants.FirstOrDefault(p => p.Id == item?["id"]?.GetValue<string>());
            if (cached?.Image?.StartsWith("file:", StringComparison.Ordinal) == true && item is not null) item["image"] = cached.Image;
        }
        await _store.SaveCacheAsync(scope, document.ToJsonString());
    }
}
