using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <remarks>
/// Keyed by <c>(baby_id, user_id)</c> and tied to the membership through the <c>baby_members</c> alternate key on the
/// same columns with ON DELETE CASCADE: removing or leaving a baby deletes the member's preferences in the database.
/// The filtered <c>baby_id</c> index lists the scheduler's candidate babies (a kind is on; appointment reminders are on
/// by default, so the scheduler also checks for an upcoming appointment before planning them).
/// </remarks>
internal sealed class BabyNotificationPreferencesConfiguration : IEntityTypeConfiguration<BabyNotificationPreferences>
{
    public const string WantsAnyFilter = "dose_due OR nap_window OR belly_pain_pattern OR overtired_warning OR fussy_pattern OR diaper_wet_headsup OR diaper_dirty_headsup OR appointment_reminders";

    public void Configure(EntityTypeBuilder<BabyNotificationPreferences> builder)
    {
        builder.ToTable("baby_notification_preferences");
        builder.HasKey(preferences => new { preferences.BabyId, preferences.UserId });
        builder.Property(preferences => preferences.DoseDue).IsRequired();
        builder.Property(preferences => preferences.DoseLeadMinutes).IsRequired();
        builder.Property(preferences => preferences.NapWindow).IsRequired();
        builder.Property(preferences => preferences.NapLeadMinutes).IsRequired();
        builder.Property(preferences => preferences.BellyPainPattern).IsRequired();
        builder.Property(preferences => preferences.OvertiredWarning).IsRequired();
        builder.Property(preferences => preferences.FussyPattern).IsRequired();
        builder.Property(preferences => preferences.DiaperWetHeadsUp).HasColumnName("diaper_wet_headsup").IsRequired();
        builder.Property(preferences => preferences.DiaperDirtyHeadsUp).HasColumnName("diaper_dirty_headsup").IsRequired();

        // On by default (rows stored before the column existed get TRUE). The sentinel `true` makes EF leave a `true`
        // to the database default and always write a `false`, so the default never overrides a member's choice.
        builder.Property(preferences => preferences.AppointmentReminders).HasDefaultValue(true).HasSentinel(true).IsRequired();
        builder.Property(preferences => preferences.UpdatedAt).IsRequired();
        builder.Ignore(preferences => preferences.Preferences);
        builder.HasIndex(preferences => preferences.BabyId).HasFilter(WantsAnyFilter);
        builder.HasOne<BabyMember>()
            .WithMany()
            .HasForeignKey(preferences => new { preferences.BabyId, preferences.UserId })
            .HasPrincipalKey(member => new { member.BabyId, member.UserId })
            .OnDelete(DeleteBehavior.Cascade);
    }
}
