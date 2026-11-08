namespace Lotties.Domain.Exceptions;

/// <summary>
/// The baby's records are in a family's own database, which in the first version is for the Owner alone: no member and no doctor
/// can be invited or join (docs/design/47-bring-your-own-database.md D11 and section 2.2, task T11). A conflict (409): the baby
/// must move back to Lotties-hosted storage first.
/// </summary>
public sealed class StoreOwnerOnlyException : DomainException
{
    public StoreOwnerOnlyException(Guid babyId)
        : base("store_owner_only", "This baby's records are in your own database, which only its Owner can use for now. Move them back to Lotties to share this baby.")
    {
        BabyId = babyId;
    }

    public Guid BabyId { get; }
}
