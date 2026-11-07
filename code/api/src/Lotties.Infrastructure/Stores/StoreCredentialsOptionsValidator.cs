using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// Fails startup on an unusable <see cref="StoreCredentialsOptions"/> while the feature is on: no current key id, a current
/// key id that is not configured, a malformed key id, or a key that is not base64 of exactly 32 bytes. Messages name key
/// ids only, never key material. With the feature off it accepts anything.
/// </summary>
internal sealed partial class StoreCredentialsOptionsValidator : IValidateOptions<StoreCredentialsOptions>
{
    private const string Section = StoreCredentialsOptions.SectionName;

    public ValidateOptionsResult Validate(string? name, StoreCredentialsOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (!options.Enabled)
        {
            return ValidateOptionsResult.Success;
        }

        var failures = CurrentKeyFailures(options)
            .Concat(options.KeyEncryptionKeys.SelectMany(KeyFailures))
            .ToArray();
        return failures.Length == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    /// <summary>Whether <paramref name="keyId"/> is a valid key id (also the limit the sealed format can store).</summary>
    public static bool IsValidKeyId(string keyId) => KeyIdPattern().IsMatch(keyId);

    /// <summary>Decodes a configured key, or null when it is not base64 of exactly <see cref="StoreCredentialsOptions.KeySizeBytes"/> bytes.</summary>
    public static byte[]? DecodeKey(string? value)
    {
        var buffer = new byte[StoreCredentialsOptions.KeySizeBytes + 3];
        var decoded = Convert.TryFromBase64String(value?.Trim() ?? string.Empty, buffer, out var written)
            && written == StoreCredentialsOptions.KeySizeBytes;
        return decoded ? buffer[..StoreCredentialsOptions.KeySizeBytes] : null;
    }

    private static IEnumerable<string> CurrentKeyFailures(StoreCredentialsOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.CurrentKeyId))
        {
            return [$"{Section}:CurrentKeyId is required when {Section}:Enabled is true."];
        }

        return options.KeyEncryptionKeys.ContainsKey(options.CurrentKeyId)
            ? []
            : [$"{Section}:CurrentKeyId '{SafeId(options.CurrentKeyId)}' must name one of {Section}:KeyEncryptionKeys."];
    }

    private static IEnumerable<string> KeyFailures(KeyValuePair<string, string> key)
    {
        if (!IsValidKeyId(key.Key))
        {
            return [$"{Section}:KeyEncryptionKeys has a key id that is not 1 to 32 lower-case letters, digits or dashes."];
        }

        return DecodeKey(key.Value) is null
            ? [$"{Section}:KeyEncryptionKeys:{key.Key} must be base64 of exactly {StoreCredentialsOptions.KeySizeBytes} bytes."]
            : [];
    }

    private static string SafeId(string keyId) => IsValidKeyId(keyId) ? keyId : "(invalid id)";

    [GeneratedRegex(@"^[a-z0-9][a-z0-9-]{0,31}\z")]
    private static partial Regex KeyIdPattern();
}
