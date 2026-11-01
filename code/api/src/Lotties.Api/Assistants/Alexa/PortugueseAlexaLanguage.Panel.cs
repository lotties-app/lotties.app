using Lotties.Application.Assistants;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>The night panel's words in Brazilian Portuguese.</summary>
internal sealed partial class PortugueseAlexaLanguage
{
    private static readonly AlexaPanelTexts PanelWords = new(
        AppName: "Lotties",
        Sleep: "Sono",
        Feed: "Mamada",
        Diaper: "Fralda",
        Nap: "Próxima janela de sono",
        AsleepSince: "dormindo desde {0}",
        AwakeSince: "acordado desde {0}",
        Ago: "há {0}",
        NextFeedEstimate: "próxima mamada {0} (estimativa do seu registro)",
        NapEstimate: "estimativa do seu registro",
        Stale: "sem atualizar");

    public AlexaPanelTexts Panel => PanelWords;

    public string? ClockOf(AssistantResult result, DateTimeOffset? instant)
    {
        ArgumentNullException.ThrowIfNull(result);
        return Speech.Clock(result, instant);
    }
}
