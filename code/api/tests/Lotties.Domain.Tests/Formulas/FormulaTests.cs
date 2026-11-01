using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Formulas;

namespace Lotties.Domain.Tests.Formulas;

/// <summary>The formula entity, its terms, the one-current-formula rule and the feeding payload reference.</summary>
public sealed class FormulaTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();
    private static readonly DateTimeOffset Now = TestClock.Now;

    private static FormulaTerms Terms(string name = "Aptamil 2", bool current = false, bool archived = false, string? stage = "2") =>
        FormulaTerms.Create(name, " Aptamil ", stage, null, new DateOnly(2026, 1, 2), current, archived);

    private static Formula NewFormula(bool current = false, Guid? babyId = null, DateTimeOffset? clientUpdatedAt = null) =>
        Formula.Create(Guid.NewGuid(), babyId ?? BabyId, Terms(current: current), UserId, Now, clientUpdatedAt);

    [Fact]
    public void Create_TrimsTextAndKeepsTheTerms()
    {
        var formula = Formula.Create(Guid.NewGuid(), BabyId, FormulaTerms.Create("  Nan Supreme 1 ", " Nestlé ", " ", null, null, isCurrent: true, isArchived: false), UserId, Now);

        Assert.Equal(("Nan Supreme 1", "Nestlé", null, true, false), (formula.Name, formula.Brand, formula.Stage, formula.IsCurrent, formula.IsArchived));
        Assert.Equal(Now, formula.UpdatedAt);
        Assert.Equal(Now, formula.ClientUpdatedAt);
    }

    [Theory]
    [InlineData(null, null, null, "name")]
    [InlineData("   ", null, null, "name")]
    [InlineData("1234567890123456789012345678901234567890123456789012345678901", null, null, "name")]
    [InlineData("Nan", "1234567890123456789012345678901234567890123456789012345678901", null, "brand")]
    [InlineData("Nan", null, "12345678901", "stage")]
    [InlineData("Na\u0000n", null, null, "name")]
    public void TermsCreate_InvalidText_ThrowsForTheField(string? name, string? brand, string? stage, string field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => FormulaTerms.Create(name, brand, stage, null, null, false, false));

        Assert.Equal(field, exception.Field);
    }

    [Fact]
    public void TermsCreate_DateOutOfRange_ThrowsForStartedOn()
    {
        var exception = Assert.Throws<DomainValidationException>(() => FormulaTerms.Create("Nan", null, null, null, new DateOnly(1999, 12, 31), false, false));

        Assert.Equal("startedOn", exception.Field);
    }

    [Fact]
    public void TermsCreate_Archived_IsNeverCurrent()
    {
        var terms = FormulaTerms.Create("Nan", null, null, null, null, isCurrent: true, isArchived: true);

        Assert.Equal((false, true), (terms.IsCurrent, terms.IsArchived));
    }

    [Fact]
    public void DecideUpsert_AnotherBaby_Throws()
    {
        var formula = NewFormula();

        Assert.Throws<FormulaBabyMismatchException>(() => formula.DecideUpsert(Guid.NewGuid(), null, Now));
    }

    [Fact]
    public void DecideUpsert_OlderClientTime_IsStaleAndEqualOrNewerApplies()
    {
        var formula = NewFormula(clientUpdatedAt: Now.AddMinutes(-10));

        Assert.Equal(FormulaUpsertDecision.IgnoreStale, formula.DecideUpsert(BabyId, Now.AddMinutes(-11), Now));
        Assert.Equal(FormulaUpsertDecision.Apply, formula.DecideUpsert(BabyId, Now.AddMinutes(-10), Now));
        Assert.Equal(FormulaUpsertDecision.Apply, formula.DecideUpsert(BabyId, null, Now));
    }

    [Fact]
    public void Edit_SameTerms_ChangesNothingAndARenameStampsBothTimes()
    {
        var formula = NewFormula();
        var later = Now.AddHours(1);

        formula.Edit(Terms(), later, later);
        Assert.Equal(Now, formula.UpdatedAt);

        formula.Edit(Terms(name: "Aptamil Pepti"), later, later.AddMinutes(-5));
        Assert.Equal(("Aptamil Pepti", later, later.AddMinutes(-5)), (formula.Name, formula.UpdatedAt, formula.ClientUpdatedAt));
    }

    [Fact]
    public void MakeRoom_NewCurrent_ClearsTheOtherCurrentOfTheSameBabyOnly()
    {
        var current = NewFormula(current: true, clientUpdatedAt: Now.AddMinutes(-30));
        var otherBaby = NewFormula(current: true, babyId: Guid.NewGuid());
        var later = Now.AddMinutes(1);

        var yielded = CurrentFormula.MakeRoom(BabyId, Guid.NewGuid(), Terms(current: true), [current, otherBaby], Now.AddMinutes(-1), later);

        Assert.Same(current, Assert.Single(yielded));
        Assert.False(current.IsCurrent);
        Assert.Equal((later, Now.AddMinutes(-1)), (current.UpdatedAt, current.ClientUpdatedAt));
        Assert.True(otherBaby.IsCurrent);
    }

    [Fact]
    public void MakeRoom_NotCurrentOrTheSameFormula_ChangesNothing()
    {
        var current = NewFormula(current: true);

        Assert.Empty(CurrentFormula.MakeRoom(BabyId, Guid.NewGuid(), Terms(current: false), [current], null, Now));
        Assert.Empty(CurrentFormula.MakeRoom(BabyId, current.Id, Terms(current: true), [current], null, Now));
        Assert.True(current.IsCurrent);
    }

    [Fact]
    public void YieldCurrentTo_OlderCause_KeepsTheNewerClientTime()
    {
        var current = NewFormula(current: true, clientUpdatedAt: Now);

        current.YieldCurrentTo(Now.AddHours(-1), Now.AddMinutes(1));

        Assert.False(current.IsCurrent);
        Assert.Equal(Now, current.ClientUpdatedAt);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("""{"method":"bottle","bottle_feeding_type":"formula"}""")]
    [InlineData("""{"method":"bottle","formula_id":null,"formula_name":null}""")]
    public void CheckReference_NoFormula_ReturnsNull(string json)
    {
        Assert.Null(FormulaPayload.CheckReference(EventPayload.From(json)));
    }

    [Fact]
    public void CheckReference_FormulaId_ReturnsIt()
    {
        var id = Guid.NewGuid();

        Assert.Equal(id, FormulaPayload.CheckReference(EventPayload.From($$"""{"formula_id":"{{id}}","formula_name":"Nan"}""")));
    }

    [Theory]
    [InlineData("""{"formula_id":"nope"}""", "formula_id")]
    [InlineData("""{"formula_id":42}""", "formula_id")]
    [InlineData("""{"formula_id":"00000000-0000-0000-0000-000000000000"}""", "formula_id")]
    [InlineData("""{"formula_name":"1234567890123456789012345678901234567890123456789012345678901"}""", "formula_name")]
    public void CheckReference_InvalidMembers_ThrowForTheMember(string json, string field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => FormulaPayload.CheckReference(EventPayload.From(json)));

        Assert.Equal(field, exception.Field);
    }

    [Fact]
    public void EnsureReferenceValid_FormulaOfAnotherBabyOrUnknown_Throws()
    {
        var mine = NewFormula();
        var theirs = NewFormula(babyId: Guid.NewGuid());

        FormulaPayload.EnsureReferenceValid(BabyId, mine.Id, mine);
        Assert.Equal("formula_id", Assert.Throws<DomainValidationException>(() => FormulaPayload.EnsureReferenceValid(BabyId, theirs.Id, theirs)).Field);
        Assert.Equal("formula_id", Assert.Throws<DomainValidationException>(() => FormulaPayload.EnsureReferenceValid(BabyId, Guid.NewGuid(), null)).Field);
    }

    [Fact]
    public void FeedingType_FormulaFieldsAreHiddenAndShownOnlyForABottleOfFormula()
    {
        var feeding = BuiltInEventTypes.Feeding;
        var start = Now;

        feeding.EnsureValidPayload(EventPayload.From("""{"method":"bottle","bottle_feeding_type":"formula","formula_id":"6f0d7a52-2d0f-4bd5-9e7b-2f43a3d0c1aa","formula_name":"Nan"}"""), start, start);
        var hidden = Assert.Throws<DomainValidationException>(() => feeding.EnsureValidPayload(EventPayload.From("""{"method":"bottle","bottle_feeding_type":"breast_milk","formula_id":"6f0d7a52-2d0f-4bd5-9e7b-2f43a3d0c1aa"}"""), start, start));

        Assert.Equal("formula_id", hidden.Field);
        Assert.All(feeding.Fields.Where(field => field.Key.StartsWith("formula_", StringComparison.Ordinal)), field => Assert.True(field.IsHidden));
    }
}
