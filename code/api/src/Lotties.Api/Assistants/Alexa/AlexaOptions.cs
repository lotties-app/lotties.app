using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>
/// The Alexa custom skill backend (section <c>Alexa</c>, env e.g. <c>Alexa__Enabled</c>, <c>Alexa__SkillIds</c>):
/// off by default (the route answers 404). <see cref="SkillIds"/> takes a list (<c>Alexa__SkillIds__0</c>) or one
/// comma-separated value (<c>Alexa__SkillIds</c>). No secret lives here: the account-linking client secret is Amazon's
/// and Keycloak's, never the API's (docs/ALEXA.md).
/// </summary>
public sealed partial class AlexaOptions
{
    public const string SectionName = "Alexa";

    /// <summary>How far the request's timestamp may be from the server clock (Amazon's requirement).</summary>
    public static readonly TimeSpan TimestampTolerance = TimeSpan.FromSeconds(150);

    public bool Enabled { get; set; }

    /// <summary>The skill ids (<c>amzn1.ask.skill.&lt;uuid&gt;</c>) whose requests are answered; required when enabled.</summary>
    public List<string> SkillIds { get; set; } = [];

    /// <summary>How long a downloaded certificate chain is reused (never beyond its leaf's expiry); default 60 minutes.</summary>
    public int CertCacheMinutes { get; set; } = 60;

    /// <summary>Timeout of the certificate chain download; default 5 seconds.</summary>
    public int CertDownloadTimeoutSeconds { get; set; } = 5;

    /// <summary>Largest certificate chain accepted; default 64 KiB.</summary>
    public int CertMaxBytes { get; set; } = 64 * 1024;

    /// <summary>Largest request body accepted (Alexa requests are a few KiB); default 128 KiB, larger is 413.</summary>
    public int MaxRequestBodyBytes { get; set; } = 128 * 1024;

    /// <summary>Whether <paramref name="applicationId"/> is one of <see cref="SkillIds"/> (exact, ordinal).</summary>
    public bool IsSkill(string? applicationId) =>
        !string.IsNullOrEmpty(applicationId) && SkillIds.Any(id => string.Equals(id.Trim(), applicationId, StringComparison.Ordinal));

    /// <summary>Whether <paramref name="value"/> looks like an Alexa skill id.</summary>
    public static bool IsSkillIdFormat(string value) => SkillIdPattern().IsMatch(value);

    [GeneratedRegex(@"\Aamzn1\.ask\.skill\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z")]
    private static partial Regex SkillIdPattern();
}

/// <summary>Fails startup when Alexa is enabled without valid skill ids, or a limit is out of range.</summary>
internal sealed class AlexaOptionsValidator : IValidateOptions<AlexaOptions>
{
    public ValidateOptionsResult Validate(string? name, AlexaOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = CollectFailures(options).ToArray();
        return failures.Length == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static IEnumerable<string> CollectFailures(AlexaOptions options)
    {
        if (options.Enabled && options.SkillIds.Count == 0)
        {
            yield return "Alexa:SkillIds must list the skill id when Alexa:Enabled is true.";
        }

        foreach (var id in options.SkillIds.Where(id => !AlexaOptions.IsSkillIdFormat(id.Trim())))
        {
            yield return $"Alexa:SkillIds has a value that is not an Alexa skill id (amzn1.ask.skill.<uuid>): '{id}'.";
        }

        foreach (var failure in RangeFailures(options))
        {
            yield return failure;
        }
    }

    private static IEnumerable<string> RangeFailures(AlexaOptions options) =>
        new (string Name, int Value, int Min, int Max)[]
        {
            (nameof(AlexaOptions.CertCacheMinutes), options.CertCacheMinutes, 1, 1440),
            (nameof(AlexaOptions.CertDownloadTimeoutSeconds), options.CertDownloadTimeoutSeconds, 1, 30),
            (nameof(AlexaOptions.CertMaxBytes), options.CertMaxBytes, 1024, 1024 * 1024),
            (nameof(AlexaOptions.MaxRequestBodyBytes), options.MaxRequestBodyBytes, 1024, 1024 * 1024),
        }
        .Where(setting => setting.Value < setting.Min || setting.Value > setting.Max)
        .Select(setting => $"{AlexaOptions.SectionName}:{setting.Name} must be between {setting.Min} and {setting.Max}.");
}

/// <summary>Adds a comma-separated <c>Alexa:SkillIds</c> value (one env variable) to the bound list.</summary>
internal sealed class AlexaSkillIdsFromText(IConfiguration configuration) : IPostConfigureOptions<AlexaOptions>
{
    public void PostConfigure(string? name, AlexaOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var text = configuration.GetSection(AlexaOptions.SectionName)[nameof(AlexaOptions.SkillIds)];
        var fromText = (text ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        options.SkillIds = options.SkillIds.Select(id => id.Trim()).Concat(fromText).Where(id => id.Length > 0).Distinct(StringComparer.Ordinal).ToList();
    }
}
