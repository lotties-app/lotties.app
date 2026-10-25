using System.Globalization;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.CryReasons;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>
/// The predictions and "por que ela está chorando" answers in Portuguese: estimates and facts from the family's own log,
/// one short sentence per fact, never a diagnosis, advice, remedy or dose. The cry answers always end with the red flags to
/// call the pediatrician for, the wording of the web's "Quando pedir ajuda" list.
/// </summary>
internal sealed partial class PortugueseAlexaLanguage
{
    private static Dictionary<AssistantResultCode, Func<AssistantResult, string>> ForecastResults() => new()
    {
        [AssistantResultCode.NextNapWindow] = NextNapWindow,
        [AssistantResultCode.NapWindowAsleep] = NapWindowAsleep,
        [AssistantResultCode.NoNapPrediction] = result => $"Ainda não tenho histórico de sono suficiente para estimar a próxima janela de sono de {Name(result)}.",
        [AssistantResultCode.NextFeed] = result => $"A próxima mamada de {Name(result)} {Expected(result, result.Estimate!)}.",
        [AssistantResultCode.NoNextFeed] = result => $"Ainda não tenho mamadas registradas o bastante para estimar a próxima mamada de {Name(result)}.",
        [AssistantResultCode.NextDiaper] = NextDiaper,
        [AssistantResultCode.NoNextDiaper] = result => $"Ainda não tenho fraldas registradas o bastante para estimar a próxima troca de {Name(result)}.",
        [AssistantResultCode.DiapersAverage] = result =>
            $"Nos últimos {Speech.Count(result.Count ?? 0, "dia", "dias")} com fraldas, {Name(result)} usou cerca de {Number(result.PerDay)} fraldas por dia: cerca de {Number(result.WetPerDay)} com xixi e {Number(result.DirtyPerDay)} com cocô.",
        [AssistantResultCode.NoDiapersAverage] = result =>
            $"Preciso de pelo menos 3 dias completos com fraldas na última semana para dar uma média, e encontrei {result.Count ?? 0}.",
        [AssistantResultCode.BottleAverage] = result =>
            $"As últimas {Speech.Count(result.Count ?? 0, "mamadeira", "mamadeiras")} de {Name(result)} tiveram em média {Volume(result, result.AmountMl)}, e a última foi de {Volume(result, result.LastAmountMl)}.",
        [AssistantResultCode.NoBottleData] = result =>
            $"Não há mamadeiras com quantidade registrada o bastante nos últimos 14 dias: preciso de pelo menos 3, e encontrei {result.Count ?? 0}.",
        [AssistantResultCode.SleepToday] = SleepToday,
        [AssistantResultCode.LastDiaper] = result =>
            $"A última fralda de {Name(result)} foi {LastDiaperContent(result)}, {AtAndAgo(result, result.At)}.",
        [AssistantResultCode.NoDiapers] = result => $"Não encontrei nenhuma fralda de {Name(result)} nos últimos 30 dias.",
        [AssistantResultCode.CryReasons] = CryReasons,
        [AssistantResultCode.CryNoData] = CryNoData,
        [AssistantResultCode.DeleteRequested] = result =>
            $"Pedi para apagar o último registro de {EntryName(result.EntryType)} de {Name(result)}, {When(result, result.At)}. Nada foi apagado: abra o app do Lotties para aprovar ou manter.",
        [AssistantResultCode.NoEntryToDelete] = _ => "Não encontrei nenhum registro feito por voz nos últimos 30 minutos, então nada foi alterado.",
    };

    private static string EntryName(string? type) => type switch
    {
        "feeding" => "alimentação",
        "sleep" => "sono",
        "diaper" => "troca de fralda",
        _ => "item",
    };

    private static string SleepToday(AssistantResult result)
    {
        var slept = Speech.Duration(result.Minutes);
        return (result.Minutes, result.Count) switch
        {
            (null or 0, _) => $"Não há sono registrado hoje para {Name(result)}.",
            (_, null or 0) => $"{Name(result)} dormiu {slept} hoje, sem sonecas.",
            _ => $"{Name(result)} dormiu {slept} hoje, com {Speech.Count(result.Count.Value, "soneca", "sonecas")}.",
        };
    }

    private static string NextNapWindow(AssistantResult result)
    {
        var window = result.Estimate!;
        return window.Latest <= result.AsOf
            ? $"A janela de sono de {Name(result)} era {Between(result, window)}."
            : $"A próxima janela de sono de {Name(result)} deve ser {Between(result, window)}.";
    }

    private static string NapWindowAsleep(AssistantResult result)
    {
        var asleep = $"{Name(result)} está dormindo, desde {Since(result, result.At)}.";
        return result.EndedAt is { } wakes ? $"{asleep} {Name(result)} deve acordar {Moment(result, wakes)}." : asleep;
    }

    private static string NextDiaper(AssistantResult result)
    {
        var sentences = new[]
        {
            result.WetEstimate is { } wet ? $"A próxima fralda de xixi {Expected(result, wet)}." : null,
            result.DirtyEstimate is { } dirty ? $"A próxima fralda de cocô {Expected(result, dirty)}." : null,
        };
        return string.Join(' ', sentences.OfType<string>());
    }

    /// <summary>"é esperada por volta das 15:15, geralmente entre 14:50 e 15:40" (or "era esperada ..." once it has passed).</summary>
    private static string Expected(AssistantResult result, AssistantTimeWindow window)
    {
        var verb = window.Latest <= result.AsOf ? "era esperada" : "é esperada";
        var usual = Speech.Clock(result, window.Earliest) is { } from && Speech.Clock(result, window.Latest) is { } to ? $", geralmente entre {from} e {to}" : string.Empty;
        return $"{verb} {Moment(result, window.Expected)}{usual}";
    }

    /// <summary>"por volta das 15:15", or "daqui a cerca de 20 minutos" / "há cerca de 20 minutos" without a known zone.</summary>
    private static string Moment(AssistantResult result, DateTimeOffset instant)
    {
        if (Speech.Clock(result, instant) is { } clock)
        {
            return $"por volta {(AtHour(clock) == "à" ? "da" : "das")} {clock}";
        }

        return instant >= result.AsOf
            ? $"daqui a cerca de {Speech.Duration(Speech.MinutesBetween(result.AsOf, instant))}"
            : $"há cerca de {Speech.Duration(Speech.MinutesBetween(instant, result.AsOf))}";
    }

    /// <summary>"entre 14:10 e 15:00", or "por volta das 14:30" (the expected time) without a known zone.</summary>
    private static string Between(AssistantResult result, AssistantTimeWindow window) =>
        Speech.Clock(result, window.Earliest) is { } from && Speech.Clock(result, window.Latest) is { } to
            ? $"entre {from} e {to}"
            : Moment(result, window.Expected);

    private static string Number(double? value) => (value ?? 0).ToString("0.#", Speech.Culture);

    private static string LastDiaperContent(AssistantResult result) => result.Diaper is null ? "uma fralda" : $"uma fralda {Diaper(result)}";

    private static string CryReasons(AssistantResult result)
    {
        var causes = result.CryCauses.Select(cause => CauseSentence(result, cause)).ToArray();
        return $"Pelo que está registrado de {Name(result)}: {string.Join(' ', causes)} {CrySafety(result)}";
    }

    private static string CryNoData(AssistantResult result)
    {
        var behind = result.Running == true ? "Um cronômetro de sono ainda está rodando, então o registro pode estar atrasado." : "Não há registros suficientes para apontar uma causa.";
        return $"{behind} {CrySafety(result)}";
    }

    /// <summary>"Fome parece provável: a última mamada foi há 3 horas; o intervalo habitual é de cerca de 2 horas e 30 minutos."</summary>
    private static string CauseSentence(AssistantResult result, AssistantCryCause cause)
    {
        var plural = cause.Cause == CryCause.Gas;
        var verb = plural ? "parecem" : "parece";
        var level = (cause.Level, plural) switch
        {
            (CryLevel.Likely, true) => "prováveis",
            (CryLevel.Likely, false) => "provável",
            (_, true) => "possíveis",
            _ => "possível",
        };
        var facts = string.Join("; ", cause.Facts.Take(2).Select(fact => CryFactText(result, fact)));
        return $"{CryCauseName(cause.Cause)} {verb} {level}: {facts}.";
    }

    private static string CryCauseName(CryCause cause) => cause switch
    {
        CryCause.Hunger => "Fome",
        CryCause.Sleepy => "Sono",
        CryCause.Diaper => "A fralda",
        CryCause.Gas => "Gases",
        _ => "Conforto",
    };

    private static string CryFactText(AssistantResult result, CryFact fact) => fact.Kind switch
    {
        "sinceLastFeed" when fact.SmallerFeed == true => $"a última mamada foi há {Speech.Duration(fact.Minutes)} e foi menor que o habitual",
        "sinceLastFeed" when fact.UsualGapMinutes is { } usual => $"a última mamada foi há {Speech.Duration(fact.Minutes)}, e o intervalo habitual é de cerca de {Speech.Duration(usual)}",
        "sinceLastFeed" => $"a última mamada foi há {Speech.Duration(fact.Minutes)}",
        "feedingNow" => $"uma mamada está em andamento, começou há {Speech.Duration(fact.Minutes)}",
        "awakeFor" when fact.WindowMinutes is { } window => $"acordada há {Speech.Duration(fact.Minutes)}, e o tempo habitual acordada é de cerca de {Speech.Duration(window)}",
        "awakeFor" => $"acordada há {Speech.Duration(fact.Minutes)}",
        "nightTime" => "é horário da noite",
        "sinceLastDiaper" when fact.UsualGapMinutes is { } usual => $"a última fralda foi há {Speech.Duration(fact.Minutes)}, e o intervalo habitual é de cerca de {Speech.Duration(usual)}",
        "sinceLastDiaper" => $"a última fralda foi há {Speech.Duration(fact.Minutes)}",
        "dirtyDue" when fact.Signal == "afterFeed" => "uma fralda suja costuma vir por agora, depois da mamada",
        "dirtyDue" => $"uma fralda suja pode vir {DirtyDueMoment(result, fact)}",
        "recentFeedNoBurp" => $"mamou há {Speech.Duration(fact.MinutesSinceFeed)}, sem arroto registrado depois",
        "reliefAfterFeed" => $"mamou há {Speech.Duration(fact.MinutesSinceFeed)}, e um arroto ou massagem foi registrado",
        "bellyPattern" => $"a dor de barriga costuma aparecer por volta das {ClockText(fact.TypicalClock)}",
        "eveningFussy" when fact.TypicalClock is not null => $"a irritação costuma começar por volta das {ClockText(fact.TypicalClock)}",
        "eveningFussy" => "o fim do dia é um horário comum de choro nessa idade",
        _ => "ainda não há registros suficientes",
    };

    private static string DirtyDueMoment(AssistantResult result, CryFact fact) =>
        fact.ExpectedAt is { } at ? Moment(result, at) : "em breve";

    private static string ClockText(string? clock) =>
        TimeOnly.TryParseExact(clock, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time) ? Speech.Clock(time) : clock ?? string.Empty;

    /// <summary>Always said after a cry answer: not a diagnosis, then the red flags to call for.</summary>
    private static string CrySafety(AssistantResult result)
    {
        var flags = result.RedFlags.Select(RedFlagText).ToArray();
        return $"Isto não é um diagnóstico nem orientação médica. Ligue para o pediatra ou para a emergência se houver {Speech.List(flags)}.";
    }

    private static string RedFlagText(string flag) => flag switch
    {
        "fever" => "febre (bebês com menos de 3 meses com febre precisam de uma ligação na hora)",
        "inconsolable" => "choro que você não consegue acalmar",
        "refusing_feeds" => "recusa para mamar ou comer",
        "unusual_sleepiness" => "sonolência fora do comum ou dificuldade para acordar",
        "bulging_or_stiff_fontanelle" => "moleira estufada ou dura",
        _ => flag,
    };
}
