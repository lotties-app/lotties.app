namespace Lotties.Domain.Catalog;

/// <summary>
/// Where a catalog product comes from: <see cref="Seed"/> rows ship with a migration (cited sources), <see cref="Community"/>
/// rows were added by users of this deployment, <see cref="Verified"/> rows were checked by an administrator (no admin
/// role or endpoints exist yet).
/// </summary>
public enum ProductStatus
{
    Seed,
    Community,
    Verified,
}
