using BabyRoutine.Infrastructure.Persistence;
using BabyRoutine.Infrastructure.Persistence.AutoMigration;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace BabyRoutine.Infrastructure.Tests.Persistence;

public sealed class DatabaseMigrationSettingsTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("false")]
    [InlineData("FALSE")]
    [InlineData("0")]
    public void ParseAutoMigrate_MissingOrFalse_IsOff(string? value)
    {
        Assert.False(DatabaseMigrationSettings.ParseAutoMigrate(value));
    }

    [Theory]
    [InlineData("true")]
    [InlineData("True")]
    [InlineData(" TRUE ")]
    [InlineData("1")]
    public void ParseAutoMigrate_TrueOrOne_IsOn(string value)
    {
        Assert.True(DatabaseMigrationSettings.ParseAutoMigrate(value));
    }

    [Theory]
    [InlineData("yes")]
    [InlineData("on")]
    [InlineData("2")]
    public void ParseAutoMigrate_NotABoolean_FailsNamingTheVariable(string value)
    {
        var exception = Assert.Throws<FormatException>(() => DatabaseMigrationSettings.ParseAutoMigrate(value));

        Assert.Contains("DB_AUTO_MIGRATE", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void FromConfiguration_KeySet_ReadsFlagWithDefaultLockTimings()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection([KeyValuePair.Create<string, string?>("Database:AutoMigrate", "true")])
            .Build();

        var settings = DatabaseMigrationSettings.FromConfiguration(configuration);

        Assert.Equal(new DatabaseMigrationSettings(true, DatabaseMigrationSettings.DefaultLockTimeout, DatabaseMigrationSettings.DefaultLockPollInterval), settings);
    }

    [Fact]
    public void FromConfiguration_KeyMissing_IsOff()
    {
        var settings = DatabaseMigrationSettings.FromConfiguration(new ConfigurationBuilder().Build());

        Assert.False(settings.AutoMigrate);
    }

    [Fact]
    public void VariableToKey_MapsAutoMigrateVariable()
    {
        Assert.Equal("Database:AutoMigrate", DatabaseMigrationSettings.VariableToKey["DB_AUTO_MIGRATE"]);
    }

    [Fact]
    public void BuildConnectionString_UsesMigratorCredentialsUnpooled()
    {
        var options = new DatabaseOptions("db.example.test", 6543, "baby_routine", "migrator", "migrator_secret");

        var builder = new NpgsqlConnectionStringBuilder(NpgsqlMigrationSessionFactory.BuildConnectionString(options));

        Assert.Equal(
            ("db.example.test", 6543, "baby_routine", "migrator", false, NpgsqlMigrationSessionFactory.ApplicationName),
            (builder.Host, builder.Port, builder.Database, builder.Username, builder.Pooling, builder.ApplicationName));
    }

    [Fact]
    public void Target_DescribesDatabaseWithoutCredentials()
    {
        var factory = new NpgsqlMigrationSessionFactory(new DatabaseOptions("db.example.test", 6543, "baby_routine", "migrator", "migrator_secret"));

        Assert.Equal("'baby_routine' on db.example.test:6543", factory.Target);
    }
}
