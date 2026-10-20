using Npgsql;

namespace BabyRoutine.Infrastructure.Persistence;

/// <summary>Database settings read from environment variables. Credentials are never hardcoded.</summary>
public sealed record DatabaseOptions(string Host, int Port, string Name, string User, string Password)
{
    public static DatabaseOptions FromEnvironment() => new(
        Host: Environment.GetEnvironmentVariable("DB_HOST") ?? "localhost",
        Port: int.TryParse(Environment.GetEnvironmentVariable("DB_PORT"), out var port) ? port : 5432,
        Name: Environment.GetEnvironmentVariable("DB_NAME") ?? "babyroutine",
        User: Environment.GetEnvironmentVariable("DB_APP_USER") ?? string.Empty,
        Password: Environment.GetEnvironmentVariable("DB_APP_PASSWORD") ?? string.Empty);

    public string ToConnectionString() => new NpgsqlConnectionStringBuilder
    {
        Host = Host,
        Port = Port,
        Database = Name,
        Username = User,
        Password = Password,
    }.ConnectionString;
}
