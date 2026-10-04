using System.Text.Json;
namespace Nabat.Core;

public sealed class SyncEngine(ApiClient api, LocalStore store) : IDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    public string Status { get; private set; } = "Not connected";
    public event EventHandler? Changed;
    public bool WorkingOffline { get; set; }
    public async Task<string> QueueCareAsync(string org, CareMutation care)
    {
        care = care with { ExpectedActorId = api.Session?.Actor.Id ?? throw new ApiException(401, "Sign in before recording care.") };
        var payload = JsonSerializer.Serialize(care, new JsonSerializerOptions(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull });
        await store.EnqueueAsync(api.Scope(org), org, $"{org}/care", payload, care.IdempotencyKey); SetStatus("Care saved on this device"); return care.IdempotencyKey;
    }
    public async Task SyncAsync(string org, CancellationToken ct = default)
    {
        if (!await _gate.WaitAsync(0, ct)) return;
        try
        {
            var scope = api.Scope(org); if (WorkingOffline) { SetStatus("Working offline"); return; }
            SetStatus("Syncing");
            foreach (var item in await store.OutboxAsync(scope, true))
            {
                ct.ThrowIfCancellationRequested();
                try { await api.SendAsync(item.Route, HttpMethod.Post, item.Payload, ct: ct); await store.RemoveAsync(item.Id); }
                catch (ApiException e) when (e.Status == 401) { SetStatus("Sign in to sync · work preserved"); return; }
                catch (ApiException e) when (e.Status >= 400 && e.Status < 500 && e.Status != 429) { await store.MarkAsync(item.Id, "blocked", e.Message, item.Attempts + 1, DateTimeOffset.UtcNow); }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException || e is ApiException)
                {
                    if (ct.IsCancellationRequested) throw;
                    await store.MarkAsync(item.Id, "pending", "Connection interrupted. Your care is saved.", item.Attempts + 1, DateTimeOffset.UtcNow.AddSeconds(Math.Min(300, Math.Pow(2, Math.Min(item.Attempts + 1, 8))))); SetStatus("Offline · care saved locally"); return;
                }
            }
            var pending = await store.OutboxAsync(scope); SetStatus(pending.Count == 0 ? "Synced" : $"{pending.Count} changes pending" + (pending.Any(p => p.State == "blocked") ? " · review required" : ""));
        }
        finally { _gate.Release(); }
    }
    private void SetStatus(string status) { Status = status; Changed?.Invoke(this, EventArgs.Empty); }
    public void Dispose() => _gate.Dispose();
}
