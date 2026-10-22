using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;

namespace Lotties.Domain.Tests.Proposals;

/// <summary>Builders for prescription proposals of <see cref="BabyId"/> written by <see cref="DoctorId"/>.</summary>
internal static class ProposalFixtures
{
    public static readonly Guid BabyId = Guid.NewGuid();
    public static readonly Guid DoctorId = Guid.NewGuid();
    public static readonly Guid ParentId = Guid.NewGuid();
    public static readonly DateTimeOffset Now = new(2026, 10, 22, 13, 0, 0, TimeSpan.Zero);

    public static PrescriptionSchedule TwiceADay() =>
        PrescriptionSchedule.Create(PrescriptionKind.Scheduled, TimesOfDay.Parse(["08:00", "20:00"]), null, null, null, null);

    public static ProposalTerms Terms(
        string name = "Paracetamol",
        Guid? medicationId = null,
        Guid? productId = null,
        decimal amount = 2,
        string unit = "drops",
        bool perKg = false,
        PrescriptionSchedule? schedule = null,
        DateOnly? start = null,
        DateOnly? end = null,
        string? instructions = "Give with milk.",
        Guid? replaces = null) =>
        ProposalTerms.Create(
            MedicationReference.Create(medicationId, productId, name),
            DoseRule.Create(amount, unit, perKg, null),
            schedule ?? TwiceADay(),
            null,
            start ?? new DateOnly(2026, 10, 22),
            end ?? new DateOnly(2026, 10, 29),
            instructions,
            replaces);

    public static PrescriptionProposal Pending(ProposalTerms? terms = null, Guid? id = null, DateTimeOffset? at = null) =>
        PrescriptionProposal.Create(id ?? Guid.NewGuid(), BabyId, terms ?? Terms(), DoctorId, at ?? Now, at ?? Now);
}
