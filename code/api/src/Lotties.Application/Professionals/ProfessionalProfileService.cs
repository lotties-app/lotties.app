using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Professionals;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Professionals;

/// <summary>The signed-in user's own professional profile (docs/design/16-doctor-access.md). Any user may declare one.</summary>
public interface IProfessionalProfileService
{
    /// <summary>The caller's profile; <see cref="ProfessionalProfileNotFoundException"/> when she has none.</summary>
    Task<ProfessionalProfileResponse> GetMineAsync(CancellationToken cancellationToken = default);

    /// <summary>Declares (201) or updates (200) the caller's profile. Never verifies it.</summary>
    Task<SaveProfessionalProfileResult> SaveMineAsync(SaveProfessionalProfileRequest request, CancellationToken cancellationToken = default);
}

/// <remarks>Two first saves of one user resolve to one row: the loser applies its request as an update.</remarks>
internal sealed class ProfessionalProfileService : IProfessionalProfileService
{
    private readonly IProfessionalProfileRepository _profiles;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<ProfessionalProfileService> _logger;

    public ProfessionalProfileService(IProfessionalProfileRepository profiles, ICurrentUser currentUser, TimeProvider timeProvider, ILogger<ProfessionalProfileService> logger)
    {
        _profiles = profiles ?? throw new ArgumentNullException(nameof(profiles));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<ProfessionalProfileResponse> GetMineAsync(CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        return await _profiles.FindAsync(user.Id, cancellationToken) ?? throw new ProfessionalProfileNotFoundException(user.Id);
    }

    public async Task<SaveProfessionalProfileResult> SaveMineAsync(SaveProfessionalProfileRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var terms = (ProfessionalProfileTerms)request;
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var existing = await _profiles.FindAsync(user.Id, cancellationToken);
        return existing is null
            ? await DeclareAsync(user.Id, terms, cancellationToken)
            : await UpdateAsync(existing, terms, cancellationToken);
    }

    private async Task<SaveProfessionalProfileResult> DeclareAsync(Guid userId, ProfessionalProfileTerms terms, CancellationToken cancellationToken)
    {
        var declared = ProfessionalProfile.Declare(userId, terms, _timeProvider.GetUtcNow());
        if (await _profiles.TryAddAsync(declared, cancellationToken))
        {
            _logger.LogInformation("User {UserId} declared a {Kind} professional profile", userId, terms.Kind);
            return new SaveProfessionalProfileResult(declared, Created: true);
        }

        var winner = await _profiles.FindAsync(userId, cancellationToken)
            ?? throw new InvalidOperationException($"The professional profile of user {userId} was reported as existing but could not be loaded.");
        return await UpdateAsync(winner, terms, cancellationToken);
    }

    private async Task<SaveProfessionalProfileResult> UpdateAsync(ProfessionalProfile existing, ProfessionalProfileTerms terms, CancellationToken cancellationToken)
    {
        existing.Update(terms, _timeProvider.GetUtcNow());
        await _profiles.SaveChangesAsync(cancellationToken);
        return new SaveProfessionalProfileResult(existing, Created: false);
    }
}
