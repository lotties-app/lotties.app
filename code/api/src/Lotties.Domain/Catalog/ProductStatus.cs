namespace Lotties.Domain.Catalog;

/// <summary>
/// Where a catalog product comes from: <see cref="Seed"/> rows ship with a migration (cited sources), <see cref="Community"/>
/// rows were added by users of this deployment, <see cref="Verified"/> rows were checked by an administrator (no admin
/// role or endpoints exist yet), <see cref="Official"/> rows come from an official registry (the ANVISA importer,
/// <see cref="Product.Source"/> names it), <see cref="Curated"/> rows from the importer's small curated list (common
/// products missing or ambiguous in the official data; not reviewed by a pharmacist). Stored as text: members may be
/// added, never renamed.
/// </summary>
public enum ProductStatus
{
    Seed,
    Community,
    Verified,
    Official,
    Curated,
}
