using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Lotties.Domain.Vaccinations;

namespace Lotties.Application.Vaccinations;

/// <summary>
/// The vaccine schedule the API serves and plans reminders with: <c>code/api/data/vaccine-schedule.br.json</c>, embedded
/// in this assembly (one source of truth, shipped with every build). Read, parsed and validated once
/// (<see cref="VaccineScheduleValidator"/>); an invalid file stops the API at startup.
/// </summary>
public interface IVaccineScheduleProvider
{
    /// <summary>The parsed, validated schedule.</summary>
    VaccineSchedule Schedule { get; }

    /// <summary>The file exactly as shipped (UTF-8 JSON), what <c>GET /vaccine-schedule</c> returns.</summary>
    ReadOnlyMemory<byte> Json { get; }

    /// <summary>A strong entity tag: the profile, <c>generatedOn</c> and a short content hash, quoted.</summary>
    string ETag { get; }
}

/// <remarks>Registered as a singleton; the resource is read in the constructor so a broken file fails at first resolve.</remarks>
internal sealed class EmbeddedVaccineScheduleProvider : IVaccineScheduleProvider
{
    public const string ResourceName = "Lotties.Application.Vaccinations.vaccine-schedule.br.json";

    private readonly byte[] _json;

    public EmbeddedVaccineScheduleProvider()
        : this(ReadResource())
    {
    }

    internal EmbeddedVaccineScheduleProvider(byte[] json)
    {
        _json = json ?? throw new ArgumentNullException(nameof(json));
        Schedule = VaccineScheduleValidator.EnsureValid(VaccineScheduleJson.Parse(Encoding.UTF8.GetString(json)));
        ETag = EntityTagOf(Schedule, json);
    }

    public VaccineSchedule Schedule { get; }

    public ReadOnlyMemory<byte> Json => _json;

    public string ETag { get; }

    private static string EntityTagOf(VaccineSchedule schedule, byte[] json)
    {
        var hash = Convert.ToHexString(SHA256.HashData(json))[..8].ToLowerInvariant();
        return string.Create(CultureInfo.InvariantCulture, $"\"{schedule.Profile.ToLowerInvariant()}-{schedule.GeneratedOn:yyyy-MM-dd}-{hash}\"");
    }

    private static byte[] ReadResource()
    {
        using var stream = typeof(EmbeddedVaccineScheduleProvider).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"The embedded vaccine schedule {ResourceName} is missing from the build.");
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}
