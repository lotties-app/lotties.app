using System.Collections.Frozen;
using Lotties.Domain.Exceptions;

namespace Lotties.Api.Errors;

/// <summary>
/// The single place that maps <see cref="DomainException"/> types to HTTP status codes. Invalid input is 400, a
/// write the caller's role does not cover for this resource 403, a missing resource 404, a state conflict 409, a well-formed request the rules reject 422 (also the fallback for
/// domain exceptions not listed here). Add a new exception type here when it needs a different status.
/// </summary>
internal static class DomainExceptionStatusCodes
{
    public const int Fallback = StatusCodes.Status422UnprocessableEntity;

    private static readonly FrozenDictionary<Type, int> ByType = new Dictionary<Type, int>
    {
        [typeof(DomainValidationException)] = StatusCodes.Status400BadRequest,
        [typeof(InvalidEventTimeRangeException)] = StatusCodes.Status400BadRequest,
        [typeof(EventNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(EventBabyMismatchException)] = StatusCodes.Status409Conflict,
        [typeof(EventNotOwnedException)] = StatusCodes.Status403Forbidden,
        [typeof(EventDeletedException)] = StatusCodes.Status409Conflict,
        [typeof(EventAlreadyStoppedException)] = StatusCodes.Status409Conflict,
        [typeof(BuiltInEventTypeReadOnlyException)] = StatusCodes.Status409Conflict,
        [typeof(MemberAlreadyExistsException)] = StatusCodes.Status409Conflict,
        [typeof(InviteAlreadyAcceptedException)] = StatusCodes.Status409Conflict,
        [typeof(InviteExpiredException)] = StatusCodes.Status410Gone,
        [typeof(BabyNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(MemberNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(InviteNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(EventTypeNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(LastOwnerException)] = StatusCodes.Status409Conflict,
        [typeof(EventTypeKeyTakenException)] = StatusCodes.Status409Conflict,
        [typeof(EventTypeInUseException)] = StatusCodes.Status409Conflict,
        [typeof(MedicationBabyMismatchException)] = StatusCodes.Status409Conflict,
        [typeof(MeasurementBabyMismatchException)] = StatusCodes.Status409Conflict,
        [typeof(MeasurementWithoutValuesException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(EventTypeNotAvailableException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(ImportFileTooLargeException)] = StatusCodes.Status413PayloadTooLarge,
        [typeof(ImportTooManyRowsException)] = StatusCodes.Status400BadRequest,
        [typeof(ImportTooManyMedicationNamesException)] = StatusCodes.Status400BadRequest,
        [typeof(InvalidImportFileException)] = StatusCodes.Status400BadRequest,
        [typeof(UnmappedMedicationsException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(InvalidMedicationMappingException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(ImportConflictException)] = StatusCodes.Status409Conflict,
        [typeof(ConcurrentModificationException)] = StatusCodes.Status409Conflict,
        [typeof(ProductNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(InvalidProductLinkException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(SubstanceNotFoundException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(CatalogSubstanceNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(PrescriptionBabyMismatchException)] = StatusCodes.Status409Conflict,
        [typeof(PrescriptionDeletedException)] = StatusCodes.Status409Conflict,
        [typeof(PrescriptionMedicationNotFoundException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(FormulaBabyMismatchException)] = StatusCodes.Status409Conflict,
        [typeof(AppointmentBabyMismatchException)] = StatusCodes.Status409Conflict,
        [typeof(VaccinationBabyMismatchException)] = StatusCodes.Status409Conflict,
        [typeof(AppointmentNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(AppointmentNotStartedException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(CareProviderBabyMismatchException)] = StatusCodes.Status409Conflict,
        [typeof(CareProviderNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(ProfessionalProfileRequiredException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(ProfessionalProfileNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(NoteBabyMismatchException)] = StatusCodes.Status409Conflict,
        [typeof(NoteNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(NoteNotOwnedException)] = StatusCodes.Status403Forbidden,
        [typeof(NoteAlreadySharedException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(MeasurementNotOwnedException)] = StatusCodes.Status403Forbidden,
        [typeof(ProposalNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(ProposalBabyMismatchException)] = StatusCodes.Status409Conflict,
        [typeof(ProposalDecidedException)] = StatusCodes.Status409Conflict,
        [typeof(ProposalNotPendingException)] = StatusCodes.Status409Conflict,
        [typeof(ReplacedPrescriptionNotFoundException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(PushNotConfiguredException)] = StatusCodes.Status409Conflict,
        [typeof(PushEndpointNotAllowedException)] = StatusCodes.Status422UnprocessableEntity,
        [typeof(NotificationActionNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(SnoozeLimitReachedException)] = StatusCodes.Status409Conflict,
        [typeof(AddressNotFoundException)] = StatusCodes.Status404NotFound,
        [typeof(AddressLookupUnavailableException)] = StatusCodes.Status502BadGateway,
        [typeof(AddressLookupDisabledException)] = StatusCodes.Status503ServiceUnavailable,
    }.ToFrozenDictionary();

    public static int For(DomainException exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        return ByType.GetValueOrDefault(exception.GetType(), Fallback);
    }
}
