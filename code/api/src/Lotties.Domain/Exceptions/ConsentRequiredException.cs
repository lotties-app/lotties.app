using Lotties.Domain.Consents;

namespace Lotties.Domain.Exceptions;

/// <summary>
/// The caller has no current core consent, so she cannot reach a baby's data (docs/design/38-consent-and-terms.md section 2,
/// decision 4). She gives it through <c>PUT /me/consents/core</c>; the routes that let her leave stay open.
/// </summary>
public sealed class ConsentRequiredException : DomainException
{
    public ConsentRequiredException()
        : base("consent_required", "Accept the terms of use and the privacy policy before using Lotties.")
    {
    }

    public override IReadOnlyDictionary<string, object?> Details { get; } = new Dictionary<string, object?> { ["currentVersion"] = ConsentVersions.Current.Version };
}
