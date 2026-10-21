using Lotties.Infrastructure.Persistence;

namespace Lotties.Infrastructure.Tests.Persistence;

public sealed class DatabaseOptionsTests
{
    private static readonly Dictionary<string, string?> BaseVariables = new()
    {
        ["DB_HOST"] = "db.example.test",
        ["DB_PORT"] = "6543",
        ["DB_NAME"] = "baby_routine",
        ["DB_APP_USER"] = "app_user",
        ["DB_APP_PASSWORD"] = "app_secret",
    };

    [Fact]
    public void FromVariables_ReadsAppCredentials()
    {
        var options = DatabaseOptions.FromVariables(Reader(BaseVariables));

        Assert.Equal(new DatabaseOptions("db.example.test", 6543, "baby_routine", "app_user", "app_secret"), options);
    }

    [Fact]
    public void FromVariables_Missing_UsesDefaultsWithoutCredentials()
    {
        var options = DatabaseOptions.FromVariables(_ => null);

        Assert.Equal(new DatabaseOptions("localhost", 5432, "babyroutine", string.Empty, string.Empty), options);
    }

    [Fact]
    public void ForMigratorFromVariables_MigratorSet_UsesMigratorCredentials()
    {
        var variables = new Dictionary<string, string?>(BaseVariables)
        {
            ["DB_MIGRATOR_USER"] = "migrator",
            ["DB_MIGRATOR_PASSWORD"] = "migrator_secret",
        };

        var options = DatabaseOptions.ForMigratorFromVariables(Reader(variables));

        Assert.Equal(("migrator", "migrator_secret", "baby_routine"), (options.User, options.Password, options.Name));
    }

    [Fact]
    public void ForMigratorFromVariables_MigratorMissing_FallsBackToAppCredentials()
    {
        var variables = new Dictionary<string, string?>(BaseVariables) { ["DB_MIGRATOR_USER"] = string.Empty };

        var options = DatabaseOptions.ForMigratorFromVariables(Reader(variables));

        Assert.Equal(("app_user", "app_secret"), (options.User, options.Password));
    }

    [Fact]
    public void ToString_DoesNotRevealPassword()
    {
        var options = DatabaseOptions.FromVariables(Reader(BaseVariables));

        Assert.DoesNotContain("app_secret", options.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void ToConnectionString_ContainsDatabaseAndUser()
    {
        var connectionString = DatabaseOptions.FromVariables(Reader(BaseVariables)).ToConnectionString();

        Assert.Contains("Database=baby_routine", connectionString, StringComparison.Ordinal);
        Assert.Contains("Username=app_user", connectionString, StringComparison.Ordinal);
    }

    private static Func<string, string?> Reader(IReadOnlyDictionary<string, string?> variables) =>
        name => variables.GetValueOrDefault(name);
}
