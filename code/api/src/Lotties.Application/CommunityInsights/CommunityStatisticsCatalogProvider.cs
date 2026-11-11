using System.Text;
using Lotties.Domain.CommunityInsights;

namespace Lotties.Application.CommunityInsights;

/// <summary>
/// The published community statistics catalog: <c>code/api/data/community-statistics.json</c>, embedded in this assembly
/// (docs/design/34-community-insights.md, task T4). Read, parsed and validated once
/// (<see cref="CommunityStatisticsValidator"/>); an invalid file stops the API at startup, like the age norms. Catalog
/// only: no route serves it and no job reads data with it yet.
/// </summary>
public interface ICommunityStatisticsCatalogProvider
{
    /// <summary>The parsed, validated catalog.</summary>
    CommunityStatisticsCatalog Catalog { get; }
}

/// <remarks>Registered as a singleton; the resource is read in the constructor so a broken file fails at first resolve.</remarks>
internal sealed class EmbeddedCommunityStatisticsCatalogProvider : ICommunityStatisticsCatalogProvider
{
    public const string ResourceName = "Lotties.Application.CommunityInsights.community-statistics.json";

    public EmbeddedCommunityStatisticsCatalogProvider()
        : this(ReadResource())
    {
    }

    internal EmbeddedCommunityStatisticsCatalogProvider(byte[] json)
    {
        ArgumentNullException.ThrowIfNull(json);
        Catalog = CommunityStatisticsValidator.EnsureValid(CommunityStatisticsJson.Parse(Encoding.UTF8.GetString(json)));
    }

    public CommunityStatisticsCatalog Catalog { get; }

    private static byte[] ReadResource()
    {
        using var stream = typeof(EmbeddedCommunityStatisticsCatalogProvider).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"The embedded community statistics catalog {ResourceName} is missing from the build.");
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}
