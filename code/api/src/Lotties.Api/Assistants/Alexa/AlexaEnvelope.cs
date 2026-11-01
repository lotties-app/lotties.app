using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>
/// The parts of an Alexa request body the skill reads (request and response JSON reference, custom skills). Every other
/// member is ignored; nothing here is logged.
/// </summary>
public sealed record AlexaRequestEnvelope(string? Version, AlexaSession? Session, AlexaContext? Context, AlexaRequest? Request)
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        MaxDepth = 32,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>The skill id the request names (the session's, else the context's).</summary>
    [JsonIgnore]
    public string? ApplicationId => Session?.Application?.ApplicationId ?? Context?.System?.Application?.ApplicationId;

    /// <summary>Whether every skill id the request names is <paramref name="isSkill"/> (at least one must be present).</summary>
    public bool NamesOnly(Func<string?, bool> isSkill)
    {
        ArgumentNullException.ThrowIfNull(isSkill);
        var named = new[] { Session?.Application?.ApplicationId, Context?.System?.Application?.ApplicationId }.Where(id => id is not null).ToArray();
        return named.Length > 0 && named.All(isSkill);
    }

    /// <summary>The account-linking access token (the context's, else the session's), or <c>null</c> when the account is not linked.</summary>
    [JsonIgnore]
    public string? AccessToken =>
        NonBlank(Context?.System?.User?.AccessToken) ?? NonBlank(Session?.User?.AccessToken);

    /// <summary>Whether the device that sent the request can show an APL document (<c>supportedInterfaces</c> has <c>Alexa.Presentation.APL</c>).</summary>
    [JsonIgnore]
    public bool SupportsApl => Context?.System?.Device?.SupportedInterfaces?.ContainsKey(AplInterface) == true;

    public const string AplInterface = "Alexa.Presentation.APL";

    private static string? NonBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}

public sealed record AlexaSession(bool? New, string? SessionId, AlexaApplication? Application, AlexaUser? User);

public sealed record AlexaContext([property: JsonPropertyName("System")] AlexaSystem? System);

public sealed record AlexaSystem(AlexaApplication? Application, AlexaUser? User, AlexaDevice? Device = null);

/// <summary>Only the names of the interfaces the device supports are read (their settings are ignored).</summary>
public sealed record AlexaDevice(IReadOnlyDictionary<string, JsonElement>? SupportedInterfaces);

public sealed record AlexaApplication(string? ApplicationId);

public sealed record AlexaUser(string? UserId, string? AccessToken);

public sealed record AlexaRequest(string? Type, string? RequestId, string? Timestamp, string? Locale, AlexaIntent? Intent, IReadOnlyList<JsonElement>? Arguments = null)
{
    /// <summary>The first argument of an APL <c>SendEvent</c> (<c>Alexa.Presentation.APL.UserEvent</c>), when it is a string.</summary>
    [JsonIgnore]
    public string? FirstArgument => Arguments is { Count: > 0 } && Arguments[0].ValueKind == JsonValueKind.String ? Arguments[0].GetString() : null;
}

public sealed record AlexaIntent(string? Name, IReadOnlyDictionary<string, AlexaSlot>? Slots);

public sealed record AlexaSlot(string? Name, string? Value, AlexaResolutions? Resolutions);

public sealed record AlexaResolutions(IReadOnlyList<AlexaResolution>? ResolutionsPerAuthority);

public sealed record AlexaResolution(AlexaResolutionStatus? Status, IReadOnlyList<AlexaResolutionValueWrapper>? Values);

public sealed record AlexaResolutionStatus(string? Code);

public sealed record AlexaResolutionValueWrapper(AlexaResolutionValue? Value);

public sealed record AlexaResolutionValue(string? Name, string? Id);

/// <summary>The response body (version 1.0): speech, an optional reprompt and card, whether the session ends.</summary>
public sealed record AlexaResponseEnvelope(string Version, AlexaResponseBody Response);

public sealed record AlexaResponseBody(AlexaOutputSpeech? OutputSpeech, AlexaCard? Card, AlexaReprompt? Reprompt, bool? ShouldEndSession, IReadOnlyList<AlexaDirective>? Directives = null);

/// <summary>
/// An APL directive: <c>Alexa.Presentation.APL.RenderDocument</c> (document and datasources) or
/// <c>Alexa.Presentation.APL.ExecuteCommands</c> (commands), both addressed by the document <see cref="Token"/>.
/// </summary>
public sealed record AlexaDirective(string Type, string Token, JsonNode? Document = null, JsonNode? Datasources = null, JsonNode? Commands = null);

public sealed record AlexaOutputSpeech(string Type, string Ssml);

public sealed record AlexaReprompt(AlexaOutputSpeech OutputSpeech);

/// <summary>A card; the skill sends only <c>LinkAccount</c> (it opens account linking in the Alexa app).</summary>
public sealed record AlexaCard(string Type);
