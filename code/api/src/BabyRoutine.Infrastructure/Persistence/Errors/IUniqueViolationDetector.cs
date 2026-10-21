namespace BabyRoutine.Infrastructure.Persistence.Errors;

/// <summary>
/// Recognizes a unique-key (or primary-key) violation of one database provider. Repositories treat such a violation
/// as a lost insert race (an idempotent outcome); every other database error is logged and rethrown. One detector
/// per provider is registered; <see cref="UniqueViolations"/> asks all of them.
/// </summary>
public interface IUniqueViolationDetector
{
    /// <summary>Whether <paramref name="providerException"/> (the inner exception of a <c>DbUpdateException</c>) is a unique violation.</summary>
    bool IsUniqueViolation(Exception providerException);
}
