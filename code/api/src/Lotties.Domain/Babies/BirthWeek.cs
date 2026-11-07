namespace Lotties.Domain.Babies;

/// <summary>
/// Birth in weeks (docs/design/46-privacy-first-onboarding.md): the app stores the Monday (ISO week start) on or before
/// the birth date, never the exact day. Pure; twin of <c>code/web/src/baby/birthWeek.ts</c>, same vectors.
/// </summary>
public static class BirthWeek
{
    public static DateOnly MondayOf(DateOnly date)
    {
        var sinceMonday = ((int)date.DayOfWeek + 6) % 7;
        return date.AddDays(-sinceMonday);
    }
}
