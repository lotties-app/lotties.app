using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Lotties.Domain.Catalog.Official;
using Lotties.Domain.Catalog.Official.Verification;

namespace Lotties.Infrastructure.Catalog.Official;

/// <summary>
/// Renders a <see cref="CuratedVerificationReport"/>: the Markdown and JSON files written to the tool's cache directory
/// (never committed: they quote the official data), the console summary and the <c>--fix-proposals</c> text. The
/// proposals are printed for a human to apply by hand; nothing edits the curated file.
/// </summary>
public static class CuratedVerificationReports
{
    private const int MaxEvidenceShown = 6;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static string ToJson(CuratedVerificationReport report) => JsonSerializer.Serialize(report, JsonOptions);

    public static string ToMarkdown(CuratedVerificationReport report, IReadOnlyList<CuratedProductEntry> entries)
    {
        var text = new StringBuilder();
        text.AppendLine(CultureInfo.InvariantCulture, $"# Curated list verification against ANVISA open data ({report.GeneratedOn})");
        text.AppendLine();
        text.AppendLine("Machine cross-check only: it compares names, ingredients, form and route with the official files. It is not a pharmacist's review and says nothing about age, warnings, dose or equivalence for treatment.");
        text.AppendLine();
        text.AppendLine("| Entry | Form | Status | Evidence (registration or notified name) |");
        text.AppendLine("|---|---|---|---|");
        foreach (var verification in report.Entries)
        {
            var form = entries.FirstOrDefault(entry => entry.Id == verification.Id)?.Form;
            text.AppendLine(CultureInfo.InvariantCulture, $"| `{verification.Id}` {verification.Name} | {(form is null ? string.Empty : OfficialCatalogPlanner.FormCode(form.Value))} | {CuratedVerificationRunner.StatusCode(verification.Status)} | {EvidenceList(verification)} |");
        }

        foreach (var verification in report.Entries)
        {
            Details(text, verification);
        }

        Findings(text, report);
        Alternatives(text, report);
        return text.ToString();
    }

    public static IReadOnlyList<string> ConsoleSummary(CuratedVerificationReport report)
    {
        var lines = new List<string>();
        foreach (var verification in report.Entries)
        {
            lines.Add($"  {CuratedVerificationRunner.StatusCode(verification.Status),-12} {verification.Id}: {verification.Summary}{(verification.Diffs.Count > 0 ? " [" + string.Join("; ", verification.Diffs.Select(diff => $"{diff.Field}: entry '{diff.Entry}' vs official '{diff.Official}'")) + "]" : string.Empty)}");
        }

        foreach (var finding in report.Findings)
        {
            lines.Add($"  {(finding.Severity == FindingSeverity.Error ? "ERROR  " : "warning")} {finding.Code}: {finding.Message}");
        }

        var differing = report.Alternatives.Count(alternative => alternative.Outcome == AlternativeCheck.Differs);
        var unverified = report.Alternatives.Count(alternative => alternative.Outcome == AlternativeCheck.Unverified);
        lines.Add($"  Suggestions checked: {report.Alternatives.Count} ({report.Alternatives.Count(alternative => alternative.Outcome == AlternativeCheck.Agrees)} agree, {differing} differ, {unverified} rest on curated data only; {report.Alternatives.Count(alternative => !alternative.SameForm)} are of another form than the entry)");
        return lines;
    }

    /// <summary>Corrections to apply by hand to the curated file; never applied automatically.</summary>
    public static IReadOnlyList<string> FixProposals(CuratedVerificationReport report)
    {
        var lines = new List<string>
        {
            "Proposed changes to Data/curated-products.json (NOT applied; review each one, keep \"reviewed\": false):",
        };
        foreach (var verification in report.Entries)
        {
            var ingredient = verification.Diffs.FirstOrDefault(diff => diff.Field == "ingredients");
            if (ingredient is not null)
            {
                lines.Add($"  {verification.Id}: ingredients -> official \"{ingredient.Official}\" (entry has \"{ingredient.Entry}\"). Confirm it is the same product before changing: the official name may belong to another product.");
            }

            foreach (var diff in verification.Diffs.Where(diff => diff.Field is "form" or "route"))
            {
                lines.Add($"  {verification.Id}: {diff.Field} -> official \"{diff.Official}\" (entry has \"{diff.Entry}\").");
            }

            lines.Add($"  {verification.Id}: add \"anvisaCheck\": {{ \"date\": \"{report.GeneratedOn}\", \"status\": \"{CuratedVerificationRunner.StatusCode(verification.Status)}\", \"evidence\": [{string.Join(", ", verification.Evidence.Take(MaxEvidenceShown).Select(product => $"\"{product.Reference}\""))}] }}");
        }

        foreach (var finding in report.Findings.Where(finding => finding.Severity == FindingSeverity.Error))
        {
            lines.Add($"  {string.Join(", ", finding.EntryIds)}: {finding.Code}: {finding.Message}");
        }

        return lines;
    }

    private static string EvidenceList(EntryVerification verification) =>
        verification.Evidence.Count == 0
            ? "none"
            : string.Join(", ", verification.Evidence.Take(MaxEvidenceShown).Select(product => $"{product.Reference}{(product.Active ? string.Empty : " (inactive)")}")) + (verification.Evidence.Count > MaxEvidenceShown ? $", +{verification.Evidence.Count - MaxEvidenceShown} more" : string.Empty);

    private static void Details(StringBuilder text, EntryVerification verification)
    {
        text.AppendLine();
        text.AppendLine(CultureInfo.InvariantCulture, $"## `{verification.Id}`: {CuratedVerificationRunner.StatusCode(verification.Status)}");
        text.AppendLine();
        text.AppendLine(verification.Summary);
        foreach (var diff in verification.Diffs)
        {
            text.AppendLine(CultureInfo.InvariantCulture, $"- DIFF {diff.Field}: entry `{diff.Entry}` vs official `{diff.Official}`");
        }

        foreach (var note in verification.Notes)
        {
            text.AppendLine(CultureInfo.InvariantCulture, $"- {note}");
        }

        if (verification.RelatedOfficialNames.Count > 0)
        {
            text.AppendLine(CultureInfo.InvariantCulture, $"- Official names starting the same (other products, NOT evidence): {string.Join(", ", verification.RelatedOfficialNames)}");
        }

        foreach (var product in verification.Evidence.Take(MaxEvidenceShown))
        {
            text.AppendLine(CultureInfo.InvariantCulture, $"- Official `{product.Reference}` \"{product.Name}\" {(product.Active ? "active" : "inactive")}, {product.Category}, holder {product.Holder}; ingredients: {(product.Ingredients.Count == 0 ? "not listed" : string.Join(" + ", product.Ingredients))}; CMED forms: {Join(product.Forms)}; routes: {Join(product.Routes)}; strengths: {Join(product.Strengths)} (read as: {Join(product.StrengthTokens ?? [])}; {product.UnreadableStrengths} not readable); CMED substance: {Join(product.CmedSubstances)}");
        }
    }

    private static void Findings(StringBuilder text, CuratedVerificationReport report)
    {
        text.AppendLine();
        text.AppendLine("## Internal consistency");
        text.AppendLine();
        if (report.Findings.Count == 0)
        {
            text.AppendLine("No findings.");
        }

        foreach (var finding in report.Findings)
        {
            text.AppendLine(CultureInfo.InvariantCulture, $"- {finding.Severity.ToString().ToUpperInvariant()} `{finding.Code}`: {finding.Message}");
        }
    }

    private static void Alternatives(StringBuilder text, CuratedVerificationReport report)
    {
        text.AppendLine();
        text.AppendLine("## \"Same active ingredient\" suggestions the app produces for each entry");
        text.AppendLine();
        text.AppendLine("| Entry | Suggested | Source | App label | Outcome |");
        text.AppendLine("|---|---|---|---|---|");
        foreach (var alternative in report.Alternatives)
        {
            text.AppendLine(CultureInfo.InvariantCulture, $"| `{alternative.EntryId}` | {alternative.AlternativeName} | {alternative.AlternativeSource} | {alternative.MatchLevel ?? "-"} | {alternative.Outcome}: {alternative.Detail} |");
        }
    }

    private static string Join(IReadOnlyList<string> values) => values.Count == 0 ? "-" : string.Join(", ", values);
}
