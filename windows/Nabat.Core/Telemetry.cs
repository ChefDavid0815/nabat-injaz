using System.Text.Json;
namespace Nabat.Core;

public interface ITelemetryService { void Record(string operation, object? fields = null); }
public sealed class LocalTelemetry(string filename) : ITelemetryService
{
    private readonly object _gate = new();
    public void Record(string operation, object? fields = null) { lock (_gate) { try { Directory.CreateDirectory(Path.GetDirectoryName(filename)!); if (File.Exists(filename) && new FileInfo(filename).Length > 2 * 1024 * 1024) File.Move(filename, filename + ".previous", true); File.AppendAllText(filename, JsonSerializer.Serialize(new { at = DateTimeOffset.UtcNow, operation, fields }) + Environment.NewLine); } catch (IOException) { } catch (UnauthorizedAccessException) { } } }
}
