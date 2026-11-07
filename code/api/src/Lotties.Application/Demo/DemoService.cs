using System.Security.Cryptography;
using Lotties.Application.Babies;
using Lotties.Application.Events;
using Lotties.Application.Measurements;
using Lotties.Application.Users;
using Lotties.Domain.Consents;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Demo;

/// <remarks>
/// Order: switch and cap checks, the user (issuer <see cref="User.DemoIssuer"/>, random subject, expiry), its demo core consent,
/// then the baby and the sample data written as that user through the normal application services
/// (<see cref="ActingUserOverride"/> stands in for the request's identity, which is anonymous).
/// A failure after the user was saved leaves a demo account that the cleanup removes at its expiry.
/// </remarks>
internal sealed class DemoService(
    DemoOptions settings,
    IUserRepository users,
    IDemoAccountRepository demoAccounts,
    IUserConsentRepository consents,
    ActingUserOverride acting,
    IBabyService babies,
    IEventService events,
    IMeasurementService measurements,
    IDemoTokenIssuer tokens,
    TimeProvider timeProvider,
    ILogger<DemoService> logger) : IDemoService
{
    public DemoStatusResponse GetStatus() => new(settings.IsEnabled, settings.LifetimeDays);

    public async Task<StartDemoResponse> StartAsync(StartDemoRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!settings.IsEnabled)
        {
            throw new DemoDisabledException();
        }

        if (await demoAccounts.CountAsync(cancellationToken) >= settings.MaxLiveAccounts)
        {
            logger.LogWarning("Demo start refused: {Max} live demo accounts", settings.MaxLiveAccounts);
            throw new DemoCapacityException();
        }

        var portuguese = string.Equals(request.Locale, "pt-BR", StringComparison.OrdinalIgnoreCase);
        var now = timeProvider.GetUtcNow();
        var user = await users.AddOrGetExistingAsync(
            User.CreateDemo(Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)), portuguese ? "Visitante da demo" : "Demo visitor", now, now + settings.Lifetime),
            cancellationToken);
        await GrantConsentAsync(user, portuguese ? "pt-BR" : "en", now, cancellationToken);

        acting.User = user;
        var baby = await babies.CreateAsync(
            new SaveBabyRequest { Name = portuguese ? "Bebê Demo" : "Demo Baby", BirthDate = DateOnly.FromDateTime(now.UtcDateTime.AddDays(-DemoSampleData.BabyAgeDays)) },
            cancellationToken);
        foreach (var sample in DemoSampleData.Build(baby.Id, now))
        {
            await events.UpsertAsync(baby.Id, DemoSampleData.EventId(baby.Id, sample.Slot), sample.Request, cancellationToken);
        }

        await measurements.UpsertAsync(
            baby.Id,
            DemoSampleData.EventId(baby.Id, -1),
            new UpsertMeasurementRequest { Date = DateOnly.FromDateTime(now.UtcDateTime.AddDays(-6)), WeightKg = 6.4m, HeightCm = 62.5m, HeadCircumferenceCm = 40.8m },
            cancellationToken);

        logger.LogInformation("Started demo account {UserId} (expires {ExpiresAt:O})", user.Id, user.DemoExpiresAt);
        return new StartDemoResponse(tokens.Issue(user), user.DemoExpiresAt!.Value, settings.LifetimeDays, baby.Id);
    }

    private async Task GrantConsentAsync(User user, string locale, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (await consents.FindAsync(user.Id, ConsentKind.Core, cancellationToken) is not null)
        {
            return;
        }

        var consent = UserConsent.Grant(user.Id, ConsentKind.Core, ConsentVersions.Current.Version, ConsentCapacity.Demo, locale, now);
        await consents.TryAddAsync(consent, UserConsentHistoryEntry.Of(consent, ConsentAction.Granted, now), cancellationToken);
    }
}

internal sealed class DemoCleanup(
    IDemoAccountRepository demoAccounts,
    IAccountDataEraser eraser,
    ILogger<DemoCleanup> logger) : IDemoCleanup
{
    /// <summary>The stand-in name never shows: the row is deleted right after the erasure.</summary>
    private const string StandInName = "Expired demo";

    private const int PageSize = 100;

    public async Task<DemoCleanupResult> RunOnceAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var ids = await demoAccounts.ListExpiredIdsAsync(now, PageSize, cancellationToken);
        var removed = 0;
        var failed = 0;
        foreach (var id in ids)
        {
            try
            {
                await eraser.EraseAsync(id, StandInName, now, cancellationToken);
                await demoAccounts.DeleteUserRowAsync(id, cancellationToken);
                removed++;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                failed++;
                logger.LogError(exception, "Removing an expired demo account failed; the next run retries");
            }
        }

        logger.LogInformation("Demo cleanup: {Removed} removed, {Failed} failed", removed, failed);
        return new DemoCleanupResult(removed, failed);
    }
}
