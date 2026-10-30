using System.Globalization;
using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Notifications;
using Lotties.Domain.Rest;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Rest;

/// <summary>One work window as the API tells it: ISO days, local <c>HH:mm</c> start and end.</summary>
public sealed record WorkWindowDto(IReadOnlyList<int> Days, string Start, string End);

/// <summary>The caller's rest settings as the API tells them (docs/design/41-caregiver-rest.md section 11).</summary>
public sealed record RestSettingsResponse(
    bool Enabled,
    string TimeZone,
    IReadOnlyList<WorkWindowDto> WorkWindows,
    string NightStart,
    string NightEnd,
    int FallAsleepMinutes,
    int WakeLeadMinutes)
{
    internal static RestSettingsResponse Of(RestSettingsValues values) => new(
        values.Enabled,
        values.TimeZone,
        [.. values.WorkWindows.Select(window => new WorkWindowDto(window.Days, RestTimes.Format(window.Start), RestTimes.Format(window.End)))],
        RestTimes.Format(values.NightStart),
        RestTimes.Format(values.NightEnd),
        values.FallAsleepMinutes,
        values.WakeLeadMinutes);
}

/// <summary>Body of <c>PUT /me/rest-settings</c> (the full state; every field is required).</summary>
public sealed record SaveRestSettingsRequest
{
    public bool? Enabled { get; init; }

    public string? TimeZone { get; init; }

    public IReadOnlyList<WorkWindowRequest?>? WorkWindows { get; init; }

    public string? NightStart { get; init; }

    public string? NightEnd { get; init; }

    public int? FallAsleepMinutes { get; init; }

    public int? WakeLeadMinutes { get; init; }
}

/// <summary>One work window in a request.</summary>
public sealed record WorkWindowRequest
{
    public IReadOnlyList<int>? Days { get; init; }

    public string? Start { get; init; }

    public string? End { get; init; }
}

/// <summary>Body of <c>PUT /me/rest/morning</c>: the night (local date it started) and the moment the person was up.</summary>
public sealed record SaveRestMorningRequest
{
    public string? Night { get; init; }

    public DateTimeOffset? UpAt { get; init; }
}

/// <summary>The current user's caregiver rest settings and morning answers (docs/design/41-caregiver-rest.md). Own rows only.</summary>
public interface IRestSettingsService
{
    /// <summary>The stored settings, or the defaults (feature off) before the first PUT.</summary>
    Task<RestSettingsResponse> GetMineAsync(CancellationToken cancellationToken = default);

    /// <summary>Stores the full state; an invalid field is 400 <c>validation_failed</c> naming it. The same state changes nothing.</summary>
    Task<RestSettingsResponse> SaveMineAsync(SaveRestSettingsRequest request, CancellationToken cancellationToken = default);

    /// <summary>Stores the moment the person was up for a night, replacing an earlier answer.</summary>
    Task SaveMorningAsync(SaveRestMorningRequest request, CancellationToken cancellationToken = default);

    /// <summary>Removes the settings and every morning answer.</summary>
    Task DeleteMineAsync(CancellationToken cancellationToken = default);
}

internal static class RestTimes
{
    public const string Format24 = "HH:mm";

    public static string Format(TimeOnly time) => time.ToString(Format24, CultureInfo.InvariantCulture);

    public static bool TryParse(string? text, out TimeOnly time) =>
        TimeOnly.TryParseExact(text, Format24, CultureInfo.InvariantCulture, DateTimeStyles.None, out time);
}

internal sealed class RestSettingsService(
    ICurrentUser currentUser,
    IUserRestRepository rest,
    TimeProvider timeProvider,
    ILogger<RestSettingsService> logger) : IRestSettingsService
{
    public const string EnabledField = "enabled";
    public const string TimeZoneField = "timeZone";
    public const string WorkWindowsField = "workWindows";
    public const string NightStartField = "nightStart";
    public const string NightEndField = "nightEnd";
    public const string FallAsleepField = "fallAsleepMinutes";
    public const string WakeLeadField = "wakeLeadMinutes";
    public const string NightField = "night";
    public const string UpAtField = "upAt";

    private static readonly TimeSpan MorningFutureTolerance = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan MorningLookBack = TimeSpan.FromHours(12);

    public async Task<RestSettingsResponse> GetMineAsync(CancellationToken cancellationToken = default)
    {
        var user = await currentUser.GetUserAsync(cancellationToken);
        var stored = await rest.FindSettingsAsync(user.Id, cancellationToken);
        return RestSettingsResponse.Of(stored?.Values() ?? RestSettingsValues.Defaults);
    }

    public async Task<RestSettingsResponse> SaveMineAsync(SaveRestSettingsRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var values = Validate(request);
        var user = await currentUser.GetUserAsync(cancellationToken);
        var now = timeProvider.GetUtcNow();
        var stored = await rest.FindSettingsAsync(user.Id, cancellationToken);
        if (stored is null)
        {
            var created = UserRestSettings.Create(user.Id, values, now);
            stored = await rest.TryAddSettingsAsync(created, cancellationToken)
                ? created
                : await rest.FindSettingsAsync(user.Id, cancellationToken)
                    ?? throw new InvalidOperationException($"The rest settings of user {user.Id} were saved concurrently but could not be loaded.");
        }

        stored.Replace(values, now);
        await rest.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Saved the rest settings of user {UserId}", user.Id);
        return RestSettingsResponse.Of(stored.Values());
    }

    public async Task SaveMorningAsync(SaveRestMorningRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!DateOnly.TryParseExact(request.Night, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var night))
        {
            throw new DomainValidationException(NightField, "night must be a date as YYYY-MM-DD.");
        }

        if (request.UpAt is not { } upAt)
        {
            throw new DomainValidationException(UpAtField, "upAt is required.");
        }

        var user = await currentUser.GetUserAsync(cancellationToken);
        var now = timeProvider.GetUtcNow();
        var settings = (await rest.FindSettingsAsync(user.Id, cancellationToken))?.Values() ?? RestSettingsValues.Defaults;
        var nightStart = NightStartUtc(night, settings);
        if (upAt <= nightStart - MorningLookBack)
        {
            throw new DomainValidationException(UpAtField, "upAt must be after the start of that night, minus 12 hours.");
        }

        if (upAt > now + MorningFutureTolerance)
        {
            throw new DomainValidationException(UpAtField, "upAt cannot be in the future.");
        }

        var stored = await rest.FindMorningAsync(user.Id, night, cancellationToken);
        if (stored is null)
        {
            var created = UserRestMorning.Create(user.Id, night, upAt);
            if (await rest.TryAddMorningAsync(created, cancellationToken))
            {
                logger.LogInformation("Saved a rest morning answer of user {UserId}", user.Id);
                return;
            }

            stored = await rest.FindMorningAsync(user.Id, night, cancellationToken)
                ?? throw new InvalidOperationException($"The rest morning answer of user {user.Id} was saved concurrently but could not be loaded.");
        }

        stored.Answer(upAt);
        await rest.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Saved a rest morning answer of user {UserId}", user.Id);
    }

    public async Task DeleteMineAsync(CancellationToken cancellationToken = default)
    {
        var user = await currentUser.GetUserAsync(cancellationToken);
        await rest.DeleteAllAsync(user.Id, cancellationToken);
        logger.LogInformation("Deleted the rest settings of user {UserId}", user.Id);
    }

    /// <summary>The instant the night starts: the local date at the person's night start, in her zone.</summary>
    internal static DateTimeOffset NightStartUtc(DateOnly night, RestSettingsValues settings)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(settings.TimeZone);
        var local = night.ToDateTime(settings.NightStart, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local))
        {
            local = local.AddHours(1);
        }

        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, zone), TimeSpan.Zero);
    }

    private static RestSettingsValues Validate(SaveRestSettingsRequest request)
    {
        if (request.Enabled is not { } enabled)
        {
            throw new DomainValidationException(EnabledField, "enabled is required.");
        }

        if (!NotificationTimeZone.TryFrom(request.TimeZone, out var zone))
        {
            throw new DomainValidationException(TimeZoneField, "timeZone must be a known IANA time zone id.");
        }

        var windows = ValidateWindows(request.WorkWindows);
        var nightStart = RequiredTime(request.NightStart, NightStartField);
        var nightEnd = RequiredTime(request.NightEnd, NightEndField);
        if (nightStart == nightEnd)
        {
            throw new DomainValidationException(NightEndField, "nightEnd must differ from nightStart.");
        }

        return new RestSettingsValues(
            enabled,
            zone.Value,
            windows,
            nightStart,
            nightEnd,
            Minutes(request.FallAsleepMinutes, FallAsleepField),
            Minutes(request.WakeLeadMinutes, WakeLeadField));
    }

    private static List<StoredWorkWindow> ValidateWindows(IReadOnlyList<WorkWindowRequest?>? requested)
    {
        if (requested is null)
        {
            throw new DomainValidationException(WorkWindowsField, "workWindows is required (an empty list for none).");
        }

        if (requested.Count > UserRestSettings.MaxWorkWindows)
        {
            throw new DomainValidationException(WorkWindowsField, $"workWindows allows at most {UserRestSettings.MaxWorkWindows} windows.");
        }

        var windows = new List<StoredWorkWindow>(requested.Count);
        foreach (var window in requested)
        {
            if (window?.Days is not { Count: >= 1 and <= 7 } days
                || days.Any(day => day is < 1 or > 7)
                || days.Distinct().Count() != days.Count)
            {
                throw new DomainValidationException(WorkWindowsField, "each work window needs 1 to 7 distinct days, numbered 1 (Monday) to 7 (Sunday).");
            }

            var start = RequiredTime(window.Start, WorkWindowsField);
            var end = RequiredTime(window.End, WorkWindowsField);
            if (start == end)
            {
                throw new DomainValidationException(WorkWindowsField, "a work window's end must differ from its start.");
            }

            windows.Add(new StoredWorkWindow(days, start, end));
        }

        return windows;
    }

    private static TimeOnly RequiredTime(string? text, string field) =>
        RestTimes.TryParse(text, out var time) ? time : throw new DomainValidationException(field, $"{field} must be a time as HH:mm.");

    private static int Minutes(int? value, string field) =>
        value is >= UserRestSettings.MinMinutes and <= UserRestSettings.MaxMinutes
            ? value.Value
            : throw new DomainValidationException(field, $"{field} must be between {UserRestSettings.MinMinutes} and {UserRestSettings.MaxMinutes} minutes.");
}
