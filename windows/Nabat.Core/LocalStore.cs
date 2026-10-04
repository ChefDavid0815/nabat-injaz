using Microsoft.Data.Sqlite;
namespace Nabat.Core;

public sealed class LocalStore
{
    private readonly string _connection;
    public LocalStore(string filename) { Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(filename))!); _connection = new SqliteConnectionStringBuilder { DataSource = filename }.ToString(); }
    private async Task<SqliteConnection> OpenAsync() { var connection = new SqliteConnection(_connection); await connection.OpenAsync(); using var command = connection.CreateCommand(); command.CommandText = "PRAGMA busy_timeout=5000;"; await command.ExecuteNonQueryAsync(); return connection; }
    public async Task InitializeAsync()
    {
        await using var connection = await OpenAsync(); using var command = connection.CreateCommand(); command.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS cache(scope TEXT PRIMARY KEY,json TEXT NOT NULL,saved_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,scope TEXT NOT NULL,organisation_id TEXT NOT NULL,route TEXT NOT NULL,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'pending',error TEXT,next_attempt_at TEXT NOT NULL,created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS outbox_scope_due ON outbox(scope,state,next_attempt_at,created_at);
            """; await command.ExecuteNonQueryAsync();
    }
    public async Task SaveCacheAsync(string scope, string json) => await ExecuteAsync("INSERT INTO cache VALUES($scope,$json,$at) ON CONFLICT(scope) DO UPDATE SET json=excluded.json,saved_at=excluded.saved_at", ("$scope", scope), ("$json", json), ("$at", DateTimeOffset.UtcNow.ToString("O")));
    public async Task<string?> ReadCacheAsync(string scope) => await ScalarAsync("SELECT json FROM cache WHERE scope=$key", scope);
    public async Task SetPreferenceAsync(string key, string value) => await ExecuteAsync("INSERT INTO preferences VALUES($key,$value) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("$key", key), ("$value", value));
    public Task<string?> PreferenceAsync(string key) => ScalarAsync("SELECT value FROM preferences WHERE key=$key", key);
    public async Task EnqueueAsync(string scope, string org, string route, string payload, string id) => await ExecuteAsync("INSERT INTO outbox(id,scope,organisation_id,route,payload,next_attempt_at,created_at) VALUES($id,$scope,$org,$route,$payload,$at,$at) ON CONFLICT(id) DO NOTHING", ("$id", id), ("$scope", scope), ("$org", org), ("$route", route), ("$payload", payload), ("$at", DateTimeOffset.UtcNow.ToString("O")));
    public async Task<List<OutboxMutation>> OutboxAsync(string scope, bool readyOnly = false)
    {
        await using var connection = await OpenAsync(); using var command = connection.CreateCommand();
        command.CommandText = "SELECT id,scope,organisation_id,route,payload,attempts,state,error FROM outbox WHERE scope=$scope" + (readyOnly ? " AND state='pending' AND next_attempt_at<=$now" : "") + " ORDER BY created_at,id LIMIT 1000";
        command.Parameters.AddWithValue("$scope", scope); if (readyOnly) command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        var items = new List<OutboxMutation>(); using var reader = await command.ExecuteReaderAsync(); while (await reader.ReadAsync()) items.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetInt32(5), reader.GetString(6), reader.IsDBNull(7) ? null : reader.GetString(7))); return items;
    }
    public async Task MarkAsync(string id, string state, string? error, int attempts, DateTimeOffset retryAt) => await ExecuteAsync("UPDATE outbox SET state=$state,error=$error,attempts=$attempts,next_attempt_at=$retry WHERE id=$id", ("$id", id), ("$state", state), ("$error", error), ("$attempts", attempts), ("$retry", retryAt.ToString("O")));
    public async Task RemoveAsync(string id) => await ExecuteAsync("DELETE FROM outbox WHERE id=$id", ("$id", id));
    private async Task ExecuteAsync(string sql, params (string Key, object? Value)[] values) { await using var connection = await OpenAsync(); using var command = connection.CreateCommand(); command.CommandText = sql; foreach (var (key, value) in values) command.Parameters.AddWithValue(key, value ?? DBNull.Value); await command.ExecuteNonQueryAsync(); }
    private async Task<string?> ScalarAsync(string sql, string key) { await using var connection = await OpenAsync(); using var command = connection.CreateCommand(); command.CommandText = sql; command.Parameters.AddWithValue("$key", key); return (await command.ExecuteScalarAsync())?.ToString(); }
}
