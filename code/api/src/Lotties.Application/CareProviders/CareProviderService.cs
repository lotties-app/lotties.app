using Lotties.Application.Users;
using Lotties.Domain.CareProviders;
using Lotties.Domain.Exceptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.CareProviders;

/// <summary>Care provider use cases of one baby, for offline sync. Callers have already authorized the current user for the baby.</summary>
public interface ICareProviderService
{
    /// <summary>The baby's providers, deleted ones included: changed at or after <c>since</c> (all when <c>null</c>), by <c>(updatedAt, id)</c>.</summary>
    Task<IReadOnlyList<CareProviderResponse>> ListAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>Idempotent upsert by client id (see <see cref="CareProvider.DecideUpsert"/> for the stale and other-baby rules).</summary>
    Task<UpsertCareProviderResult> UpsertAsync(Guid babyId, Guid providerId, UpsertCareProviderRequest request, CancellationToken cancellationToken = default);
}

/// <remarks>
/// Same sync rules as appointments: the server <c>updatedAt</c> is the delta cursor, the client <c>updatedAt</c> (stored
/// as <c>clientUpdatedAt</c>) decides conflicts, an unchanged replay changes nothing, and concurrent creates of one id
/// resolve to one row (the loser applies its request as an edit). There is no delete route: <c>isDeleted</c> is the soft delete.
/// </remarks>
internal sealed class CareProviderService : ICareProviderService
{
    private readonly ICareProviderRepository _providers;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<CareProviderService> _logger;

    public CareProviderService(ICareProviderRepository providers, ICurrentUser currentUser, TimeProvider timeProvider, ILogger<CareProviderService> logger)
    {
        _providers = providers ?? throw new ArgumentNullException(nameof(providers));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<CareProviderResponse>> ListAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var found = await _providers.ListChangesAsync(babyId, since, cancellationToken);
        return found.Select(provider => (CareProviderResponse)provider).ToArray();
    }

    public async Task<UpsertCareProviderResult> UpsertAsync(Guid babyId, Guid providerId, UpsertCareProviderRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureProviderId(providerId);
        var terms = (CareProviderTerms)request;
        var existing = await _providers.FindAsync(providerId, cancellationToken);
        return existing is null
            ? await CreateAsync(babyId, providerId, terms, request.UpdatedAt, cancellationToken)
            : await UpdateAsync(babyId, existing, terms, request.UpdatedAt, cancellationToken);
    }

    private async Task<UpsertCareProviderResult> CreateAsync(Guid babyId, Guid providerId, CareProviderTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var created = CareProvider.Create(providerId, babyId, terms, user.Id, _timeProvider.GetUtcNow(), clientUpdatedAt);
        if (!await _providers.TryAddAsync(created, cancellationToken))
        {
            return await UpdateAsync(babyId, await FindConcurrentWinnerAsync(providerId, cancellationToken), terms, clientUpdatedAt, cancellationToken);
        }

        _logger.LogInformation("Created care provider {ProviderId} for baby {BabyId}", providerId, babyId);
        return new UpsertCareProviderResult(created, Created: true);
    }

    private async Task<UpsertCareProviderResult> UpdateAsync(Guid babyId, CareProvider existing, CareProviderTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();
        var decision = existing.DecideUpsert(babyId, clientUpdatedAt, now);
        if (decision != CareProviderUpsertDecision.Apply || terms == existing.Terms)
        {
            _logger.LogInformation("Upsert of care provider {ProviderId} changed nothing: {Decision}", existing.Id, decision);
            return new UpsertCareProviderResult(existing, Created: false);
        }

        existing.Edit(terms, now, clientUpdatedAt);
        await _providers.SaveChangesAsync(cancellationToken);
        return new UpsertCareProviderResult(existing, Created: false);
    }

    private async Task<CareProvider> FindConcurrentWinnerAsync(Guid providerId, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Care provider {ProviderId} was created concurrently; applying the request as an edit", providerId);
        return await _providers.FindAsync(providerId, cancellationToken)
            ?? throw new InvalidOperationException($"Care provider {providerId} was reported as existing but could not be loaded.");
    }

    private static void EnsureProviderId(Guid providerId)
    {
        if (providerId == Guid.Empty)
        {
            throw new DomainValidationException("providerId", "The provider id must be a non-empty GUID generated by the client.");
        }
    }
}
