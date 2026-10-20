using System.Collections.Frozen;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Api.Errors;

/// <summary>
/// The single place that maps <see cref="DomainException"/> types to HTTP status codes. Invalid input is 400, a
/// missing resource 404, a state conflict 409, a well-formed request the rules reject 422 (also the fallback for
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
        [typeof(EventDeletedException)] = StatusCodes.Status409Conflict,
        [typeof(EventAlreadyStoppedException)] = StatusCodes.Status409Conflict,
        [typeof(BuiltInEventTypeReadOnlyException)] = StatusCodes.Status409Conflict,
        [typeof(MemberAlreadyExistsException)] = StatusCodes.Status409Conflict,
        [typeof(InviteAlreadyAcceptedException)] = StatusCodes.Status409Conflict,
        [typeof(InviteExpiredException)] = StatusCodes.Status410Gone,
        [typeof(EventTypeNotAvailableException)] = StatusCodes.Status422UnprocessableEntity,
    }.ToFrozenDictionary();

    public static int For(DomainException exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        return ByType.GetValueOrDefault(exception.GetType(), Fallback);
    }
}
