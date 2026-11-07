using System.Data.Common;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Persistence;

/// <summary>
/// Neutrality of the bring-your-own-database refactors for a hosted baby (docs/design/47-bring-your-own-database.md section 12):
/// one fixed scenario of writes and sync reads on the built-in store, compared with two golden files recorded before the model
/// split. <c>built-in-sync.responses.json</c> holds every status and response body (as JSON documents: property order, values and
/// number text), <c>built-in-sync.sql.json</c> every SQL statement each request ran. GUIDs are numbered in order of appearance
/// (the seeded baby and owner are random); the server clock is fixed. A change that alters either file is not neutral: look at
/// the <c>.actual.json</c> written next to the test binary. Set <c>LOTTIES_APPROVE_GOLDEN=1</c> to record new files on purpose.
/// </summary>
public sealed partial class BuiltInStoreNeutralityTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ApproveVariable = "LOTTIES_APPROVE_GOLDEN";
    private const string ResponsesFile = "built-in-sync.responses.json";
    private const string SqlFile = "built-in-sync.sql.json";

    private static readonly DateTimeOffset Now = TestUsers.Now;
    private static readonly Guid MedicationId = Guid.Parse("a1000000-0000-4000-8000-000000000001");
    private static readonly Guid PrescriptionId = Guid.Parse("a2000000-0000-4000-8000-000000000001");
    private static readonly Guid FormulaId = Guid.Parse("a3000000-0000-4000-8000-000000000001");
    private static readonly Guid ProviderId = Guid.Parse("a4000000-0000-4000-8000-000000000001");
    private static readonly Guid AppointmentId = Guid.Parse("a5000000-0000-4000-8000-000000000001");
    private static readonly Guid VaccinationId = Guid.Parse("a6000000-0000-4000-8000-000000000001");
    private static readonly Guid MeasurementId = Guid.Parse("a7000000-0000-4000-8000-000000000001");
    private static readonly Guid SharedNoteId = Guid.Parse("a8000000-0000-4000-8000-000000000001");
    private static readonly Guid PrivateNoteId = Guid.Parse("a8000000-0000-4000-8000-000000000002");
    private static readonly Guid FeedingId = Guid.Parse("a9000000-0000-4000-8000-000000000001");
    private static readonly Guid NapId = Guid.Parse("a9000000-0000-4000-8000-000000000002");
    private static readonly Guid DiaperId = Guid.Parse("a9000000-0000-4000-8000-000000000003");
    private static readonly Guid ProposalId = Guid.Parse("aa000000-0000-4000-8000-000000000001");

    private const string LineEnd = "\n";

    private static readonly JsonSerializerOptions GoldenJson = new() { WriteIndented = true, NewLine = LineEnd, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private readonly SqlCapture _sql = new();

    [Fact]
    public async Task HostedBaby_SyncResponsesAndSqlMatchTheGoldenFiles()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctorId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Doctor));
        var host = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<TimeProvider>(new FixedTimeProvider(Now));
            services.ConfigureDbContext<LottiesDbContext>(options => options.AddInterceptors(_sql));
            services.ConfigureDbContext<LottiesDataDbContext>(options => options.AddInterceptors(_sql));
        }));
        var scenario = new Scenario(
            new Actors(host.ClientFor(baby.OwnerSubject), host.ClientFor(baby.SubjectOf(BabyRole.Doctor)), doctorId),
            _sql,
            $"/api/v1/babies/{baby.BabyId}");

        await scenario.RunAsync();

        var (responses, sql) = scenario.Golden();
        var mismatches = new[] { Compare(ResponsesFile, responses), Compare(SqlFile, sql) }.Where(message => message is not null).ToArray();
        Assert.True(mismatches.Length == 0, string.Join(Environment.NewLine, mismatches));
    }

    private static string? Compare(string fileName, string actual)
    {
        if (Environment.GetEnvironmentVariable(ApproveVariable) == "1")
        {
            File.WriteAllText(Path.Combine(SourceDirectory(), "Golden", fileName), actual + LineEnd);
            return null;
        }

        var expected = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Persistence", "Golden", fileName)).ReplaceLineEndings(LineEnd);
        if (expected == actual + LineEnd)
        {
            return null;
        }

        var actualPath = Path.Combine(AppContext.BaseDirectory, Path.ChangeExtension(fileName, ".actual.json"));
        File.WriteAllText(actualPath, actual);
        return $"{fileName} differs from the golden file; the actual output is at {actualPath}.";
    }

    private static string SourceDirectory([CallerFilePath] string path = "") => Path.GetDirectoryName(path)!;

    [GeneratedRegex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")]
    private static partial Regex GuidPattern();

    /// <summary>The baby's Owner and its Doctor (with her user id, for the member removal).</summary>
    private sealed record Actors(HttpClient Owner, HttpClient Doctor, Guid DoctorId);

    /// <summary>
    /// The fixed sequence of requests; every response and the SQL it ran are recorded in order. It ends with the Owner removing
    /// the Doctor, which cancels her pending proposal in the same save (a write of both planes).
    /// </summary>
    private sealed class Scenario(Actors actors, SqlCapture sql, string babyPath)
    {
        private HttpClient _client = actors.Owner;

        private readonly List<(string Request, int Status, JsonNode? Body, IReadOnlyList<string> Sql)> _steps = [];
        private readonly Dictionary<string, string> _guids = new(StringComparer.OrdinalIgnoreCase);

        public async Task RunAsync()
        {
            await WritesAsync();
            await ReadsAsync();
        }

        public (string Responses, string Sql) Golden()
        {
            var responses = new JsonArray(_steps.Select(step => (JsonNode)new JsonObject
            {
                ["request"] = step.Request,
                ["status"] = step.Status,
                ["body"] = step.Body?.DeepClone(),
            }).ToArray());
            var sql = new JsonArray(_steps.Select(step => (JsonNode)new JsonObject
            {
                ["request"] = step.Request,
                ["sql"] = new JsonArray(step.Sql.Select(statement => (JsonNode)JsonValue.Create(statement)!).ToArray()),
            }).ToArray());
            return (Normalize(responses.ToJsonString(GoldenJson)), Normalize(sql.ToJsonString(GoldenJson)));
        }

        private async Task WritesAsync()
        {
            await PutAsync($"/medications/{MedicationId}", new { name = "Simethicone", isUsual = true, defaultDosage = new { amount = 2, unit = "drops" } });
            await PutAsync($"/prescriptions/{PrescriptionId}", new
            {
                medicationId = MedicationId,
                kind = "asNeeded",
                dose = new { amount = 2, unit = "drops" },
                minIntervalMinutes = 480,
                maxDosesPer24h = 3,
                indication = "belly pain",
                startDate = "2026-01-01",
                prescriber = "Dr. Ana",
                updatedAt = Now.AddMinutes(-30),
            });
            await PutAsync($"/formulas/{FormulaId}", new { name = "Aptamil 2", brand = "Aptamil", stage = "2", startedOn = "2026-01-01", isCurrent = true, archived = false });
            await PutAsync($"/care-providers/{ProviderId}", new { name = "Dr. Ana Lima", specialty = "pediatrician", clinicName = "Clinic Central", phone = "+55 11 5555-0000", isFavorite = true });
            await PutAsync($"/appointments/{AppointmentId}", new { title = "Pediatrician", type = "consultation", startsAt = Now.AddDays(3), durationMinutes = 30, location = "Clinic Central", providerId = ProviderId, status = "upcoming", reminderOffsetsMinutes = new[] { 1440, 120 } });
            await PutAsync($"/vaccinations/{VaccinationId}", new { vaccineKey = "bcg", doseId = "bcg-1", doseLabel = "Dose única", givenOn = "2026-01-05", network = "public", clinic = "UBS Centro", lot = "L123" });
            await PutAsync($"/measurements/{MeasurementId}", new { date = "2026-01-09", weightKg = 5.2m, heightCm = 55.5m, headCircumferenceCm = 37.1m });
            await AsDoctorAsync(async () =>
            {
                await RecordAsync(HttpMethod.Put, "/api/v1/me/professional-profile", new { displayName = "Ana Souza", specialty = "Pediatrics", registrationNumber = "CRM-SP 123456", shareDisplayName = true, shareRegistration = false });
                await PutAsync($"/notes/{SharedNoteId}", new { kind = "recommendation", visibility = "shared", body = "Offer 120 ml every 3 hours." });
                await PutAsync($"/notes/{PrivateNoteId}", new { kind = "note", visibility = "private", body = "Ask about the rash.", updatedAt = Now.AddMinutes(-5) });
                await PutAsync($"/prescription-proposals/{ProposalId}", new { medicationName = "Paracetamol drops", kind = "scheduled", dose = new { amount = 2, unit = "drops" }, timesOfDay = new[] { "20:00", "08:00" }, startDate = "2026-01-10", endDate = "2026-01-17", instructions = "Give after the morning feed." });
            });
            await SendAsync(HttpMethod.Put, $"/notes/{SharedNoteId}/read", null);
            await SendAsync(HttpMethod.Post, "/event-types", new
            {
                key = "pumping",
                name = "Pumping",
                icon = "water_drop",
                color = "#123ABC",
                hasDuration = true,
                fields = new object[] { new { key = "amount_ml", label = "Amount", kind = "number", min = 0, unit = "ml" } },
            });
            await PutAsync($"/events/{FeedingId}", new { typeId = BuiltInEventTypes.FeedingId, startedAt = Now.AddHours(-3), endedAt = Now.AddHours(-3).AddMinutes(15), payload = new { method = "bottle", amount_ml = 120, bottle_feeding_type = "formula", formula_id = FormulaId, formula_name = "Aptamil 2" }, notes = "first", updatedAt = Now.AddHours(-3) });
            await PutAsync($"/events/{NapId}", new { typeId = BuiltInEventTypes.SleepId, startedAt = Now.AddHours(-2), endedAt = Now.AddHours(-1), payload = new { kind = "nap", paused_seconds = 600, pause_count = 1 } });
            await PutAsync($"/events/{DiaperId}", new { typeId = BuiltInEventTypes.DiaperId, startedAt = Now.AddMinutes(-20), endedAt = Now.AddMinutes(-20), payload = new { content = "WET" } });
            await PutAsync($"/events/{NapId}", new { typeId = BuiltInEventTypes.SleepId, startedAt = Now.AddHours(-2), endedAt = Now.AddHours(-1), payload = new { kind = "nap", paused_seconds = 600, pause_count = 1 }, notes = "edited" });
            await SendAsync(HttpMethod.Delete, $"/events/{DiaperId}", null);
        }

        private async Task ReadsAsync()
        {
            var since = Uri.EscapeDataString(Now.AddDays(-1).ToString("O"));
            await GetAbsoluteAsync("/api/v1/babies");
            await GetAsync(string.Empty);
            await GetAsync("/events");
            await GetAsync($"/events?since={since}");
            await GetAsync("/events?limit=1");
            await GetAsync($"/events/{FeedingId}");
            await GetAsync("/event-types");
            await GetAsync("/medications");
            await GetAsync($"/prescriptions?since={since}");
            await GetAsync("/medications/status");
            await GetAsync($"/formulas?since={since}");
            await GetAsync($"/care-providers?since={since}");
            await GetAsync($"/appointments?since={since}");
            await GetAsync($"/vaccinations?since={since}");
            await GetAsync("/measurements");
            await GetAsync($"/notes?since={since}");
            await GetAsync($"/note-reads?since={since}");
            await GetAsync($"/prescription-proposals?since={since}");
            await GetAsync("/predictions");
            await AsDoctorAsync(async () =>
            {
                await GetAsync($"/notes?since={since}");
                await GetAsync($"/prescription-proposals?since={since}");
            });
            await SendAsync(HttpMethod.Delete, $"/members/{actors.DoctorId}", null);
            await GetAsync($"/prescription-proposals?since={since}");
            await GetAsync("/members");
        }

        private async Task AsDoctorAsync(Func<Task> steps)
        {
            _client = actors.Doctor;
            await steps();
            _client = actors.Owner;
        }

        private Task PutAsync(string path, object body) => SendAsync(HttpMethod.Put, path, body);

        private Task GetAsync(string path) => SendAsync(HttpMethod.Get, path, null);

        private Task GetAbsoluteAsync(string path) => RecordAsync(HttpMethod.Get, path, null);

        private Task SendAsync(HttpMethod method, string path, object? body) => RecordAsync(method, babyPath + path, body);

        private async Task RecordAsync(HttpMethod method, string path, object? body)
        {
            using var request = new HttpRequestMessage(method, path) { Content = body is null ? null : JsonContent.Create(body) };
            var mark = sql.Count;
            using var response = await _client.SendAsync(request);
            var text = await response.Content.ReadAsStringAsync();
            _steps.Add(($"{(_client == actors.Doctor ? "doctor" : "owner")} {method} {path}", (int)response.StatusCode, text.Length == 0 ? null : JsonNode.Parse(text), sql.Since(mark)));
        }

        /// <summary>Numbers every GUID in order of first appearance, across both files (the same id gets the same number).</summary>
        private string Normalize(string text) =>
            GuidPattern().Replace(text, match => _guids.TryGetValue(match.Value, out var name) ? name : _guids[match.Value] = $"guid-{_guids.Count + 1:D3}");
    }

    /// <summary>Records the text of every command that runs while an HTTP request is handled (background jobs are left out).</summary>
    private sealed class SqlCapture : DbCommandInterceptor
    {
        private readonly IHttpContextAccessor _http = new HttpContextAccessor();
        private readonly List<string> _statements = [];
        private readonly Lock _gate = new();

        public int Count
        {
            get
            {
                lock (_gate)
                {
                    return _statements.Count;
                }
            }
        }

        public IReadOnlyList<string> Since(int mark)
        {
            lock (_gate)
            {
                return _statements.Skip(mark).ToArray();
            }
        }

        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result) =>
            Record(command, result);

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(Record(command, result));

        public override InterceptionResult<int> NonQueryExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<int> result) =>
            Record(command, result);

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(Record(command, result));

        public override InterceptionResult<object> ScalarExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<object> result) =>
            Record(command, result);

        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(Record(command, result));

        private T Record<T>(DbCommand command, T result)
        {
            if (_http.HttpContext is not null)
            {
                lock (_gate)
                {
                    _statements.Add(command.CommandText.ReplaceLineEndings("\n"));
                }
            }

            return result;
        }
    }
}
