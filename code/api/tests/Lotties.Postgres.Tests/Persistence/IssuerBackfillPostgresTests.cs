using Lotties.Application.Users;
using Lotties.Domain.Users;
using Lotties.Postgres.Tests.Support;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Lotties.Postgres.Tests.Persistence;

/// <summary>
/// The issuer backfill of legacy user rows (PLAN item 20; migration <c>Wave2Hardening</c>, REVIEW wave 2 finding 16) on a real
/// Postgres: users stored before issuers were recorded get the unknown issuer <c>''</c> and a display name that was an e-mail
/// becomes <c>Parent</c>; <c>(issuer, subject)</c> is unique; the first sign-in with the subject claims the row and records the
/// token issuer (<see cref="IUserProvisioningService"/>), and the same subject from another issuer is a different account.
/// </summary>
[Collection(PostgresCollection.Name)]
[Trait("Category", PostgresCollection.Category)]
public sealed class IssuerBackfillPostgresTests(PostgresFixture postgres)
{
    /// <summary>The last control migration before <c>Wave2Hardening</c> (users keyed by subject only).</summary>
    private const string BeforeIssuers = "20261021010818_EventClientUpdatedAt";

    private const string Issuer = "https://auth.example.test/realms/lotties";
    private const string OtherIssuer = "https://other.example.test/";
    private const string UniqueViolation = "23505";

    [PostgresFact]
    public async Task Legacy_rows_get_the_unknown_issuer_and_lose_an_email_display_name()
    {
        await using var world = await BuiltInWorld.CreateAsync(postgres, "issuerfill", BeforeIssuers);
        var withEmail = await InsertLegacyUserAsync(world, "legacy-email", "ana@example.test");
        var withName = await InsertLegacyUserAsync(world, "legacy-name", "Ana");

        await world.MigrateAsync();

        Assert.Equal(2L, await postgres.ScalarAsync<long>("SELECT count(*) FROM users WHERE issuer = ''", world.Database));
        Assert.Equal("Parent", await DisplayNameAsync(world, withEmail));
        Assert.Equal("Ana", await DisplayNameAsync(world, withName));
        Assert.True(await postgres.ScalarAsync<bool>(
            "SELECT indisunique FROM pg_index WHERE indexrelid = 'ix_users_issuer_subject'::regclass", world.Database));
        var duplicate = await Assert.ThrowsAsync<PostgresException>(() => postgres.ExecuteAsync(
            $"INSERT INTO users (id, issuer, subject, display_name, created_at) VALUES ('{Guid.NewGuid()}', '', 'legacy-name', 'Copy', now())",
            world.Database));
        Assert.Equal(UniqueViolation, duplicate.SqlState);
    }

    [PostgresFact]
    public async Task First_sign_in_claims_the_legacy_row_and_another_issuer_gets_its_own_account()
    {
        await using var world = await BuiltInWorld.CreateAsync(postgres, "issuerclaim", BeforeIssuers);
        var legacyId = await InsertLegacyUserAsync(world, "legacy-sub", "Ana");
        var untouchedId = await InsertLegacyUserAsync(world, "never-signed-in", "Bia");
        await world.MigrateAsync();

        var claimed = await SignInAsync(world, new ExternalIdentity(Issuer, "legacy-sub", "Ana"));
        var again = await SignInAsync(world, new ExternalIdentity(Issuer, "legacy-sub", "Ana"));
        var stranger = await SignInAsync(world, new ExternalIdentity(OtherIssuer, "legacy-sub", "Someone"));

        Assert.Equal(legacyId, claimed.Id);
        Assert.Equal(legacyId, again.Id);
        Assert.NotEqual(legacyId, stranger.Id);
        Assert.Equal(Issuer, await postgres.ScalarAsync<string>($"SELECT issuer FROM users WHERE id = '{legacyId}'", world.Database));
        Assert.Equal(OtherIssuer, await postgres.ScalarAsync<string>($"SELECT issuer FROM users WHERE id = '{stranger.Id}'", world.Database));
        Assert.Equal(string.Empty, await postgres.ScalarAsync<string>($"SELECT issuer FROM users WHERE id = '{untouchedId}'", world.Database));
        Assert.Equal(2L, await postgres.ScalarAsync<long>("SELECT count(*) FROM users WHERE subject = 'legacy-sub'", world.Database));
    }

    private static async Task<User> SignInAsync(BuiltInWorld world, ExternalIdentity identity)
    {
        await using var scope = world.Scope();
        return await scope.ServiceProvider.GetRequiredService<IUserProvisioningService>().EnsureUserAsync(identity);
    }

    /// <summary>A row as the schema before <c>Wave2Hardening</c> had it: no issuer column.</summary>
    private async Task<Guid> InsertLegacyUserAsync(BuiltInWorld world, string subject, string displayName)
    {
        var id = Guid.NewGuid();
        await postgres.ExecuteAsync(
            $"INSERT INTO users (id, subject, display_name, created_at) VALUES ('{id}', '{subject}', '{displayName}', '2026-10-01T12:00:00Z')",
            world.Database);
        return id;
    }

    private async Task<string?> DisplayNameAsync(BuiltInWorld world, Guid userId) =>
        await postgres.ScalarAsync<string>($"SELECT display_name FROM users WHERE id = '{userId}'", world.Database);
}
