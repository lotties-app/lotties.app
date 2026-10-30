using Lotties.Application.Assistants;

namespace Lotties.Api.Assistants;

/// <summary>
/// The only place an adapter may read a medicine's name from an <see cref="AssistantResult"/> (docs/design/32-assistants.md "what an
/// assistant may say"). The name is in the result only when the user turned on "say the names of my medicines" (<c>sayMedicineNames</c>);
/// until then these return nothing and every renderer says "a medication dose" / "medicine reminders". An amount, dose, schedule or
/// interval is never in a result at all. <c>AssistantNamePrivacyTests</c> fails when another adapter file reads
/// <c>Medicine</c> or <c>DueMedicines</c>.
/// </summary>
internal static class SpokenMedicine
{
    /// <summary>The medicine the answer is about when the user allowed names, else <c>null</c> (never blank).</summary>
    public static string? NameOf(AssistantResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return string.IsNullOrWhiteSpace(result.Medicine) ? null : result.Medicine;
    }

    /// <summary>The names of the medicines due now when the user allowed names, else an empty list.</summary>
    public static IReadOnlyList<string> DueNamesOf(AssistantResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return result.DueMedicines.Where(name => !string.IsNullOrWhiteSpace(name)).ToArray();
    }
}
