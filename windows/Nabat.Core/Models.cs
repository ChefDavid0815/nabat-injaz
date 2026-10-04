using System.Text.Json;
namespace Nabat.Core;

public static class Contracts
{
    public static JsonSerializerOptions ResponseJson { get; } = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower, PropertyNameCaseInsensitive = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString };
    public static T Read<T>(JsonElement data) => data.Deserialize<T>(ResponseJson) ?? throw new InvalidDataException("The server returned incomplete data.");
}
public record Actor(string Id, string Name, string Email);
public record Workspace(string Id, string Name, string Role, string Timezone);
public record ApiSession(string Token, DateTimeOffset ExpiresAt, Actor Actor, List<Workspace> Workspaces);
public record PlantSummary
{
    public string Id { get; init; } = ""; public string Name { get; init; } = ""; public string Code { get; init; } = "";
    public string SpeciesName { get; init; } = ""; public string ScientificName { get; init; } = "";
    public string? LocationId { get; init; }
    public string? LocationName { get; init; }
    public int? Score { get; init; }
    public int? Delta { get; init; }
    public double? Confidence { get; init; }
    public string HealthState { get; init; } = "baseline"; public string? Image { get; init; }
    public DateTimeOffset? LastServiced { get; init; }
    public DateTimeOffset? LastWatered { get; init; }
    public DateTimeOffset? NextCare { get; init; }
    public DateTimeOffset? LastObservation { get; init; }
    public string LifecycleStatus { get; init; } = "active"; public string? Trend { get; init; }
    public string? AssigneeId { get; init; }
    public string? AssigneeName { get; init; }
    public int ActiveAlerts { get; init; }
    public long OperationsRevision { get; init; }
    public double PriorityScore { get; init; }
    public string[] PriorityReasons { get; init; } = [];
    public string? AlertReason { get; init; }
    public string? AlertSeverity { get; init; }
    public int OverdueDays { get; init; }
    public string ScoreText => Score?.ToString() ?? "—";
    public string TrendText => Trend == "baseline" || Delta is null ? "Baseline" : Delta > 0 ? $"+{Delta}" : Delta.ToString()!;
    public string WhyNow => AlertReason ?? PriorityReasons.FirstOrDefault() ?? "Continue scheduled care";
    public string LocationText => LocationName ?? "Unplaced"; public string CaretakerText => AssigneeName ?? "Unassigned";
    public string LastCareText => LastServiced is { } care ? PresentationCulture.Date(care, "dd MMM HH:mm") : "No care yet";
    public string NextCareText => NextCare is { } next ? PresentationCulture.Date(next, "dd MMM HH:mm") : "Not scheduled";
    public string ObservationText => LastObservation is { } photo ? PresentationCulture.Date(photo, "dd MMM") : "No observation";
}
public record OperationTask
{
    public string Id { get; init; } = ""; public string PlantId { get; init; } = ""; public string PlantName { get; init; } = "";
    public string PlantCode { get; init; } = ""; public string Kind { get; init; } = ""; public string Title { get; init; } = "";
    public string Status { get; init; } = "pending"; public int Revision { get; init; }
    public string? AssigneeId { get; init; }
    public string? AssigneeName { get; init; }
    public string? LocationName { get; init; }
    public DateTimeOffset DueAt { get; init; }
    public string Detail => $"{PlantCode} · {LocationName ?? "Unplaced"} · {AssigneeName ?? "Unassigned"}";
}
public record MaintenanceSession
{
    public string Id { get; init; } = ""; public string OwnerId { get; init; } = ""; public string OwnerName { get; init; } = "";
    public string? LocationName { get; init; }
    public string Status { get; init; } = ""; public int Revision { get; init; }
    public int PlantCount { get; init; }
    public int VisitedCount { get; init; }
    public DateTimeOffset StartedAt { get; init; }
    public DateTimeOffset? EndedAt { get; init; }
    public JsonElement Summary { get; init; }
    public string Display => $"{LocationName ?? "Selected plants"} · {VisitedCount}/{PlantCount} visited · {Status}";
}
public record Location(string Id, string Name, string? ParentId, int PlantCount = 0, int CriticalCount = 0, int AttentionCount = 0, int OpenAlerts = 0);
public record Member(string UserId, string Name, string Role);
public record OutboxMutation(string Id, string Scope, string OrganisationId, string Route, string Payload, int Attempts, string State, string? Error);
public record CareMutation(string PlantId, string Type, string IdempotencyKey, string OccurredAt, string Note = "", string? TaskId = null, string? SessionId = null, string? ExpectedActorId = null);
public record FleetPage(List<PlantSummary> Items, int Total, int Page, int Limit);
public sealed class OperationsSnapshot
{
    public Workspace Workspace { get; init; } = new("", "", "", "Asia/Dubai"); public Actor Actor { get; init; } = new("", "", "");
    public List<PlantSummary> Plants { get; init; } = []; public List<OperationTask> Tasks { get; init; } = [];
    public List<MaintenanceSession> Sessions { get; init; } = []; public List<Location> Locations { get; init; } = []; public List<Member> Team { get; init; } = [];
    public JsonElement Metrics { get; init; }
    public JsonElement Alerts { get; init; }
    public JsonElement Recent { get; init; }
    public JsonElement Species { get; init; }
    public DateTimeOffset ServerTime { get; init; }
    public int TotalPlants { get; init; }
    public static OperationsSnapshot Parse(string json)
    {
        using var doc = JsonDocument.Parse(json); var root = doc.RootElement;
        if (root.GetProperty("contractVersion").GetString() != "operations/1.1") throw new InvalidDataException("Unsupported operations contract.");
        return new()
        {
            Workspace = Contracts.Read<Workspace>(root.GetProperty("workspace")),
            Actor = Contracts.Read<Actor>(root.GetProperty("actor")),
            Plants = Contracts.Read<FleetPage>(root.GetProperty("plants")).Items,
            TotalPlants = root.GetProperty("plants").GetProperty("total").GetInt32(),
            Tasks = Contracts.Read<List<OperationTask>>(root.GetProperty("tasks")),
            Sessions = Contracts.Read<List<MaintenanceSession>>(root.GetProperty("sessions")),
            Locations = Contracts.Read<List<Location>>(root.GetProperty("locations")),
            Team = Contracts.Read<List<Member>>(root.GetProperty("team")),
            Metrics = root.GetProperty("metrics").Clone(),
            Alerts = root.GetProperty("alerts").Clone(),
            Recent = root.GetProperty("recent").Clone(),
            Species = root.GetProperty("species").Clone(),
            ServerTime = root.GetProperty("serverTime").GetDateTimeOffset()
        };
    }
}
