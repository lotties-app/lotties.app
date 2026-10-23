namespace Lotties.Domain.Exceptions;

/// <summary>The user is the only owner of babies that other people still use; ownership must move first.</summary>
public sealed class AccountDeletionBlockedException : DomainException
{
    public AccountDeletionBlockedException(IReadOnlyList<Guid> babyIds)
        : base("account_deletion_blocked", "Transfer the ownership of the shared babies (or remove the other members) before deleting the account.")
    {
        BabyIds = babyIds ?? throw new ArgumentNullException(nameof(babyIds));
    }

    public IReadOnlyList<Guid> BabyIds { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["babyIds"] = BabyIds };
}
