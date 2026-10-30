using Lotties.Application.Assistants;

namespace Lotties.Api.Assistants;

/// <summary>
/// The only place an adapter may read a baby's name from an <see cref="AssistantResult"/> (docs/design/32-assistants.md "what an
/// assistant may say"). The name is in the result only when the user turned on "say my baby's name in answers"
/// (<c>sayBabyName</c>); until then these return <c>null</c> and every renderer falls back to neutral wording ("the baby").
/// <c>AssistantNamePrivacyTests</c> fails when any other adapter file reads <c>Baby.Name</c> or a listed baby's name.
/// </summary>
internal static class SpokenBaby
{
    /// <summary>The baby's name when the user allowed it, else <c>null</c> (never blank).</summary>
    public static string? NameOf(AssistantResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return result.Baby?.Name is { } name && !string.IsNullOrWhiteSpace(name) ? name : null;
    }

    /// <summary>The names of the listed babies, or <c>null</c> when the user did not allow names (or one name is missing): say the count instead.</summary>
    public static IReadOnlyList<string>? NamesOfListed(AssistantResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        var names = result.Babies.Select(baby => baby.Name).ToArray();
        return names.Length > 0 && names.All(name => !string.IsNullOrWhiteSpace(name)) ? names.Select(name => name!).ToArray() : null;
    }
}
