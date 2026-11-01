using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;

namespace Lotties.Domain.Babies;

/// <summary>
/// What a member reads of the records that touch more than one section (docs/design/19-doctor-dashboard.md section 3): a
/// Doctor sees only what her sections open, any other member sees everything. Medication doses are logged as events but
/// belong to the medications section; the formula a bottle names belongs to the formulas section; the vaccine profile
/// belongs to the vaccines section.
/// </summary>
public sealed class SectionView
{
    private static readonly Guid[] MedicationEventTypes = [BuiltInEventTypes.MedicationId];

    private readonly DoctorScopeSet _scopes;

    private SectionView(DoctorScopeSet scopes)
    {
        _scopes = scopes;
    }

    /// <summary>The view of every member but a Doctor.</summary>
    public static SectionView Everything { get; } = new(DoctorScopeSet.All);

    /// <summary>The event types this view leaves out: the medication doses without the medications section.</summary>
    public IReadOnlyList<Guid> HiddenEventTypeIds => Sees(DoctorScope.Medications) ? [] : MedicationEventTypes;

    /// <summary>The view of <paramref name="member"/>: her effective sections for a Doctor, everything for any other role.</summary>
    public static SectionView Of(BabyMember member)
    {
        ArgumentNullException.ThrowIfNull(member);
        return member.Role.IsDoctor() ? new SectionView(member.EffectiveDoctorScopes) : Everything;
    }

    public bool Sees(DoctorScope scope) => _scopes.Contains(scope);

    /// <summary>Whether <paramref name="stored"/> is shown at all (<see cref="HiddenEventTypeIds"/>).</summary>
    public bool Shows(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        return !HiddenEventTypeIds.Contains(stored.TypeId);
    }

    /// <summary>Whether the predictions of the event type <paramref name="key"/> are shown (the medication doses' only with medications).</summary>
    public bool ShowsType(EventTypeKey key) => key != BuiltInEventTypes.Medication.Key || Sees(DoctorScope.Medications);

    /// <summary>The payload of <paramref name="stored"/> as this view reads it: a feeding names its formula only with the formulas section.</summary>
    public EventPayload PayloadOf(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        return stored.TypeId == BuiltInEventTypes.FeedingId && !Sees(DoctorScope.Formulas)
            ? FormulaPayload.WithoutFormula(stored.Payload)
            : stored.Payload;
    }
}
