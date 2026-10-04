using System.Text;
namespace Nabat.Core;

public static class NdefUri
{
    public static byte[] Encode(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http") || !string.IsNullOrEmpty(uri.UserInfo)) throw new ArgumentException("Use a stable HTTP identity resolver URL.");
        var prefix = url.StartsWith("https://", StringComparison.Ordinal) ? (byte)4 : (byte)3;
        var text = Encoding.UTF8.GetBytes(url[(prefix == 4 ? 8 : 7)..]); var length = text.Length + 1;
        if (length > 254) throw new ArgumentException("Resolver URL is too long for a short NDEF URI record.");
        return [0xD1, 0x01, (byte)length, 0x55, prefix, .. text];
    }
    public static string Decode(byte[] data)
    {
        if (data.Length < 5 || data[0] != 0xD1 || data[1] != 1 || data[3] != 0x55 || data[2] != data.Length - 4) throw new InvalidDataException("Expected one short NDEF URI record.");
        var prefix = data[4] switch { 0 => "", 3 => "http://", 4 => "https://", _ => throw new InvalidDataException("Unsupported URI prefix.") };
        return prefix + new UTF8Encoding(false, true).GetString(data, 5, data.Length - 5);
    }
}
public interface INfcAdapter { Task WriteAsync(byte[] ndef, CancellationToken ct = default); Task<byte[]> ReadAsync(CancellationToken ct = default); }
public sealed class SimulatedNfcAdapter : INfcAdapter
{
    private byte[] _data = [];
    public Task WriteAsync(byte[] ndef, CancellationToken ct = default) { ct.ThrowIfCancellationRequested(); _data = [.. ndef]; return Task.CompletedTask; }
    public Task<byte[]> ReadAsync(CancellationToken ct = default) { ct.ThrowIfCancellationRequested(); return Task.FromResult<byte[]>([.. _data]); }
}
