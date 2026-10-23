using Lotties.Domain.Common;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.CareProviders;

/// <summary>
/// One entry of a baby's directory of care providers ("My doctors", docs/design/22-care-providers.md). The id is client
/// generated; sync follows the formulas contract: <see cref="UpdatedAt"/> (server receive time) is the delta cursor,
/// <see cref="ClientUpdatedAt"/> (client edit time, bounded to the server clock + 5 min) decides conflicts. Never
/// removed from storage: deleting sets <see cref="IsDeleted"/> (kept, synced, restorable). Appointments copy the text
/// they need, so deleting or editing a provider never rewrites an appointment.
/// </summary>
public sealed class CareProvider
{
    private CareProvider()
    {
    }

    private CareProvider(Guid id, Guid babyId, Guid createdBy, DateTimeOffset createdAt, DateTimeOffset clientUpdatedAt)
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

    public string? Specialty { get; private set; }

    public string? RegistrationCouncil { get; private set; }

    public string? RegistrationNumber { get; private set; }

    public string? RegistrationRegion { get; private set; }

    public string? ClinicName { get; private set; }

    public string? Address { get; private set; }

    public string? Phone { get; private set; }

    public string? Whatsapp { get; private set; }

    public string? Email { get; private set; }

    public string? Website { get; private set; }

    public string? Notes { get; private set; }

    public bool IsFavorite { get; private set; }

    public bool IsDeleted { get; private set; }

    public Guid CreatedBy { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset ClientUpdatedAt { get; private set; }

    public CareProviderTerms Terms =>
        CareProviderTerms.Create(Name, Specialty, RegistrationCouncil, RegistrationNumber, RegistrationRegion, ClinicName, Address, Phone, Whatsapp, Email, Website, Notes, IsFavorite, IsDeleted);

    public static CareProvider Create(Guid id, Guid babyId, CareProviderTerms terms, Guid createdBy, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        var provider = new CareProvider(
            Ids.Required(id, nameof(id)),
            Ids.Required(babyId, nameof(babyId)),
            Ids.Required(createdBy, nameof(createdBy)),
            UtcTime.Normalize(now),
            ClientEditTime.Bound(clientUpdatedAt, now));
        provider.Apply(terms);
        return provider;
    }

    /// <summary>
    /// Decides how a client upsert applies, before any change: a provider never moves to another baby
    /// (<see cref="CareProviderBabyMismatchException"/>), and a write whose bounded client time is strictly older than
    /// <see cref="ClientUpdatedAt"/> loses (last write wins). Ties and absent times apply.
    /// </summary>
    public CareProviderUpsertDecision DecideUpsert(Guid babyId, DateTimeOffset? clientUpdatedAt, DateTimeOffset now)
    {
        if (BabyId != babyId)
        {
            throw new CareProviderBabyMismatchException(Id, babyId);
        }

        return clientUpdatedAt is not null && ClientEditTime.Bound(clientUpdatedAt, now) < ClientUpdatedAt
            ? CareProviderUpsertDecision.IgnoreStale
            : CareProviderUpsertDecision.Apply;
    }

    /// <summary>
    /// Applies the full terms. Equal terms change nothing (not even the timestamps), so a replay returns the same
    /// representation; otherwise <see cref="UpdatedAt"/> becomes <paramref name="now"/> and <see cref="ClientUpdatedAt"/>
    /// the bounded client time.
    /// </summary>
    public void Edit(CareProviderTerms terms, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
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

    private void Apply(CareProviderTerms terms)
    {
        Name = terms.Name;
        Specialty = terms.Specialty;
        RegistrationCouncil = terms.RegistrationCouncil;
        RegistrationNumber = terms.RegistrationNumber;
        RegistrationRegion = terms.RegistrationRegion;
        ClinicName = terms.ClinicName;
        Address = terms.Address;
        Phone = terms.Phone;
        Whatsapp = terms.Whatsapp;
        Email = terms.Email;
        Website = terms.Website;
        Notes = terms.Notes;
        IsFavorite = terms.IsFavorite;
        IsDeleted = terms.IsDeleted;
    }
}

/// <summary>How a client upsert applies to an existing provider (see <see cref="CareProvider.DecideUpsert"/>).</summary>
public enum CareProviderUpsertDecision
{
    /// <summary>Apply the incoming terms.</summary>
    Apply,

    /// <summary>The stored provider changed after the client's edit; the upsert is a no-op and the stored copy is returned.</summary>
    IgnoreStale,
}
