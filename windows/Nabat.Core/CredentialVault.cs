using System.Security.Cryptography;
using System.Text.Json;
namespace Nabat.Core;

public sealed class CredentialVault(string filename)
{
    public void Save(string baseUrl, ApiSession session)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var plain = JsonSerializer.SerializeToUtf8Bytes(new SavedSession(baseUrl, session));
        var encrypted = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser); var temporary = filename + ".new";
        File.WriteAllBytes(temporary, encrypted); File.Move(temporary, filename, true); CryptographicOperations.ZeroMemory(plain);
    }
    public SavedSession? Load()
    {
        if (!OperatingSystem.IsWindows() || !File.Exists(filename)) return null;
        byte[]? plain = null;
        try { plain = ProtectedData.Unprotect(File.ReadAllBytes(filename), null, DataProtectionScope.CurrentUser); return JsonSerializer.Deserialize<SavedSession>(plain); }
        catch (Exception e) when (e is CryptographicException or JsonException or IOException) { return null; }
        finally { if (plain is not null) CryptographicOperations.ZeroMemory(plain); }
    }
    public void Clear() { if (File.Exists(filename)) File.Delete(filename); }
    public record SavedSession(string BaseUrl, ApiSession Session);
}
