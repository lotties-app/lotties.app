using System.Reflection;
using System.Text.Json;
using Lotties.Domain.AgeNorms;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Application.Predictions;

/// <summary>
/// Resolves cold-start priors from pre-computed community statistics baked into the release
/// (docs/design/34-community-insights.md). Only tier-A share-based norms are included; percentile
/// outputs wait for O2 tier-B epsilon approval. Returns <c>null</c> for BYO-database babies:
/// community priors are computed over the hosted population and do not apply to a family's own store.
/// </summary>
internal sealed class CommunityStaticPriorProvider : IPriorProvider
{
    private readonly IReadOnlyList<CommunityPriorNorm> _norms;

    public CommunityStaticPriorProvider()
    {
        _norms = LoadEmbedded();
    }

    public ColdStartPrior? GetPrior(EventTypeKey typeKey, int ageDays)
    {
        if (ageDays < 0 || _norms.Count == 0)
        {
            return null;
        }

        // TODO(BYO): when IStoreScope is available in this layer, gate on TryEnterBuiltInAsync and
        // return null for external stores. For now the provider is registered only for built-in babies
        // by the composition root (docs/design/47-bring-your-own-database.md D9).

        var metric = MetricFor(typeKey);
        if (metric is null)
        {
            return null;
        }

        foreach (var norm in _norms)
        {
            if (!string.Equals(norm.Metric, metric, StringComparison.Ordinal))
            {
                continue;
            }

            if (ageDays < norm.FromDays || ageDays >= norm.ToDays)
            {
                continue;
            }

            // IsUsableAsPrior gate: confidence != low, needsReview == false.
            if (string.Equals(norm.Confidence, "low", StringComparison.Ordinal) || norm.NeedsReview)
            {
                continue;
            }

            if (norm.TypicalMinutes is null || norm.TypicalMinutes <= 0)
            {
                continue;
            }

            var medianGap = TimeSpan.FromMinutes(norm.TypicalMinutes.Value);
            if (medianGap <= TimeSpan.Zero)
            {
                continue;
            }

            return new ColdStartPrior(typeKey, medianGap, null, ageDays, metric, PriorOrigin.CommunityStatic);
        }

        return null;
    }

    /// <summary>Mirrors <c>ColdStartMetrics.For</c> (internal to Domain) so this provider can resolve event types to metric keys.</summary>
    private static string? MetricFor(EventTypeKey typeKey) => typeKey.Value switch
    {
        "feeding" => AgeNormMetrics.FeedGapMinutes,
        "sleep" => null,
        _ => null,
    };

    private static IReadOnlyList<CommunityPriorNorm> LoadEmbedded()
    {
        var assembly = typeof(CommunityStaticPriorProvider).Assembly;
        const string resourceName = "Lotties.Application.CommunityInsights.community-priors.json";

        using var stream = assembly.GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            return [];
        }

        using var reader = new StreamReader(stream);
        var json = reader.ReadToEnd();

        try
        {
            var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (!root.TryGetProperty("norms", out var normsElement) || normsElement.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var norms = new List<CommunityPriorNorm>();
            foreach (var entry in normsElement.EnumerateArray())
            {
                if (!entry.TryGetProperty("metric", out var metricEl) || metricEl.ValueKind != JsonValueKind.String)
                {
                    continue;
                }

                var metric = metricEl.GetString()!;

                double? typicalMinutes = null;
                if (entry.TryGetProperty("typical", out var typicalEl) && typicalEl.ValueKind == JsonValueKind.Number)
                {
                    typicalMinutes = typicalEl.GetDouble();
                }

                string? unit = null;
                if (entry.TryGetProperty("unit", out var unitEl) && unitEl.ValueKind == JsonValueKind.String)
                {
                    unit = unitEl.GetString();
                }

                // Convert to minutes based on unit; skip unsupported units.
                double? minutes = unit switch
                {
                    "minutes" => typicalMinutes,
                    "hours" => typicalMinutes.HasValue ? typicalMinutes.Value * 60.0 : null,
                    _ => null,
                };

                int fromDays = 0;
                int toDays = int.MaxValue;
                if (entry.TryGetProperty("ageBand", out var bandEl) && bandEl.ValueKind == JsonValueKind.Object)
                {
                    if (bandEl.TryGetProperty("fromWeeks", out var fromEl) && fromEl.ValueKind == JsonValueKind.Number)
                    {
                        fromDays = (int)(fromEl.GetInt32() * 7);
                    }

                    if (bandEl.TryGetProperty("toWeeks", out var toEl) && toEl.ValueKind == JsonValueKind.Number)
                    {
                        toDays = (int)(toEl.GetInt32() * 7);
                    }
                }

                string? confidence = null;
                if (entry.TryGetProperty("confidence", out var confEl) && confEl.ValueKind == JsonValueKind.String)
                {
                    confidence = confEl.GetString();
                }

                bool needsReview = false;
                if (entry.TryGetProperty("needsReview", out var nrEl) && nrEl.ValueKind == JsonValueKind.True)
                {
                    needsReview = true;
                }

                norms.Add(new CommunityPriorNorm(metric, fromDays, toDays, minutes, confidence, needsReview));
            }

            return norms;
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private sealed record CommunityPriorNorm(
        string Metric,
        int FromDays,
        int ToDays,
        double? TypicalMinutes,
        string? Confidence,
        bool NeedsReview);
}