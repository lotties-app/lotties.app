using System.Globalization;
using System.Text.Json;
using Lotties.Domain.Rest;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <summary>Stores the work windows as camelCase JSON (jsonb on PostgreSQL, text on the SQLite test host).</summary>
internal static class RestConverters
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static readonly ValueConverter<IReadOnlyList<StoredWorkWindow>, string> WorkWindows =
        new(windows => ToJson(windows), json => FromJson(json));

    public static readonly ValueComparer<IReadOnlyList<StoredWorkWindow>> WorkWindowsComparer =
        new(
            (left, right) => left!.SequenceEqual(right!),
            list => list.Aggregate(0, (hash, item) => HashCode.Combine(hash, item)),
            list => list.ToList());

    private static string ToJson(IReadOnlyList<StoredWorkWindow> windows) =>
        JsonSerializer.Serialize(
            windows.Select(window => new Stored(window.Days, window.Start.ToString("HH:mm", CultureInfo.InvariantCulture), window.End.ToString("HH:mm", CultureInfo.InvariantCulture))),
            Json);

    private static IReadOnlyList<StoredWorkWindow> FromJson(string json) =>
        [.. (JsonSerializer.Deserialize<List<Stored>>(json, Json) ?? [])
            .Select(stored => new StoredWorkWindow(
                stored.Days,
                TimeOnly.ParseExact(stored.Start, "HH:mm", CultureInfo.InvariantCulture),
                TimeOnly.ParseExact(stored.End, "HH:mm", CultureInfo.InvariantCulture)))];

    private sealed record Stored(IReadOnlyList<int> Days, string Start, string End);
}

/// <remarks>
/// One row per user (migration <c>CaregiverRest</c>), created on the first <c>PUT /me/rest-settings</c>. A user-level
/// choice: it dies with the user row (cascade) and is erased with the account. Never in the backup or the sync.
/// </remarks>
internal sealed class UserRestSettingsConfiguration : IEntityTypeConfiguration<UserRestSettings>
{
    public void Configure(EntityTypeBuilder<UserRestSettings> builder)
    {
        builder.ToTable("user_rest_settings");
        builder.HasKey(settings => settings.UserId);
        builder.Property(settings => settings.UserId).ValueGeneratedNever();
        builder.Property(settings => settings.Enabled).IsRequired();
        builder.Property(settings => settings.TimeZone).HasMaxLength(64).IsRequired();
        builder.Property(settings => settings.WorkWindows)
            .HasConversion(RestConverters.WorkWindows, RestConverters.WorkWindowsComparer)
            .HasColumnType("jsonb")
            .IsRequired();
        builder.Property(settings => settings.NightStart).IsRequired();
        builder.Property(settings => settings.NightEnd).IsRequired();
        builder.Property(settings => settings.FallAsleepMinutes).IsRequired();
        builder.Property(settings => settings.WakeLeadMinutes).IsRequired();
        builder.Property(settings => settings.UpdatedAt).IsRequired();
        builder.HasOne<User>().WithOne().HasForeignKey<UserRestSettings>(settings => settings.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <remarks>One optional row per user and night (migration <c>CaregiverRest</c>): the moment she said she was up.</remarks>
internal sealed class UserRestMorningConfiguration : IEntityTypeConfiguration<UserRestMorning>
{
    public void Configure(EntityTypeBuilder<UserRestMorning> builder)
    {
        builder.ToTable("user_rest_mornings");
        builder.HasKey(morning => new { morning.UserId, morning.Night });
        builder.Property(morning => morning.UserId).ValueGeneratedNever();
        builder.Property(morning => morning.Night).IsRequired();
        builder.Property(morning => morning.UpAt).IsRequired();
        builder.HasOne<User>().WithMany().HasForeignKey(morning => morning.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
