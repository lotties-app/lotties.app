using System.Collections.Frozen;

namespace Lotties.Domain.Medications;

/// <summary>
/// A dose unit counted in items or applications rather than measured (mass, volume, drops). A dose in a counted unit
/// cannot be per kg of body weight; <see cref="Spray"/> and <see cref="Puff"/> doses are whole numbers and
/// <see cref="Suppository"/> doses are multiples of 0.5 (real prescriptions use half suppositories).
/// </summary>
public enum CountedDoseUnit
{
    /// <summary>A nasal or oral spray ("2 sprays", pt-BR "2 jatos").</summary>
    Spray,

    /// <summary>An inhaler puff.</summary>
    Puff,

    /// <summary>A suppository.</summary>
    Suppository,

    /// <summary>An application of an ointment or cream.</summary>
    Application,
}

/// <summary>
/// Recognises the counted units in the free-text dose unit (units stay free text: "drops", "gotas", "ml", "mg" and
/// anything else the doctor wrote keep working). The aliases cover English and Brazilian Portuguese, singular and
/// plural, any case, with or without accents; the web client keeps the same list (code/web/src/medications/doseUnits.ts).
/// </summary>
public static class DoseUnits
{
    private static readonly FrozenDictionary<string, CountedDoseUnit> Aliases = new Dictionary<string, CountedDoseUnit>
    {
        ["spray"] = CountedDoseUnit.Spray,
        ["sprays"] = CountedDoseUnit.Spray,
        ["jato"] = CountedDoseUnit.Spray,
        ["jatos"] = CountedDoseUnit.Spray,
        ["borrifada"] = CountedDoseUnit.Spray,
        ["borrifadas"] = CountedDoseUnit.Spray,
        ["puff"] = CountedDoseUnit.Puff,
        ["puffs"] = CountedDoseUnit.Puff,
        ["inalação"] = CountedDoseUnit.Puff,
        ["inalações"] = CountedDoseUnit.Puff,
        ["inalacao"] = CountedDoseUnit.Puff,
        ["inalacoes"] = CountedDoseUnit.Puff,
        ["suppository"] = CountedDoseUnit.Suppository,
        ["suppositories"] = CountedDoseUnit.Suppository,
        ["supositório"] = CountedDoseUnit.Suppository,
        ["supositórios"] = CountedDoseUnit.Suppository,
        ["supositorio"] = CountedDoseUnit.Suppository,
        ["supositorios"] = CountedDoseUnit.Suppository,
        ["application"] = CountedDoseUnit.Application,
        ["applications"] = CountedDoseUnit.Application,
        ["aplicação"] = CountedDoseUnit.Application,
        ["aplicações"] = CountedDoseUnit.Application,
        ["aplicacao"] = CountedDoseUnit.Application,
        ["aplicacoes"] = CountedDoseUnit.Application,
    }.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);

    /// <summary>The counted unit <paramref name="unit"/> names, or <c>null</c> for a measured or unknown unit.</summary>
    public static CountedDoseUnit? CountedUnitOf(string? unit) =>
        unit is not null && Aliases.TryGetValue(unit.Trim(), out var counted) ? counted : null;

    /// <summary>
    /// The step a dose in <paramref name="unit"/> must be a multiple of: 1 for sprays and puffs, 0.5 for suppositories
    /// (half suppositories), <c>null</c> for applications (any amount).
    /// </summary>
    public static decimal? AmountStepOf(CountedDoseUnit unit) => unit switch
    {
        CountedDoseUnit.Spray or CountedDoseUnit.Puff => 1m,
        CountedDoseUnit.Suppository => 0.5m,
        _ => null,
    };
}
