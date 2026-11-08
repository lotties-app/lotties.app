using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The connection pools this process keeps for families' own databases (section <c>Stores:DataSources</c>, e.g. env
/// <c>Stores__DataSources__IdleMinutes=10</c>; docs/design/47-bring-your-own-database.md section 3.2 step 6). One pool per store;
/// a pool nobody used for <see cref="IdleMinutes"/> is closed (which also lets a paused free database sleep), and past
/// <see cref="MaxCount"/> live pools the least recently used one is closed. Read only while <c>Stores:Enabled</c> is on.
/// </summary>
public sealed class ExternalDataStoreOptions
{
    public const string SectionName = "Stores:DataSources";

    /// <summary>Most live store pools in this process (1 to 1000).</summary>
    public int MaxCount { get; set; } = 50;

    /// <summary>Minutes without use after which a store's pool is closed (1 to 1440).</summary>
    public int IdleMinutes { get; set; } = 10;
}

/// <summary>Fails startup on a value out of range.</summary>
internal sealed class ExternalDataStoreOptionsValidator : IValidateOptions<ExternalDataStoreOptions>
{
    public ValidateOptionsResult Validate(string? name, ExternalDataStoreOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = new[]
        {
            Check(options.MaxCount is >= 1 and <= 1000, nameof(options.MaxCount), "1 to 1000"),
            Check(options.IdleMinutes is >= 1 and <= 1440, nameof(options.IdleMinutes), "1 to 1440"),
        }.OfType<string>().ToArray();
        return failures.Length == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static string? Check(bool valid, string property, string range) =>
        valid ? null : $"{ExternalDataStoreOptions.SectionName}:{property} must be from {range}.";
}
