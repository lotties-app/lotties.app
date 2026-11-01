using Lotties.Domain.Consents;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// Makes the test host grant a current core consent to every user it creates (docs/design/38-consent-and-terms.md), so the tests of
/// everything else keep passing against the consent gate without a line changed. It is a <c>SaveChanges</c> interceptor: when a
/// <see cref="User"/> row is added (provisioned on first request, or seeded through <see cref="ApiFactory.SeedAsync"/>) and no
/// consent row is added with it, a real core <see cref="UserConsent"/> (current version, declared capacity guardian) and its history
/// line are added in the same save. The consent tests opt out with <see cref="ApiFactory.GrantConsentToNewUsers"/> = <c>false</c>
/// (new users then have no record) or take a granted user's record away with <see cref="TestConsent.RevokeConsentAsync"/>.
/// </summary>
internal sealed class TestConsentGrant : SaveChangesInterceptor
{
    private volatile bool _enabled = true;

    /// <summary>Whether users created from now on get a core consent (on by default).</summary>
    public bool Enabled
    {
        get => _enabled;
        set => _enabled = value;
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Grant(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Grant(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private void Grant(DbContext? context)
    {
        if (!_enabled || context is null)
        {
            return;
        }

        var already = context.ChangeTracker.Entries<UserConsent>().Where(entry => entry.State == EntityState.Added).Select(entry => entry.Entity.UserId).ToHashSet();
        var created = context.ChangeTracker.Entries<User>().Where(entry => entry.State == EntityState.Added).Select(entry => entry.Entity.Id).Where(id => !already.Contains(id)).ToArray();
        foreach (var userId in created)
        {
            var now = DateTimeOffset.UtcNow;
            var consent = UserConsent.Grant(userId, ConsentKind.Core, ConsentVersions.Current.Version, ConsentCapacity.Guardian, "en", now);
            context.Add(consent);
            context.Add(UserConsentHistoryEntry.Of(consent, ConsentAction.Granted, now));
        }
    }
}

internal static class TestConsent
{
    /// <summary>Takes away every consent record of the user with this subject (as if she never accepted).</summary>
    public static async Task RevokeConsentAsync(this ApiFactory factory, string subject)
    {
        ArgumentNullException.ThrowIfNull(factory);
        var userId = await factory.UserIdAsync(subject);
        await factory.QueryAsync(async (LottiesDbContext context) =>
        {
            await context.UserConsents.Where(row => row.UserId == userId).ExecuteDeleteAsync();
            await context.UserConsentHistory.Where(row => row.UserId == userId).ExecuteDeleteAsync();
            return 0;
        });
    }

    /// <summary>Replaces the core consent of the user with this subject by one given under <paramref name="version"/> (an older version, for the tests of the gate).</summary>
    public static async Task SetCoreVersionAsync(this ApiFactory factory, string subject, string version)
    {
        ArgumentNullException.ThrowIfNull(factory);
        var userId = await factory.UserIdAsync(subject);
        await factory.QueryAsync(async (LottiesDbContext context) =>
        {
            await context.UserConsents.Where(row => row.UserId == userId && row.Kind == ConsentKind.Core)
                .ExecuteUpdateAsync(setters => setters.SetProperty(row => row.Version, version));
            return 0;
        });
    }
}
