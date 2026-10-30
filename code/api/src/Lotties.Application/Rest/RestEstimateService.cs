using System.Globalization;
using System.Text.Json.Serialization;
using Lotties.Application.Serialization;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.Clinical;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Rest;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Rest;

/// <summary>One rested stretch as the API tells it (docs/design/41-caregiver-rest.md section 11). <c>End</c> is <c>null</c> while ongoing.</summary>
public sealed record RestPartResponse
{
    public DateTimeOffset Start { get; init; }

    public DateTimeOffset? End { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public RestStartSource StartSource { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public RestEndSource EndSource { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public RestConfidence Confidence { get; init; }
}

public sealed record RestConstantsResponse(int FallAsleepMinutes, int WakeLeadMinutes);

/// <summary>The estimate for one night. Never stored, cached or logged; parts only, no total or score.</summary>
public sealed record RestEstimateResponse
{
    /// <summary>The local date the night started, <c>yyyy-MM-dd</c>.</summary>
    public required string Night { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public RestStatus Status { get; init; }

    public IReadOnlyList<RestPartResponse> Parts { get; init; } = [];

    public bool AskMorning { get; init; }

    public required RestConstantsResponse Constants { get; init; }
}

/// <summary>The caller's own caregiver rest estimate. It only ever answers for the signed-in person.</summary>
public interface IRestEstimateService
{
    /// <summary>
    /// The estimate of <paramref name="night"/> (<c>yyyy-MM-dd</c>, the local date the night started; the latest night that has
    /// started when <c>null</c>). A bad date is 400 <c>validation_failed</c> on <c>night</c>. With the feature off nothing is read.
    /// </summary>
    Task<RestEstimateResponse> GetMineAsync(string? night, CancellationToken cancellationToken = default);
}

internal sealed class RestEstimateService(
    ICurrentUser currentUser,
    IUserRestRepository rest,
    IBabyRepository babies,
    IClinicalEventRepository events,
    TimeProvider timeProvider,
    ILogger<RestEstimateService> logger) : IRestEstimateService
{
    private const string SleepKey = "sleep";
    private const int MaxEventsPerBaby = 5000;
    private static readonly TimeSpan LookBack = TimeSpan.FromHours(12);
    private static readonly TimeSpan LookAhead = TimeSpan.FromHours(6);
    private static readonly TimeSpan SleepIdLookBack = TimeSpan.FromHours(24);
    private static readonly string[] SleepKeys = [SleepKey];

    public async Task<RestEstimateResponse> GetMineAsync(string? night, CancellationToken cancellationToken = default)
    {
        var requested = ParseNight(night);
        var user = await currentUser.GetUserAsync(cancellationToken);
        var now = timeProvider.GetUtcNow();
        var values = (await rest.FindSettingsAsync(user.Id, cancellationToken))?.Values() ?? RestSettingsValues.Defaults;
        var date = requested ?? LatestNight(values, now);
        var settings = ToSettings(values);

        IReadOnlyList<RestEvent> loaded = [];
        DateTimeOffset? answer = null;
        if (values.Enabled)
        {
            answer = (await rest.FindMorningAsync(user.Id, date, cancellationToken))?.UpAt;
            loaded = await LoadEventsAsync(user.Id, date, values, cancellationToken);
        }

        var estimate = RestEstimator.Estimate(new RestInput(settings, user.Id, date, now, answer, loaded));
        logger.LogInformation("Computed the rest estimate of user {UserId}", user.Id);
        return Map(estimate);
    }

    private async Task<IReadOnlyList<RestEvent>> LoadEventsAsync(Guid userId, DateOnly night, RestSettingsValues values, CancellationToken cancellationToken)
    {
        var start = RestSettingsService.NightStartUtc(night, values);
        var endDate = values.NightEnd <= values.NightStart ? night.AddDays(1) : night;
        var end = RestSettingsService.NightStartUtc(endDate, values with { NightStart = values.NightEnd });
        var from = start - LookBack;
        var to = end + LookAhead;
        var result = new List<RestEvent>();
        foreach (var baby in await babies.ListForUserAsync(userId, cancellationToken))
        {
            // A Doctor is no caregiver here: her babies never feed the estimate (design 41 section 4).
            if (baby.Members.SingleOrDefault(member => member.UserId == userId) is not { } membership || membership.Role.IsDoctor())
            {
                continue;
            }

            var sleepIds = (await events.ListByTypesAsync(baby.Id, SleepKeys, from - SleepIdLookBack, to, cancellationToken))
                .Select(item => item.Event.Id)
                .ToHashSet();
            var overlapping = await events.ListOverlappingAsync(baby.Id, from, to, MaxEventsPerBaby, [], cancellationToken);
            result.AddRange(overlapping.Select(item => new RestEvent(
                item.BabyId,
                sleepIds.Contains(item.Id),
                item.StartedAt,
                item.EndedAt,
                item.CreatedBy,
                item.CreatedAt,
                false)));
        }

        return result;
    }

    private static DateOnly? ParseNight(string? night)
    {
        if (night is null)
        {
            return null;
        }

        return DateOnly.TryParseExact(night, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : throw new DomainValidationException(RestSettingsService.NightField, "night must be a date as YYYY-MM-DD.");
    }

    /// <summary>The latest local date whose night start (in the person's zone) is not after now.</summary>
    private static DateOnly LatestNight(RestSettingsValues values, DateTimeOffset now)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(values.TimeZone);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);
        return RestSettingsService.NightStartUtc(today, values) <= now ? today : today.AddDays(-1);
    }

    private static RestSettings ToSettings(RestSettingsValues values) => new(
        values.Enabled,
        values.TimeZone,
        [.. values.WorkWindows.Select(window => new RestWorkWindow(window.Days, window.Start, window.End))],
        values.NightStart,
        values.NightEnd,
        values.FallAsleepMinutes,
        values.WakeLeadMinutes);

    private static RestEstimateResponse Map(RestNight estimate) => new()
    {
        Night = estimate.Night.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        Status = estimate.Status,
        Parts =
        [
            .. estimate.Parts.Select(part => new RestPartResponse
            {
                Start = part.Start,
                End = part.End,
                StartSource = part.StartSource,
                EndSource = part.EndSource,
                Confidence = part.Confidence,
            }),
        ],
        AskMorning = estimate.AskMorning,
        Constants = new RestConstantsResponse(estimate.Constants.FallAsleepMinutes, estimate.Constants.WakeLeadMinutes),
    };
}
