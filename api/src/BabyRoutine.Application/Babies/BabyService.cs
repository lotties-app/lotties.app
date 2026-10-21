using BabyRoutine.Application.Users;
using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Users;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Babies;

internal sealed class BabyService : IBabyService
{
    private readonly IBabyRepository _babies;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<BabyService> _logger;

    public BabyService(IBabyRepository babies, ICurrentUser currentUser, TimeProvider timeProvider, ILogger<BabyService> logger)
    {
        _babies = babies ?? throw new ArgumentNullException(nameof(babies));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IReadOnlyList<BabyResponse>> ListAsync(CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var babies = await _babies.ListForUserAsync(user.Id, cancellationToken);
        return babies.Select(baby => ToResponse(baby, user)).ToArray();
    }

    public async Task<BabyResponse> CreateAsync(SaveBabyRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var baby = Baby.Create(request.Name, request.BirthDate, user.Id, _timeProvider.GetUtcNow());
        await _babies.AddAsync(baby, cancellationToken);
        _logger.LogInformation("User {UserId} created baby {BabyId}", user.Id, baby.Id);
        return ToResponse(baby, user);
    }

    public async Task<BabyResponse> GetAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        return ToResponse(await LoadAsync(babyId, cancellationToken), user);
    }

    public async Task<BabyResponse> UpdateAsync(Guid babyId, SaveBabyRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var baby = await LoadAsync(babyId, cancellationToken);
        baby.UpdateDetails(request.Name, request.BirthDate, _timeProvider.GetUtcNow());
        await _babies.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("User {UserId} updated baby {BabyId}", user.Id, baby.Id);
        return ToResponse(baby, user);
    }

    private async Task<Baby> LoadAsync(Guid babyId, CancellationToken cancellationToken) =>
        await _babies.FindAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);

    private static BabyResponse ToResponse(Baby baby, User user)
    {
        var member = baby.FindMember(user.Id) ?? throw new MemberNotFoundException(baby.Id, user.Id);
        return BabyResponse.For(baby, member.Role);
    }
}
