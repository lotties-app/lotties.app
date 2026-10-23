using System.Text.Json.Serialization;
using Lotties.Application.Serialization;
using Lotties.Domain.Appointments;
using Lotties.Domain.Exceptions;

namespace Lotties.Application.Appointments;

/// <summary>
/// Body of <c>PUT /api/v1/babies/{babyId}/appointments/{appointmentId}</c>: the full editable state. <c>title</c>,
/// <c>type</c> and <c>startsAt</c> are required; <c>status</c> defaults to <c>upcoming</c>; <c>reminderOffsetsMinutes</c>
/// absent (or <c>null</c>) is 1 day and 2 hours, <c>[]</c> is none. <c>updatedAt</c> is the client edit time (last write
/// wins, as for events).
/// </summary>
public sealed record UpsertAppointmentRequest
{
    public string? Title { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public AppointmentType? Type { get; init; }

    public DateTimeOffset? StartsAt { get; init; }

    public int? DurationMinutes { get; init; }

    public string? Location { get; init; }

    public string? DoctorName { get; init; }

    public string? Notes { get; init; }

    public string? Outcome { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public AppointmentStatus? Status { get; init; }

    public IReadOnlyList<int>? ReminderOffsetsMinutes { get; init; }

    /// <summary>The care provider picked from the baby's directory; the text fields keep the copied details.</summary>
    public Guid? ProviderId { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }

    /// <summary>Validates every rule but the clock one; throws <see cref="DomainValidationException"/> naming the field.</summary>
    public static explicit operator AppointmentTerms(UpsertAppointmentRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return AppointmentTerms.Create(
            request.Title,
            request.Type ?? throw new DomainValidationException("type", "type is required."),
            request.StartsAt ?? throw new DomainValidationException("startsAt", "startsAt is required."),
            request.DurationMinutes,
            request.Location,
            request.DoctorName,
            request.Notes,
            request.Outcome,
            request.Status ?? AppointmentStatus.Upcoming,
            AppointmentReminders.From(request.ReminderOffsetsMinutes?.ToArray()),
            request.ProviderId);
    }
}

/// <summary>An appointment as stored.</summary>
public sealed record AppointmentResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public required string Title { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public AppointmentType Type { get; init; }

    public DateTimeOffset StartsAt { get; init; }

    public int? DurationMinutes { get; init; }

    public string? Location { get; init; }

    public string? DoctorName { get; init; }

    public string? Notes { get; init; }

    public string? Outcome { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public AppointmentStatus Status { get; init; }

    /// <summary>Minutes before the start, largest first.</summary>
    public required IReadOnlyList<int> ReminderOffsetsMinutes { get; init; }

    public Guid? ProviderId { get; init; }

    public Guid CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary>Server receive time of the last change; the delta cursor.</summary>
    public DateTimeOffset UpdatedAt { get; init; }

    /// <summary>Client edit time of the last applied change; decides conflicts.</summary>
    public DateTimeOffset ClientUpdatedAt { get; init; }

    public static implicit operator AppointmentResponse(Appointment appointment)
    {
        ArgumentNullException.ThrowIfNull(appointment);
        return new AppointmentResponse
        {
            Id = appointment.Id,
            BabyId = appointment.BabyId,
            Title = appointment.Title,
            Type = appointment.Type,
            StartsAt = appointment.StartsAt,
            DurationMinutes = appointment.DurationMinutes,
            Location = appointment.Location,
            DoctorName = appointment.DoctorName,
            Notes = appointment.Notes,
            Outcome = appointment.Outcome,
            Status = appointment.Status,
            ReminderOffsetsMinutes = appointment.Reminders.Minutes,
            ProviderId = appointment.ProviderId,
            CreatedBy = appointment.CreatedBy,
            CreatedAt = appointment.CreatedAt,
            UpdatedAt = appointment.UpdatedAt,
            ClientUpdatedAt = appointment.ClientUpdatedAt,
        };
    }
}

/// <summary>The outcome of an upsert: the appointment as stored, and whether this request created it.</summary>
public sealed record UpsertAppointmentResult(AppointmentResponse Appointment, bool Created);
