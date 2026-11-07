namespace Lotties.Infrastructure.Stores;

/// <summary>
/// Configuration section <c>Stores</c> for sealing store descriptors (docs/design/47-bring-your-own-database.md section
/// 3.3). Off by default: with <see cref="Enabled"/> false nothing is registered and no key is needed. When on, the
/// key-encryption keys come from configuration only (environment variables such as
/// <c>Stores__KeyEncryptionKeys__k1</c> and <c>Stores__CurrentKeyId</c>, set from a Kubernetes Secret), never from the
/// database; each is base64 of 32 random bytes. Validated at startup by <see cref="StoreCredentialsOptionsValidator"/>.
/// </summary>
public sealed class StoreCredentialsOptions
{
    public const string SectionName = "Stores";

    /// <summary>AES-256: a key-encryption key is 32 bytes.</summary>
    public const int KeySizeBytes = 32;

    /// <summary>The feature flag of bring-your-own-database; false by default.</summary>
    public bool Enabled { get; set; }

    /// <summary>The id of the key every new seal or re-wrap uses; must be one of <see cref="KeyEncryptionKeys"/>.</summary>
    public string? CurrentKeyId { get; set; }

    /// <summary>
    /// Key id (lower-case letters, digits and dashes, at most 32) to base64 of 32 bytes. Keep a previous key here until
    /// every row has been re-wrapped with the current one. Secret: never logged.
    /// </summary>
    public Dictionary<string, string> KeyEncryptionKeys { get; set; } = new(StringComparer.Ordinal);

    public override string ToString() => $"{nameof(StoreCredentialsOptions)} {{ Enabled = {Enabled}, CurrentKeyId = {CurrentKeyId}, Keys = {KeyEncryptionKeys.Count} }}";
}
