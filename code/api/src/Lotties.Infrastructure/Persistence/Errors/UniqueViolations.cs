using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Errors;

/// <summary>Tells whether a failed save was a unique-key violation, asking every registered <see cref="IUniqueViolationDetector"/>.</summary>
internal sealed class UniqueViolations(IEnumerable<IUniqueViolationDetector> detectors)
{
    private readonly IReadOnlyList<IUniqueViolationDetector> _detectors = detectors.ToArray();

    public bool IsUniqueViolation(DbUpdateException exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        return exception.InnerException is { } providerException
            && _detectors.Any(detector => detector.IsUniqueViolation(providerException));
    }
}
