using System.Text.Json;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;

namespace Lotties.Domain.Tests.Babies;

/// <summary>What a member reads of records that touch more than one section (docs/design/19-doctor-dashboard.md section 3).</summary>
public sealed class SectionViewTests
{
    private const string BottleOfFormula =
        """{"method":"bottle","amount_ml":120,"bottle_feeding_type":"formula","formula_id":"5d8f1d2e-3c47-4a8e-9a43-0d6d1f2a4b11","formula_name":"Aptamil 1"}""";

    private static readonly Guid OwnerId = Guid.NewGuid();

    [Fact]
    public void Of_Owner_SeesEverySection()
    {
        var view = SectionView.Of(NewBaby().Members.Single());

        Assert.All(Enum.GetValues<DoctorScope>(), scope => Assert.True(view.Sees(scope)));
        Assert.Empty(view.HiddenEventTypeIds);
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public void Of_FamilyMember_ShowsMedicationDosesAndFormulas(BabyRole role)
    {
        var view = SectionView.Of(Admit(role));

        Assert.True(view.Shows(Dose()));
        Assert.Equal(BottleOfFormula, view.PayloadOf(Bottle()).Value);
    }

    [Fact]
    public void Of_DoctorWithOnlySomeSections_SeesOnlyThose()
    {
        var view = SectionView.Of(AdmitDoctor(DoctorScope.DailyLog, DoctorScope.Growth));

        Assert.True(view.Sees(DoctorScope.DailyLog));
        Assert.True(view.Sees(DoctorScope.Growth));
        Assert.False(view.Sees(DoctorScope.Vaccines));
        Assert.False(view.Sees(DoctorScope.Medications));
    }

    [Fact]
    public void Shows_DoctorWithoutMedications_HidesMedicationDoses()
    {
        var view = SectionView.Of(AdmitDoctor(DoctorScope.DailyLog));

        Assert.False(view.Shows(Dose()));
        Assert.True(view.Shows(Bottle()));
        Assert.Equal([BuiltInEventTypes.MedicationId], view.HiddenEventTypeIds);
    }

    [Fact]
    public void Shows_DoctorWithMedications_ShowsMedicationDoses()
    {
        var view = SectionView.Of(AdmitDoctor(DoctorScope.DailyLog, DoctorScope.Medications));

        Assert.True(view.Shows(Dose()));
        Assert.Empty(view.HiddenEventTypeIds);
    }

    [Fact]
    public void ShowsType_DoctorWithoutMedications_HidesOnlyTheMedicationType()
    {
        var view = SectionView.Of(AdmitDoctor(DoctorScope.DailyLog));

        Assert.False(view.ShowsType(BuiltInEventTypes.Medication.Key));
        Assert.True(view.ShowsType(BuiltInEventTypes.Feeding.Key));
    }

    [Fact]
    public void PayloadOf_DoctorWithoutFormulas_LeavesOutTheFormulaOfABottle()
    {
        var view = SectionView.Of(AdmitDoctor(DoctorScope.DailyLog));

        var payload = Parse(view.PayloadOf(Bottle()));

        Assert.False(payload.TryGetProperty(FormulaPayload.FormulaIdMember, out _));
        Assert.False(payload.TryGetProperty(FormulaPayload.FormulaNameMember, out _));
        Assert.Equal("formula", payload.GetProperty("bottle_feeding_type").GetString());
        Assert.Equal(120, payload.GetProperty("amount_ml").GetInt32());
    }

    [Fact]
    public void PayloadOf_DoctorWithFormulas_KeepsTheFormulaOfABottle()
    {
        var view = SectionView.Of(AdmitDoctor(DoctorScope.DailyLog, DoctorScope.Formulas));

        Assert.Equal(BottleOfFormula, view.PayloadOf(Bottle()).Value);
    }

    [Fact]
    public void PayloadOf_DoctorWithoutFormulas_KeepsOtherTypesUnchanged()
    {
        var view = SectionView.Of(AdmitDoctor(DoctorScope.DailyLog));
        var sleep = NewEvent(BuiltInEventTypes.SleepId, """{"kind":"nap","formula_name":"not a bottle"}""");

        Assert.Equal(sleep.Payload, view.PayloadOf(sleep));
    }

    [Fact]
    public void Of_NullMember_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => SectionView.Of(null!));
    }

    private static Baby NewBaby() => Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

    private static BabyMember Admit(BabyRole role)
    {
        var baby = NewBaby();
        var issued = Invite.Issue(baby.Id, role, OwnerId, TestClock.Now, TimeSpan.FromDays(7));
        return baby.AdmitWith(issued.Invite, Guid.NewGuid(), TestClock.Now);
    }

    private static BabyMember AdmitDoctor(params DoctorScope[] scopes)
    {
        var baby = NewBaby();
        var issued = Invite.Issue(baby.Id, BabyRole.Doctor, OwnerId, TestClock.Now, TimeSpan.FromDays(7), DoctorScopeSet.Create(scopes));
        return baby.AdmitWith(issued.Invite, Guid.NewGuid(), TestClock.Now, isDeclaredProfessional: true);
    }

    private static Event Dose() =>
        NewEvent(BuiltInEventTypes.MedicationId, """{"medications":[{"medicationId":"0b7c4a52-8a3f-4e4b-9a5e-1f1f8e6b2c33","name":"Paracetamol"}]}""");

    private static Event Bottle() => NewEvent(BuiltInEventTypes.FeedingId, BottleOfFormula);

    private static Event NewEvent(Guid typeId, string json) =>
        Event.Create(Guid.NewGuid(), Guid.NewGuid(), typeId, OwnerId, TestClock.Now, null, EventPayload.From(json), null, TestClock.Now);

    private static JsonElement Parse(EventPayload payload)
    {
        using var document = JsonDocument.Parse(payload.Value);
        return document.RootElement.Clone();
    }
}
