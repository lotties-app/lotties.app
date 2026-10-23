using Lotties.Application.Appointments;
using Lotties.Application.CareProviders;
using Lotties.Application.Events;
using Lotties.Application.EventTypes;
using Lotties.Application.Formulas;
using Lotties.Application.Measurements;
using Lotties.Application.Medications;
using Lotties.Application.Notes;
using Lotties.Application.Prescriptions;
using Lotties.Application.Vaccinations;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Application.Backups;

internal sealed partial class BackupApplier
{
    private sealed partial class Run
    {
        private const string MedicationKind = "medication";
        private const string PrescriptionKind = "prescription";
        private const string FormulaKind = "formula";
        private const string CareProviderKind = "careProvider";
        private const string AppointmentKind = "appointment";
        private const string VaccinationKind = "vaccination";
        private const string MeasurementKind = "measurement";
        private const string NoteKind = "note";
        private const string EventKind = "event";

        private Dictionary<string, EventTypeResponse> _customTypesByKey = [];
        private Dictionary<Guid, MedicationResponse> _medicationsBefore = [];
        private Dictionary<Guid, MeasurementResponse> _measurementsBefore = [];

        private async Task EventTypesAsync(bool babyExists)
        {
            if (babyExists)
            {
                var current = (await owner._eventTypes.ListAsync(babyId, cancellationToken)).Where(eventType => eventType.BabyId is not null).ToArray();
                _customTypesByKey = current.ToDictionary(eventType => eventType.Key);
            }

            await StepAsync("eventTypes", file.EventTypes, eventType => eventType.Id, ApplyEventTypeAsync);
        }

        private async Task<Outcome> ApplyEventTypeAsync(EventTypeResponse source)
        {
            if (_customTypesByKey.TryGetValue(source.Key, out var existing))
            {
                _eventTypeMap[source.Id] = existing.Id;
                return SameDefinition(existing, source) ? Outcome.Unchanged : Outcome.Kept;
            }

            var created = await owner._eventTypes.CreateAsync(
                babyId,
                new CreateEventTypeRequest
                {
                    Key = source.Key,
                    Name = source.Name,
                    Icon = source.Icon,
                    Color = source.Color,
                    HasDuration = source.HasDuration,
                    Fields = source.Fields,
                },
                cancellationToken);
            _eventTypeMap[source.Id] = created.Id;
            return Outcome.New;
        }

        private static bool SameDefinition(EventTypeResponse stored, EventTypeResponse source) =>
            BackupJson.Serialize(stored with { Id = default, BabyId = default }).AsSpan().SequenceEqual(BackupJson.Serialize(source with { Id = default, BabyId = default }));

        private Guid MapType(Guid sourceTypeId) => _eventTypeMap.GetValueOrDefault(sourceTypeId, sourceTypeId);

        private async Task MedicationsAsync(bool babyExists)
        {
            if (babyExists)
            {
                _medicationsBefore = (await owner._medications.ListAsync(babyId, cancellationToken)).ToDictionary(medication => medication.Id);
            }

            await StepAsync("medications", file.Medications, medication => medication.Id, ApplyMedicationAsync);
        }

        private async Task<Outcome> ApplyMedicationAsync(MedicationResponse source)
        {
            var id = Target(MedicationKind, source.Id);
            if (_medicationsBefore.TryGetValue(id, out var existing))
            {
                return SameMedication(existing, source) ? Outcome.Unchanged : Outcome.Kept;
            }

            var request = new UpsertMedicationRequest { Name = source.Name, ProductId = source.ProductId, DefaultDosage = source.DefaultDosage, Notes = source.Notes, IsUsual = source.IsUsual };
            try
            {
                await owner._medications.UpsertAsync(babyId, id, request, cancellationToken);
            }
            catch (InvalidProductLinkException)
            {
                Notice("product_links_dropped");
                await owner._medications.UpsertAsync(babyId, id, request with { ProductId = null }, cancellationToken);
            }

            return Outcome.New;
        }

        private static bool SameMedication(MedicationResponse stored, MedicationResponse source) =>
            (stored.Name, stored.DefaultDosage, stored.Notes, stored.IsUsual) == (source.Name, source.DefaultDosage, source.Notes, source.IsUsual);

        private async Task PrescriptionsAsync(bool babyExists)
        {
            if (babyExists)
            {
                var current = await owner._prescriptions.ListChangesAsync(babyId, null, cancellationToken);
                SetPriors(PrescriptionKind, current.Select(item => (item.Id, new Prior(item.UpdatedAt, item.ClientUpdatedAt, item.DeletedAt is not null))));
            }

            await StepAsync("prescriptions", file.Prescriptions, prescription => prescription.Id, ApplyPrescriptionAsync, prescription => PrescriptionNotices(prescription));
        }

        private IEnumerable<string> PrescriptionNotices(PrescriptionResponse prescription) =>
            AuthorNotice(prescription.CreatedBy).Concat(prescription.PrescribedByUserId is null ? [] : ["doctor_provenance_dropped"]);

        private async Task<Outcome> ApplyPrescriptionAsync(PrescriptionResponse source)
        {
            var id = Target(PrescriptionKind, source.Id);
            var before = PriorOf(PrescriptionKind, id);
            if (DeletedOutcome(source.DeletedAt is not null, before) is { } decided)
            {
                return decided;
            }

            var request = new UpsertPrescriptionRequest
            {
                MedicationId = Target(MedicationKind, source.MedicationId),
                Status = source.Status,
                Kind = source.Kind,
                Dose = source.Dose,
                TimesOfDay = source.TimesOfDay,
                EveryMinutes = source.EveryMinutes,
                DayParts = source.DayParts,
                DayPartReminders = source.DayPartReminders,
                MinIntervalMinutes = source.MinIntervalMinutes,
                MaxDosesPer24h = source.MaxDosesPer24h,
                Indication = source.Indication,
                IntervalGroup = source.IntervalGroup,
                StartDate = source.StartDate,
                EndDate = source.EndDate,
                Prescriber = source.Prescriber,
                Instructions = source.Instructions,
                UpdatedAt = source.ClientUpdatedAt,
            };
            var result = await owner._prescriptions.UpsertAsync(babyId, id, request, cancellationToken);
            if (before is null && source.DeletedAt is not null)
            {
                await owner._prescriptions.DeleteAsync(babyId, id, cancellationToken);
            }

            return Classify(before, result.Created, result.Prescription.UpdatedAt, source.ClientUpdatedAt);
        }

        private async Task FormulasAsync(bool babyExists)
        {
            if (babyExists)
            {
                var current = await owner._formulas.ListChangesAsync(babyId, null, cancellationToken);
                SetPriors(FormulaKind, current.Select(item => (item.Id, new Prior(item.UpdatedAt, item.ClientUpdatedAt, false))));
            }

            await StepAsync("formulas", file.Formulas, formula => formula.Id, ApplyFormulaAsync, formula => AuthorNotice(formula.CreatedBy));
        }

        private async Task<Outcome> ApplyFormulaAsync(FormulaResponse source)
        {
            var id = Target(FormulaKind, source.Id);
            var before = PriorOf(FormulaKind, id);
            var request = new UpsertFormulaRequest
            {
                Name = source.Name,
                Brand = source.Brand,
                Stage = source.Stage,
                Notes = source.Notes,
                StartedOn = source.StartedOn,
                IsCurrent = source.IsCurrent,
                Archived = source.Archived,
                UpdatedAt = source.ClientUpdatedAt,
            };
            var result = await owner._formulas.UpsertAsync(babyId, id, request, cancellationToken);
            return Classify(before, result.Created, result.Formula.UpdatedAt, source.ClientUpdatedAt);
        }

        private async Task CareProvidersAsync(bool babyExists)
        {
            if (babyExists)
            {
                var current = await owner._careProviders.ListAsync(babyId, null, cancellationToken);
                SetPriors(CareProviderKind, current.Select(item => (item.Id, new Prior(item.UpdatedAt, item.ClientUpdatedAt, item.IsDeleted))));
            }

            await StepAsync("careProviders", file.CareProviders, provider => provider.Id, ApplyCareProviderAsync, provider => AuthorNotice(provider.CreatedBy));
        }

        private async Task<Outcome> ApplyCareProviderAsync(CareProviderResponse source)
        {
            var id = Target(CareProviderKind, source.Id);
            var before = PriorOf(CareProviderKind, id);
            if (source.IsDeleted && before is { Deleted: false })
            {
                return Outcome.Kept;
            }

            var request = new UpsertCareProviderRequest
            {
                Name = source.Name,
                Specialty = source.Specialty,
                RegistrationCouncil = source.RegistrationCouncil,
                RegistrationNumber = source.RegistrationNumber,
                RegistrationRegion = source.RegistrationRegion,
                ClinicName = source.ClinicName,
                Address = source.Address,
                Phone = source.Phone,
                Whatsapp = source.Whatsapp,
                Email = source.Email,
                Website = source.Website,
                Notes = source.Notes,
                IsFavorite = source.IsFavorite,
                IsDeleted = source.IsDeleted,
                UpdatedAt = source.ClientUpdatedAt,
            };
            var result = await owner._careProviders.UpsertAsync(babyId, id, request, cancellationToken);
            return Classify(before, result.Created, result.Provider.UpdatedAt, source.ClientUpdatedAt);
        }

        private async Task AppointmentsAsync(bool babyExists)
        {
            if (babyExists)
            {
                var current = await owner._appointments.ListAsync(babyId, new Lotties.Domain.Appointments.AppointmentQuery(), cancellationToken);
                SetPriors(AppointmentKind, current.Select(item => (item.Id, new Prior(item.UpdatedAt, item.ClientUpdatedAt, false))));
            }

            await StepAsync("appointments", file.Appointments, appointment => appointment.Id, ApplyAppointmentAsync, appointment => AuthorNotice(appointment.CreatedBy));
        }

        private async Task<Outcome> ApplyAppointmentAsync(AppointmentResponse source)
        {
            var id = Target(AppointmentKind, source.Id);
            var before = PriorOf(AppointmentKind, id);
            var request = new UpsertAppointmentRequest
            {
                Title = source.Title,
                Type = source.Type,
                StartsAt = source.StartsAt,
                DurationMinutes = source.DurationMinutes,
                Location = source.Location,
                DoctorName = source.DoctorName,
                Notes = source.Notes,
                Outcome = source.Outcome,
                Status = source.Status,
                ReminderOffsetsMinutes = source.ReminderOffsetsMinutes,
                ProviderId = source.ProviderId is { } provider ? Target(CareProviderKind, provider) : null,
                UpdatedAt = source.ClientUpdatedAt,
            };
            var result = await owner._appointments.UpsertAsync(babyId, id, request, cancellationToken);
            return Classify(before, result.Created, result.Appointment.UpdatedAt, source.ClientUpdatedAt);
        }

        private async Task VaccinationsAsync(bool babyExists)
        {
            if (babyExists)
            {
                var current = await owner._vaccinations.ListAsync(babyId, null, cancellationToken);
                SetPriors(VaccinationKind, current.Select(item => (item.Id, new Prior(item.UpdatedAt, item.ClientUpdatedAt, item.DeletedAt is not null))));
            }

            await StepAsync("vaccinations", file.Vaccinations, vaccination => vaccination.Id, ApplyVaccinationAsync, vaccination => AuthorNotice(vaccination.CreatedBy));
        }

        private async Task<Outcome> ApplyVaccinationAsync(VaccinationResponse source)
        {
            var id = Target(VaccinationKind, source.Id);
            var before = PriorOf(VaccinationKind, id);
            if (DeletedOutcome(source.DeletedAt is not null, before) is { } decided)
            {
                return decided;
            }

            var request = new UpsertVaccinationRequest
            {
                VaccineKey = source.VaccineKey,
                DoseId = source.DoseId,
                CustomName = source.CustomName,
                DoseLabel = source.DoseLabel,
                GivenOn = source.GivenOn,
                Network = source.Network,
                Clinic = source.Clinic,
                Lot = source.Lot,
                AdministeredBy = source.AdministeredBy,
                Notes = source.Notes,
                UpdatedAt = source.ClientUpdatedAt,
            };
            var result = await owner._vaccinations.UpsertAsync(babyId, id, request, cancellationToken);
            if (before is null && source.DeletedAt is not null)
            {
                await owner._vaccinations.DeleteAsync(babyId, id, cancellationToken);
            }

            return Classify(before, result.Created, result.Vaccination.UpdatedAt, source.ClientUpdatedAt);
        }

        private async Task MeasurementsAsync(bool babyExists)
        {
            if (babyExists)
            {
                _measurementsBefore = (await owner._measurements.ListAsync(babyId, cancellationToken)).ToDictionary(measurement => measurement.Id);
            }

            await StepAsync("measurements", file.Measurements, measurement => measurement.Id, ApplyMeasurementAsync, MeasurementNotices);
        }

        private IEnumerable<string> MeasurementNotices(MeasurementResponse measurement) =>
            AuthorNotice(measurement.CreatedBy).Concat(measurement.RecordedByDoctor ? ["doctor_measurements_flattened"] : []);

        private async Task<Outcome> ApplyMeasurementAsync(MeasurementResponse source)
        {
            var id = Target(MeasurementKind, source.Id);
            if (_measurementsBefore.TryGetValue(id, out var existing))
            {
                return SameMeasurement(existing, source) ? Outcome.Unchanged : Outcome.Kept;
            }

            var request = new UpsertMeasurementRequest { Date = source.Date, WeightKg = source.WeightKg, HeightCm = source.HeightCm, HeadCircumferenceCm = source.HeadCircumferenceCm, Notes = source.Notes };
            await owner._measurements.UpsertAsync(babyId, id, request, cancellationToken);
            return Outcome.New;
        }

        private static bool SameMeasurement(MeasurementResponse stored, MeasurementResponse source) =>
            (stored.Date, stored.WeightKg, stored.HeightCm, stored.HeadCircumferenceCm, stored.Notes) == (source.Date, source.WeightKg, source.HeightCm, source.HeadCircumferenceCm, source.Notes);

        private async Task NotesAsync(bool babyExists)
        {
            if (babyExists)
            {
                var current = await owner._notes.ListChangesAsync(babyId, null, cancellationToken);
                SetPriors(NoteKind, current.Select(item => (item.Id, new Prior(item.UpdatedAt, item.ClientUpdatedAt, item.DeletedAt is not null))));
            }

            await StepAsync("notes", file.Notes, note => note.Id, ApplyNoteAsync, note => AuthorNotice(note.AuthorUserId));
        }

        private async Task<Outcome> ApplyNoteAsync(NoteResponse source)
        {
            var id = Target(NoteKind, source.Id);
            var before = PriorOf(NoteKind, id);
            if (DeletedOutcome(source.DeletedAt is not null, before) is { } decided)
            {
                return decided;
            }

            var request = new UpsertNoteRequest { Kind = source.Kind, Visibility = source.Visibility, Body = source.Body, UpdatedAt = source.ClientUpdatedAt };
            var result = await owner._notes.UpsertAsync(babyId, id, request, cancellationToken);
            if (before is null && source.DeletedAt is not null)
            {
                await owner._notes.DeleteAsync(babyId, id, cancellationToken);
            }

            return Classify(before, result.Created, result.Note.UpdatedAt, source.ClientUpdatedAt);
        }

        private async Task EventsAsync(bool babyExists)
        {
            if (babyExists)
            {
                SetPriors(EventKind, await ListEventPriorsAsync());
            }

            await StepAsync("events", file.Events, stored => stored.Id, ApplyEventAsync, stored => AuthorNotice(stored.CreatedBy));
        }

        private async Task<List<(Guid Id, Prior Prior)>> ListEventPriorsAsync()
        {
            var priors = new List<(Guid, Prior)>();
            string? cursor = null;
            do
            {
                var page = await owner._events.ListChangesAsync(babyId, new ListEventChangesRequest(null, cursor, EventPageSize), cancellationToken);
                priors.AddRange(page.Items.Select(item => (item.Id, new Prior(item.UpdatedAt, item.ClientUpdatedAt, item.DeletedAt is not null))));
                cursor = page.NextCursor;
            }
            while (cursor is not null);
            return priors;
        }

        private async Task<Outcome> ApplyEventAsync(BackupEvent source)
        {
            var id = Target(EventKind, source.Id);
            var before = PriorOf(EventKind, id);
            if (DeletedOutcome(source.DeletedAt is not null, before) is { } decided)
            {
                return decided;
            }

            var typeId = MapType(source.TypeId);
            var request = new UpsertEventRequest
            {
                TypeId = typeId,
                StartedAt = source.StartedAt,
                EndedAt = source.EndedAt,
                Payload = EventPayload.From(BackupPayloads.Remap(source.Payload, typeId, Target)),
                Notes = source.Notes,
                UpdatedAt = source.ClientUpdatedAt,
            };
            var result = await owner._events.UpsertAsync(babyId, id, request, cancellationToken);
            if (before is null && source.DeletedAt is not null)
            {
                await owner._events.DeleteAsync(babyId, id, cancellationToken);
            }

            return Classify(before, result.Created, result.Event.UpdatedAt, source.ClientUpdatedAt);
        }
    }
}
