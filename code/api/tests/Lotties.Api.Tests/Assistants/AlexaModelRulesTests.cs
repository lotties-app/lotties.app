using System.Text.Json;
using System.Text.RegularExpressions;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Assistants.Mcp;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.EventTypes;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The interaction models against the assistant rules (docs/design/32-assistants.md): valid JSON, a question never lands in a write
/// intent, nothing the Alexa console rejects, read intents without slots, every choice slot offering exactly the built-in options,
/// every intent reachable from the adapter and every write command offered to MCP (but for medication, which has no MCP tool).
/// </summary>
public sealed class AlexaModelRulesTests
{
    private static readonly string[] Locales = ["en-US", "pt-BR"];

    private static readonly string[] QuestionStarts =
        ["how ", "what ", "when ", "why ", "which ", "who ", "is ", "are ", "does ", "quanto", "quanta", "quando", "qual ", "por que", "quantos", "quantas", "quem ", "onde "];

    private sealed record Intent(string Name, string[] Samples, string[] Slots);

    private static JsonElement Language(string locale)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "alexa", $"interaction-model.{locale}.json")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return JsonDocument.Parse(File.ReadAllText(Path.Combine(directory.FullName, "alexa", $"interaction-model.{locale}.json"))).RootElement.GetProperty("interactionModel").GetProperty("languageModel").Clone();
    }

    private static List<Intent> Intents(string locale) => Language(locale).GetProperty("intents").EnumerateArray()
        .Select(intent => new Intent(
            intent.GetProperty("name").GetString()!,
            intent.TryGetProperty("samples", out var samples) ? samples.EnumerateArray().Select(sample => sample.GetString()!).ToArray() : [],
            intent.TryGetProperty("slots", out var slots) ? slots.EnumerateArray().Select(slot => slot.GetProperty("name").GetString()!).ToArray() : []))
        .ToList();

    private static string SourceRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Lotties.sln")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException("Lotties.sln was not found above the test binaries.");
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Model_EveryWriteIntent_HasNoQuestionOrTodaySamples(string locale)
    {
        var writes = Intents(locale).Where(intent => AlexaSkill.WriteIntents.Contains(intent.Name)).ToArray();

        Assert.Equal(AlexaSkill.WriteIntents.Count, writes.Length);
        foreach (var write in writes)
        {
            Assert.NotEmpty(write.Samples);
            Assert.All(write.Samples, sample =>
            {
                Assert.DoesNotContain(QuestionStarts, start => sample.StartsWith(start, StringComparison.OrdinalIgnoreCase));
                Assert.False(sample.EndsWith('?'), $"{write.Name}: {sample}");
                Assert.DoesNotContain("hoje", sample, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("today", sample, StringComparison.OrdinalIgnoreCase);
            });
        }
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Model_NoSampleHasDigitsOrCommas_AndNoneIsInTwoIntents_AndSlotNamesAreUnique(string locale)
    {
        var intents = Intents(locale);

        Assert.All(intents.SelectMany(intent => intent.Samples.Select(sample => (intent.Name, sample))), entry =>
            Assert.False(Regex.IsMatch(entry.sample, "[0-9,]") || entry.sample != entry.sample.Trim(), $"{entry.Name}: {entry.sample}"));
        var samples = intents.SelectMany(intent => intent.Samples.Select(sample => sample.ToLowerInvariant())).ToList();
        Assert.Equal(samples.Count, samples.Distinct().Count());
        var slots = intents.SelectMany(intent => intent.Slots).ToList();
        Assert.Equal(slots.Count, slots.Distinct(StringComparer.Ordinal).Count());
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Model_ReadIntentsHaveNoSlots_AndEveryIntentIsReachableFromTheAdapter(string locale)
    {
        var intents = Intents(locale);
        var custom = intents.Where(intent => !intent.Name.StartsWith("AMAZON.", StringComparison.Ordinal)).ToArray();

        Assert.All(custom, intent => Assert.Contains(intent.Name, AlexaSkill.KnownIntents));
        Assert.All(AlexaSkill.KnownIntents, known => Assert.Contains(known, intents.Select(intent => intent.Name)));
        Assert.All(custom.Where(intent => !AlexaSkill.WriteIntents.Contains(intent.Name)), intent => Assert.Empty(intent.Slots));
    }

    [Fact]
    public void Adapter_TheWriteIntentsAreExactlyTheOnesThatCallAWriteCommand()
    {
        var source = File.ReadAllLines(Path.Combine(SourceRoot(), "src", "Lotties.Api", "Assistants", "Alexa", "AlexaSkill.cs"));
        var calls = source.Select(line => Regex.Match(line, @"\[""(?<intent>\w+Intent)""\] = .*service\.(?<call>\w+)Async\(")).Where(match => match.Success)
            .ToDictionary(match => match.Groups["intent"].Value, match => match.Groups["call"].Value);

        var writes = calls.Where(pair => pair.Value.StartsWith("Log", StringComparison.Ordinal) || pair.Value.StartsWith("RequestDelete", StringComparison.Ordinal)).Select(pair => pair.Key);

        Assert.Equal(AlexaSkill.WriteIntents.Order(), writes.Order());
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Model_ChoiceTypes_HaveIdsThatAreExactlyTheBuiltInOptions(string locale)
    {
        var types = Language(locale).GetProperty("types").EnumerateArray().ToDictionary(type => type.GetProperty("name").GetString()!, type => type.GetProperty("values").EnumerateArray().Select(value => value.GetProperty("id").GetString()!).ToArray());

        Assert.Equal(AssistantChoices.FussyIntensities.Order(), types["FUSSY_INTENSITY"].Order());
        Assert.Equal(AssistantChoices.TemperatureMethods.Order(), types["TEMP_METHOD"].Order());
        Assert.Equal(AssistantChoices.Milestones.Order(), types["MILESTONE_TYPE"].Order());
        Assert.Equal(AssistantChoices.Symptoms.Order(), types["SYMPTOM_TYPE"].Order());
        Assert.Equal(AssistantChoices.Severities.Order(), types["SYMPTOM_SEVERITY"].Order());
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Model_NoSymptomOrIntensityValueNamesADiagnosis(string locale)
    {
        var text = Language(locale).GetProperty("types").GetRawText();

        Assert.DoesNotMatch(@"(?i)dehydrat|desidrat|lethargy|letarg|fever|febre|infection|infec", text.Replace("\"temperature\"", string.Empty));
    }

    [Fact]
    public void Mcp_EveryWriteCommandHasATool_ButMedicationHasNone()
    {
        var catalog = File.ReadAllText(Path.Combine(SourceRoot(), "src", "Lotties.Api", "Assistants", "Mcp", "McpToolCatalog.cs"));
        var commands = typeof(IAssistantService).GetMethods().Select(method => method.Name).Where(name => name.StartsWith("Log", StringComparison.Ordinal) || name.StartsWith("Read", StringComparison.Ordinal) || name is "ListBabiesAsync" or "RequestDeleteLastAsync");

        foreach (var command in commands.Where(command => !command.Contains("Medication", StringComparison.Ordinal)))
        {
            Assert.True(catalog.Contains($"assistant.{command}(", StringComparison.Ordinal), $"{command} has no MCP tool");
        }

        Assert.DoesNotContain("Medication", catalog.Replace("No medication tool", string.Empty).Replace("medication", string.Empty, StringComparison.OrdinalIgnoreCase), StringComparison.Ordinal);
        Assert.DoesNotContain(McpToolCatalog.All, tool => tool.Name.Contains("medic", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Mcp_ChoiceParameters_OfferExactlyTheBuiltInOptions()
    {
        var parameters = McpToolCatalog.All.SelectMany(tool => tool.Parameters).Where(parameter => parameter.Kind == McpParameterKind.Choice && parameter.Values is not null).ToArray();
        var symptom = Assert.Single(parameters, parameter => parameter.Name == "symptom");
        var milestone = Assert.Single(parameters, parameter => parameter.Name == "milestone");

        Assert.Equal(AssistantChoices.Symptoms.Order(), symptom.Values!.Order());
        Assert.Equal(AssistantChoices.Milestones.Order(), milestone.Values!.Order());
        Assert.Equal(BuiltInEventTypes.Fussy.Fields.Single(field => field.Key == "intensity").Options.Order(), Assert.Single(parameters, parameter => parameter.Name == "intensity").Values!.Order());
        Assert.DoesNotContain(parameters.Where(parameter => parameter.Name is "symptom" or "milestone"), parameter => parameter.Values!.Contains("other"));
    }
}
