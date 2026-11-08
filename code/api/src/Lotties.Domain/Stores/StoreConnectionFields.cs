using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Stores;

/// <summary>
/// The database, user and password of a user's store, checked before any connection is built
/// (docs/design/47-bring-your-own-database.md section 3.2 step 1). The database and user name are printable ASCII without
/// whitespace and without the characters that could end a value or start another option in a connection string
/// (<c>; = ' " \</c>). The password may hold any character but a control character (real provider passwords contain
/// <c>=</c> and <c>;</c>): the connection string is built by <c>NpgsqlConnectionStringBuilder</c>, which quotes and escapes
/// every value, so no other option can be set through it. <see cref="ToString"/> never prints a value.
/// </summary>
public sealed class StoreConnectionFields
{
    /// <summary>Longest database or user name (the Postgres identifier limit, in bytes; ASCII only here).</summary>
    public const int MaxNameLength = 63;

    /// <summary>Longest password.</summary>
    public const int MaxPasswordLength = 128;

    private const string ForbiddenCharacters = ";='\"\\";

    private StoreConnectionFields(string database, string username, string password)
    {
        Database = database;
        Username = username;
        Password = password;
    }

    public string Database { get; }

    public string Username { get; }

    public string Password { get; }

    /// <summary>Checks every field or throws <see cref="StoreEndpointRejectedException"/> (<c>endpoint_invalid_field</c>, with the field name only).</summary>
    public static StoreConnectionFields Create(string? database, string? username, string? password) =>
        new(
            Checked("database", database, MaxNameLength, IsAllowedInName),
            Checked("username", username, MaxNameLength, IsAllowedInName),
            Checked("password", password, MaxPasswordLength, IsAllowedInPassword));

    /// <inheritdoc />
    public override string ToString() => nameof(StoreConnectionFields) + " { redacted }";

    private static string Checked(string field, string? value, int maxLength, Func<char, bool> isAllowed)
    {
        if (string.IsNullOrEmpty(value) || value.Length > maxLength || !value.All(isAllowed))
        {
            throw new StoreEndpointRejectedException(StoreEndpointFailure.InvalidField, field);
        }

        return value;
    }

    private static bool IsAllowedInName(char character) =>
        character is > ' ' and <= '~' && !ForbiddenCharacters.Contains(character, StringComparison.Ordinal);

    private static bool IsAllowedInPassword(char character) => !char.IsControl(character);
}
