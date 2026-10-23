namespace Lotties.Domain.Catalog.Official.Verification;

/// <summary>
/// One row of the registered-medicines file with the columns the verifier reads beyond <see cref="AnvisaRegistrationRow"/>:
/// the registration holder (company name) and the regulatory category (<c>BAIXO RISCO</c> = notified, no registration number).
/// </summary>
public sealed record AnvisaRegistrationDetail(string ProductName, string RegistrationNumber, string Status, string ActiveIngredients, string Holder, string Category)
{
    public bool IsActive => string.Equals(Status.Trim(), AnvisaRegistrationRow.ActiveStatus, StringComparison.OrdinalIgnoreCase);

    public AnvisaRegistrationRow ToRow() => new(ProductName, RegistrationNumber, Status, ActiveIngredients);
}

/// <summary>One CMED presentation with its substance column (<c>SUBSTÂNCIA</c>, separated by <c>;</c>).</summary>
public sealed record CmedPresentationDetail(string Registration, string ProductName, string Presentation, string Substance)
{
    public CmedPresentationRow ToRow() => new(Registration, ProductName, Presentation);
}

/// <summary>Outcome of checking a curated entry against the official data.</summary>
public enum VerificationStatus
{
    /// <summary>Active official registration whose ingredients, form and route agree with the entry.</summary>
    Verified,

    /// <summary>The official data disagrees with the entry (see the field diffs).</summary>
    Mismatch,

    /// <summary>No official registration or notification under the entry's name (it may be notification-exempt).</summary>
    NotFound,

    /// <summary>Several active official products share the name with different ingredient sets.</summary>
    Ambiguous,

    /// <summary>Only inactive (cancelled, expired) official registrations exist.</summary>
    Cancelled,

    /// <summary>An active official record exists but lists no ingredient (notified product), so nothing can be compared.</summary>
    Unverifiable,
}

/// <summary>One field where the entry and the official data differ (or the official data could not be compared).</summary>
public sealed record FieldDiff(string Field, string Entry, string Official);

/// <summary>An official product (one registration, or one notified product name) found for an entry: references only, no bulk data.</summary>
public sealed record OfficialProductEvidence(
    string Name,
    string Registration,
    bool Active,
    string Holder,
    string Category,
    IReadOnlyList<string> Ingredients,
    IReadOnlyList<string> IngredientKeys,
    IReadOnlyList<string> Forms,
    IReadOnlyList<string> Routes,
    IReadOnlyList<string> Strengths,
    IReadOnlyList<string> CmedSubstances)
{
    /// <summary>The registration number, or <c>notified:&lt;name&gt;</c> for a product without one.</summary>
    public string Reference => Registration.Length > 0 ? Registration : "notified:" + Name;
}

/// <summary>The verification of one curated entry.</summary>
public sealed record EntryVerification(
    string Id,
    string Name,
    VerificationStatus Status,
    string Summary,
    IReadOnlyList<string> EntryIngredientKeys,
    IReadOnlyList<FieldDiff> Diffs,
    IReadOnlyList<OfficialProductEvidence> Evidence,
    IReadOnlyList<string> Notes,
    IReadOnlyList<string> RelatedOfficialNames);

/// <summary>Severity of a consistency finding: errors fail the command, warnings are listed.</summary>
public enum FindingSeverity
{
    Warning,
    Error,
}

/// <summary>An internal-consistency finding about the curated list.</summary>
public sealed record ConsistencyFinding(string Code, FindingSeverity Severity, string Message, IReadOnlyList<string> EntryIds);

/// <summary>One "same active ingredient" suggestion the app would show for a curated entry.</summary>
public sealed record AlternativeCheck(string EntryId, string AlternativeName, string AlternativeSource, string Outcome, string Detail, bool SameForm = true)
{
    public const string Agrees = "AGREES";
    public const string Differs = "DIFFERS";
    public const string Unverified = "UNVERIFIED";
}

/// <summary>The whole report.</summary>
public sealed record CuratedVerificationReport(
    string GeneratedOn,
    IReadOnlyList<EntryVerification> Entries,
    IReadOnlyList<ConsistencyFinding> Findings,
    IReadOnlyList<AlternativeCheck> Alternatives)
{
    public bool HasFailures =>
        Entries.Any(entry => entry.Status == VerificationStatus.Mismatch)
        || Findings.Any(finding => finding.Severity == FindingSeverity.Error)
        || Alternatives.Any(alternative => alternative.Outcome == AlternativeCheck.Differs);
}
