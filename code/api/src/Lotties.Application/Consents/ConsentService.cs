using Lotties.Application.Users;
using Lotties.Domain.Consents;
using Lotties.Domain.Exceptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Consents;

/// <summary>One consent as the API tells it. <see cref="Accepted"/> is always <c>true</c> in <c>core</c>; an optional one says whether it is on.</summary>
public sealed record ConsentStateResponse(bool Accepted, string Version, DateTimeOffset AcceptedAt, string? Capacity, string Locale, DateTimeOffset? WithdrawnAt);

/// <summary>The optional consents by kind; each is <c>null</c> until the person first turned the feature on.</summary>
public sealed record OptionalConsentsResponse(ConsentStateResponse? Push, ConsentStateResponse? Alexa, ConsentStateResponse? Mcp, ConsentStateResponse? ByoDatabase);

/// <summary>
/// <c>GET /me/consents</c>: the version in force, the core consent (<c>null</c> before the first), the optional ones,
/// whether she must accept (never accepted, or a material change since) and, for a minor change only, the version to mark as seen.
/// </summary>
public sealed record ConsentsResponse(
    string CurrentVersion,
    string TermsVersion,
    string PrivacyPolicyVersion,
    ConsentStateResponse? Core,
    OptionalConsentsResponse Optional,
    bool RequiresAcceptance,
    string? MinorChangeSince);

/// <summary>Body of <c>PUT /me/consents/core</c>.</summary>
public sealed record AcceptCoreConsentRequest
{
    public string? Version { get; init; }

    /// <summary><c>guardian</c> or <c>authorised</c>.</summary>
    public string? Capacity { get; init; }

    /// <summary>The language of the text she read (<c>en</c>, <c>pt-BR</c>); optional.</summary>
    public string? Locale { get; init; }
}

/// <summary>Body of <c>PUT /me/consents/optional/{kind}</c>: the matching switch's new state.</summary>
public sealed record SetOptionalConsentRequest
{
    public bool? Granted { get; init; }

    public string? Locale { get; init; }
}

/// <summary>Consent records of the current user and the check the gate runs (docs/design/38-consent-and-terms.md).</summary>
public interface IConsentService
{
    Task<ConsentsResponse> GetMineAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Records the core consent for the current version. 400 <c>validation_failed</c> (field <c>version</c> or <c>capacity</c>) when one is
    /// missing or unknown, 409 <c>consent_version_outdated</c> when the version is not the current one. Accepting again is a new grant.
    /// </summary>
    Task<ConsentsResponse> AcceptCoreAsync(AcceptCoreConsentRequest request, CancellationToken cancellationToken = default);

    /// <summary>Records that an optional feature was turned on or off. Returns <c>null</c> for a kind that is not optional (the route answers 404).</summary>
    Task<ConsentsResponse?> SetOptionalAsync(string kind, SetOptionalConsentRequest request, CancellationToken cancellationToken = default);

    /// <summary>Whether <paramref name="userId"/> has a core consent in force that no material change has replaced (what the gate checks).</summary>
    Task<bool> HasCurrentCoreAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>The users among <paramref name="userIds"/> that have a core consent in force (the push reminders go to these only).</summary>
    Task<IReadOnlySet<Guid>> WithCurrentCoreAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default);
}

internal sealed class ConsentService(
    ICurrentUser currentUser,
    IUserConsentRepository consents,
    TimeProvider timeProvider,
    ILogger<ConsentService> logger) : IConsentService
{
    public const string VersionField = "version";
    public const string CapacityField = "capacity";
    public const string GrantedField = "granted";

    public async Task<bool> HasCurrentCoreAsync(Guid userId, CancellationToken cancellationToken = default) =>
        await consents.CoreVersionAsync(userId, cancellationToken) is { } version && !ConsentVersions.RequiresAcceptance(version);

    public async Task<IReadOnlySet<Guid>> WithCurrentCoreAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(userIds);
        if (userIds.Count == 0)
        {
            return new HashSet<Guid>();
        }

        var versions = await consents.CoreVersionsAsync(userIds, cancellationToken);
        return versions.Where(entry => !ConsentVersions.RequiresAcceptance(entry.Value)).Select(entry => entry.Key).ToHashSet();
    }

    public async Task<ConsentsResponse> GetMineAsync(CancellationToken cancellationToken = default)
    {
        var user = await currentUser.GetUserAsync(cancellationToken);
        return await ViewAsync(user.Id, cancellationToken);
    }

    public async Task<ConsentsResponse> AcceptCoreAsync(AcceptCoreConsentRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (string.IsNullOrWhiteSpace(request.Version))
        {
            throw new DomainValidationException(VersionField, "version is required.");
        }

        if (!ConsentCapacities.TryParse(request.Capacity, out var capacity))
        {
            throw new DomainValidationException(CapacityField, "capacity must be one of: guardian, authorised.");
        }

        if (!string.Equals(request.Version, ConsentVersions.Current.Version, StringComparison.Ordinal))
        {
            throw new ConsentVersionOutdatedException(request.Version.Length > 40 ? request.Version[..40] : request.Version);
        }

        var user = await currentUser.GetUserAsync(cancellationToken);
        await GrantAsync(user.Id, ConsentKind.Core, capacity, request.Locale, cancellationToken);
        logger.LogInformation("Recorded the core consent version {Version} of user {UserId}", ConsentVersions.Current.Version, user.Id);
        return await ViewAsync(user.Id, cancellationToken);
    }

    public async Task<ConsentsResponse?> SetOptionalAsync(string kind, SetOptionalConsentRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!ConsentKinds.TryParse(kind, out var parsed) || parsed == ConsentKind.Core)
        {
            return null;
        }

        if (request.Granted is not { } granted)
        {
            throw new DomainValidationException(GrantedField, "granted is required (true or false).");
        }

        var user = await currentUser.GetUserAsync(cancellationToken);
        if (granted)
        {
            await GrantAsync(user.Id, parsed, capacity: null, request.Locale, cancellationToken);
        }
        else
        {
            await WithdrawAsync(user.Id, parsed, cancellationToken);
        }

        logger.LogInformation("Recorded the {Kind} consent of user {UserId} as {State}", ConsentKinds.NameOf(parsed), user.Id, granted ? "on" : "off");
        return await ViewAsync(user.Id, cancellationToken);
    }

    /// <summary>
    /// Gives the consent: the first one adds the row with its history line in one save (a concurrent first request that won is
    /// then regranted over); a repeated one while it is in force at the same version records nothing (a retry is harmless).
    /// </summary>
    private async Task GrantAsync(Guid userId, ConsentKind kind, ConsentCapacity? capacity, string? locale, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var version = ConsentVersions.Current.Version;
        var stored = await consents.FindAsync(userId, kind, cancellationToken);
        if (stored is null)
        {
            var created = UserConsent.Grant(userId, kind, version, capacity, locale, now);
            if (await consents.TryAddAsync(created, UserConsentHistoryEntry.Of(created, ConsentAction.Granted, now), cancellationToken))
            {
                return;
            }

            stored = await consents.FindAsync(userId, kind, cancellationToken)
                ?? throw new InvalidOperationException($"The {kind} consent of user {userId} was saved concurrently but could not be loaded.");
        }

        if (stored.IsGranted && string.Equals(stored.Version, version, StringComparison.Ordinal) && (kind != ConsentKind.Core || stored.Capacity == capacity))
        {
            return;
        }

        stored.Regrant(version, capacity, locale, now);
        consents.AddHistory(UserConsentHistoryEntry.Of(stored, ConsentAction.Granted, now));
        await consents.SaveChangesAsync(cancellationToken);
    }

    private async Task WithdrawAsync(Guid userId, ConsentKind kind, CancellationToken cancellationToken)
    {
        var stored = await consents.FindAsync(userId, kind, cancellationToken);
        if (stored is null)
        {
            return;
        }

        var now = timeProvider.GetUtcNow();
        if (!stored.Withdraw(ConsentVersions.Current.Version, now))
        {
            return;
        }

        consents.AddHistory(UserConsentHistoryEntry.Of(stored, ConsentAction.Withdrawn, now));
        await consents.SaveChangesAsync(cancellationToken);
    }

    private async Task<ConsentsResponse> ViewAsync(Guid userId, CancellationToken cancellationToken)
    {
        var rows = (await consents.ListAsync(userId, cancellationToken)).ToDictionary(row => row.Kind);
        var core = rows.GetValueOrDefault(ConsentKind.Core) is { IsGranted: true } granted ? StateOf(granted) : null;
        var requires = core is null || ConsentVersions.RequiresAcceptance(core.Version);
        var current = ConsentVersions.Current;
        return new ConsentsResponse(
            current.Version,
            current.TermsVersion,
            current.PrivacyPolicyVersion,
            core,
            new OptionalConsentsResponse(OptionalOf(rows, ConsentKind.Push), OptionalOf(rows, ConsentKind.Alexa), OptionalOf(rows, ConsentKind.Mcp), OptionalOf(rows, ConsentKind.ByoDatabase)),
            requires,
            !requires && ConsentVersions.HasMinorChangeSince(core!.Version) ? current.Version : null);
    }

    private static ConsentStateResponse? OptionalOf(Dictionary<ConsentKind, UserConsent> rows, ConsentKind kind) =>
        rows.TryGetValue(kind, out var row) ? StateOf(row) : null;

    private static ConsentStateResponse StateOf(UserConsent row) =>
        new(row.IsGranted, row.Version, row.AcceptedAt, row.Capacity is { } capacity ? ConsentCapacities.NameOf(capacity) : null, row.Locale, row.WithdrawnAt);
}
