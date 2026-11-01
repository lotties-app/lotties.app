using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Lotties.Api.Assistants;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.Units;
using ModelContextProtocol.Protocol;
using static Lotties.Api.Tests.Assistants.AssistantTestKit;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// Data minimisation (docs/design/32-assistants.md "what an assistant may say"): an answer carries the baby's name only when the
/// user turned on <c>sayBabyName</c>, and never free text people typed (appointment titles, formula or medicine names, fussy
/// intensity) or the names of people. Covers every command through the real service, both Alexa languages and the MCP renderers.
/// </summary>
public sealed partial class AssistantNamePrivacyTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string BabyName = "Lia";
    private const string AppointmentTitle = "Dr Zyxwv Clinic";
    private const string MedicineName = "Secretmed";
    private const string DoseAmount = "7.3125";

    // Everything a care provider or an appointment holds, each distinctive: none may appear in any rendering of any command.
    private static readonly string[] DoctorData = ["Qwxyzname", "Wvutsclinic", "99999-1234", "Jkhgfstreet", "zq@qq.test", "Notehjkl", "Plmkloc", "Bnmqtitle", "Doctornm", "Crmnumber"];

    private static readonly string[] FreeText = [AppointmentTitle, "Zyxwv", MedicineName, .. DoctorData];

    private static DateTimeOffset Now => DateTimeOffset.UtcNow;

    private static readonly (string Name, Func<IAssistantService, AssistantInvocation, Task<AssistantResult>> Run)[] Commands =
    [
        ("sleep_start", (a, i) => a.LogSleepStartAsync(i)),
        ("sleep_start_again", (a, i) => a.LogSleepStartAsync(i)),
        ("sleep_status_asleep", (a, i) => a.ReadSleepStatusAsync(i)),
        ("nap_window_asleep", (a, i) => a.ReadNextNapWindowAsync(i)),
        ("sleep_end", (a, i) => a.LogSleepEndAsync(i)),
        ("sleep_end_again", (a, i) => a.LogSleepEndAsync(i)),
        ("sleep_status_awake", (a, i) => a.ReadSleepStatusAsync(i)),
        ("bottle", (a, i) => a.LogBottleAsync(i, 118, BottleKind.Formula)),
        ("bottle_oz", (a, i) => a.LogBottleVolumeAsync(i, 4, Lotties.Domain.Units.VolumeUnit.FluidOunces, BottleKind.BreastMilk)),
        ("bottle_invalid", (a, i) => a.LogBottleAsync(i, 5000, BottleKind.Unspecified)),
        ("nursing", (a, i) => a.LogNursingAsync(i, BreastSide.Left)),
        ("nursing_again", (a, i) => a.LogNursingAsync(i, BreastSide.Left)),
        ("last_feed", (a, i) => a.ReadLastFeedAsync(i)),
        ("diaper", (a, i) => a.LogDiaperAsync(i, DiaperKind.Both)),
        ("last_diaper", (a, i) => a.ReadLastDiaperAsync(i)),
        ("diapers_today", (a, i) => a.ReadDiapersTodayAsync(i)),
        ("next_appointment", (a, i) => a.ReadNextAppointmentAsync(i)),
        ("due_vaccines", (a, i) => a.ReadDueVaccinesAsync(i)),
        ("profile", (a, i) => a.ReadBabyProfileAsync(i)),
        ("day_summary", (a, i) => a.ReadDaySummaryAsync(i, null)),
        ("week_summary", (a, i) => a.ReadWeekSummaryAsync(i, null)),
        ("next_feed", (a, i) => a.ReadNextFeedAsync(i)),
        ("next_diaper", (a, i) => a.ReadNextDiaperAsync(i)),
        ("diapers_average", (a, i) => a.ReadDiapersAverageAsync(i)),
        ("bottle_average", (a, i) => a.ReadBottleAverageAsync(i)),
        ("sleep_today", (a, i) => a.ReadSleepTodayAsync(i)),
        ("bottle_today", (a, i) => a.ReadBottleTodayAsync(i)),
        ("feeds_today", (a, i) => a.ReadFeedsTodayAsync(i)),
        ("cry_reasons", (a, i) => a.ReadCryReasonsAsync(i)),
        ("bath", (a, i) => a.LogBathAsync(i, 36.5m)),
        ("temperature_invalid", (a, i) => a.LogTemperatureAsync(i, 99m, TemperatureUnit.Celsius)),
        ("belly_pain_invalid", (a, i) => a.LogBellyPainAsync(i, 9)),
        ("tummy_time", (a, i) => a.LogTummyTimeAsync(i)),
        ("belly_pain", (a, i) => a.LogBellyPainAsync(i, 3)),
        ("breast_pump", (a, i) => a.LogBreastPumpAsync(i, null, null)),
        ("nasal_suction", (a, i) => a.LogNasalSuctionAsync(i, null, null)),
        ("belly_massage", (a, i) => a.LogBellyMassageAsync(i, null, null)),
        ("fussy", (a, i) => a.LogFussyAsync(i, "mild", null)),
        ("nail_trim", (a, i) => a.LogNailTrimAsync(i, null)),
        ("temperature", (a, i) => a.LogTemperatureAsync(i, 37.2m, null)),
        ("spit_up", (a, i) => a.LogSpitUpAsync(i, null, null)),
        ("teething", (a, i) => a.LogTeethingAsync(i, null, null)),
        ("milestone", (a, i) => a.LogMilestoneAsync(i, null)),
        ("symptom", (a, i) => a.LogSymptomAsync(i, null, null)),
        ("outdoor", (a, i) => a.LogOutdoorAsync(i, null)),
        ("skin_care", (a, i) => a.LogSkinCareAsync(i, null)),
        ("medication_reminder", (a, i) => a.ReadMedicationReminderAsync(i)),
        ("medication_given", (a, i) => a.LogMedicationAsync(i, MedicineName)),
        ("medication_unknown", (a, i) => a.LogMedicationAsync(i, "Nosuchmed")),
        ("list_babies", (a, i) => a.ListBabiesAsync(i)),
        ("request_delete_last", (a, i) => a.RequestDeleteLastAsync(i)),
    ];

    [Fact]
    public async Task EveryCommand_ByDefault_NamesNoBabyAndNoFreeText_InTheResultTheSpeechOrTheMcpText()
    {
        var results = await RunAllAsync(sayBabyName: false);

        Assert.Equal(Commands.Length, results.Count);
        Assert.Contains(results, pair => pair.Result.Code == AssistantResultCode.MedicationLogged);
        Assert.Contains(results, pair => pair.Result.Code == AssistantResultCode.MedicationReminder && pair.Result.Count == 1);
        Assert.Contains(results, pair => pair.Result.Code == AssistantResultCode.NextAppointment && pair.Result.Appointment!.Specialty == "pediatrician");
        Assert.True(results.Select(pair => pair.Result.Code).Distinct().Count() > 25, "the run should reach many different answers");
        foreach (var (name, result) in results)
        {
            Assert.Null(result.Baby?.Name);
            Assert.All(result.Babies, baby => Assert.Null(baby.Name));
            foreach (var (what, text) in EverythingSaid(result))
            {
                AssertNoName(text, $"{name} ({result.Code}) {what}");
            }
        }
    }

    [Fact]
    public async Task EveryCommand_WithSayBabyName_SaysTheNameAsToday_ButStillNoFreeText()
    {
        var results = await RunAllAsync(sayBabyName: true);

        var byCode = results.GroupBy(pair => pair.Result.Code).ToDictionary(group => group.Key, group => group.First().Result);
        Assert.All(results.Where(pair => pair.Result.Baby is not null), pair => Assert.Equal(BabyName, pair.Result.Baby!.Name));
        foreach (var code in new[] { AssistantResultCode.SleepStarted, AssistantResultCode.BottleLogged, AssistantResultCode.DiapersToday, AssistantResultCode.DaySummary, AssistantResultCode.BabyProfile, AssistantResultCode.Sleeping })
        {
            var result = byCode[code];
            Assert.Contains(BabyName, AlexaLanguages.For("en-US").Say(result), StringComparison.Ordinal);
            Assert.Contains(BabyName, AlexaLanguages.For("pt-BR").Say(result), StringComparison.Ordinal);
            Assert.Contains(BabyName, McpResultText.Of(result), StringComparison.Ordinal);
            Assert.Equal(BabyName, McpToolResults.From(result).StructuredContent!.Value.GetProperty("baby").GetProperty("name").GetString());
        }

        Assert.Equal([BabyName], byCode[AssistantResultCode.Babies].Babies.Select(baby => baby.Name));
        foreach (var (name, result) in results)
        {
            foreach (var (what, text) in EverythingSaid(result))
            {
                AssertNoFreeText(text, $"{name} ({result.Code}) {what}");
            }
        }
    }

    [Fact]
    public async Task EveryCommand_WithSayMedicineNames_SaysTheMedicineName_ButNeverAnAmountDoseOrOtherFreeText()
    {
        var results = await RunAllAsync(sayBabyName: false, sayMedicineNames: true);

        var logged = results.Single(pair => pair.Name == "medication_given").Result;
        var reminder = results.Single(pair => pair.Name == "medication_reminder").Result;
        Assert.Equal(MedicineName, logged.Medicine);
        Assert.Equal([MedicineName], reminder.DueMedicines);
        foreach (var result in new[] { logged, reminder })
        {
            foreach (var (what, text) in EverythingSaid(result))
            {
                if (what != "json" && what != "mcp structured" && what != "mcp content")
                {
                    Assert.Contains(MedicineName, text, StringComparison.Ordinal);
                }
            }
        }

        Assert.Contains($"a dose of {MedicineName}", AlexaLanguages.For("en-US").Say(logged), StringComparison.Ordinal);
        Assert.Contains($"uma dose de {MedicineName}", AlexaLanguages.For("pt-BR").Say(logged), StringComparison.Ordinal);
        Assert.Contains("Due now: " + MedicineName, AlexaLanguages.For("en-US").Say(reminder), StringComparison.Ordinal);
        Assert.Contains("not recommendations from Lotties", AlexaLanguages.For("en-US").Say(reminder), StringComparison.Ordinal);
        foreach (var (name, result) in results)
        {
            foreach (var (what, text) in EverythingSaid(result))
            {
                Assert.DoesNotContain(DoseAmount, text, StringComparison.Ordinal);
                Assert.DoesNotContain("drops", text, StringComparison.OrdinalIgnoreCase);
                foreach (var free in FreeText.Where(free => free != MedicineName))
                {
                    Assert.False(text.Contains(free, StringComparison.OrdinalIgnoreCase), $"{name} ({result.Code}) {what} carries '{free}': {text}");
                }
            }
        }
    }

    [Fact]
    public async Task MedicationAnswers_ByDefault_SayAMedicationDose_NeverTheNameOrAnAmount_AndTheReminderAlwaysHasTheNotice()
    {
        var results = await RunAllAsync(sayBabyName: false);
        var medication = results.Where(pair => pair.Name.StartsWith("medication", StringComparison.Ordinal)).ToArray();

        Assert.All(medication, pair =>
        {
            Assert.Null(pair.Result.Medicine);
            Assert.Empty(pair.Result.DueMedicines);
            foreach (var (what, text) in EverythingSaid(pair.Result))
            {
                Assert.DoesNotContain(DoseAmount, text, StringComparison.Ordinal);
                Assert.DoesNotContain("drops", text, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain(MedicineName, text, StringComparison.OrdinalIgnoreCase);
            }
        });
        var logged = medication.Single(pair => pair.Name == "medication_given").Result;
        Assert.Contains("a medication dose was given", AlexaLanguages.For("en-US").Say(logged), StringComparison.Ordinal);
        Assert.Contains("uma dose de medicamento foi dada", AlexaLanguages.For("pt-BR").Say(logged), StringComparison.Ordinal);
        Assert.Contains("doesn't check or suggest doses", AlexaLanguages.For("en-US").Say(logged), StringComparison.Ordinal);
        Assert.Contains("não confere nem sugere doses", AlexaLanguages.For("pt-BR").Say(logged), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Answers_ByDefault_UseTheNeutralWording_InBothLanguages()
    {
        var baby = await factory.SeedBabyAsync();
        var en = AlexaLanguages.For("en-US");
        var pt = AlexaLanguages.For("pt-BR");

        var bottle = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBottleAsync(Invocation(fallbackZone: "America/New_York"), 118, BottleKind.Unspecified));
        var today = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadBottleTodayAsync(Invocation(fallbackZone: "America/Sao_Paulo")));

        Assert.Matches(@"^Logged a 118 ml bottle (at \d{1,2}:\d{2} [AP]M|just now) for the baby\.$", en.Say(bottle));
        Assert.Matches(@"^Registrei uma mamadeira de 118 ml (às|à) \d{2}:\d{2}\.$", pt.Say(bottle with { TimeZone = "America/Sao_Paulo" }));
        Assert.Equal("The baby drank 118 ml in 1 bottle today.", en.Say(today with { TimeZone = "America/Sao_Paulo" }));
        Assert.Equal("O bebê tomou 118 ml em 1 mamadeira hoje.", pt.Say(today with { TimeZone = "America/Sao_Paulo" }));
    }

    [Fact]
    public async Task ListBabies_SeveralBabies_ByDefaultSaysTheCountAndWhereToChoose_WithTheOptInTheNames()
    {
        var (subject, babyIds) = await factory.SeedMemberOfAsync(BabyRole.Parent, BabyRole.Owner);

        var anonymous = await factory.RunAsAsync(subject, assistant => assistant.ListBabiesAsync(Invocation()));
        await SaveSettingsAsync(subject, true);
        var named = await factory.RunAsAsync(subject, assistant => assistant.ListBabiesAsync(Invocation()));
        var chooser = await factory.RunAsAsync(subject, assistant => assistant.LogSleepStartAsync(Invocation()));

        Assert.Equal(babyIds.Length, anonymous.Babies.Count);
        Assert.All(anonymous.Babies, baby => Assert.Null(baby.Name));
        Assert.Equal("You have 2 babies in Lotties. To choose the one voice commands are about, open the app, then Settings, Voice assistants.", AlexaLanguages.For("en-US").Say(anonymous));
        Assert.Equal("Você tem 2 bebês no Lotties. Para escolher o bebê dos comandos de voz, abra o app, depois Configurações, Assistentes de voz.", AlexaLanguages.For("pt-BR").Say(anonymous));
        Assert.All(named.Babies, baby => Assert.False(string.IsNullOrWhiteSpace(baby.Name)));
        Assert.StartsWith("Your babies in Lotties: ", AlexaLanguages.For("en-US").Say(named), StringComparison.Ordinal);
        Assert.Equal(AssistantResultCode.ChooseBaby, chooser.Code);
        Assert.Contains("Settings, Voice assistants", AlexaLanguages.For("en-US").Say(chooser), StringComparison.Ordinal);
        Assert.Contains("Assistentes de voz", AlexaLanguages.For("pt-BR").Say(chooser), StringComparison.Ordinal);
    }

    [Fact]
    public async Task NotAllowed_ForAViewer_ByDefaultNamesNoBaby()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);

        var result = await factory.RunAsAsync(baby.SubjectOf(BabyRole.Viewer), assistant => assistant.LogSleepStartAsync(Invocation()));

        Assert.Equal(AssistantResultCode.NotAllowed, result.Code);
        Assert.Null(result.Baby!.Name);
        Assert.Equal("Your role on the baby doesn't allow this. Ask the baby's owner in the app.", AlexaLanguages.For("en-US").Say(result));
        Assert.Equal("O seu papel no bebê não permite isso. Fale com quem administra o bebê no app.", AlexaLanguages.For("pt-BR").Say(result));
    }

    [Fact]
    public async Task NextAppointment_SaysOnlyTheSpecialtyWhenItIsAKnownOne_NeverTheTitleOrAnyDoctorData()
    {
        var baby = await factory.SeedBabyAsync();
        var known = await SeedProviderAsync(baby, "Pediatria");
        var unknown = await SeedProviderAsync(baby, "Dr Qwxyzname special care");
        foreach (var (providerId, hours) in new[] { (known, 30), (unknown, 52) })
        {
            await SeedAppointmentAsync(baby, providerId, Now.AddHours(hours));
        }

        var next = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextAppointmentAsync(Invocation(fallbackZone: "America/Sao_Paulo")));
        var en = AlexaLanguages.For("en-US").Say(next);
        var pt = AlexaLanguages.For("pt-BR").Say(next);

        Assert.Equal("pediatrician", next.Appointment!.Specialty);
        Assert.Matches(@"^The baby's next appointment is with a pediatrician, .+ at \d{1,2}:\d{2} [AP]M\.$", en);
        Assert.Matches(@"^A próxima consulta do bebê é com pediatra, .+ (?:às|à) \d{2}:\d{2}\.$", pt);
        foreach (var (what, text) in EverythingSaid(next))
        {
            AssertNoFreeText(text, $"next appointment {what}");
        }

        var none = next with { Appointment = next.Appointment with { Specialty = null } };
        Assert.Matches(@"^The baby's next appointment is .+ at \d{1,2}:\d{2} [AP]M\.$", AlexaLanguages.For("en-US").Say(none));
        Assert.Matches(@"^A próxima consulta do bebê é .+ (?:às|à) \d{2}:\d{2}\.$", AlexaLanguages.For("pt-BR").Say(none));
    }

    [Fact]
    public async Task NextAppointment_WithAnUnknownSpecialtyOrNoProvider_SaysOnlyThatThereIsOne()
    {
        var baby = await factory.SeedBabyAsync();
        await SeedAppointmentAsync(baby, await SeedProviderAsync(baby, "Qwxyzname the great"), Now.AddHours(30));

        var next = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextAppointmentAsync(Invocation(fallbackZone: "America/Sao_Paulo")));

        Assert.Null(next.Appointment!.Specialty);
        Assert.DoesNotContain("Qwxyzname", JsonSerializer.Serialize(next) + AlexaLanguages.For("en-US").Say(next) + McpResultText.Of(next), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task NextAppointment_AProviderOfAnotherBabyIsNeverUsed()
    {
        var baby = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var foreign = await SeedProviderAsync(other, "pediatra");
        await SeedAppointmentAsync(baby, foreign, Now.AddHours(30));

        var next = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.ReadNextAppointmentAsync(Invocation(fallbackZone: "America/Sao_Paulo")));

        Assert.Null(next.Appointment!.Specialty);
    }

    [Theory]
    [InlineData("en-US")]
    [InlineData("pt-BR")]
    public void Say_EveryResultCode_WithoutAName_NeverNamesTheBabyAndReadsWell(string locale)
    {
        var language = AlexaLanguages.For(locale);
        foreach (var code in Enum.GetValues<AssistantResultCode>())
        {
            foreach (var zone in new string?[] { "America/Sao_Paulo", null })
            {
                var named = AlexaSpeechTests.Full(code, zone);
                var anonymous = named with { Baby = new AssistantBaby(Guid.NewGuid()), Babies = named.Babies.Select(baby => baby with { Name = null }).ToArray() };

                var withName = language.Say(named);
                var withoutName = language.Say(anonymous);

                Assert.DoesNotContain("Charlotte", withoutName, StringComparison.Ordinal);
                Assert.DoesNotContain("Lia", withoutName, StringComparison.Ordinal);
                Assert.DoesNotContain("Theo", withoutName, StringComparison.Ordinal);
                Assert.DoesNotContain("  ", withoutName, StringComparison.Ordinal);
                Assert.DoesNotContain(" ,", withoutName, StringComparison.Ordinal);
                Assert.DoesNotContain(" .", withoutName, StringComparison.Ordinal);
                Assert.DoesNotContain("{", withoutName, StringComparison.Ordinal);
                Assert.False(withoutName.StartsWith(char.ToLowerInvariant(withoutName[0])) && char.IsLetter(withoutName[0]), $"{code}: sentences start with a capital: {withoutName}");
                Assert.NotEqual(string.Empty, withName);
            }
        }
    }

    [Fact]
    public void McpText_AndStructuredJson_WithoutAName_NeverNameTheBaby()
    {
        foreach (var code in Enum.GetValues<AssistantResultCode>())
        {
            var named = AlexaSpeechTests.Full(code, "America/Sao_Paulo");
            var anonymous = named with { Baby = new AssistantBaby(Guid.NewGuid()), Babies = named.Babies.Select(baby => baby with { Name = null }).ToArray() };

            var rendered = McpToolResults.From(anonymous);
            var everything = McpResultText.Of(anonymous) + string.Join("\n", rendered.Content.OfType<TextContentBlock>().Select(block => block.Text)) + rendered.StructuredContent!.Value.GetRawText();

            Assert.DoesNotContain("Charlotte", everything, StringComparison.Ordinal);
            Assert.DoesNotContain("Lia", everything, StringComparison.Ordinal);
            Assert.DoesNotContain("Theo", everything, StringComparison.Ordinal);
            Assert.DoesNotContain("\"name\"", everything, StringComparison.Ordinal);
            Assert.False(McpResultText.Of(anonymous).StartsWith("the baby", StringComparison.Ordinal), McpResultText.Of(anonymous));
        }
    }

    [Fact]
    public void Adapters_ReadABabyNameOnlyThroughSpokenBaby_AndTheApplicationOnlyBehindTheOptIn()
    {
        var root = SourceRoot();
        var adapterFiles = Directory.GetFiles(Path.Combine(root, "src", "Lotties.Api", "Assistants"), "*.cs", SearchOption.AllDirectories)
            .Where(file => Path.GetFileName(file) != "SpokenBaby.cs");
        var applicationFiles = Directory.GetFiles(Path.Combine(root, "src", "Lotties.Application", "Assistants"), "*.cs", SearchOption.AllDirectories);

        var adapterLeaks = adapterFiles.SelectMany(file => LinesMatching(file, BabyNameAccess())).ToArray();
        var unguarded = applicationFiles
            .SelectMany(file => LinesMatching(file, BabyNameAccess()).Select(line => line))
            .Where(line => !line.Text.Contains("sayBabyName", StringComparison.OrdinalIgnoreCase) && !line.Text.Contains("OrderBy", StringComparison.Ordinal) && !line.Text.TrimStart().StartsWith("///", StringComparison.Ordinal))
            .ToArray();

        Assert.True(adapterLeaks.Length == 0, "Adapters must read the baby's name only through SpokenBaby (the opt-in guard): " + string.Join("; ", adapterLeaks));
        Assert.True(unguarded.Length == 0, "The application may put a baby's name in a result only behind SayBabyName: " + string.Join("; ", unguarded));
    }

    [Fact]
    public void Adapters_NeverReadTheFreeTextFieldsPeopleType()
    {
        var root = SourceRoot();
        var files = Directory.GetFiles(Path.Combine(root, "src", "Lotties.Api", "Assistants"), "*.cs", SearchOption.AllDirectories);

        var leaks = files.SelectMany(file => LinesMatching(file, new Regex(@"\.(Title|FormulaName|MedicationName|Provider\w*)\b"))).ToArray();

        Assert.True(leaks.Length == 0, "Answers carry no free text or names of people: " + string.Join("; ", leaks));
    }

    [Fact]
    public void Adapters_NeverReadAnAppointmentOrCareProviderMember_OnlyTheSpecialtyCode()
    {
        var root = SourceRoot();
        var adapterFiles = Directory.GetFiles(Path.Combine(root, "src", "Lotties.Api", "Assistants"), "*.cs", SearchOption.AllDirectories);
        var applicationFiles = Directory.GetFiles(Path.Combine(root, "src", "Lotties.Application", "Assistants"), "*.cs", SearchOption.AllDirectories);
        var doctorMembers = new Regex(@"\.(Title|DoctorName|Location|ClinicName|Phone|Whatsapp|Email|Address|Website|Registration\w*|Prescriber)\b");

        var adapterLeaks = adapterFiles.SelectMany(file => LinesMatching(file, doctorMembers).Concat(LinesMatching(file, new Regex(@"[Aa]ppointment\W{0,3}\.(Outcome|Notes|Title)\b")))).Where(line => !line.Text.TrimStart().StartsWith("///", StringComparison.Ordinal)).ToArray();
        var applicationLeaks = applicationFiles
            .SelectMany(file => LinesMatching(file, doctorMembers).Concat(LinesMatching(file, new Regex(@"\.Specialty\b"))))
            .Where(line => !line.Text.TrimStart().StartsWith("///", StringComparison.Ordinal) && !line.Text.Contains("DoctorSpecialties.CodeOf(", StringComparison.Ordinal))
            .ToArray();

        Assert.True(adapterLeaks.Length == 0, "Adapters never read a doctor, clinic or appointment member: " + string.Join("; ", adapterLeaks));
        Assert.True(applicationLeaks.Length == 0, "The Application reads a care provider's typed specialty only through DoctorSpecialties.CodeOf: " + string.Join("; ", applicationLeaks));
    }

    [Fact]
    public void Adapters_ReadAMedicineNameOnlyThroughSpokenMedicine()
    {
        var root = SourceRoot();
        var adapterFiles = Directory.GetFiles(Path.Combine(root, "src", "Lotties.Api", "Assistants"), "*.cs", SearchOption.AllDirectories)
            .Where(file => Path.GetFileName(file) != "SpokenMedicine.cs");
        var access = new Regex(@"\.(Medicine|DueMedicines)\b");

        var adapterLeaks = adapterFiles.SelectMany(file => LinesMatching(file, access)).Where(line => !line.Text.TrimStart().StartsWith("///", StringComparison.Ordinal)).ToArray();

        Assert.True(adapterLeaks.Length == 0, "Adapters read a medicine name only through SpokenMedicine: " + string.Join("; ", adapterLeaks));
    }

    private async Task<Guid> SeedProviderAsync(SeededBaby baby, string specialty)
    {
        var id = Guid.NewGuid();
        var put = await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync(
            $"/api/v1/babies/{baby.BabyId}/care-providers/{id}",
            new { name = "Dr Qwxyzname", specialty, registrationCouncil = "CRM", registrationNumber = "Crmnumber", clinicName = "Wvutsclinic", address = "Jkhgfstreet 5", phone = "+55 11 99999-1234", email = "zq@qq.test", notes = "Notehjkl" });
        put.EnsureSuccessStatusCode();
        return id;
    }

    private async Task SeedAppointmentAsync(SeededBaby baby, Guid? providerId, DateTimeOffset startsAt)
    {
        var put = await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync(
            $"/api/v1/babies/{baby.BabyId}/appointments/{Guid.NewGuid()}",
            new { title = "Bnmqtitle " + AppointmentTitle, type = "consultation", startsAt, location = "Plmkloc", doctorName = "Doctornm", notes = "Notehjkl", providerId });
        put.EnsureSuccessStatusCode();
    }

    /// <summary>A medicine with a scheduled prescription (every 4 hours, a dose of 7.3125 drops) whose last dose was 5 hours ago: one reminder is due.</summary>
    private async Task SeedMedicineAsync(SeededBaby baby)
    {
        var client = factory.CreateClientFor(baby.OwnerSubject);
        var medicationId = Guid.NewGuid();
        (await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/medications/{medicationId}", new { name = MedicineName, isUsual = true })).EnsureSuccessStatusCode();
        var prescriptionId = Guid.NewGuid();
        var start = DateTime.UtcNow.AddDays(-3).ToString("yyyy-MM-dd");
        var put = await client.PutAsJsonAsync($"/api/v1/babies/{baby.BabyId}/prescriptions/{prescriptionId}", new { medicationId, kind = "scheduled", dose = new { amount = 7.3125, unit = "drops" }, everyMinutes = 240, startDate = start });
        Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());
        var payload = $$"""{"medications":[{"medicationId":"{{medicationId}}","name":"{{MedicineName}}","prescriptionId":"{{prescriptionId}}"}]}""";
        await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, Lotties.Domain.EventTypes.BuiltInEventTypes.MedicationId, Now.AddHours(-5), Now.AddHours(-5), payload);
    }

    private async Task<List<(string Name, AssistantResult Result)>> RunAllAsync(bool sayBabyName, bool sayMedicineNames = false)
    {
        var baby = await factory.SeedBabyAsync();
        await SeedAppointmentAsync(baby, await SeedProviderAsync(baby, "pediatra"), Now.AddDays(2));
        await SeedMedicineAsync(baby);
        await SaveSettingsAsync(baby.OwnerSubject, sayBabyName, sayMedicineNames);

        var results = new List<(string, AssistantResult)>();
        foreach (var (name, run) in Commands)
        {
            results.Add((name, await factory.RunAsAsync(baby.OwnerSubject, assistant => run(assistant, Invocation(fallbackZone: "America/Sao_Paulo")))));
        }

        return results;
    }

    private async Task SaveSettingsAsync(string subject, bool sayBabyName, bool sayMedicineNames = false)
    {
        var response = await factory.CreateClientFor(subject).PutAsJsonAsync("/api/v1/me/assistant-settings", new { defaultBabyId = (Guid?)null, sayBabyName, sayMedicineNames });
        response.EnsureSuccessStatusCode();
    }

    private static IEnumerable<(string What, string Text)> EverythingSaid(AssistantResult result)
    {
        var mcp = McpToolResults.From(result);
        yield return ("json", JsonSerializer.Serialize(result));
        yield return ("en", AlexaLanguages.For("en-US").Say(result));
        yield return ("pt", AlexaLanguages.For("pt-BR").Say(result));
        yield return ("mcp sentence", McpResultText.Of(result));
        yield return ("mcp content", string.Join("\n", mcp.Content.OfType<TextContentBlock>().Select(block => block.Text)));
        yield return ("mcp structured", mcp.StructuredContent!.Value.GetRawText());
    }

    private static void AssertNoName(string text, string where)
    {
        Assert.False(text.Contains(BabyName, StringComparison.Ordinal), $"{where} names the baby: {text}");
        AssertNoFreeText(text, where);
    }

    private static void AssertNoFreeText(string text, string where)
    {
        foreach (var free in FreeText)
        {
            Assert.False(text.Contains(free, StringComparison.OrdinalIgnoreCase), $"{where} carries free text '{free}': {text}");
        }
    }

    private static IEnumerable<SourceLine> LinesMatching(string file, Regex pattern) =>
        File.ReadAllLines(file).Select((text, index) => new SourceLine(Path.GetFileName(file), index + 1, text)).Where(line => pattern.IsMatch(line.Text));

    [GeneratedRegex(@"(\bBaby\??\.Name\b|\bbaby\??\.Name\b|\.Baby\.Name\b|(?<![Ss]ay)BabyName\b)")]
    private static partial Regex BabyNameAccess();

    private static string SourceRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Lotties.sln")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException("The code/api directory (Lotties.sln) was not found above the test binaries.");
    }

    private sealed record SourceLine(string File, int Number, string Text)
    {
        public override string ToString() => $"{File}:{Number}";
    }
}
