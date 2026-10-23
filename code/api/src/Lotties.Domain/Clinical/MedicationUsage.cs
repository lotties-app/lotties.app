using Lotties.Domain.Prescriptions;

namespace Lotties.Domain.Clinical;

/// <summary>One medication and how often it was given in a range: its catalog id (<c>null</c> for a dose logged without one), the name, the dose count and the latest one.</summary>
public sealed record MedicationUsage(Guid? MedicationId, string Name, int Count, DateTimeOffset LastGivenAt);

/// <summary>Groups the doses given in a range per medication; pure, no I/O.</summary>
public static class MedicationUsages
{
    /// <summary>
    /// One <see cref="MedicationUsage"/> per medication (by catalog id, else by name ignoring case), most given first
    /// (then the latest given, then the name). The name is the one the latest dose copied.
    /// </summary>
    public static IReadOnlyList<MedicationUsage> Summarize(IEnumerable<GivenMedication> given)
    {
        ArgumentNullException.ThrowIfNull(given);
        return given
            .GroupBy(KeyOf)
            .Select(ToUsage)
            .OrderByDescending(usage => usage.Count)
            .ThenByDescending(usage => usage.LastGivenAt)
            .ThenBy(usage => usage.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string KeyOf(GivenMedication dose) =>
        dose.MedicationId is { } id ? id.ToString("N") : "name:" + (dose.Name ?? string.Empty).Trim().ToUpperInvariant();

    private static MedicationUsage ToUsage(IGrouping<string, GivenMedication> doses)
    {
        var latestFirst = doses.OrderByDescending(dose => dose.GivenAt).ToArray();
        return new MedicationUsage(
            latestFirst.Select(dose => dose.MedicationId).FirstOrDefault(id => id is not null),
            latestFirst.Select(dose => dose.Name?.Trim()).FirstOrDefault(name => !string.IsNullOrEmpty(name)) ?? string.Empty,
            latestFirst.Length,
            latestFirst[0].GivenAt);
    }
}
