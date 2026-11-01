using Lotties.Domain.Common;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Formulas;

/// <summary>
/// An infant formula of one baby (per-baby list, docs/design/14-formulas.md). The id is client generated; sync follows
/// the events contract: <see cref="UpdatedAt"/> (server receive time) is the delta cursor, <see cref="ClientUpdatedAt"/>
/// (client edit time, bounded to the server clock + 5 min) decides conflicts. A formula is never deleted, because
/// feeding events name it: it is archived instead (<see cref="FormulaTerms.IsArchived"/>). At most one formula of a baby
/// is current (<see cref="CurrentFormula"/>).
/// </summary>
public sealed class Formula
{
    private Formula()
    {
    }

    private Formula(Guid id, Guid babyId, Guid createdBy, DateTimeOffset createdAt, DateTimeOffset clientUpdatedAt)
    {
        Id = id;
        BabyId = babyId;
        CreatedBy = createdBy;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
        ClientUpdatedAt = clientUpdatedAt;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public string? Brand { get; private set; }

    public string? Stage { get; private set; }

    public string? Notes { get; private set; }

    public DateOnly? StartedOn { get; private set; }

    public bool IsCurrent { get; private set; }

    public bool IsArchived { get; private set; }

    public Guid CreatedBy { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset ClientUpdatedAt { get; private set; }

    public FormulaTerms Terms => FormulaTerms.Create(Name, Brand, Stage, Notes, StartedOn, IsCurrent, IsArchived);

    public static Formula Create(Guid id, Guid babyId, FormulaTerms terms, Guid createdBy, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        var formula = new Formula(
            Ids.Required(id, nameof(id)),
            Ids.Required(babyId, nameof(babyId)),
            Ids.Required(createdBy, nameof(createdBy)),
            UtcTime.Normalize(now),
            ClientEditTime.Bound(clientUpdatedAt, now));
        formula.Apply(terms);
        return formula;
    }

    /// <summary>
    /// Decides how a client upsert applies, before any change: a formula never moves to another baby
    /// (<see cref="FormulaBabyMismatchException"/>), and a write whose bounded client time is strictly older than
    /// <see cref="ClientUpdatedAt"/> loses (last write wins). Ties and absent times apply.
    /// </summary>
    public FormulaUpsertDecision DecideUpsert(Guid babyId, DateTimeOffset? clientUpdatedAt, DateTimeOffset now)
    {
        if (BabyId != babyId)
        {
            throw new FormulaBabyMismatchException(Id, babyId);
        }

        return clientUpdatedAt is not null && ClientEditTime.Bound(clientUpdatedAt, now) < ClientUpdatedAt
            ? FormulaUpsertDecision.IgnoreStale
            : FormulaUpsertDecision.Apply;
    }

    /// <summary>
    /// Applies the full terms. Equal terms change nothing (not even the timestamps), so a replay returns the same
    /// representation; otherwise <see cref="UpdatedAt"/> becomes <paramref name="now"/> and <see cref="ClientUpdatedAt"/>
    /// the bounded client time.
    /// </summary>
    public void Edit(FormulaTerms terms, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        if (terms == Terms)
        {
            return;
        }

        Apply(terms);
        UpdatedAt = UtcTime.Normalize(now);
        ClientUpdatedAt = ClientEditTime.Bound(clientUpdatedAt, now);
    }

    /// <summary>
    /// Another formula of the baby became current: this one no longer is. Stamps <see cref="UpdatedAt"/> (so clients
    /// learn it through the delta) and moves <see cref="ClientUpdatedAt"/> forward to the edit that caused it (never back),
    /// so an older offline write that would make this one current again loses, as last write wins requires.
    /// </summary>
    public void YieldCurrentTo(DateTimeOffset causeClientUpdatedAt, DateTimeOffset now)
    {
        if (!IsCurrent)
        {
            return;
        }

        IsCurrent = false;
        UpdatedAt = UtcTime.Normalize(now);
        ClientUpdatedAt = causeClientUpdatedAt > ClientUpdatedAt ? UtcTime.Normalize(causeClientUpdatedAt) : ClientUpdatedAt;
    }

    private void Apply(FormulaTerms terms)
    {
        Name = terms.Name;
        Brand = terms.Brand;
        Stage = terms.Stage;
        Notes = terms.Notes;
        StartedOn = terms.StartedOn;
        IsCurrent = terms.IsCurrent;
        IsArchived = terms.IsArchived;
    }
}

/// <summary>How a client upsert applies to an existing formula (see <see cref="Formula.DecideUpsert"/>).</summary>
public enum FormulaUpsertDecision
{
    /// <summary>Apply the incoming terms.</summary>
    Apply,

    /// <summary>The stored formula changed after the client's edit; the upsert is a no-op and the stored copy is returned.</summary>
    IgnoreStale,
}
