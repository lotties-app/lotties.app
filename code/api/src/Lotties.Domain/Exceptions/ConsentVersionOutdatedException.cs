using Lotties.Domain.Consents;

namespace Lotties.Domain.Exceptions;

/// <summary>
/// A consent was sent for a version that can no longer be accepted (unknown, or a material entry came after it: the person saw a
/// text that was replaced): nothing was recorded.
/// </summary>
public sealed class ConsentVersionOutdatedException : DomainException
{
    public ConsentVersionOutdatedException(string? sent)
        : base("consent_version_outdated", $"The consent version '{sent}' can no longer be accepted; reload and read the current text.")
    {
    }

    public override IReadOnlyDictionary<string, object?> Details { get; } = new Dictionary<string, object?> { ["currentVersion"] = ConsentVersions.Current.Version };
}
