using System.Text.RegularExpressions;
using Lotties.Domain.Imports;

namespace Lotties.Domain.Catalog.Official;

/// <summary>
/// Maps a CMED presentation text (ANVISA's abbreviations, e.g. <c>75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML</c>) to
/// a catalog <see cref="ProductForm"/>. Ordered rules, first match wins:
/// <list type="number">
/// <item>injectable, infusion, diluent or dialysis (<c>INJ</c>, <c>INFUS</c>, <c>DIL</c>, <c>IV</c>, <c>IM</c>, <c>SC</c>, <c>HD</c>, <c>DP</c>) -> other;</item>
/// <item><c>SUP</c> (supositório) -> suppository;</item>
/// <item>inhalation aerosol or powder (<c>INAL</c> with <c>AER</c>/<c>PO</c>/<c>CAP</c>, or <c>AER</c> not for skin, mouth or nose) -> inhaler;</item>
/// <item><c>SPR</c>/<c>SPRAY</c>/<c>JET</c>, a skin/mouth/nose aerosol, or a nasal solution without a dropper -> spray;</item>
/// <item><c>GOT</c> (gotas, dropper bottle) -> drops;</item>
/// <item><c>XPE</c> (xarope) -> syrup;</item>
/// <item><c>POM</c>, <c>CREM</c> or a gel that is not a capsule or tablet -> ointment (ointment or cream);</item>
/// <item><c>COM</c> (comprimido) or <c>DRG</c> (drágea) -> tablet;</item>
/// <item><c>PO</c> (pó) or <c>GRAN</c> (granulado) -> powder;</item>
/// <item>anything else (capsules, oral solutions and suspensions without a dropper, lotions, patches...) -> other.</item>
/// </list>
/// Capsules stay <c>other</c>: the catalog has no capsule form and "tablet" would misname them.
/// </summary>
public static partial class PharmaceuticalForms
{
    private static readonly IReadOnlyList<FormRule> Rules =
    [
        new(tokens => tokens.Overlaps(["INJ", "INFUS", "DIL", "IV", "IM", "SC", "HD", "DP"]), ProductForm.Other),
        new(tokens => tokens.Overlaps(["SUP", "SUPOS"]), ProductForm.Suppository),
        new(IsInhaler, ProductForm.Inhaler),
        new(IsSpray, ProductForm.Spray),
        new(tokens => tokens.Contains("GOT"), ProductForm.Drops),
        new(tokens => tokens.Contains("XPE"), ProductForm.Syrup),
        new(IsOintment, ProductForm.Ointment),
        new(tokens => tokens.Overlaps(["COM", "DRG"]), ProductForm.Tablet),
        new(tokens => tokens.Overlaps(["PO", "GRAN"]), ProductForm.Powder),
    ];

    private static readonly string[] TopicalOrNasal = ["DERM", "TOP", "BUC", "NAS", "NASAL"];

    /// <summary>The catalog form of a CMED presentation text (<see cref="ProductForm.Other"/> when no rule matches).</summary>
    public static ProductForm FromPresentation(string? presentation)
    {
        var tokens = Tokens(presentation);
        return Rules.FirstOrDefault(rule => rule.Matches(tokens))?.Form ?? ProductForm.Other;
    }

    /// <summary>Upper-case ASCII words of a presentation text (diacritics removed, so <c>PÓ</c> is <c>PO</c>).</summary>
    public static IReadOnlySet<string> Tokens(string? presentation) =>
        Word().Matches(MedicationNameMatcher.Normalize(presentation ?? string.Empty).ToUpperInvariant())
            .Select(match => match.Value)
            .ToHashSet(StringComparer.Ordinal);

    private static bool IsInhaler(IReadOnlySet<string> tokens) =>
        (tokens.Contains("INAL") && tokens.Overlaps(["AER", "PO", "CAP"]))
        || (tokens.Contains("AER") && !tokens.Overlaps(TopicalOrNasal));

    private static bool IsSpray(IReadOnlySet<string> tokens) =>
        tokens.Overlaps(["SPR", "SPRAY", "JET"])
        || (tokens.Contains("AER") && tokens.Overlaps(TopicalOrNasal))
        || (tokens.Overlaps(["NAS", "NASAL"]) && !tokens.Contains("GOT"));

    private static bool IsOintment(IReadOnlySet<string> tokens) =>
        tokens.Overlaps(["POM", "CREM"]) || (tokens.Contains("GEL") && !tokens.Overlaps(["CAP", "COM"]));

    [GeneratedRegex("[A-Z]+", RegexOptions.CultureInvariant)]
    private static partial Regex Word();

    private sealed record FormRule(Func<IReadOnlySet<string>, bool> Matches, ProductForm Form);
}
