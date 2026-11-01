using Lotties.Domain.Common;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Vaccinations;

/// <summary>
/// A vaccine a baby took (docs/design/18-vaccines.md section 4). The id is client generated; sync follows the
/// prescriptions contract: <see cref="UpdatedAt"/> (server receive time) is the delta cursor, <see cref="ClientUpdatedAt"/>
/// (client edit time, bounded to the server clock + 5 min) decides conflicts, deletes are soft (<see cref="DeletedAt"/>)
/// and final. The day it was given is never in the future: at most the server's UTC date plus one day (ahead of UTC the
/// family's local today is already tomorrow in UTC).
/// </summary>
public sealed class Vaccination
{
    private Vaccination()
    {
    }

    private Vaccination(Guid id, Guid babyId, Guid createdBy, DateTimeOffset createdAt, DateTimeOffset clientUpdatedAt)
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

    public string? VaccineKey { get; private set; }

    public string? DoseId { get; private set; }

    public string? CustomName { get; private set; }

    public string? DoseLabel { get; private set; }

    public DateOnly GivenOn { get; private set; }

    public VaccineNetwork Network { get; private set; }

    public string? Clinic { get; private set; }

    public string? Lot { get; private set; }

    public string? AdministeredBy { get; private set; }

    public string? Notes { get; private set; }

    public Guid CreatedBy { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset ClientUpdatedAt { get; private set; }

    public DateTimeOffset? DeletedAt { get; private set; }

    public bool IsDeleted => DeletedAt is not null;

    public VaccinationTerms Terms =>
        VaccinationTerms.Create(VaccineKey, DoseId, CustomName, DoseLabel, GivenOn, Network, Clinic, Lot, AdministeredBy, Notes);

    /// <summary>What the status engine reads.</summary>
    public VaccinationRecord ToRecord() => new(Id, DoseId, GivenOn);

    public static Vaccination Create(Guid id, Guid babyId, VaccinationTerms terms, Guid createdBy, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        EnsureNotInFuture(terms, now);
        var vaccination = new Vaccination(
            Ids.Required(id, nameof(id)),
            Ids.Required(babyId, nameof(babyId)),
            Ids.Required(createdBy, nameof(createdBy)),
            UtcTime.Normalize(now),
            ClientEditTime.Bound(clientUpdatedAt, now));
        vaccination.Apply(terms);
        return vaccination;
    }

    /// <summary>
    /// Decides how a client upsert applies, before any change: a record never moves to another baby
    /// (<see cref="VaccinationBabyMismatchException"/>), a deleted one stays deleted, and a write whose bounded client time
    /// is strictly older than <see cref="ClientUpdatedAt"/> loses (last write wins). Ties and absent times apply.
    /// </summary>
    public VaccinationUpsertDecision DecideUpsert(Guid babyId, DateTimeOffset? clientUpdatedAt, DateTimeOffset now)
    {
        if (BabyId != babyId)
        {
            throw new VaccinationBabyMismatchException(Id, babyId);
        }

        return this switch
        {
            { IsDeleted: true } => VaccinationUpsertDecision.IgnoreDeleted,
            _ when clientUpdatedAt is not null && ClientEditTime.Bound(clientUpdatedAt, now) < ClientUpdatedAt => VaccinationUpsertDecision.IgnoreStale,
            _ => VaccinationUpsertDecision.Apply,
        };
    }

    /// <summary>
    /// Applies the full terms. Equal terms change nothing (not even the timestamps), so a replay returns the same
    /// representation; otherwise <see cref="UpdatedAt"/> becomes <paramref name="now"/> and <see cref="ClientUpdatedAt"/>
    /// the bounded client time. A deleted record is never edited (the service ignores such writes first).
    /// </summary>
    public void Edit(VaccinationTerms terms, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        if (IsDeleted || terms == Terms)
        {
            return;
        }

        EnsureNotInFuture(terms, now);
        Apply(terms);
        UpdatedAt = UtcTime.Normalize(now);
        ClientUpdatedAt = ClientEditTime.Bound(clientUpdatedAt, now);
    }

    /// <summary>Soft delete; always wins and is idempotent. Stamps <see cref="DeletedAt"/>, <see cref="UpdatedAt"/> and <see cref="ClientUpdatedAt"/> with <paramref name="now"/>.</summary>
    public void SoftDelete(DateTimeOffset now)
    {
        if (IsDeleted)
        {
            return;
        }

        var deletedAt = UtcTime.Normalize(now);
        DeletedAt = deletedAt;
        UpdatedAt = deletedAt;
        ClientUpdatedAt = deletedAt;
    }

    /// <summary>The latest accepted day: the server's UTC date plus one day.</summary>
    public static DateOnly LatestGivenOn(DateTimeOffset now) => DateOnly.FromDateTime(UtcTime.Normalize(now).UtcDateTime).AddDays(1);

    private static void EnsureNotInFuture(VaccinationTerms terms, DateTimeOffset now)
    {
        var latest = LatestGivenOn(now);
        if (terms.GivenOn > latest)
        {
            throw new DomainValidationException("givenOn", $"givenOn must not be after {latest:yyyy-MM-dd}.");
        }
    }

    private void Apply(VaccinationTerms terms)
    {
        VaccineKey = terms.VaccineKey;
        DoseId = terms.DoseId;
        CustomName = terms.CustomName;
        DoseLabel = terms.DoseLabel;
        GivenOn = terms.GivenOn;
        Network = terms.Network;
        Clinic = terms.Clinic;
        Lot = terms.Lot;
        AdministeredBy = terms.AdministeredBy;
        Notes = terms.Notes;
    }
}

/// <summary>How a client upsert applies to an existing record (see <see cref="Vaccination.DecideUpsert"/>).</summary>
public enum VaccinationUpsertDecision
{
    /// <summary>Apply the incoming terms.</summary>
    Apply,

    /// <summary>The stored record changed after the client's edit; the upsert is a no-op and the stored copy is returned.</summary>
    IgnoreStale,

    /// <summary>The record was deleted (deletes are final); the upsert is a no-op and the stored copy is returned.</summary>
    IgnoreDeleted,
}

/// <summary>Persistence for <see cref="Vaccination"/>. Records are soft deleted; list reads include deleted ones.</summary>
public interface IVaccinationRepository
{
    /// <summary>The record with <paramref name="vaccinationId"/> whatever baby it belongs to, deleted included; tracked.</summary>
    Task<Vaccination?> FindAsync(Guid vaccinationId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The baby's records, deleted included: changed at or after <paramref name="since"/> ordered by <c>(UpdatedAt, Id)</c>
    /// (the delta), or all by <c>(GivenOn, Id)</c> without it; not tracked.
    /// </summary>
    Task<IReadOnlyList<Vaccination>> ListAsync(Guid babyId, DateTimeOffset? since, CancellationToken cancellationToken = default);

    /// <summary>The baby's records that are not deleted (what the status engine reads); not tracked.</summary>
    Task<IReadOnlyList<Vaccination>> ListActiveAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Saves a new record; <c>false</c> (nothing tracked) when a concurrent request created the same id first.</summary>
    Task<bool> TryAddAsync(Vaccination vaccination, CancellationToken cancellationToken = default);

    /// <summary>Saves the tracked changes.</summary>
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
