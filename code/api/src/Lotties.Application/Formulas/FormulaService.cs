using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Formulas;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Formulas;

/// <summary>Formula use cases of one baby, for offline sync. Callers have already authorized the current user for the baby.</summary>
public interface IFormulaService
{
    /// <summary>The baby's formulas changed at or after <paramref name="since"/> (all when <c>null</c>), archived included, by (updatedAt, id).</summary>
    Task<IReadOnlyList<FormulaResponse>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>
    /// Idempotent upsert by client id (see <see cref="Formula.DecideUpsert"/> for the stale and other-baby rules). Making
    /// a formula current makes every other formula of the baby not current, in the same transaction
    /// (<see cref="CurrentFormula"/>).
    /// </summary>
    Task<UpsertFormulaResult> UpsertAsync(Guid babyId, Guid formulaId, UpsertFormulaRequest request, CancellationToken cancellationToken = default);
}

/// <remarks>
/// Same sync rules as prescriptions: the server <c>updatedAt</c> is the delta cursor, the client <c>updatedAt</c> (stored
/// as <c>clientUpdatedAt</c>) decides conflicts, an unchanged replay changes nothing, and concurrent creates of one id
/// resolve to one row (the loser applies its request as an edit). The other current formula is cleared in a first save
/// and the change saved in a second one of the same transaction, so the one-current index is never broken in between.
/// </remarks>
internal sealed class FormulaService : IFormulaService
{
    private readonly IFormulaRepository _formulas;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<FormulaService> _logger;

    public FormulaService(IFormulaRepository formulas, ICurrentUser currentUser, TimeProvider timeProvider, ILogger<FormulaService> logger)
    {
        _formulas = formulas ?? throw new ArgumentNullException(nameof(formulas));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<FormulaResponse>> ListChangesAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default)
    {
        var changed = await _formulas.ListChangesAsync(babyId, since, cancellationToken);
        return changed.Select(formula => (FormulaResponse)formula).ToArray();
    }

    public async Task<UpsertFormulaResult> UpsertAsync(Guid babyId, Guid formulaId, UpsertFormulaRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        EnsureFormulaId(formulaId);
        var terms = (FormulaTerms)request;
        var existing = await _formulas.FindAsync(formulaId, cancellationToken);
        return existing is null
            ? await CreateAsync(babyId, formulaId, terms, request.UpdatedAt, cancellationToken)
            : await UpdateAsync(babyId, existing, terms, request.UpdatedAt, cancellationToken);
    }

    private async Task<UpsertFormulaResult> CreateAsync(Guid babyId, Guid formulaId, FormulaTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var created = Formula.Create(formulaId, babyId, terms, user.Id, _timeProvider.GetUtcNow(), clientUpdatedAt);
        var conflict = await TrySaveNewAsync(created, clientUpdatedAt, cancellationToken);
        if (conflict is null)
        {
            _logger.LogInformation("Created formula {FormulaId} for baby {BabyId}", formulaId, babyId);
            return new UpsertFormulaResult(created, Created: true);
        }

        var winner = await _formulas.FindAsync(formulaId, cancellationToken) ?? throw conflict;
        _logger.LogInformation("Formula {FormulaId} was created concurrently; applying the request as an edit", formulaId);
        return await UpdateAsync(babyId, winner, terms, clientUpdatedAt, cancellationToken);
    }

    private async Task<ConcurrentModificationException?> TrySaveNewAsync(Formula created, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        try
        {
            await _formulas.InTransactionAsync(token => SaveNewAsync(created, clientUpdatedAt, token), cancellationToken);
            return null;
        }
        catch (ConcurrentModificationException conflict)
        {
            return conflict;
        }
    }

    private async Task SaveNewAsync(Formula created, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        await MakeRoomAsync(created.BabyId, created.Id, created.Terms, clientUpdatedAt, cancellationToken);
        await _formulas.AddAsync(created, cancellationToken);
    }

    private async Task<UpsertFormulaResult> UpdateAsync(Guid babyId, Formula existing, FormulaTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        var decision = existing.DecideUpsert(babyId, clientUpdatedAt, _timeProvider.GetUtcNow());
        if (decision != FormulaUpsertDecision.Apply || terms == existing.Terms)
        {
            _logger.LogInformation("Upsert of formula {FormulaId} changed nothing: {Decision}", existing.Id, decision);
            return new UpsertFormulaResult(existing, Created: false);
        }

        await _formulas.InTransactionAsync(token => SaveEditAsync(existing, terms, clientUpdatedAt, token), cancellationToken);
        return new UpsertFormulaResult(existing, Created: false);
    }

    private async Task SaveEditAsync(Formula existing, FormulaTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        await MakeRoomAsync(existing.BabyId, existing.Id, terms, clientUpdatedAt, cancellationToken);
        existing.Edit(terms, _timeProvider.GetUtcNow(), clientUpdatedAt);
        await _formulas.SaveChangesAsync(cancellationToken);
    }

    private async Task MakeRoomAsync(Guid babyId, Guid formulaId, FormulaTerms terms, DateTimeOffset? clientUpdatedAt, CancellationToken cancellationToken)
    {
        if (!terms.IsCurrent)
        {
            return;
        }

        var current = await _formulas.ListCurrentAsync(babyId, cancellationToken);
        var yielded = CurrentFormula.MakeRoom(babyId, formulaId, terms, current, clientUpdatedAt, _timeProvider.GetUtcNow());
        await SaveYieldedAsync(yielded, babyId, cancellationToken);
    }

    private async Task SaveYieldedAsync(IReadOnlyList<Formula> yielded, Guid babyId, CancellationToken cancellationToken)
    {
        if (yielded.Count == 0)
        {
            return;
        }

        await _formulas.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Cleared the current formula {FormulaIds} of baby {BabyId}", yielded.Select(formula => formula.Id).ToArray(), babyId);
    }

    private static void EnsureFormulaId(Guid formulaId)
    {
        if (formulaId == Guid.Empty)
        {
            throw new DomainValidationException("formulaId", "The formula id must be a non-empty GUID generated by the client.");
        }
    }
}
