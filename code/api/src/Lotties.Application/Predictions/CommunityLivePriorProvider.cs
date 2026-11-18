using System.Net.Http.Json;
using Lotties.Application.CommunityInsights;
using Lotties.Domain.AgeNorms;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Application.Predictions;

/// <summary>
/// Resolves cold-start priors from the live community statistics serving endpoint
/// (docs/design/34-community-insights.md section 5). Returns <c>null</c> on any failure
/// (network, auth, parse, staleness) so the composite chain falls through to static or
/// published norms. Results are cached per instance lifetime (one prediction run) to avoid
/// repeated HTTP calls for the same metric key.
/// </summary>
internal sealed class CommunityLivePriorProvider : IPriorProvider
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly PredictionOptions _options;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<CommunityLivePriorProvider> _logger;
    private readonly Dictionary<string, CommunityStatisticsResponse?> _cache = new(StringComparer.Ordinal);

    public CommunityLivePriorProvider(
        IHttpClientFactory httpClientFactory,
        PredictionOptions options,
        TimeProvider timeProvider,
        ILogger<CommunityLivePriorProvider> logger)
    {
        ArgumentNullException.ThrowIfNull(httpClientFactory);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);
        _httpClientFactory = httpClientFactory;
        _options = options;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    public ColdStartPrior? GetPrior(EventTypeKey typeKey, int ageDays)
    {
        if (ageDays < 0 || !_options.UseCommunityLivePriors)
        {
            return null;
        }

        var metric = MetricFor(typeKey);
        if (metric is null)
        {
            return null;
        }

        var response = FetchAsync(metric).GetAwaiter().GetResult();
        if (response is null)
        {
            return null;
        }

        if (IsStale(response.ReleasedAtUtc))
        {
            _logger.LogDebug("Community live prior for {Metric} is stale (released {ReleasedAtUtc})", metric, response.ReleasedAtUtc);
            return null;
        }

        if (response.Value is null || response.Value <= 0)
        {
            return null;
        }

        // The serving endpoint returns mean values in minutes for gap metrics.
        var medianGap = TimeSpan.FromMinutes((double)response.Value);
        if (medianGap <= TimeSpan.Zero)
        {
            return null;
        }

        return new ColdStartPrior(typeKey, medianGap, null, ageDays, metric, PriorOrigin.CommunityLive);
    }

    /// <summary>Mirrors <c>ColdStartMetrics.For</c> (internal to Domain) so this provider can resolve event types to metric keys.</summary>
    private static string? MetricFor(EventTypeKey typeKey) => typeKey.Value switch
    {
        "feeding" => AgeNormMetrics.FeedGapMinutes,
        "sleep" => null,
        _ => null,
    };

    private bool IsStale(DateTimeOffset releasedAtUtc)
    {
        var age = _timeProvider.GetUtcNow() - releasedAtUtc;
        return age > _options.MaxCommunityPriorAge;
    }

    private async Task<CommunityStatisticsResponse?> FetchAsync(string metricKey)
    {
        if (_cache.TryGetValue(metricKey, out var cached))
        {
            return cached;
        }

        try
        {
            var client = _httpClientFactory.CreateClient("CommunityStatistics");
            var response = await client.GetAsync($"/api/v1/community/statistics/{metricKey}").ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Community live prior fetch failed for {Metric}: HTTP {StatusCode}",
                    metricKey,
                    (int)response.StatusCode);
                _cache[metricKey] = null;
                return null;
            }

            var result = await response.Content.ReadFromJsonAsync<CommunityStatisticsResponse>().ConfigureAwait(false);
            _cache[metricKey] = result;
            return result;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            _logger.LogWarning(ex, "Community live prior fetch failed for {Metric}", metricKey);
            _cache[metricKey] = null;
            return null;
        }
    }
}