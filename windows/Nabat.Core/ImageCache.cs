using System.Security.Cryptography;
using System.Text;
namespace Nabat.Core;

public sealed class ImageCache(string root, long maximumBytes = 100 * 1024 * 1024)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    public async Task<Uri> GetAsync(string source, Uri server, string scope, CancellationToken ct = default)
    {
        var uri = new Uri(server, source);
        if (uri.Authority != server.Authority || uri.Scheme != server.Scheme || !string.IsNullOrEmpty(uri.UserInfo)) throw new InvalidDataException("Image must belong to the configured NABAT server.");
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(scope + "|" + uri.AbsolutePath)));
        var folder = Path.Combine(root, scope); Directory.CreateDirectory(folder); var filename = Path.Combine(folder, key + ".webp");
        await _gate.WaitAsync(ct);
        try
        {
            if (File.Exists(filename)) { File.SetLastAccessTimeUtc(filename, DateTime.UtcNow); return new Uri(filename); }
            using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(20) };
            using var response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct); response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength > 12 * 1024 * 1024) throw new InvalidDataException("Preview image exceeds the local cache limit.");
            await using var input = await response.Content.ReadAsStreamAsync(ct); using var bytes = new MemoryStream(); var buffer = new byte[65536]; int count;
            while ((count = await input.ReadAsync(buffer, ct)) > 0) { if (bytes.Length + count > 12 * 1024 * 1024) throw new InvalidDataException("Preview image exceeds the cache limit."); await bytes.WriteAsync(buffer.AsMemory(0, count), ct); }
            var temporary = filename + ".new"; await File.WriteAllBytesAsync(temporary, bytes.ToArray(), ct); File.Move(temporary, filename, true);
            var files = Directory.GetFiles(root, "*.webp", SearchOption.AllDirectories).Select(f => new FileInfo(f)).OrderBy(f => f.LastAccessTimeUtc).ToList(); var total = files.Sum(f => f.Length);
            foreach (var file in files) { if (total <= maximumBytes) break; if (file.FullName == filename) continue; total -= file.Length; file.Delete(); }
            return new Uri(filename);
        }
        finally { _gate.Release(); }
    }
}
