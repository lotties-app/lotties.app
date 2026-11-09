using System.Globalization;
using System.Text.Json.Serialization;
using Lotties.Application.Serialization;
using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Rest;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Rest;

/// <summary>One night of the history (docs/design/41-caregiver-rest.md "History"): the one-night estimate's parts plus two flags.</summary>
public sealed record RestHistoryNightResponse
{
    /// <summary>The local date the night started, <c>yyyy-MM-dd</c>.</summary>
    public required string Night { get; init; }

    /// <summary><c>ok</c> or <c>notEnoughLog</c>.</summary>
    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public RestStatus Status { get; init; }

    public IReadOnlyList<RestPartResponse> Parts { get; init; } = [];

    /// <summary><c>low</c> when any part is low, <c>normal</c> otherwise, <c>null</c> without parts.</summary>
    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public RestConfidence? Confidence { get; init; }

    /// <summary>A work window of the person overlaps the night window: the night is shown but left out of the summaries.</summary>
    public bool WorkOverlap { get; init; }

    /// <summary>The night is in the summaries (<c>ok</c>, every part ended, no work overlap).</summary>
    public bool Counted { get; init; }
}

public sealed record RestMinutesRangeResponse(int P25, int Median, int P75);

/// <summary>A group's counted nights; <c>restedMinutes</c> is <c>null</c> below the minimum number of nights.</summary>
public sealed record RestGroupSummaryResponse(int CountedNights, RestMinutesRangeResponse? RestedMinutes);

public sealed record RestWeekSplitResponse(RestGroupSummaryResponse Weekday, RestGroupSummaryResponse Weekend);

public sealed record RestHourShareResponse(int Hour, double Share);

/// <summary>24 local hours from the hour the night starts; <c>hours</c> is empty below the minimum number of nights.</summary>
public sealed record RestTypicalNightResponse(int CountedNights, IReadOnlyList<RestHourShareResponse> Hours);

public sealed record RestHistoryConstantsResponse(
    int FallAsleepMinutes,
    int WakeLeadMinutes,
    int MinimumNights,
    int MinutesRounding,
    int ShareDecimals,
    int AsleepMinutesPerHour);

/// <summary>The caller's own rest over past nights. Never stored, cached or logged; no score, target, total or comparison.</summary>
public sealed record RestHistoryResponse
{
    /// <summary><c>ok</c> or <c>disabled</c> (feature off: no event is read and every list is empty).</summary>
    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public RestStatus Status { get; init; }

    public int NightsRequested { get; init; }

    /// <summary>Oldest first, ending at the last finished night.</summary>
    public IReadOnlyList<RestHistoryNightResponse> Nights { get; init; } = [];

    public required RestWeekSplitResponse WeekdayWeekend { get; init; }

    public required RestTypicalNightResponse TypicalNight { get; init; }

    public required RestHistoryConstantsResponse Constants { get; init; }
}

/// <summary>The caller's own caregiver rest history. It only ever answers for the signed-in person.</summary>
public interface IRestHistoryService
{
    /// <summary>
    /// The history of the last <paramref name="nights"/> finished nights (<c>14</c> or <c>28</c>; 14 when <c>null</c>). Anything
    /// else is 400 <c>validation_failed</c> on <c>nights</c>. With the feature off nothing is read.
    /// </summary>
    Task<RestHistoryResponse> GetMineAsync(string? nights, CancellationToken cancellationToken = default);
}

internal sealed class RestHistoryService(
    ICurrentUser currentUser,
    IUserRestRepository rest,
    RestEventReader reader,
    TimeProvider timeProvider,
    ILogger<RestHistoryService> logger) : IRestHistoryService
{
    public const string NightsField = "nights";
    public const int DefaultNights = 14;

    /// <summary>The events read per baby for the whole window (about 690 a day over 29 days).</summary>
    private const int MaxEventsPerBaby = 20000;

    public async Task<RestHistoryResponse> GetMineAsync(string? nights, CancellationToken cancellationToken = default)
    {
        var count = ParseNights(nights);
        var user = await currentUser.GetUserAsync(cancellationToken);
        var now = timeProvider.GetUtcNow();
        var values = (await rest.FindSettingsAsync(user.Id, cancellationToken))?.Values() ?? RestSettingsValues.Defaults;
        var settings = RestEstimateService.ToSettings(values);
        var lastNight = RestHistoryBuilder.LastFinishedNight(settings, now);
        var firstNight = lastNight.AddDays(1 - count);

        IReadOnlyDictionary<DateOnly, DateTimeOffset> answers = new Dictionary<DateOnly, DateTimeOffset>();
        IReadOnlyList<RestEvent> loaded = [];
        if (values.Enabled)
        {
            answers = (await rest.ListMorningsAsync(user.Id, firstNight, lastNight, cancellationToken)).ToDictionary(row => row.Night, row => row.UpAt);
            loaded = await LoadEventsAsync(user.Id, settings, firstNight, lastNight, cancellationToken);
        }

        var history = RestHistoryBuilder.Build(new RestHistoryInput(settings, user.Id, lastNight, count, now, answers, loaded));
        logger.LogInformation("Computed the rest history of user {UserId}", user.Id);
        return Map(history);
    }

    private Task<IReadOnlyList<RestEvent>> LoadEventsAsync(Guid userId, RestSettings settings, DateOnly firstNight, DateOnly lastNight, CancellationToken cancellationToken)
    {
        var from = RestCalendar.EventWindow(settings, firstNight).Start;
        var to = RestCalendar.EventWindow(settings, lastNight).End;
        return reader.ReadAsync(userId, from, to, MaxEventsPerBaby, cancellationToken);
    }

    private static int ParseNights(string? nights)
    {
        if (nights is null)
        {
            return DefaultNights;
        }

        return int.TryParse(nights, NumberStyles.None, CultureInfo.InvariantCulture, out var count) && RestHistoryBuilder.IsAllowedNights(count)
            ? count
            : throw new DomainValidationException(NightsField, "nights must be 14 or 28.");
    }

    private static RestHistoryResponse Map(RestHistory history) => new()
    {
        Status = history.Status,
        NightsRequested = history.NightsRequested,
        Nights = [.. history.Nights.Select(MapNight)],
        WeekdayWeekend = new RestWeekSplitResponse(MapGroup(history.WeekdayWeekend.Weekday), MapGroup(history.WeekdayWeekend.Weekend)),
        TypicalNight = new RestTypicalNightResponse(
            history.TypicalNight.CountedNights,
            [.. history.TypicalNight.Hours.Select(hour => new RestHourShareResponse(hour.Hour, hour.Share))]),
        Constants = new RestHistoryConstantsResponse(
            history.Constants.FallAsleepMinutes,
            history.Constants.WakeLeadMinutes,
            history.Constants.MinimumNights,
            history.Constants.MinutesRounding,
            history.Constants.ShareDecimals,
            history.Constants.AsleepMinutesPerHour),
    };

    private static RestHistoryNightResponse MapNight(RestHistoryNight night) => new()
    {
        Night = night.Estimate.Night.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        Status = night.Estimate.Status,
        Parts = [.. night.Estimate.Parts.Select(RestEstimateService.MapPart)],
        Confidence = night.Confidence,
        WorkOverlap = night.WorkOverlap,
        Counted = night.Counted,
    };

    private static RestGroupSummaryResponse MapGroup(RestGroupSummary group) => new(
        group.CountedNights,
        group.RestedMinutes is { } range ? new RestMinutesRangeResponse(range.P25, range.Median, range.P75) : null);
}
