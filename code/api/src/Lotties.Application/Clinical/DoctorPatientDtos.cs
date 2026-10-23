namespace Lotties.Application.Clinical;

/// <summary>The latest recorded weight of a patient.</summary>
public sealed record PatientWeightResponse
{
    public decimal WeightKg { get; init; }

    public DateOnly Date { get; init; }
}

/// <summary>
/// The averages of a patient's last seven local days (today included), taken like the parents' Insights: over the days with
/// data, leaving today out unless it is the only one. <see cref="SleepMinutesPerDay"/> is whole minutes, the others have one decimal.
/// </summary>
public sealed record PatientWeekResponse
{
    public DateOnly From { get; init; }

    public DateOnly To { get; init; }

    public int? SleepMinutesPerDay { get; init; }

    public double? FeedsPerDay { get; init; }

    public double? BottleMlPerDay { get; init; }

    public double? DiapersPerDay { get; init; }
}

/// <summary>
/// A baby of the signed-in doctor (<c>GET /api/v1/doctor/patients</c>). Every figure belongs to a scope of the doctor on this
/// baby and is <c>null</c> without it: <c>daily_log</c> opens <see cref="LastEventAt"/> and <see cref="Week"/>, <c>growth</c>
/// <see cref="LatestWeight"/>, <c>medications</c> <see cref="PendingProposals"/> (her own), <c>vaccines</c> <see cref="VaccinesDue"/> and
/// <c>notes</c> <see cref="SharedNotes"/> (her own shared notes).
/// </summary>
public sealed record DoctorPatientResponse
{
    public Guid BabyId { get; init; }

    public string Name { get; init; } = string.Empty;

    public DateOnly BirthDate { get; init; }

    public IReadOnlyList<string> DoctorScopes { get; init; } = [];

    public DateTimeOffset? LastEventAt { get; init; }

    public PatientWeekResponse? Week { get; init; }

    public PatientWeightResponse? LatestWeight { get; init; }

    public int? PendingProposals { get; init; }

    public int? VaccinesDue { get; init; }

    public int? SharedNotes { get; init; }
}
