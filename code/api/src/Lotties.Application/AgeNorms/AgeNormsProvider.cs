using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Lotties.Domain.AgeNorms;

namespace Lotties.Application.AgeNorms;

/// <summary>
/// The published age norms the API serves and the domain reads as priors: <c>code/api/data/age-norms.json</c>, embedded
/// in this assembly (one source of truth, shipped with every build; docs/design/28-age-norms.md). Read, parsed and
/// validated once (<see cref="AgeNormsValidator"/>); an invalid file stops the API at startup.
/// </summary>
public interface IAgeNormsProvider
{
    /// <summary>The parsed, validated norms.</summary>
    AgeNormSet Norms { get; }

    /// <summary>The file exactly as shipped (UTF-8 JSON), what <c>GET /age-norms</c> returns.</summary>
    ReadOnlyMemory<byte> Json { get; }

    /// <summary>A strong entity tag: <c>generatedAt</c> and a short content hash, quoted.</summary>
    string ETag { get; }
}

/// <remarks>Registered as a singleton; the resource is read in the constructor so a broken file fails at first resolve.</remarks>
internal sealed class EmbeddedAgeNormsProvider : IAgeNormsProvider
{
    public const string ResourceName = "Lotties.Application.AgeNorms.age-norms.json";

    private readonly byte[] _json;

    public EmbeddedAgeNormsProvider()
        : this(ReadResource())
    {
    }

    internal EmbeddedAgeNormsProvider(byte[] json)
    {
        _json = json ?? throw new ArgumentNullException(nameof(json));
        Norms = AgeNormsValidator.EnsureValid(AgeNormsJson.Parse(Encoding.UTF8.GetString(json)));
        ETag = EntityTagOf(Norms, json);
    }

    public AgeNormSet Norms { get; }

    public ReadOnlyMemory<byte> Json => _json;

    public string ETag { get; }

    private static string EntityTagOf(AgeNormSet norms, byte[] json)
    {
        var hash = Convert.ToHexString(SHA256.HashData(json))[..8].ToLowerInvariant();
        return string.Create(CultureInfo.InvariantCulture, $"\"agenorms-{norms.GeneratedAt:yyyy-MM-dd}-{hash}\"");
    }

    private static byte[] ReadResource()
    {
        using var stream = typeof(EmbeddedAgeNormsProvider).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"The embedded age norms {ResourceName} are missing from the build.");
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}
