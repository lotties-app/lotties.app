using Lotties.Domain.EventTypes;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using static Lotties.Api.Tests.Notifications.SchedulerTestHost;

namespace Lotties.Api.Tests.Notifications;

/// <summary>
/// Reminders carry a baby's data (docs/design/38-consent-and-terms.md): a person without a current core consent gets none, and gets
/// them again once she accepts. The scheduler host grants every new user a consent by default, like the rest of the suite.
/// </summary>
public sealed class ReminderConsentDispatchTests : IDisposable
{
    private readonly SchedulerTestHost _host = new();

    public void Dispose() => _host.Dispose();

    private async Task<Family> SeedWetDiapersAsync()
    {
        var family = await _host.SeedFamilyAsync();
        await _host.SeedSettingsAsync(family.OwnerId, "America/Sao_Paulo");
        await _host.SeedPreferencesAsync(family.BabyId, family.OwnerId, doseDue: false, diaperWet: true, diaperDirty: false);
        await _host.SeedSubscriptionAsync(family.OwnerId);
        foreach (var index in Enumerable.Range(0, 16))
        {
            await _host.SeedEventAsync(family.BabyId, family.OwnerId, BuiltInEventTypes.DiaperId, SaoPaulo(13).AddHours(-3 * index), """{"content":"WET"}""");
        }

        return family;
    }

    [Fact]
    public async Task RunOnceAsync_OwnerWithoutConsent_GetsNoReminder()
    {
        var family = await SeedWetDiapersAsync();
        await _host.Factory.QueryAsync(async (LottiesDbContext context) => await context.UserConsents.Where(row => row.UserId == family.OwnerId).ExecuteDeleteAsync());

        var result = await _host.RunAsync(SaoPaulo(15, 50));

        Assert.Empty(_host.Sender.Sent);
        Assert.Equal(0, result.Sent);
        Assert.Empty(await _host.DeliveriesAsync());
    }

    [Fact]
    public async Task RunOnceAsync_OwnerWithConsent_GetsTheReminder()
    {
        await SeedWetDiapersAsync();

        var result = await _host.RunAsync(SaoPaulo(15, 50));

        Assert.Equal(1, result.Sent);
        Assert.Single(_host.Sender.Sent);
    }
}
