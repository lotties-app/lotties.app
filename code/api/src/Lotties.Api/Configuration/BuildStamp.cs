using System.Globalization;
using System.Text.RegularExpressions;

namespace Lotties.Api.Configuration;

/// <summary>
/// The release this API build is (docs/DEPLOY.md "Versions"): <c>APP_VERSION</c>, <c>APP_COMMIT</c> and
/// <c>APP_BUILD_TIME</c>, which deploy/homelab/deploy.sh stamps into the image as environment variables. A missing or
/// malformed value never fails the start: the version falls back to <c>dev</c>, the commit to empty, the time to null.
/// </summary>
public sealed partial record BuildStamp(string Version, string Commit, DateTimeOffset? BuiltAt)
{
    public const string DevVersion = "dev";
    public const string VersionKey = "APP_VERSION";
    public const string CommitKey = "APP_COMMIT";
    public const string BuildTimeKey = "APP_BUILD_TIME";

    /// <summary>Reads the stamp from configuration (environment variables are part of it).</summary>
    public static BuildStamp FromConfiguration(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        return new BuildStamp(
            ParseVersion(configuration[VersionKey]),
            ParseCommit(configuration[CommitKey]),
            ParseBuildTime(configuration[BuildTimeKey]));
    }

    private static string ParseVersion(string? value)
    {
        var version = value?.Trim().TrimStart('v', 'V') ?? string.Empty;
        return VersionPattern().IsMatch(version) ? version : DevVersion;
    }

    private static string ParseCommit(string? value)
    {
        var commit = value?.Trim().ToLowerInvariant() ?? string.Empty;
        return CommitPattern().IsMatch(commit) ? commit : string.Empty;
    }

    private static DateTimeOffset? ParseBuildTime(string? value) =>
        DateTimeOffset.TryParse(value?.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var builtAt)
            ? builtAt.ToUniversalTime()
            : null;

    [GeneratedRegex(@"^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]{1,32})?$")]
    private static partial Regex VersionPattern();

    [GeneratedRegex("^[0-9a-f]{7,40}$")]
    private static partial Regex CommitPattern();
}
