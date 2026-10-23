using System.Collections.Frozen;
using System.Globalization;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>Brazilian Portuguese (every <c>pt-*</c> locale): 24-hour clock times ("15:15"), fallback zone <c>America/Sao_Paulo</c>.</summary>
internal sealed class PortugueseAlexaLanguage : IAlexaLanguage
{
    private static readonly SpokenClock Speech = new(CultureInfo.GetCultureInfo("pt-BR"), "HH:mm", new SpokenWords("minuto", "minutos", "hora", "horas", "e", "menos de um minuto"));

    private readonly FrozenDictionary<AssistantResultCode, Func<AssistantResult, string>> _results;
    private readonly FrozenDictionary<AlexaPrompt, AlexaLine> _prompts;

    public PortugueseAlexaLanguage()
    {
        _results = Results().ToFrozenDictionary();
        _prompts = Prompts().ToFrozenDictionary();
    }

    public string Locale => "pt-BR";

    public string? FallbackTimeZone => "America/Sao_Paulo";

    public bool CanHandle(string? locale) => locale?.StartsWith("pt", StringComparison.OrdinalIgnoreCase) == true;

    public string Say(AssistantResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return _results[result.Code](result);
    }

    public AlexaLine Say(AlexaPrompt prompt) => _prompts[prompt];

    private static Dictionary<AssistantResultCode, Func<AssistantResult, string>> Results() => new()
    {
        [AssistantResultCode.NotAllowed] = result => result.Baby is null
            ? "Os comandos de voz são para a família do bebê. Sua conta não pode usá-los aqui."
            : $"O seu papel em {Name(result)} não permite isso. Fale com quem administra o bebê no app.",
        [AssistantResultCode.NoBaby] = _ => "Ainda não há nenhum bebê na sua conta do Lotties. Adicione um no app primeiro.",
        [AssistantResultCode.ChooseBaby] = _ => "Você tem mais de um bebê no Lotties. Escolha o bebê dos comandos de voz no app, em Configurações, Assistentes de voz.",
        [AssistantResultCode.RateLimited] = _ => "São muitos pedidos seguidos. Tente de novo daqui a um minuto.",
        [AssistantResultCode.InvalidAmount] = result => $"Diga uma quantidade de {result.Min} a {result.Max} ml, por exemplo: registrar mamadeira de 120 ml.",
        [AssistantResultCode.SleepStarted] = result => $"Certo. {Name(result)} dormiu {When(result, result.At)}.",
        [AssistantResultCode.SleepAlreadyRunning] = result => $"{Name(result)} já está dormindo, desde {Since(result, result.At)}.",
        [AssistantResultCode.SleepEnded] = result => result.Minutes is null
            ? $"{Name(result)} acordou {When(result, result.At)}."
            : $"{Name(result)} acordou {When(result, result.At)}, depois de dormir {Speech.Duration(result.Minutes)}.",
        [AssistantResultCode.NoRunningSleep] = result => $"{Name(result)} não está dormindo agora, então não havia sono para encerrar.",
        [AssistantResultCode.SeveralRunningSleeps] = result => $"{Name(result)} tem {result.Count} cronômetros de sono ativos. Encerre-os no app.",
        [AssistantResultCode.BottleLogged] = result => $"Registrei uma mamadeira de {result.AmountMl} ml{BottleContent(result)} {When(result, result.At)} para {Name(result)}.",
        [AssistantResultCode.NursingStarted] = result => $"Amamentação iniciada no peito {Side(result)} para {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.NursingAlreadyRunning] = result => $"{Name(result)} já está mamando, desde {Since(result, result.At)}.",
        [AssistantResultCode.DiaperLogged] = result => $"Registrei uma fralda {Diaper(result)} para {Name(result)} {When(result, result.At)}.",
        [AssistantResultCode.LastFeed] = LastFeed,
        [AssistantResultCode.NoFeeds] = result => $"Não encontrei nenhuma alimentação de {Name(result)} nos últimos 30 dias.",
        [AssistantResultCode.Sleeping] = result => $"{Name(result)} está dormindo desde {Since(result, result.At)}, há {Speech.Duration(result.Minutes)}.",
        [AssistantResultCode.Awake] = result => $"{Name(result)} acordou {When(result, result.At)}. O último sono durou {Speech.Duration(result.Minutes)}.",
        [AssistantResultCode.NoSleeps] = result => $"Não encontrei nenhum sono de {Name(result)} nos últimos 30 dias.",
        [AssistantResultCode.DiapersToday] = DiapersToday,
        [AssistantResultCode.NextAppointment] = result => $"A próxima consulta de {Name(result)} é {result.Appointment!.Title}, {Day(result, result.Appointment.StartsAt)}.",
        [AssistantResultCode.NoAppointment] = result => $"{Name(result)} não tem consultas marcadas.",
        [AssistantResultCode.VaccinesDue] = VaccinesDue,
        [AssistantResultCode.NoVaccinesDue] = result => $"Pelo calendário de vacinas, {Name(result)} não tem nenhuma dose pendente agora.",
        [AssistantResultCode.UnknownBaby] = _ => "Não encontrei esse bebê na sua conta do Lotties.",
        [AssistantResultCode.InvalidDate] = _ => "Pergunte sobre um dia do último ano, até hoje.",
        [AssistantResultCode.Babies] = result => result.Babies.Count == 0
            ? "Ainda não há nenhum bebê na sua conta do Lotties."
            : $"Seus bebês no Lotties: {Speech.List(result.Babies.Select(baby => baby.Name).ToArray())}.",
        [AssistantResultCode.BabyProfile] = result => $"{Name(result)} tem {Age(result.Age)}.",
        [AssistantResultCode.DaySummary] = DaySummary,
        [AssistantResultCode.WeekSummary] = WeekSummary,
    };

    private static string Age(AssistantBabyAge? age) => age switch
    {
        null or { Days: 0 } => "menos de um dia",
        { Months: > 0 } => Speech.Count(age.Months, "mês", "meses"),
        { Weeks: > 0 } => Speech.Count(age.Weeks, "semana", "semanas"),
        _ => Speech.Count(age.Days, "dia", "dias"),
    };

    private static string DaySummary(AssistantResult result)
    {
        var day = result.Days.FirstOrDefault();
        var when = day switch
        {
            null => "Nesse dia",
            { Complete: false } => "Até agora, hoje",
            _ => $"Em {day.Date.ToString("d 'de' MMMM", Speech.Culture)}",
        };
        return $"{when}, {Name(result)} {Totals(SpokenDayTotals.Of(result.Days))}.";
    }

    private static string WeekSummary(AssistantResult result)
    {
        var last = result.Days.Count == 0 ? "hoje" : result.Days[^1].Date.ToString("d 'de' MMMM", Speech.Culture);
        return $"Nos 7 dias até {last}, {Name(result)} {Totals(SpokenDayTotals.Of(result.Days))}.";
    }

    private static string Totals(SpokenDayTotals totals)
    {
        var bottles = totals.BottleMl > 0 ? $", {totals.BottleMl} ml em mamadeiras" : string.Empty;
        return $"dormiu {Speech.Duration(totals.SleepMinutes)} com {Speech.Count(totals.Naps, "soneca", "sonecas")}, teve {Speech.Count(totals.Feeds, "alimentação", "alimentações")}{bottles} e {Speech.Count(totals.Diapers, "fralda", "fraldas")}";
    }

    private static Dictionary<AlexaPrompt, AlexaLine> Prompts() => new()
    {
        [AlexaPrompt.Welcome] = new("Boas-vindas ao Lotties. Você pode dizer, por exemplo: o bebê dormiu, registrar mamadeira de 120 ml, ou quando foi a última mamada?", "O que você quer fazer?"),
        [AlexaPrompt.Help] = new("Você pode registrar sono, mamadeiras, amamentação e fraldas, e perguntar sobre a última mamada, o sono, as fraldas de hoje, a próxima consulta ou as vacinas pendentes. Por exemplo: o bebê acordou. O que você quer fazer?", "O que você quer fazer?"),
        [AlexaPrompt.Goodbye] = new("Até logo."),
        [AlexaPrompt.Fallback] = new("Desculpe, o Lotties não consegue ajudar com isso. Diga ajuda para saber o que dá para fazer.", "O que você quer fazer?"),
        [AlexaPrompt.SetBabyHelp] = new("Para escolher o bebê dos comandos de voz, abra o app Lotties, depois Configurações, Assistentes de voz."),
        [AlexaPrompt.LinkAccount] = new("Vincule a sua conta do Lotties no app Alexa para usar esta skill."),
        [AlexaPrompt.DiaperKindMissing] = new("A fralda estava com xixi, cocô ou os dois? Diga, por exemplo: registrar fralda de xixi."),
        [AlexaPrompt.Error] = new("Desculpe, algo deu errado. Tente de novo."),
    };

    private static string LastFeed(AssistantResult result)
    {
        var feed = FeedDescription(result);
        return result.Running == true
            ? $"{Name(result)} está se alimentando agora: {feed}, desde {Since(result, result.At)}."
            : $"A última alimentação de {Name(result)} foi {feed}, {AtAndAgo(result, result.At)}.";
    }

    private static string DiapersToday(AssistantResult result)
    {
        var window = result.Window == AssistantDayWindow.Today ? "hoje" : "nas últimas 24 horas";
        return result.Count is null or 0
            ? $"{Name(result)} não teve nenhuma fralda {window}."
            : $"{Name(result)} teve {Speech.Count(result.Count.Value, "fralda", "fraldas")} {window}: {result.Wet} com xixi e {result.Dirty} com cocô.";
    }

    private static string VaccinesDue(AssistantResult result)
    {
        var overdue = result.Overdue is > 0 ? $", {Speech.Count(result.Overdue.Value, "atrasada", "atrasadas")}" : string.Empty;
        var names = Speech.List(result.Vaccines.Select(dose => Localized(dose.Names)).Distinct(StringComparer.Ordinal).ToArray());
        return $"Pelo calendário de vacinas, {Name(result)} tem {Speech.Count(result.Count ?? 0, "dose pendente", "doses pendentes")}{overdue}: {names}. Você pode vê-las no app.";
    }

    private static string FeedDescription(AssistantResult result) => result.FeedMethod switch
    {
        FeedMethod.Bottle when result.AmountMl is { } amount => $"uma mamadeira de {amount} ml{BottleContent(result)}",
        FeedMethod.Bottle => $"uma mamadeira{BottleContent(result)}",
        FeedMethod.Breast when result.Side is not null => $"amamentação no peito {Side(result)}",
        FeedMethod.Breast => "amamentação",
        FeedMethod.Solid => "comida sólida",
        _ => "uma alimentação",
    };

    private static string BottleContent(AssistantResult result) => result.BottleKind switch
    {
        BottleKind.Formula when !string.IsNullOrWhiteSpace(result.FormulaName) => $" de {result.FormulaName}",
        BottleKind.Formula => " de fórmula",
        BottleKind.BreastMilk => " de leite materno",
        _ => string.Empty,
    };

    private static string Side(AssistantResult result) => result.Side == BreastSide.Right ? "direito" : "esquerdo";

    private static string Diaper(AssistantResult result) => result.Diaper switch
    {
        DiaperKind.Dirty => "de cocô",
        DiaperKind.Both => "de xixi e cocô",
        _ => "de xixi",
    };

    /// <summary>"às 15:15" ("à 01:05"), or "agora mesmo" / "há 20 minutos" without a known zone.</summary>
    private static string When(AssistantResult result, DateTimeOffset? instant) =>
        Speech.Clock(result, instant) is { } clock ? $"{AtHour(clock)} {clock}" : instant is { } value && Speech.MinutesBetween(value, result.AsOf) < 1 ? "agora mesmo" : Ago(result, instant);

    /// <summary>"15:15", or "há 20 minutos" without a known zone.</summary>
    private static string Since(AssistantResult result, DateTimeOffset? instant) => Speech.Clock(result, instant) ?? Ago(result, instant);

    /// <summary>"às 15:15, há 20 minutos", or "há 20 minutos" without a known zone.</summary>
    private static string AtAndAgo(AssistantResult result, DateTimeOffset? instant) =>
        Speech.Clock(result, instant) is { } clock ? $"{AtHour(clock)} {clock}, {Ago(result, instant)}" : Ago(result, instant);

    private static string Ago(AssistantResult result, DateTimeOffset? instant) =>
        instant is { } value ? $"há {Speech.Duration(Speech.MinutesBetween(value, result.AsOf))}" : string.Empty;

    /// <summary>"hoje às 15:15", "amanhã às 09:00", "na terça-feira, 28 de outubro, às 15:15", or "daqui a 3 dias" without a zone.</summary>
    private static string Day(AssistantResult result, DateTimeOffset instant)
    {
        if (Speech.Local(result, instant) is not { } local || Speech.Local(result, result.AsOf) is not { } today)
        {
            return $"daqui a {Speech.Duration(Speech.MinutesBetween(result.AsOf, instant))}";
        }

        var clock = Speech.Clock(result, instant)!;
        var days = (local.Date - today.Date).Days;
        return days switch
        {
            0 => $"hoje {AtHour(clock)} {clock}",
            1 => $"amanhã {AtHour(clock)} {clock}",
            _ => $"{OnDay(local)} {local.ToString("dddd, d 'de' MMMM", Speech.Culture)}, {AtHour(clock)} {clock}",
        };
    }

    private static string AtHour(string clock) => clock.StartsWith("01:", StringComparison.Ordinal) ? "à" : "às";

    private static string OnDay(DateTime local) => local.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday ? "no" : "na";

    private static string Localized(IReadOnlyDictionary<string, string> names) =>
        names.TryGetValue("pt-BR", out var portuguese) ? portuguese : names.TryGetValue("en", out var english) ? english : names.Values.FirstOrDefault() ?? string.Empty;

    private static string Name(AssistantResult result) => result.Baby?.Name ?? "o bebê";
}
