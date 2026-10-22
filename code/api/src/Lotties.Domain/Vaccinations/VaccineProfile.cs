using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Vaccinations;

/// <summary>Which recommendations a baby's schedule shows.</summary>
public enum VaccineCoverage
{
    /// <summary>The public schedule only (SUS, PNI): code <c>public</c>.</summary>
    Public,

    /// <summary>The public schedule plus the private-clinic recommendations of SBP and SBIm: code <c>public+private</c>.</summary>
    PublicAndPrivate,
}

/// <summary>Whether the mother got the RSV vaccine in pregnancy (as the family answered).</summary>
public enum RsvMaternalVaccination
{
    Unknown,
    Yes,
    No,
}

/// <summary>
/// What the vaccine schedule needs to know about a baby besides the birth date: the coverage, the gestational age at
/// birth (weeks; <c>null</c> = not told, term assumed) and the mother's RSV vaccination in pregnancy (<c>null</c> = not
/// answered, treated as unknown). A premature baby (under <see cref="TermWeeks"/> weeks) gets a notice; the dates never change.
/// </summary>
public sealed record VaccineProfile
{
    public const int TermWeeks = 37;
    public const int MinGestationalAgeWeeks = 20;
    public const int MaxGestationalAgeWeeks = 44;
    public const string PublicCode = "public";
    public const string PublicAndPrivateCode = "public+private";

    private VaccineProfile(VaccineCoverage coverage, int? gestationalAgeWeeks, RsvMaternalVaccination? rsvMaternalVaccination)
    {
        Coverage = coverage;
        GestationalAgeWeeks = gestationalAgeWeeks;
        RsvMaternalVaccination = rsvMaternalVaccination;
    }

    /// <summary>A baby nobody told the app about: public schedule, term, RSV vaccination not answered.</summary>
    public static VaccineProfile Default { get; } = new(VaccineCoverage.Public, null, null);

    public VaccineCoverage Coverage { get; }

    public int? GestationalAgeWeeks { get; }

    public RsvMaternalVaccination? RsvMaternalVaccination { get; }

    /// <summary>Born before 37 weeks: the schedule shows the premature notice (dates unchanged).</summary>
    public bool IsPremature => GestationalAgeWeeks is < TermWeeks;

    /// <summary>Validates; throws <see cref="DomainValidationException"/> naming the field.</summary>
    public static VaccineProfile Create(VaccineCoverage coverage, int? gestationalAgeWeeks, RsvMaternalVaccination? rsvMaternalVaccination)
    {
        if (!Enum.IsDefined(coverage))
        {
            throw new DomainValidationException("vaccineProfile", "vaccineProfile must be public or public+private.");
        }

        if (gestationalAgeWeeks is < MinGestationalAgeWeeks or > MaxGestationalAgeWeeks)
        {
            throw new DomainValidationException("gestationalAgeWeeks", $"gestationalAgeWeeks must be between {MinGestationalAgeWeeks} and {MaxGestationalAgeWeeks}.");
        }

        if (rsvMaternalVaccination is { } rsv && !Enum.IsDefined(rsv))
        {
            throw new DomainValidationException("rsvMaternalVaccination", "rsvMaternalVaccination must be unknown, yes or no.");
        }

        return new VaccineProfile(coverage, gestationalAgeWeeks, rsvMaternalVaccination);
    }

    /// <summary>The wire and storage code of <paramref name="coverage"/>.</summary>
    public static string CodeOf(VaccineCoverage coverage) => coverage switch
    {
        VaccineCoverage.Public => PublicCode,
        VaccineCoverage.PublicAndPrivate => PublicAndPrivateCode,
        _ => throw new ArgumentOutOfRangeException(nameof(coverage), coverage, "Unknown vaccine coverage."),
    };

    /// <summary>The coverage of a wire or storage code; throws <see cref="DomainValidationException"/> for anything else.</summary>
    public static VaccineCoverage CoverageOf(string? code) => code switch
    {
        PublicCode => VaccineCoverage.Public,
        PublicAndPrivateCode => VaccineCoverage.PublicAndPrivate,
        _ => throw new DomainValidationException("vaccineProfile", "vaccineProfile must be public or public+private."),
    };
}
