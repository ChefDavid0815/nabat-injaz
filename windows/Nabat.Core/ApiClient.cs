using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
namespace Nabat.Core;

public sealed class ApiException(int status, string message) : Exception(message) { public int Status { get; } = status; }
public sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http;
    public Uri BaseUri { get; }
    public ApiSession? Session { get; set; }
    public ApiClient(string baseUrl, HttpMessageHandler? handler = null)
    {
        BaseUri = new Uri(baseUrl.TrimEnd('/') + "/");
        if (!string.IsNullOrEmpty(BaseUri.UserInfo) || !string.IsNullOrEmpty(BaseUri.Query) || BaseUri.AbsolutePath != "/" || (BaseUri.Scheme != "https" && !(BaseUri.Scheme == "http" && BaseUri.IsLoopback))) throw new ArgumentException("Use an HTTPS NABAT server, or a loopback development server.");
        _http = new(handler ?? new HttpClientHandler { AllowAutoRedirect = false }) { BaseAddress = BaseUri, Timeout = TimeSpan.FromSeconds(30) };
    }
    public async Task<ApiSession> SignInAsync(string email, string password, CancellationToken ct = default)
    {
        var json = await SendAsync("session", HttpMethod.Post, JsonSerializer.Serialize(new { email, password }), false, ct);
        Session = JsonSerializer.Deserialize<ApiSession>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? throw new InvalidDataException("Sign-in data is missing."); return Session;
    }
    public async Task<string> SendAsync(string route, HttpMethod method, string? payload = null, bool authenticated = true, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(method, "api/v1/operations/" + route);
        if (authenticated) { if (Session is null) throw new ApiException(401, "Sign in to sync your work."); request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Session.Token); }
        if (payload is not null) request.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request, ct); var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            var message = "The service could not complete this operation.";
            try { message = JsonDocument.Parse(body).RootElement.GetProperty("error").GetString() ?? message; } catch (JsonException) { } catch (KeyNotFoundException) { }
            throw new ApiException((int)response.StatusCode, message);
        }
        return body;
    }
    public Task<string> GetAsync(string route, CancellationToken ct = default) => SendAsync(route, HttpMethod.Get, ct: ct);
    public async Task<byte[]> GetBytesAsync(string route) { using var request = new HttpRequestMessage(HttpMethod.Get, "api/v1/operations/" + route); request.Headers.Authorization = new("Bearer", Session?.Token ?? throw new ApiException(401, "Sign in first.")); using var response = await _http.SendAsync(request); if (!response.IsSuccessStatusCode) throw new ApiException((int)response.StatusCode, "Preview could not be loaded."); return await response.Content.ReadAsByteArrayAsync(); }
    public async Task<string> UploadAsync(string route, byte[] bytes, CancellationToken ct = default) { using var request = new HttpRequestMessage(HttpMethod.Put, "api/v1/operations/" + route); request.Headers.Authorization = new("Bearer", Session?.Token ?? throw new ApiException(401, "Sign in first.")); request.Content = new ByteArrayContent(bytes); request.Content.Headers.ContentType = new("application/octet-stream"); using var response = await _http.SendAsync(request, ct); if (!response.IsSuccessStatusCode) throw new ApiException((int)response.StatusCode, "The photo was not saved. Retry with a valid JPEG, PNG or WebP smaller than 4 MB."); return await response.Content.ReadAsStringAsync(ct); }
    public Task<string> PostAsync<T>(string route, T payload, CancellationToken ct = default) => SendAsync(route, HttpMethod.Post, JsonSerializer.Serialize(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull }), ct: ct);
    public string Scope(string org) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes($"{BaseUri}|{Session?.Actor.Id ?? throw new ApiException(401, "Sign in first.")}|{org}")));
    public void Dispose() => _http.Dispose();
}
