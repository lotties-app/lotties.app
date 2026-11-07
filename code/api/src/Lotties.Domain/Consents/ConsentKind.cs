namespace Lotties.Domain.Consents;

/// <summary>What a consent covers: the core consent that the service needs (terms, privacy policy, a child's health data) or one optional feature (docs/design/38-consent-and-terms.md).</summary>
public enum ConsentKind
{
    /// <summary>The core consent, required to use the app.</summary>
    Core,

    /// <summary>Web push notifications.</summary>
    Push,

    /// <summary>The Alexa skill.</summary>
    Alexa,

    /// <summary>The MCP assistant connection.</summary>
    Mcp,
}

/// <summary>Wire names of <see cref="ConsentKind"/>: <c>core</c>, <c>push</c>, <c>alexa</c>, <c>mcp</c>.</summary>
public static class ConsentKinds
{
    /// <summary>The optional kinds, in the order the API lists them.</summary>
    public static IReadOnlyList<ConsentKind> Optional { get; } = [ConsentKind.Push, ConsentKind.Alexa, ConsentKind.Mcp];

    public static string NameOf(ConsentKind kind) => kind switch
    {
        ConsentKind.Core => "core",
        ConsentKind.Push => "push",
        ConsentKind.Alexa => "alexa",
        ConsentKind.Mcp => "mcp",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, null),
    };

    public static bool TryParse(string? name, out ConsentKind kind)
    {
        foreach (var candidate in Enum.GetValues<ConsentKind>())
        {
            if (string.Equals(NameOf(candidate), name, StringComparison.Ordinal))
            {
                kind = candidate;
                return true;
            }
        }

        kind = default;
        return false;
    }

    /// <summary>The kind stored under <paramref name="name"/>; a name the code does not know (a corrupt row) reads as <see cref="ConsentKind.Core"/>.</summary>
    public static ConsentKind ParseOrCore(string? name) => TryParse(name, out var kind) ? kind : ConsentKind.Core;
}

/// <summary>The capacity a person declares when she gives the core consent.</summary>
public enum ConsentCapacity
{
    /// <summary>The child's parent or legal guardian.</summary>
    Guardian,

    /// <summary>An adult the parent or guardian authorised (a family member, caregiver or health professional).</summary>
    Authorised,

    /// <summary>A visitor of the try-it demo (docs/design/45-try-it-demo.md): written only by the demo start, never accepted from a request.</summary>
    Demo,
}

/// <summary>Wire names of <see cref="ConsentCapacity"/>: <c>guardian</c>, <c>authorised</c> (and <c>demo</c>, which a request can never name).</summary>
public static class ConsentCapacities
{
    public static string NameOf(ConsentCapacity capacity) => capacity switch
    {
        ConsentCapacity.Guardian => "guardian",
        ConsentCapacity.Authorised => "authorised",
        ConsentCapacity.Demo => "demo",
        _ => throw new ArgumentOutOfRangeException(nameof(capacity), capacity, null),
    };

    public static bool TryParse(string? name, out ConsentCapacity capacity)
    {
        foreach (var candidate in Enum.GetValues<ConsentCapacity>().Where(value => value != ConsentCapacity.Demo))
        {
            if (string.Equals(NameOf(candidate), name, StringComparison.Ordinal))
            {
                capacity = candidate;
                return true;
            }
        }

        capacity = default;
        return false;
    }

    /// <summary>The stored capacity (the only reader that knows <c>demo</c>); a name the code does not know reads as <see cref="ConsentCapacity.Authorised"/>.</summary>
    public static ConsentCapacity ParseOrAuthorised(string? name) =>
        string.Equals(name, NameOf(ConsentCapacity.Demo), StringComparison.Ordinal) ? ConsentCapacity.Demo : TryParse(name, out var capacity) ? capacity : ConsentCapacity.Authorised;
}
