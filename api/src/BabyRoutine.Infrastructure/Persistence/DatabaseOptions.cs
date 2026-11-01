using System.Text;
using Npgsql;

namespace BabyRoutine.Infrastructure.Persistence;

/// <summary>Database settings read from environment variables. Credentials are never hardcoded.</summary>
public sealed record DatabaseOptions(string Host, int Port, string Name, string User, string Password)
{
    /// <summary>Runtime (application user) settings: <c>DB_HOST</c>, <c>DB_PORT</c>, <c>DB_NAME</c>, <c>DB_APP_USER</c>, <c>DB_APP_PASSWORD</c>.</summary>
    public static DatabaseOptions FromEnvironment() => FromVariables(Environment.GetEnvironmentVariable);

    /// <summary>
    /// Migration settings: like <see cref="FromEnvironment"/> but with <c>DB_MIGRATOR_USER</c> and
    /// <c>DB_MIGRATOR_PASSWORD</c>, falling back to the <c>DB_APP_*</c> credentials when they are not set.
    /// </summary>
    public static DatabaseOptions ForMigratorFromEnvironment() => ForMigratorFromVariables(Environment.GetEnvironmentVariable);

    public static DatabaseOptions FromVariables(Func<string, string?> readVariable)
    {
        ArgumentNullException.ThrowIfNull(readVariable);
        return Build(readVariable, ReadOrEmpty(readVariable, "DB_APP_USER"), ReadOrEmpty(readVariable, "DB_APP_PASSWORD"));
    }

    public static DatabaseOptions ForMigratorFromVariables(Func<string, string?> readVariable)
    {
        ArgumentNullException.ThrowIfNull(readVariable);
        var useMigrator = !string.IsNullOrEmpty(readVariable("DB_MIGRATOR_USER"));
        return useMigrator
            ? Build(readVariable, ReadOrEmpty(readVariable, "DB_MIGRATOR_USER"), ReadOrEmpty(readVariable, "DB_MIGRATOR_PASSWORD"))
            : FromVariables(readVariable);
    }

    public string ToConnectionString() => new NpgsqlConnectionStringBuilder
    {
        Host = Host,
        Port = Port,
        Database = Name,
        Username = User,
        Password = Password,
    }.ConnectionString;

    private bool PrintMembers(StringBuilder builder)
    {
        builder.Append($"Host = {Host}, Port = {Port}, Name = {Name}, User = {User}, Password = ***");
        return true;
    }

    private static DatabaseOptions Build(Func<string, string?> readVariable, string user, string password) => new(
        Host: ReadOrDefault(readVariable, "DB_HOST", "localhost"),
        Port: int.TryParse(readVariable("DB_PORT"), out var port) ? port : 5432,
        Name: ReadOrDefault(readVariable, "DB_NAME", "babyroutine"),
        User: user,
        Password: password);

    private static string ReadOrDefault(Func<string, string?> readVariable, string name, string fallback)
    {
        var value = readVariable(name);
        return string.IsNullOrEmpty(value) ? fallback : value;
    }

    private static string ReadOrEmpty(Func<string, string?> readVariable, string name) => readVariable(name) ?? string.Empty;
}
