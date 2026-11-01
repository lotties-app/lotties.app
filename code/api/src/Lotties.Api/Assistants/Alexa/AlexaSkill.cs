using System.Collections.Frozen;
using System.Globalization;
using System.Text.Json;
using Lotties.Api.Authentication;
using Lotties.Api.Limits;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Exceptions;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>An answer to Alexa and what it was (for the log: a result code or a prompt name, never words).</summary>
internal sealed record AlexaAnswer(AlexaResponseEnvelope Response, string Outcome);

/// <summary>
/// The Alexa adapter of the assistant command layer (docs/design/32-assistants.md section 6), in Amazon's order: Alexa
/// enabled (else 404); body within <see cref="AlexaOptions.MaxRequestBodyBytes"/> (else 413); signature and certificate
/// chain (<see cref="IAlexaRequestVerifier"/>, else 400); JSON; timestamp within <see cref="AlexaOptions.TimestampTolerance"/>;
/// skill id one of <see cref="AlexaOptions.SkillIds"/> (else 400). Then the request: Launch, the built-in intents and
/// <c>SetBabyHelpIntent</c> answer without an account; a command intent needs the account-linking token
/// (<see cref="IAccountLinkTokenValidator"/>; none or invalid = the LinkAccount card), then the user's assistant limit
/// (<see cref="AssistantRateLimiter"/>), then runs as that user through <see cref="IAssistantService"/> and is spoken in the
/// request's language (<see cref="AlexaLanguages"/>). <c>PanelIntent</c> and the APL <c>UserEvent</c> refresh of the Echo Show
/// night panel (docs/design/42-echo-show-panel.md) take the same path and answer an APL directive (<see cref="AlexaPanel"/>). Logs: request type, known intent name, outcome code and the
/// correlation id; never the body, slots, tokens or user ids.
/// </summary>
internal sealed class AlexaSkill(
    IOptions<AlexaOptions> options,
    IAlexaRequestVerifier verifier,
    IAccountLinkTokenValidator tokens,
    AssistantRateLimiter rateLimiter,
    IAssistantService assistant,
    TimeProvider timeProvider,
    ILogger<AlexaSkill> logger)
{
    public const string AdapterName = "alexa";
    private const string Version = "1.0";

    private delegate Task<AssistantResult> Command(IAssistantService assistant, AssistantInvocation invocation, AlexaIntent intent, CancellationToken cancellationToken);

    private static readonly FrozenDictionary<string, Command> Commands = new Dictionary<string, Command>(StringComparer.Ordinal)
    {
        ["SleepStartIntent"] = (service, invocation, _, token) => service.LogSleepStartAsync(invocation, token),
        ["SleepEndIntent"] = (service, invocation, _, token) => service.LogSleepEndAsync(invocation, token),
        ["BottleIntent"] = (service, invocation, intent, token) => service.LogBottleVolumeAsync(invocation, AlexaSlots.Decimal(intent, AlexaSlots.AmountSlot), AlexaSlots.Volume(intent), AlexaSlots.BottleKind(intent), token),
        ["NursingIntent"] = (service, invocation, intent, token) => service.LogNursingAsync(invocation, AlexaSlots.Side(intent), token),
        ["DiaperIntent"] = (service, invocation, intent, token) => service.LogDiaperAsync(invocation, AlexaSlots.Diaper(intent)!.Value, token),
        ["LastFeedIntent"] = (service, invocation, _, token) => service.ReadLastFeedAsync(invocation, token),
        ["SleepStatusIntent"] = (service, invocation, _, token) => service.ReadSleepStatusAsync(invocation, token),
        ["DiapersTodayIntent"] = (service, invocation, _, token) => service.ReadDiapersTodayAsync(invocation, token),
        ["NextAppointmentIntent"] = (service, invocation, _, token) => service.ReadNextAppointmentAsync(invocation, token),
        ["DueVaccinesIntent"] = (service, invocation, _, token) => service.ReadDueVaccinesAsync(invocation, token),
        ["NextNapWindowIntent"] = (service, invocation, _, token) => service.ReadNextNapWindowAsync(invocation, token),
        ["NextFeedIntent"] = (service, invocation, _, token) => service.ReadNextFeedAsync(invocation, token),
        ["NextDiaperIntent"] = (service, invocation, _, token) => service.ReadNextDiaperAsync(invocation, token),
        ["DiapersAverageIntent"] = (service, invocation, _, token) => service.ReadDiapersAverageAsync(invocation, token),
        ["BottleAverageIntent"] = (service, invocation, _, token) => service.ReadBottleAverageAsync(invocation, token),
        ["SleepTodayIntent"] = (service, invocation, _, token) => service.ReadSleepTodayAsync(invocation, token),
        ["BottleTodayIntent"] = (service, invocation, _, token) => service.ReadBottleTodayAsync(invocation, token),
        ["FeedsTodayIntent"] = (service, invocation, _, token) => service.ReadFeedsTodayAsync(invocation, token),
        ["LastDiaperIntent"] = (service, invocation, _, token) => service.ReadLastDiaperAsync(invocation, token),
        ["RequestDeleteLastIntent"] = (service, invocation, _, token) => service.RequestDeleteLastAsync(invocation, token),
        ["CryReasonsIntent"] = (service, invocation, _, token) => service.ReadCryReasonsAsync(invocation, token),
        ["BathIntent"] = (service, invocation, intent, token) => service.LogBathAsync(invocation, AlexaSlots.Decimal(intent, "temperature"), null, token),
        ["TummyTimeIntent"] = (service, invocation, _, token) => service.LogTummyTimeAsync(invocation, token),
        ["BellyPainIntent"] = (service, invocation, intent, token) => service.LogBellyPainAsync(invocation, AlexaSlots.Number(intent, "painLevel"), token),
        ["BreastPumpIntent"] = (service, invocation, intent, token) => service.LogBreastPumpAsync(invocation, AlexaSlots.Number(intent, "amountLeft"), AlexaSlots.Number(intent, "amountRight"), token),
        ["NasalSuctionIntent"] = (service, invocation, _, token) => service.LogNasalSuctionAsync(invocation, null, null, token),
        ["BellyMassageIntent"] = (service, invocation, _, token) => service.LogBellyMassageAsync(invocation, null, null, token),
        ["FussyIntent"] = (service, invocation, intent, token) => service.LogFussyAsync(invocation, AlexaSlots.Choice(intent, "intensity", AssistantChoices.FussyIntensities), null, token),
        ["NailTrimIntent"] = (service, invocation, _, token) => service.LogNailTrimAsync(invocation, null, token),
        ["TemperatureIntent"] = (service, invocation, intent, token) => service.LogTemperatureAsync(invocation, AlexaSlots.Decimal(intent, "value"), null, AlexaSlots.Choice(intent, "method", AssistantChoices.TemperatureMethods), token),
        ["SpitUpIntent"] = (service, invocation, _, token) => service.LogSpitUpAsync(invocation, null, null, token),
        ["TeethingIntent"] = (service, invocation, _, token) => service.LogTeethingAsync(invocation, null, null, token),
        ["MilestoneIntent"] = (service, invocation, intent, token) => service.LogMilestoneAsync(invocation, AlexaSlots.Choice(intent, "milestone", AssistantChoices.Milestones), token),
        ["SymptomIntent"] = (service, invocation, intent, token) => service.LogSymptomAsync(invocation, AlexaSlots.Choice(intent, "symptom", AssistantChoices.Symptoms), AlexaSlots.Choice(intent, "severity", AssistantChoices.Severities), token),
        ["OutdoorIntent"] = (service, invocation, _, token) => service.LogOutdoorAsync(invocation, null, token),
        ["SkinCareIntent"] = (service, invocation, _, token) => service.LogSkinCareAsync(invocation, null, token),
        ["MedicationIntent"] = (service, invocation, intent, token) => service.LogMedicationAsync(invocation, AlexaSlots.SlotValue(intent, "medicationName"), token),
        ["MedicationReminderIntent"] = (service, invocation, _, token) => service.ReadMedicationReminderAsync(invocation, token),
        ["WeekSummaryIntent"] = (service, invocation, _, token) => service.ReadWeekSummaryAsync(invocation, null, token),
        ["ListBabiesIntent"] = (service, invocation, _, token) => service.ListBabiesAsync(invocation, token),
        ["BabyProfileIntent"] = (service, invocation, _, token) => service.ReadBabyProfileAsync(invocation, token),
        ["DaySummaryIntent"] = (service, invocation, _, token) => service.ReadDaySummaryAsync(invocation, null, token),
    }.ToFrozenDictionary(StringComparer.Ordinal);

    private static readonly FrozenDictionary<string, AlexaPrompt> Prompts = new Dictionary<string, AlexaPrompt>(StringComparer.Ordinal)
    {
        ["AMAZON.HelpIntent"] = AlexaPrompt.Help,
        ["AMAZON.NavigateHomeIntent"] = AlexaPrompt.Help,
        ["AMAZON.StopIntent"] = AlexaPrompt.Goodbye,
        ["AMAZON.CancelIntent"] = AlexaPrompt.Goodbye,
        ["AMAZON.FallbackIntent"] = AlexaPrompt.Fallback,
        ["SetBabyHelpIntent"] = AlexaPrompt.SetBabyHelp,
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>The intents that need a slot the command cannot do without, and the question asked when it is missing.</summary>
    private static readonly FrozenDictionary<string, Func<AlexaIntent, AlexaPrompt?>> RequiredSlots = new Dictionary<string, Func<AlexaIntent, AlexaPrompt?>>(StringComparer.Ordinal)
    {
        ["DiaperIntent"] = intent => AlexaSlots.Diaper(intent) is null ? AlexaPrompt.DiaperKindMissing : null,
        ["BellyPainIntent"] = intent => AlexaSlots.Number(intent, "painLevel") is null ? AlexaPrompt.PainLevelMissing : null,
        ["TemperatureIntent"] = intent => AlexaSlots.Decimal(intent, "value") is null ? AlexaPrompt.TemperatureMissing : null,
        ["MedicationIntent"] = intent => AlexaSlots.SlotValue(intent, "medicationName") is null ? AlexaPrompt.MedicationNameMissing : null,
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>The intents that write (log an event or ask to delete one): a question must never match one of them.</summary>
    public static IReadOnlySet<string> WriteIntents { get; } = new HashSet<string>(StringComparer.Ordinal)
    {
        "SleepStartIntent", "SleepEndIntent", "BottleIntent", "NursingIntent", "DiaperIntent", "RequestDeleteLastIntent", "BathIntent", "TummyTimeIntent",
        "BellyPainIntent", "BreastPumpIntent", "NasalSuctionIntent", "BellyMassageIntent", "FussyIntent", "NailTrimIntent", "TemperatureIntent", "SpitUpIntent",
        "TeethingIntent", "MilestoneIntent", "SymptomIntent", "OutdoorIntent", "SkinCareIntent", "MedicationIntent",
    }.ToFrozenSet(StringComparer.Ordinal);

    /// <summary>The Echo Show night panel intent (a read intent: it runs several read commands and lays them out, see <see cref="AlexaPanel"/>).</summary>
    public const string PanelIntent = "PanelIntent";

    private const string UserEventRequest = "Alexa.Presentation.APL.UserEvent";

    /// <summary>The intent names this skill knows (the only ones that may appear in a log line).</summary>
    public static IReadOnlyCollection<string> KnownIntents { get; } = Commands.Keys.Concat(Prompts.Keys).Append(PanelIntent).ToArray();

    public async Task<IResult> HandleAsync(HttpContext context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        var settings = options.Value;
        if (!settings.Enabled)
        {
            return Results.NotFound();
        }

        var body = await AlexaBody.ReadAsync(context.Request, settings.MaxRequestBodyBytes, cancellationToken);
        if (body is null)
        {
            return Reject(context, StatusCodes.Status413PayloadTooLarge, "body_too_large");
        }

        var verification = await verifier.VerifyAsync(SignedRequestOf(context.Request, body), cancellationToken);
        if (verification != AlexaVerification.Valid)
        {
            return Reject(context, StatusCodes.Status400BadRequest, verification.ToString());
        }

        var envelope = AlexaBody.Parse(body);
        var refusal = envelope is null ? "invalid_request" : RefusalOf(envelope, settings);
        if (refusal is not null)
        {
            return Reject(context, StatusCodes.Status400BadRequest, refusal);
        }

        var answer = await AnswerAsync(context, envelope!, AlexaLanguages.For(envelope!.Request!.Locale), cancellationToken);
        Log(context, envelope, answer.Outcome);
        return Results.Json(answer.Response, AlexaRequestEnvelope.JsonOptions);
    }

    private string? RefusalOf(AlexaRequestEnvelope envelope, AlexaOptions settings) => envelope switch
    {
        { Request: null } or { Request.Type: null } => "invalid_request",
        { Request.RequestId: null or "" } or { Request.RequestId.Length: > AssistantInvocation.MaxIdLength } => "invalid_request",
        _ when !IsFresh(envelope.Request!.Timestamp) => "stale_timestamp",
        _ when !envelope.NamesOnly(settings.IsSkill) => "unknown_skill",
        _ => null,
    };

    private async Task<AlexaAnswer> AnswerAsync(HttpContext context, AlexaRequestEnvelope envelope, IAlexaLanguage language, CancellationToken cancellationToken)
    {
        var request = envelope.Request!;
        return request.Type switch
        {
            "LaunchRequest" => Ask(language, AlexaPrompt.Welcome),
            "IntentRequest" => await IntentAsync(context, envelope, language, cancellationToken),
            UserEventRequest when request.FirstArgument == AlexaPanel.RefreshArgument => await PanelAsync(context, envelope, language, refresh: true, cancellationToken),
            _ => new AlexaAnswer(new AlexaResponseEnvelope(Version, new AlexaResponseBody(null, null, null, null)), request.Type ?? "unknown"),
        };
    }

    private async Task<AlexaAnswer> IntentAsync(HttpContext context, AlexaRequestEnvelope envelope, IAlexaLanguage language, CancellationToken cancellationToken)
    {
        var intent = envelope.Request!.Intent ?? new AlexaIntent(null, null);
        var name = intent.Name ?? string.Empty;
        if (Prompts.TryGetValue(name, out var prompt))
        {
            return Ask(language, prompt);
        }

        if (name == PanelIntent)
        {
            return await PanelAsync(context, envelope, language, refresh: false, cancellationToken);
        }

        return Commands.TryGetValue(name, out var command)
            ? await CommandAsync(context, envelope, intent, command, language, cancellationToken)
            : Ask(language, AlexaPrompt.Fallback);
    }

    private async Task<AlexaAnswer> CommandAsync(HttpContext context, AlexaRequestEnvelope envelope, AlexaIntent intent, Command command, IAlexaLanguage language, CancellationToken cancellationToken)
    {
        if (await AuthenticateAsync(context, envelope) is not { } subject)
        {
            return LinkAccount(language);
        }

        if (!rateLimiter.TryAcquire(subject))
        {
            return RateLimited(language);
        }

        if (RequiredSlots.TryGetValue(intent.Name!, out var required) && required(intent) is { } missing)
        {
            return Ask(language, missing);
        }

        return await RunAsync(command, InvocationOf(envelope, language), intent, language, cancellationToken);
    }

    /// <summary>The user's <c>sub</c> from the account-linking token (and the request's user set to her), or <c>null</c> when the account is not linked.</summary>
    private async Task<string?> AuthenticateAsync(HttpContext context, AlexaRequestEnvelope envelope)
    {
        var principal = envelope.AccessToken is { } token ? await tokens.ValidateAsync(context, token) : null;
        if (principal?.FindFirst(OidcClaims.Subject)?.Value is not { Length: > 0 } subject)
        {
            return null;
        }

        context.User = principal;
        return subject;
    }

    private static AssistantInvocation InvocationOf(AlexaRequestEnvelope envelope, IAlexaLanguage language) =>
        new(AdapterName, envelope.Request!.RequestId!, language.FallbackTimeZone, Locale: envelope.Request.Locale);

    private AlexaAnswer RateLimited(IAlexaLanguage language) =>
        Speak(language.Say(new AssistantResult { Code = AssistantResultCode.RateLimited, AsOf = timeProvider.GetUtcNow() }), AssistantResult.CodeName(AssistantResultCode.RateLimited));

    /// <summary>
    /// The night panel (design 42): the same account-linking and per-user limit as any command, then the existing read commands
    /// laid out by <see cref="AlexaPanel"/>. On a screen it answers a RenderDocument and keeps the session open without speaking
    /// (it is night); the document asks for a refresh every minute (<c>panelRefresh</c>), which comes back here. A refresh that
    /// the limit refuses keeps the screen as it is and only marks it "not updated". Without a screen it speaks the usual answers.
    /// </summary>
    private async Task<AlexaAnswer> PanelAsync(HttpContext context, AlexaRequestEnvelope envelope, IAlexaLanguage language, bool refresh, CancellationToken cancellationToken)
    {
        if (await AuthenticateAsync(context, envelope) is not { } subject)
        {
            return LinkAccount(language);
        }

        if (!rateLimiter.TryAcquire(subject))
        {
            return refresh ? Directive(AlexaPanel.MarkStale(language), "panel:stale") : RateLimited(language);
        }

        var invocation = InvocationOf(envelope, language);
        var reads = await ReadPanelAsync(invocation, envelope.SupportsApl, cancellationToken);
        if (!envelope.SupportsApl)
        {
            return Speak(AlexaPanel.Summary(reads, language), "panel:speech");
        }

        var (directive, shown) = AlexaPanel.Render(reads, language);
        return Directive(directive, $"panel:{shown}/4");
    }

    /// <summary>Runs the read commands the panel shows, one after the other (one database context); a refused one is a missing tile, never an error screen.</summary>
    private async Task<PanelReads> ReadPanelAsync(AssistantInvocation invocation, bool screen, CancellationToken cancellationToken)
    {
        var sleep = await ReadAsync(assistant.ReadSleepStatusAsync, invocation, cancellationToken);
        var lastFeed = await ReadAsync(assistant.ReadLastFeedAsync, invocation, cancellationToken);
        var lastDiaper = await ReadAsync(assistant.ReadLastDiaperAsync, invocation, cancellationToken);
        if (!screen)
        {
            return new PanelReads(sleep, lastFeed, null, lastDiaper, null);
        }

        var nextFeed = await ReadAsync(assistant.ReadNextFeedAsync, invocation, cancellationToken);
        var nextNap = await ReadAsync(assistant.ReadNextNapWindowAsync, invocation, cancellationToken);
        return new PanelReads(sleep, lastFeed, nextFeed, lastDiaper, nextNap);
    }

    private async Task<AssistantResult?> ReadAsync(Func<AssistantInvocation, CancellationToken, Task<AssistantResult>> read, AssistantInvocation invocation, CancellationToken cancellationToken)
    {
        try
        {
            return await read(invocation, cancellationToken);
        }
        catch (DomainException exception)
        {
            logger.LogWarning("Alexa panel read refused by the domain: {Code}", exception.Code);
            return null;
        }
    }

    private async Task<AlexaAnswer> RunAsync(Command command, AssistantInvocation invocation, AlexaIntent intent, IAlexaLanguage language, CancellationToken cancellationToken)
    {
        try
        {
            var result = await command(assistant, invocation, intent, cancellationToken);
            return Speak(language.Say(result), AssistantResult.CodeName(result.Code));
        }
        catch (DomainException exception)
        {
            logger.LogWarning("Alexa command refused by the domain: {Code}", exception.Code);
            return Speak(language.Say(AlexaPrompt.Error).Text, $"error:{exception.Code}");
        }
    }

    private bool IsFresh(string? timestamp) =>
        DateTimeOffset.TryParse(timestamp, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var sent)
        && (timeProvider.GetUtcNow() - sent).Duration() <= AlexaOptions.TimestampTolerance;

    private static AlexaSignedRequest SignedRequestOf(HttpRequest request, byte[] body) => new(
        request.Headers[AlexaRequestVerifier.CertificateChainUrlHeader].ToString(),
        FirstNonBlank(request.Headers[AlexaRequestVerifier.Signature256Header].ToString(), request.Headers[AlexaRequestVerifier.SignatureHeader].ToString()),
        body);

    private static string? FirstNonBlank(params string[] values) => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));

    private static AlexaAnswer Speak(string text, string outcome) =>
        new(new AlexaResponseEnvelope(Version, new AlexaResponseBody(Ssml.Of(text), null, null, true)), outcome);

    private static AlexaAnswer Directive(AlexaDirective directive, string outcome) =>
        new(new AlexaResponseEnvelope(Version, new AlexaResponseBody(null, null, null, false, [directive])), outcome);

    private static AlexaAnswer Ask(IAlexaLanguage language, AlexaPrompt prompt)
    {
        var line = language.Say(prompt);
        var reprompt = line.Reprompt is null ? null : new AlexaReprompt(Ssml.Of(line.Reprompt));
        return new AlexaAnswer(new AlexaResponseEnvelope(Version, new AlexaResponseBody(Ssml.Of(line.Text), null, reprompt, reprompt is null)), prompt.ToString());
    }

    private static AlexaAnswer LinkAccount(IAlexaLanguage language) =>
        new(new AlexaResponseEnvelope(Version, new AlexaResponseBody(Ssml.Of(language.Say(AlexaPrompt.LinkAccount).Text), new AlexaCard("LinkAccount"), null, true)), nameof(AlexaPrompt.LinkAccount));

    private IResult Reject(HttpContext context, int status, string reason)
    {
        logger.LogWarning("Alexa request refused: {Reason} (correlation {CorrelationId})", reason, context.TraceIdentifier);
        return Results.StatusCode(status);
    }

    private void Log(HttpContext context, AlexaRequestEnvelope envelope, string outcome)
    {
        var intent = envelope.Request?.Intent?.Name is { } name && KnownIntents.Contains(name) ? name : "-";
        logger.LogInformation(
            "Alexa {RequestType} {Intent}: {Outcome} (correlation {CorrelationId})",
            envelope.Request?.Type,
            intent,
            outcome,
            context.TraceIdentifier);
    }
}

/// <summary>The raw request body, read once and bounded (it is what the signature covers), and its safe parse.</summary>
internal static class AlexaBody
{
    private const int ChunkBytes = 8 * 1024;

    /// <summary>The body bytes, or <c>null</c> when it is (or declares to be) larger than <paramref name="maxBytes"/>.</summary>
    public static async Task<byte[]?> ReadAsync(HttpRequest request, int maxBytes, CancellationToken cancellationToken)
    {
        if (request.ContentLength > maxBytes)
        {
            return null;
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[ChunkBytes];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, cancellationToken)) > 0 && buffer.Length + read <= maxBytes)
        {
            buffer.Write(chunk, 0, read);
        }

        return read > 0 ? null : buffer.ToArray();
    }

    /// <summary>The envelope, or <c>null</c> for anything that is not a JSON object of the expected shape (depth bounded).</summary>
    public static AlexaRequestEnvelope? Parse(byte[] body)
    {
        try
        {
            return JsonSerializer.Deserialize<AlexaRequestEnvelope>(body, AlexaRequestEnvelope.JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
