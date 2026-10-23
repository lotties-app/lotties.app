using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Babies;

/// <summary>
/// The sections a Doctor member sees (0-6 distinct <see cref="DoctorScope"/> values, kept in canonical order). Immutable
/// and compared by content. A member without a stored set sees <see cref="All"/> (the defaults, see
/// <see cref="BabyMember.EffectiveDoctorScopes"/>); the empty set <see cref="None"/> hides every section. Sent as codes
/// (<c>["daily_log","growth"]</c>) and stored as the comma-separated codes (<see cref="ToStorage"/>).
/// </summary>
public sealed record DoctorScopeSet
{
    public const string Field = "doctorScopes";
    public const int StorageMaxLength = 128;

    private const char StorageSeparator = ',';

    private readonly int _mask;

    private DoctorScopeSet(int mask)
    {
        _mask = mask;
    }

    /// <summary>Every section (the default of a Doctor).</summary>
    public static DoctorScopeSet All { get; } = Create(DoctorScopes.All);

    /// <summary>No section.</summary>
    public static DoctorScopeSet None { get; } = new(0);

    /// <summary>The scopes in canonical order.</summary>
    public IReadOnlyList<DoctorScope> Values => DoctorScopes.All.Where(Contains).ToArray();

    /// <summary>The codes of <see cref="Values"/>.</summary>
    public IReadOnlyList<string> Codes => Values.Select(DoctorScopes.CodeOf).ToArray();

    public static DoctorScopeSet Create(IEnumerable<DoctorScope> scopes)
    {
        ArgumentNullException.ThrowIfNull(scopes);
        return new DoctorScopeSet(scopes.Aggregate(0, (mask, scope) => mask | BitOf(scope)));
    }

    /// <summary>
    /// Parses codes sent by a client: duplicates collapse, an empty list is the empty set; an unknown or <c>null</c> code
    /// throws <see cref="DomainValidationException"/> (field <c>doctorScopes</c>).
    /// </summary>
    public static DoctorScopeSet Parse(IEnumerable<string?>? codes)
    {
        ArgumentNullException.ThrowIfNull(codes);
        return Create(codes.Select(ParseOne).ToArray());
    }

    /// <summary>
    /// Reads the stored comma-separated codes, leniently: unknown codes (written by a newer server) are ignored, so an
    /// older server never fails on a row. <c>null</c> or empty text is the empty set.
    /// </summary>
    public static DoctorScopeSet FromStorage(string? stored)
    {
        var codes = (stored ?? string.Empty).Split(StorageSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return Create(codes.Select(ParseKnown).OfType<DoctorScope>().ToArray());
    }

    public bool Contains(DoctorScope scope) => (_mask & BitOf(scope)) != 0;

    /// <summary>The comma-separated codes in canonical order (<c>daily_log,growth</c>); empty text for none.</summary>
    public string ToStorage() => string.Join(StorageSeparator, Codes);

    private static DoctorScope ParseOne(string? code) =>
        DoctorScopes.TryParse(code, out var scope)
            ? scope
            : throw new DomainValidationException(Field, $"doctorScopes entries must be one of {string.Join(", ", DoctorScopes.All.Select(DoctorScopes.CodeOf))}, got '{code ?? "null"}'.");

    private static DoctorScope? ParseKnown(string code) => DoctorScopes.TryParse(code, out var scope) ? scope : null;

    private static int BitOf(DoctorScope scope) => Enum.IsDefined(scope)
        ? 1 << (int)scope
        : throw new DomainValidationException(Field, $"Doctor scope {scope} is not supported.");
}
