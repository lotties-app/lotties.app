using Lotties.Domain.Appointments;
using Lotties.Domain.CareProviders;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Notes;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using Lotties.Domain.Vaccinations;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence;

/// <summary>
/// The data plane of docs/design/47-bring-your-own-database.md (D2): the records about a baby's care, mapped by
/// <see cref="LottiesDataDbContext"/>. Everything else (accounts, babies, members, invites, doctor access, consents, push,
/// settings, board, catalog) is the control plane, mapped by <see cref="LottiesDbContext"/>.
/// </summary>
public static class DataPlane
{
    /// <summary>The aggregates of the data plane, one table each.</summary>
    public static readonly IReadOnlyList<Type> EntityTypes =
    [
        typeof(Event),
        typeof(EventType),
        typeof(Medication),
        typeof(Prescription),
        typeof(Formula),
        typeof(Appointment),
        typeof(CareProvider),
        typeof(Vaccination),
        typeof(Measurement),
        typeof(BabyNote),
        typeof(PrescriptionProposal),
        typeof(NoteRead),
    ];

    /// <summary>Whether <paramref name="configurationType"/> configures an aggregate of the data plane.</summary>
    internal static bool IsDataConfiguration(Type configurationType) =>
        configurationType.GetInterfaces().Any(contract =>
            contract.IsGenericType
            && contract.GetGenericTypeDefinition() == typeof(IEntityTypeConfiguration<>)
            && EntityTypes.Contains(contract.GetGenericArguments()[0]));
}
