namespace Lotties.Domain.Consents;

/// <summary>One published version of the consent text: the pair (terms version, privacy policy version) and whether it asks everyone to accept again.</summary>
/// <param name="Version">The consent version, stored with every record (<c>2026-10-27.1</c>); entries are listed oldest first.</param>
/// <param name="TermsVersion">The terms of use version this entry carries (web <c>TERMS_VERSION</c>).</param>
/// <param name="PrivacyPolicyVersion">The privacy policy version this entry carries (web <c>PRIVACY_POLICY_VERSION</c>).</param>
/// <param name="Material">
/// <c>true</c>: everyone must accept again before continuing (new data collected, a new recipient or purpose, a change in rights
/// or in who is responsible). <c>false</c>: a minor change, shown as a dismissible notice.
/// </param>
/// <param name="Date">The calendar date the version was written, <c>yyyy-mm-dd</c>.</param>
public sealed record ConsentVersionEntry(string Version, string TermsVersion, string PrivacyPolicyVersion, bool Material, string Date);

/// <summary>
/// The consent versions in one list (docs/design/38-consent-and-terms.md section 2, decision 3). It mirrors
/// <c>code/web/src/legal/consentVersions.json</c> (the web reads the same file); <c>ConsentVersionTests</c> fails when the two
/// disagree. Add an entry at the end for every change that alters the meaning of the terms, the privacy policy or the consent screen;
/// never edit or remove an entry (records keep pointing at them).
/// </summary>
public static class ConsentVersions
{
    /// <summary>Every version, oldest first.</summary>
    public static IReadOnlyList<ConsentVersionEntry> Entries { get; } =
    [
        new("2026-10-27.1", TermsVersion: "1", PrivacyPolicyVersion: "9", Material: true, Date: "2026-10-27"),
        new("2026-10-30.1", TermsVersion: "1", PrivacyPolicyVersion: "10", Material: false, Date: "2026-10-30"),
        new("2026-11-03.1", TermsVersion: "1", PrivacyPolicyVersion: "11", Material: false, Date: "2026-11-03"),
        new("2026-11-06.1", TermsVersion: "1", PrivacyPolicyVersion: "12", Material: false, Date: "2026-11-06"),
        new("2026-11-11.1", TermsVersion: "1", PrivacyPolicyVersion: "13", Material: false, Date: "2026-11-11"),
    ];

    /// <summary>The newest version.</summary>
    public static ConsentVersionEntry Current => Entries[^1];

    /// <summary>The position of <paramref name="version"/> in <see cref="Entries"/>, or -1 for a version the code does not know.</summary>
    public static int IndexOf(string? version) => IndexOf(Entries, version);

    /// <summary>
    /// Whether a person whose core consent is <paramref name="acceptedVersion"/> (<c>null</c>: none) must accept again: she never
    /// accepted, the version is unknown, or a material entry came after it.
    /// </summary>
    public static bool RequiresAcceptance(string? acceptedVersion) => RequiresAcceptance(Entries, acceptedVersion);

    /// <summary>Whether she accepted an older version and only minor entries came since (a "policy updated" notice, no new consent).</summary>
    public static bool HasMinorChangeSince(string? acceptedVersion) => HasMinorChangeSince(Entries, acceptedVersion);

    /// <summary><see cref="IndexOf(string?)"/> over an explicit list (the rules are pure; the tests run them over lists of their own).</summary>
    public static int IndexOf(IReadOnlyList<ConsentVersionEntry> entries, string? version)
    {
        ArgumentNullException.ThrowIfNull(entries);
        for (var index = 0; index < entries.Count; index++)
        {
            if (string.Equals(entries[index].Version, version, StringComparison.Ordinal))
            {
                return index;
            }
        }

        return -1;
    }

    /// <summary><see cref="RequiresAcceptance(string?)"/> over an explicit list.</summary>
    public static bool RequiresAcceptance(IReadOnlyList<ConsentVersionEntry> entries, string? acceptedVersion)
    {
        var accepted = IndexOf(entries, acceptedVersion);
        return accepted < 0 || entries.Skip(accepted + 1).Any(entry => entry.Material);
    }

    /// <summary><see cref="HasMinorChangeSince(string?)"/> over an explicit list.</summary>
    public static bool HasMinorChangeSince(IReadOnlyList<ConsentVersionEntry> entries, string? acceptedVersion)
    {
        var accepted = IndexOf(entries, acceptedVersion);
        return accepted >= 0 && accepted < entries.Count - 1 && !RequiresAcceptance(entries, acceptedVersion);
    }
}
