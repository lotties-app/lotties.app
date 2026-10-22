using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Vaccinations;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Vaccinations;

/// <summary>Vaccination record use cases of one baby, for offline sync. Callers have already authorized the current user for the baby.</summary>
public interface IVaccinationService
{
    /// <summary>The baby's records, deleted included: changed at or after <paramref name="since"/> by <c>(updatedAt, id)</c>, or all by <c>(givenOn, id)</c>.</summary>
    Task<IReadOnlyList<VaccinationResponse>> ListAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>Idempotent upsert by client id (see <see cref="Vaccination.DecideUpsert"/> for the stale, deleted and other-baby rules).</summary>
    Task<UpsertVaccinationResult> UpsertAsync(Guid babyId, Guid vaccinationId, UpsertVaccinationRequest request, CancellationToken cancellationToken = default);

    /// <summary>Soft delete; idempotent, and an unknown id (or one of another baby) is a no-op.</summary>
    Task DeleteAsync(Guid babyId, Guid vaccinationId, CancellationToken cancellationToken = default);
}

/// <remarks>
/// Same sync rules as prescriptions: the server <c>updatedAt</c> is the delta cursor, the client <c>updatedAt</c> (stored
/// as <c>clientUpdatedAt</c>) decides conflicts, an unchanged replay changes nothing, concurrent creates of one id resolve
/// to one row (the loser applies its request as an edit), and deletes are soft and final.
/// </remarks>
internal sealed class VaccinationService : IVaccinationService
{
    private readonly IVaccinationRepository _vaccinations;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<VaccinationService> _logger;

    public VaccinationService(IVaccinationRepository vaccinations, ICurrentUser currentUser, TimeProvider timeProvider, ILogger<VaccinationService> logger)
    {
        _vaccinations = vaccinations ?? throw new ArgumentNullException(nameof(vaccinations));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<VaccinationResponse>> ListAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var found = await _vaccinations.ListAsync(babyId, since, cancellationToken);
        return found.Select(vaccination => (VaccinationResponse)vaccination).ToArray();
    }

    public async Task<UpsertVaccinationResult> UpsertAsync(Guid babyId, Guid vaccinationId, UpsertVaccinationRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureVaccinationId(vaccinationId);
        var terms = (VaccinationTerms)request;
        var existing = await _vaccinations.FindAsync(vaccinationId, cancellationToken);
        return existing is null
            ? await CreateAsync(babyId, vaccinationId, terms, request.UpdatedAt, cancellationToken)
            : await UpdateAsync(babyId, existing, terms, request.UpdatedAt, cancellationToken);
    }

    public async Task DeleteAsync(Guid babyId, Guid vaccinationId, CancellationToken cancellationToken = default)
    {
        var existing = await _vaccinations.FindAsync(vaccinationId, cancellationToken);
        if (existing is null || existing.BabyId != babyId)
        {
            _logger.LogDebug("Delete of unknown vaccination {VaccinationId} for baby {BabyId} is a no-op", vaccinationId, babyId);
            return;
        }

        existing.SoftDelete(_timeProvider.GetUtcNow());
        await _vaccinations.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Soft deleted vaccination {VaccinationId} of baby {BabyId}", vaccinationId, babyId);
    }

    private async Task<UpsertVaccinationResult> CreateAsync(Guid babyId, Guid vaccinationId, VaccinationTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var created = Vaccination.Create(vaccinationId, babyId, terms, user.Id, _timeProvider.GetUtcNow(), clientUpdatedAt);
        if (!await _vaccinations.TryAddAsync(created, cancellationToken))
        {
            return await UpdateAsync(babyId, await FindConcurrentWinnerAsync(vaccinationId, cancellationToken), terms, clientUpdatedAt, cancellationToken);
        }

        _logger.LogInformation("Created vaccination {VaccinationId} for baby {BabyId}", vaccinationId, babyId);
        return new UpsertVaccinationResult(created, Created: true);
    }

    private async Task<UpsertVaccinationResult> UpdateAsync(Guid babyId, Vaccination existing, VaccinationTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var now = _timeProvider.GetUtcNow();
        var decision = existing.DecideUpsert(babyId, clientUpdatedAt, now);
        if (decision != VaccinationUpsertDecision.Apply || terms == existing.Terms)
        {
            _logger.LogInformation("Upsert of vaccination {VaccinationId} changed nothing: {Decision}", existing.Id, decision);
            return new UpsertVaccinationResult(existing, Created: false);
        }

        existing.Edit(terms, now, clientUpdatedAt);
        await _vaccinations.SaveChangesAsync(cancellationToken);
        return new UpsertVaccinationResult(existing, Created: false);
    }

    private async Task<Vaccination> FindConcurrentWinnerAsync(Guid vaccinationId, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Vaccination {VaccinationId} was created concurrently; applying the request as an edit", vaccinationId);
        return await _vaccinations.FindAsync(vaccinationId, cancellationToken)
            ?? throw new InvalidOperationException($"Vaccination {vaccinationId} was reported as existing but could not be loaded.");
    }

    private static void EnsureVaccinationId(Guid vaccinationId)
    {
        if (vaccinationId == Guid.Empty)
        {
            throw new DomainValidationException("vaccinationId", "The vaccination id must be a non-empty GUID generated by the client.");
        }
    }
}
