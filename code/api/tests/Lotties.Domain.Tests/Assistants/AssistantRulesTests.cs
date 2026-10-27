using System.Text.Json;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;

namespace Lotties.Domain.Tests.Assistants;

/// <summary>The assistant rules of the Domain: the baby choice, the event ids, the payloads and the facts read back.</summary>
public sealed class AssistantRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 15, 0, 0, TimeSpan.Zero);
    private static readonly Guid BabyA = Guid.NewGuid();
    private static readonly Guid BabyB = Guid.NewGuid();

    [Fact]
    public void Decide_NoMembership_IsNoBaby() =>
        Assert.Equal(AssistantBabyOutcome.NoBaby, AssistantBabyChoice.Decide([], null).Outcome);

    [Fact]
    public void Decide_OnlyDoctorMemberships_IsNotAllowed() =>
        Assert.Equal(AssistantBabyOutcome.NotAllowed, AssistantBabyChoice.Decide([new(BabyA, BabyRole.Doctor), new(BabyB, BabyRole.Doctor)], BabyA).Outcome);

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public void Decide_OneFamilyBaby_IsIt(BabyRole role) =>
        Assert.Equal(AssistantBabyResolution.Of(BabyA), AssistantBabyChoice.Decide([new(BabyA, role)], null));

    [Fact]
    public void Decide_OneToLogAmongViewsAndPatients_IsTheOneToLog() =>
        Assert.Equal(BabyB, AssistantBabyChoice.Decide([new(BabyA, BabyRole.Viewer), new(BabyB, BabyRole.Caregiver), new(Guid.NewGuid(), BabyRole.Doctor)], null).BabyId);

    [Fact]
    public void Decide_SeveralToLogWithoutDefault_IsChooseBaby() =>
        Assert.Equal(AssistantBabyOutcome.ChooseBaby, AssistantBabyChoice.Decide([new(BabyA, BabyRole.Parent), new(BabyB, BabyRole.Owner)], null).Outcome);

    [Fact]
    public void Decide_StoredDefaultStillAFamilyMember_WinsEvenOverTheOnlyBabyToLog() =>
        Assert.Equal(BabyA, AssistantBabyChoice.Decide([new(BabyA, BabyRole.Viewer), new(BabyB, BabyRole.Parent)], BabyA).BabyId);

    [Fact]
    public void Decide_StoredDefaultWhereTheUserIsTheDoctorOrNotAMember_IsIgnored()
    {
        Assert.Equal(AssistantBabyOutcome.ChooseBaby, AssistantBabyChoice.Decide([new(BabyA, BabyRole.Parent), new(BabyB, BabyRole.Parent)], Guid.NewGuid()).Outcome);
        Assert.Equal(BabyB, AssistantBabyChoice.Decide([new(BabyA, BabyRole.Doctor), new(BabyB, BabyRole.Parent)], BabyA).BabyId);
    }

    [Fact]
    public void Decide_SeveralViewsOnly_IsChooseBaby() =>
        Assert.Equal(AssistantBabyOutcome.ChooseBaby, AssistantBabyChoice.Decide([new(BabyA, BabyRole.Viewer), new(BabyB, BabyRole.Viewer)], null).Outcome);

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public void Decide_RequestedFamilyBaby_WinsOverTheStoredDefault(BabyRole role) =>
        Assert.Equal(AssistantBabyResolution.Of(BabyB), AssistantBabyChoice.Decide([new(BabyA, BabyRole.Parent), new(BabyB, role)], BabyA, BabyB));

    [Fact]
    public void Decide_RequestedBabyNotInTheFamily_IsUnknownBabyAlikeForStrangersAndPatients()
    {
        var memberships = new AssistantMembership[] { new(BabyA, BabyRole.Parent), new(BabyB, BabyRole.Doctor) };

        Assert.Equal(AssistantBabyOutcome.UnknownBaby, AssistantBabyChoice.Decide(memberships, null, Guid.NewGuid()).Outcome);
        Assert.Equal(AssistantBabyOutcome.UnknownBaby, AssistantBabyChoice.Decide(memberships, BabyA, BabyB).Outcome);
    }

    [Fact]
    public void Decide_RequestedBabyWithoutFamily_KeepsNoBabyAndNotAllowed()
    {
        Assert.Equal(AssistantBabyOutcome.NoBaby, AssistantBabyChoice.Decide([], null, BabyA).Outcome);
        Assert.Equal(AssistantBabyOutcome.NotAllowed, AssistantBabyChoice.Decide([new(BabyA, BabyRole.Doctor)], null, BabyA).Outcome);
    }

    [Fact]
    public void Family_LeavesOutDoctorMemberships() =>
        Assert.Equal([BabyA], AssistantBabyChoice.Family([new(BabyA, BabyRole.Viewer), new(BabyB, BabyRole.Doctor)]).Select(membership => membership.BabyId));

    [Theory]
    [InlineData(BabyRole.Owner, true)]
    [InlineData(BabyRole.Parent, true)]
    [InlineData(BabyRole.Caregiver, true)]
    [InlineData(BabyRole.Viewer, false)]
    [InlineData(BabyRole.Doctor, false)]
    public void CanBeDefault_OnlyRolesThatLog(BabyRole role, bool expected) => Assert.Equal(expected, AssistantBabyChoice.CanBeDefault(role));

    [Fact]
    public void EventIds_AreStablePerRequestAndDifferPerRequestCommandBabyAndAdapter()
    {
        var id = AssistantEventIds.For("alexa", "req-1", "bottle", BabyA);

        Assert.Equal(id, AssistantEventIds.For("alexa", "req-1", "bottle", BabyA));
        Assert.Equal(5, new[] { id, AssistantEventIds.For("alexa", "req-2", "bottle", BabyA), AssistantEventIds.For("alexa", "req-1", "diaper", BabyA), AssistantEventIds.For("alexa", "req-1", "bottle", BabyB), AssistantEventIds.For("mcp", "req-1", "bottle", BabyA) }.Distinct().Count());
        Assert.Equal(5, (id.ToByteArray(bigEndian: true)[6] >> 4));
    }

    [Fact]
    public void Settings_SameDefault_ChangesNothing()
    {
        var settings = UserAssistantSettings.Create(Guid.NewGuid(), BabyA, Now);

        settings.ChangeDefaultBaby(BabyA, Now.AddHours(1));
        var unchanged = settings.UpdatedAt;
        settings.ChangeDefaultBaby(Guid.Empty, Now.AddHours(2));

        Assert.Equal(Now, unchanged);
        Assert.Equal((null, Now.AddHours(2)), (settings.DefaultBabyId, settings.UpdatedAt));
    }

    [Fact]
    public void Settings_SayBabyName_IsOffByDefault_AndTheSameValueChangesNothing()
    {
        var settings = UserAssistantSettings.Create(Guid.NewGuid(), BabyA, Now);

        settings.ChangeSayBabyName(false, Now.AddHours(1));
        var unchanged = (settings.SayBabyName, settings.UpdatedAt);
        settings.ChangeSayBabyName(true, Now.AddHours(2));

        Assert.Equal((false, Now), unchanged);
        Assert.Equal((true, Now.AddHours(2)), (settings.SayBabyName, settings.UpdatedAt));
        Assert.True(UserAssistantSettings.Create(Guid.NewGuid(), null, Now, sayBabyName: true).SayBabyName);
    }

    [Fact]
    public void Bottle_FormulaWithCurrentFormula_NamesIt()
    {
        var formula = Formula.Create(Guid.NewGuid(), BabyA, FormulaTerms.Create("Nan 1", null, null, null, null, isCurrent: true, isArchived: false), Guid.NewGuid(), Now);

        var payload = Json(AssistantPayloads.Bottle(120, BottleKind.Formula, formula));

        Assert.Equal(("bottle", 120, "formula", formula.Id.ToString("D"), "Nan 1"), (payload.GetProperty("method").GetString(), payload.GetProperty("amount_ml").GetInt32(), payload.GetProperty("bottle_feeding_type").GetString(), payload.GetProperty("formula_id").GetString(), payload.GetProperty("formula_name").GetString()));
        Assert.False(payload.TryGetProperty("amount_drunk_ml", out _));
    }

    [Fact]
    public void Bottle_FormulaThatIsNotCurrent_IsNotNamed()
    {
        var formula = Formula.Create(Guid.NewGuid(), BabyA, FormulaTerms.Create("Old", null, null, null, null, isCurrent: false, isArchived: true), Guid.NewGuid(), Now);

        Assert.False(Json(AssistantPayloads.Bottle(60, BottleKind.Formula, formula)).TryGetProperty("formula_id", out _));
    }

    [Fact]
    public void Bottle_PayloadsPassTheFeedingFieldRules()
    {
        foreach (var kind in Enum.GetValues<BottleKind>())
        {
            BuiltInEventTypes.Feeding.EnsureValidPayload(AssistantPayloads.Bottle(90, kind, null), Now, Now);
        }

        BuiltInEventTypes.Feeding.EnsureValidPayload(AssistantPayloads.Nursing(BreastSide.Right, Now), Now, null);
        BuiltInEventTypes.Diaper.EnsureValidPayload(AssistantPayloads.Diaper(DiaperKind.Both), Now, Now);
        BuiltInEventTypes.Sleep.EnsureValidPayload(AssistantPayloads.SleepTimer("night"), Now, null);
    }

    [Theory]
    [InlineData(null, 600, 1)]
    [InlineData(300, 900, 1)]
    [InlineData(3500, 3600, 1)]
    public void Stopped_OpenPause_IsFoldedWithinTheTimersLength(int? pausedSeconds, int expected, int pauseCount)
    {
        var start = Now.AddHours(-1);
        var pausedAt = Now.AddMinutes(-10).ToString("O");
        var members = pausedSeconds is null ? string.Empty : $",\"paused_seconds\":{pausedSeconds}";
        var payload = EventPayload.From($$"""{"kind":"nap","pause_count":{{pauseCount}},"paused_at":"{{pausedAt}}"{{members}}}""");

        var stopped = Json(AssistantPayloads.Stopped(payload, start, Now));

        Assert.False(stopped.TryGetProperty("paused_at", out _));
        Assert.Equal(expected, stopped.GetProperty("paused_seconds").GetInt32());
        Assert.Equal("nap", stopped.GetProperty("kind").GetString());
        BuiltInEventTypes.Sleep.EnsureValidPayload(AssistantPayloads.Stopped(payload, start, Now), start, Now);
    }

    [Fact]
    public void Stopped_WithoutOpenPause_IsUnchanged()
    {
        var payload = EventPayload.From("""{"kind":"nap","paused_seconds":30}""");

        Assert.Equal(payload.Value, AssistantPayloads.Stopped(payload, Now.AddHours(-1), Now).Value);
    }

    [Theory]
    [InlineData("""{"kind":"nap"}""", true)]
    [InlineData("""{"kind":"night"}""", true)]
    [InlineData("{}", true)]
    [InlineData("""{"kind":"night_waking"}""", false)]
    [InlineData("""{"kind":"bed_time"}""", false)]
    public void IsSleepTimer_ByKind(string payload, bool expected) =>
        Assert.Equal(expected, AssistantEventFacts.IsSleepTimer(Event(BuiltInEventTypes.SleepId, payload, Now, null)));

    [Fact]
    public void SleepKindAt_RecentBedTimeOrNightHours_IsNight()
    {
        var utc = TimeZoneInfo.Utc;
        var bedTime = Event(BuiltInEventTypes.SleepId, """{"kind":"bed_time"}""", Now.AddHours(-2), Now.AddHours(-2));
        var oldBedTime = Event(BuiltInEventTypes.SleepId, """{"kind":"bed_time"}""", Now.AddHours(-4), Now.AddHours(-4));

        Assert.Equal("night", AssistantEventFacts.SleepKindAt([bedTime], Now, null));
        Assert.Equal("nap", AssistantEventFacts.SleepKindAt([oldBedTime], Now, utc));
        Assert.Equal("night", AssistantEventFacts.SleepKindAt([], new DateTimeOffset(2026, 10, 23, 19, 0, 0, TimeSpan.Zero), utc));
        Assert.Equal("night", AssistantEventFacts.SleepKindAt([], new DateTimeOffset(2026, 10, 23, 4, 59, 0, TimeSpan.Zero), utc));
        Assert.Equal("nap", AssistantEventFacts.SleepKindAt([], new DateTimeOffset(2026, 10, 23, 5, 0, 0, TimeSpan.Zero), utc));
        Assert.Equal("nap", AssistantEventFacts.SleepKindAt([], new DateTimeOffset(2026, 10, 23, 21, 0, 0, TimeSpan.Zero), null));
    }

    [Fact]
    public void SuggestedNursingSide_OppositeToTheLastSideElseLeft()
    {
        var older = Event(BuiltInEventTypes.FeedingId, """{"method":"breast","side":"right"}""", Now.AddHours(-6), Now.AddHours(-6).AddMinutes(10));
        var newest = Event(BuiltInEventTypes.FeedingId, """{"method":"breast","side":"both","last_side":"left"}""", Now.AddHours(-3), Now.AddHours(-3).AddMinutes(10));
        var bottle = Event(BuiltInEventTypes.FeedingId, """{"method":"bottle","amount_ml":90}""", Now.AddHours(-1), Now.AddHours(-1));

        Assert.Equal(BreastSide.Right, AssistantEventFacts.SuggestedNursingSide([older, newest, bottle]));
        Assert.Equal(BreastSide.Left, AssistantEventFacts.SuggestedNursingSide([older]));
        Assert.Equal(BreastSide.Left, AssistantEventFacts.SuggestedNursingSide([bottle]));
    }

    [Fact]
    public void ReadFeed_DrunkAmountNeverAbovePrepared()
    {
        var feed = AssistantEventFacts.ReadFeed(Event(BuiltInEventTypes.FeedingId, """{"method":"bottle","amount_ml":120,"amount_drunk_ml":80,"bottle_feeding_type":"formula","formula_name":"Nan"}""", Now, Now));
        var all = AssistantEventFacts.ReadFeed(Event(BuiltInEventTypes.FeedingId, """{"method":"bottle","amount_ml":120}""", Now, Now));

        Assert.Equal(new FeedFact(FeedMethod.Bottle, 80, null, BottleKind.Formula, "Nan"), feed);
        Assert.Equal(120, all.AmountMl);
    }

    [Theory]
    [InlineData("WET", DiaperKind.Wet)]
    [InlineData("dirty", DiaperKind.Dirty)]
    [InlineData("MIXED", DiaperKind.Both)]
    [InlineData(null, null)]
    public void DiaperKindOf_Content(string? content, DiaperKind? expected)
    {
        var payload = content is null ? "{}" : $$"""{"content":"{{content}}"}""";

        Assert.Equal(expected, AssistantEventFacts.DiaperKindOf(Event(BuiltInEventTypes.DiaperId, payload, Now, Now)));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(500, true)]
    [InlineData(501, false)]
    public void IsBottleAmount_Limits(int? amount, bool expected) => Assert.Equal(expected, AssistantLimits.IsBottleAmount(amount));

    [Theory]
    [InlineData("Europe/Lisbon", "Asia/Tokyo", "America/Sao_Paulo", "pt-BR", "Europe/Lisbon", AssistantZoneSource.Requested)]
    [InlineData("Bad/Zone", "Asia/Tokyo", "America/Sao_Paulo", "pt-BR", "Asia/Tokyo", AssistantZoneSource.Stored)]
    [InlineData(null, null, "America/Sao_Paulo", "en", "America/Sao_Paulo", AssistantZoneSource.Adapter)]
    [InlineData(null, null, null, "pt-br", "America/Sao_Paulo", AssistantZoneSource.Language)]
    [InlineData(null, null, null, "en", null, AssistantZoneSource.Utc)]
    [InlineData(null, "", null, null, null, AssistantZoneSource.Utc)]
    public void ZoneChoice_RequestedThenStoredThenAdapterThenLanguage(string? requested, string? stored, string? adapter, string? locale, string? zone, AssistantZoneSource source) =>
        Assert.Equal(new AssistantZone(zone, source), AssistantZoneChoice.Decide(requested, stored, adapter, locale));

    private static Event Event(Guid typeId, string payload, DateTimeOffset startedAt, DateTimeOffset? endedAt) =>
        Domain.Events.Event.Create(Guid.NewGuid(), BabyA, typeId, Guid.NewGuid(), startedAt, endedAt, EventPayload.From(payload), null, Now);

    private static JsonElement Json(EventPayload payload) => JsonDocument.Parse(payload.Value).RootElement;
}
