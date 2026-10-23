using System.Diagnostics.CodeAnalysis;

namespace Lotties.Domain.Babies;

/// <summary>
/// A section of a baby's data the Owner lets a Doctor see (docs/design/19-doctor-dashboard.md): the daily log (events,
/// predictions, the timeline), growth measurements, medications (prescriptions and the doctor's own proposals), the
/// vaccine records, the formulas and the notes. Stored and sent by code (<see cref="DoctorScopes.CodeOf"/>), never by number.
/// </summary>
public enum DoctorScope
{
    DailyLog,
    Growth,
    Medications,
    Vaccines,
    Formulas,
    Notes,
}

/// <summary>The wire and storage codes of <see cref="DoctorScope"/> and their canonical order.</summary>
public static class DoctorScopes
{
    public const string DailyLogCode = "daily_log";
    public const string GrowthCode = "growth";
    public const string MedicationsCode = "medications";
    public const string VaccinesCode = "vaccines";
    public const string FormulasCode = "formulas";
    public const string NotesCode = "notes";

    /// <summary>Every scope in canonical order (the order of the enum).</summary>
    public static IReadOnlyList<DoctorScope> All { get; } = Enum.GetValues<DoctorScope>();

    public static string CodeOf(DoctorScope scope) => scope switch
    {
        DoctorScope.DailyLog => DailyLogCode,
        DoctorScope.Growth => GrowthCode,
        DoctorScope.Medications => MedicationsCode,
        DoctorScope.Vaccines => VaccinesCode,
        DoctorScope.Formulas => FormulasCode,
        DoctorScope.Notes => NotesCode,
        _ => throw new ArgumentOutOfRangeException(nameof(scope), scope, "Unknown doctor scope."),
    };

    /// <summary>Reads a code exactly as <see cref="CodeOf"/> writes it.</summary>
    public static bool TryParse([NotNullWhen(true)] string? code, out DoctorScope scope)
    {
        var found = All.Where(candidate => CodeOf(candidate) == code).Select(candidate => (DoctorScope?)candidate).FirstOrDefault();
        scope = found.GetValueOrDefault();
        return found is not null;
    }
}
