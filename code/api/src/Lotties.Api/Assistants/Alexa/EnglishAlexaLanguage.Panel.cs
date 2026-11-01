using Lotties.Application.Assistants;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>The night panel's words in English.</summary>
internal sealed partial class EnglishAlexaLanguage
{
    private static readonly AlexaPanelTexts PanelWords = new(
        AppName: "Lotties",
        Sleep: "Sleep",
        Feed: "Feed",
        Diaper: "Diaper",
        Nap: "Next nap",
        AsleepSince: "asleep since {0}",
        AwakeSince: "awake since {0}",
        Ago: "{0} ago",
        NextFeedEstimate: "next feed {0} (estimate from your log)",
        NapEstimate: "estimate from your log",
        Stale: "not updated");

    public AlexaPanelTexts Panel => PanelWords;

    public string? ClockOf(AssistantResult result, DateTimeOffset? instant)
    {
        ArgumentNullException.ThrowIfNull(result);
        return Speech.Clock(result, instant);
    }
}
