namespace Lotties.Domain.Catalog;

/// <summary>
/// The pharmaceutical form of a catalog product (its presentation). Stored and sent as text, so members may be added
/// but never renamed. <see cref="Spray"/> (nasal or oral), <see cref="Ointment"/> (ointment or cream, topical),
/// <see cref="Suppository"/> and <see cref="Inhaler"/> are dosed in counted units (see
/// <see cref="Lotties.Domain.Medications.CountedDoseUnit"/>).
/// </summary>
public enum ProductForm
{
    Drops,
    Syrup,
    Tablet,
    Powder,
    Other,
    Spray,
    Ointment,
    Suppository,
    Inhaler,
}
