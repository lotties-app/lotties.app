using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The one place that writes and reads the served community statistics release (docs/design/34-community-insights.md section 6),
/// schema <see cref="SchemaVersion"/>:
/// <code>
/// { "schemaVersion": 1, "generatedAt": "...", "catalogVersion": 2, "placeholder": false,
///   "statistics": [ { "key": "cry_outcome_by_cause", "k": 20, "kHysteresis": 18, "epsilon": 0.2 } ],
///   "cells": [ { "statistic": "cry_outcome_by_cause", "band": { "fromWeeks": 0, "toWeeks": 6 }, "dimension": "evening",
///                "outputs": { "share_helped_by_cause.hunger": 0.312, ... }, "babies": "20-49" } ] }
/// </code>
/// <c>dimension</c> is absent when the statistic has none. Reading is strict: an unknown or missing property, a duplicate cell, a
/// cell of a statistic the file does not list, a placeholder with cells, a share outside [0, 1] or an unknown bucket is a
/// <see cref="FormatException"/>. A reader that cannot parse a release (for example a phase-1 placeholder row written before this
/// format) treats it as a release with no cells, so nothing it cannot read is ever served.
/// </summary>
public static partial class CommunityReleaseJson
{
    /// <summary>The release schema this code writes and reads.</summary>
    public const int SchemaVersion = 1;

    private const string SharePrefix = "share_";

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        RespectRequiredConstructorParameters = true,
        RespectNullableAnnotations = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        AllowDuplicateProperties = false,
    };

    /// <summary>The release as served JSON; cells and output values in a fixed order, so the same release is the same text.</summary>
    public static string Serialize(CommunityRelease release)
    {
        ArgumentNullException.ThrowIfNull(release);
        var error = FirstError(release);
        return error is null
            ? JsonSerializer.Serialize(WireRelease.From(release), Options)
            : throw new ArgumentException($"The community release cannot be written: {error}", nameof(release));
    }

    /// <summary>Reads a served release; anything that is not exactly this schema is a <see cref="FormatException"/>.</summary>
    public static CommunityRelease Parse(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        try
        {
            var wire = JsonSerializer.Deserialize<WireRelease>(json, Options) ?? throw new FormatException("The community release is null.");
            return EnsureValid(wire.ToRelease());
        }
        catch (JsonException exception)
        {
            throw new FormatException($"The community release is not valid: {exception.Message}", exception);
        }
    }

    private static CommunityRelease EnsureValid(CommunityRelease release)
    {
        var error = FirstError(release);
        return error is null ? release : throw new FormatException($"The community release is not valid: {error}");
    }

    private static string? FirstError(CommunityRelease release)
    {
        var keys = release.Statistics.Select(statistic => statistic.Key).ToHashSet(StringComparer.Ordinal);
        return new[]
        {
            release.IsPlaceholder && (release.Statistics.Count > 0 || release.Cells.Count > 0) ? "a placeholder has no statistics and no cells." : null,
            keys.Count != release.Statistics.Count ? "a statistic is listed twice." : null,
            release.Statistics.Select(StatisticError).FirstOrDefault(error => error is not null),
            release.Cells.Select(cell => CellError(cell, keys)).FirstOrDefault(error => error is not null),
            release.Cells.DistinctBy(cell => (cell.Statistic, cell.Band, cell.Dimension)).Count() != release.Cells.Count ? "a cell is listed twice." : null,
        }.FirstOrDefault(error => error is not null);
    }

    private static string? StatisticError(CommunityReleaseStatistic statistic) =>
        !SnakeCase().IsMatch(statistic.Key) ? $"statistic '{statistic.Key}' is not a snake_case key."
            : statistic.KHysteresis < 1 || statistic.KHysteresis > statistic.K ? $"statistic '{statistic.Key}' needs 1 <= kHysteresis <= k."
            : statistic.Epsilon <= 0m ? $"statistic '{statistic.Key}' needs a positive epsilon."
            : null;

    private static string? CellError(CommunityReleaseCell cell, IReadOnlySet<string> statistics) =>
        !statistics.Contains(cell.Statistic) ? $"cell of statistic '{cell.Statistic}', which the release does not list."
            : cell.Band.FromWeeks < 0 || cell.Band.ToWeeks <= cell.Band.FromWeeks ? $"cell of '{cell.Statistic}' has an empty or negative band."
            : cell.Dimension is not null && !SnakeCase().IsMatch(cell.Dimension) ? $"cell of '{cell.Statistic}' has an invalid dimension value."
            : cell.Outputs.Count == 0 ? $"cell of '{cell.Statistic}' has no output."
            : cell.Outputs.Keys.Any(name => !ValueName().IsMatch(name)) ? $"cell of '{cell.Statistic}' has an invalid output name."
            : cell.Outputs.Any(IsShareOutOfRange) ? $"cell of '{cell.Statistic}' has a share outside [0, 1]."
            : null;

    private static bool IsShareOutOfRange(KeyValuePair<string, decimal> value) =>
        value.Key.StartsWith(SharePrefix, StringComparison.Ordinal) && (value.Value < 0m || value.Value > 1m);

    [GeneratedRegex("^[a-z][a-z0-9]*(_[a-z0-9]+)*$")]
    private static partial Regex SnakeCase();

    [GeneratedRegex("^[a-z][a-z0-9]*(_[a-z0-9]+)*(\\.[a-z][a-z0-9]*(_[a-z0-9]+)*)?$")]
    private static partial Regex ValueName();

    private sealed record WireRelease(
        int SchemaVersion,
        DateTimeOffset GeneratedAt,
        int CatalogVersion,
        bool Placeholder,
        IReadOnlyList<WireStatistic> Statistics,
        IReadOnlyList<WireCell> Cells)
    {
        public static WireRelease From(CommunityRelease release) => new(
            CommunityReleaseJson.SchemaVersion,
            release.GeneratedAt.ToUniversalTime(),
            release.CatalogVersion,
            release.IsPlaceholder,
            [.. release.Statistics.OrderBy(statistic => statistic.Key, StringComparer.Ordinal).Select(WireStatistic.From)],
            [.. release.Cells.OrderBy(cell => cell.Statistic, StringComparer.Ordinal).ThenBy(cell => cell.Band.FromWeeks).ThenBy(cell => cell.Band.ToWeeks).ThenBy(cell => cell.Dimension, StringComparer.Ordinal).Select(WireCell.From)]);

        public CommunityRelease ToRelease() =>
            SchemaVersion == CommunityReleaseJson.SchemaVersion
                ? new(GeneratedAt.ToUniversalTime(), CatalogVersion, Placeholder, [.. Statistics.Select(statistic => statistic.ToStatistic())], [.. Cells.Select(cell => cell.ToCell())])
                : throw new FormatException($"The community release schemaVersion {SchemaVersion} is not {CommunityReleaseJson.SchemaVersion}.");
    }

    private sealed record WireStatistic(string Key, int K, int KHysteresis, decimal Epsilon)
    {
        public static WireStatistic From(CommunityReleaseStatistic statistic) => new(statistic.Key, statistic.K, statistic.KHysteresis, statistic.Epsilon);

        public CommunityReleaseStatistic ToStatistic() => new(Key, K, KHysteresis, Epsilon);
    }

    private sealed record WireCell(
        [property: JsonPropertyOrder(0)] string Statistic,
        [property: JsonPropertyOrder(1)] WireBand Band,
        [property: JsonPropertyOrder(3)] IReadOnlyDictionary<string, decimal> Outputs,
        [property: JsonPropertyOrder(4)] string Babies,
        [property: JsonPropertyOrder(2), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Dimension = null)
    {
        public static WireCell From(CommunityReleaseCell cell) => new(
            cell.Statistic,
            new WireBand(cell.Band.FromWeeks, cell.Band.ToWeeks),
            new SortedDictionary<string, decimal>(cell.Outputs.ToDictionary(), StringComparer.Ordinal),
            CommunityGroupSizes.ToWire(cell.Babies),
            cell.Dimension);

        public CommunityReleaseCell ToCell() => new(
            Statistic,
            new CommunityBand(Band.FromWeeks, Band.ToWeeks),
            Dimension,
            Outputs.ToDictionary(StringComparer.Ordinal),
            CommunityGroupSizes.FromWire(Babies) ?? throw new FormatException($"The community release group size '{Babies}' is unknown."));
    }

    private sealed record WireBand(int FromWeeks, int ToWeeks);
}
