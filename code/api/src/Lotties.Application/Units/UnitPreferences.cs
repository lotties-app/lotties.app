using Lotties.Application.Users;
using Lotties.Domain.Units;

namespace Lotties.Application.Units;

/// <summary>
/// The unit system the current user wants answers told in (docs/design/37-measurement-units.md): her stored setting, and for
/// <c>auto</c> (or none stored) the system of the request's locale tag, metric when the adapter has none.
/// </summary>
public interface IUnitPreferences
{
    Task<UnitSystem> ResolveAsync(string? localeTag, CancellationToken cancellationToken = default);
}

internal sealed class UnitPreferences(ICurrentUser currentUser, IUserUnitSettingsRepository settings) : IUnitPreferences
{
    public async Task<UnitSystem> ResolveAsync(string? localeTag, CancellationToken cancellationToken = default)
    {
        var user = await currentUser.GetUserAsync(cancellationToken);
        var stored = await settings.FindAsync(user.Id, cancellationToken);
        return UnitSystems.Resolve(stored?.Setting ?? UnitSetting.Auto, localeTag);
    }
}
