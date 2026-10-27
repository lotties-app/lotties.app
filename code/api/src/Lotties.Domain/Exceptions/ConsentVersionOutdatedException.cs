using Lotties.Domain.Consents;

namespace Lotties.Domain.Exceptions;

/// <summary>A consent was sent for a version that is not the current one (the person saw an older text): nothing was recorded.</summary>
public sealed class ConsentVersionOutdatedException : DomainException
{
    public ConsentVersionOutdatedException(string? sent)
        : base("consent_version_outdated", $"The consent version '{sent}' is not the current one; reload and read the current text.")
    {
    }

    public override IReadOnlyDictionary<string, object?> Details { get; } = new Dictionary<string, object?> { ["currentVersion"] = ConsentVersions.Current.Version };
}
