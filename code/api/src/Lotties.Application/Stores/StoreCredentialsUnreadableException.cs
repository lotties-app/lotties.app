namespace Lotties.Application.Stores;

/// <summary>Why a sealed store descriptor could not be opened; safe to log (it carries no value of the descriptor).</summary>
public enum StoreCredentialsFailure
{
    /// <summary>The bytes are not a sealed descriptor (truncated, wrong magic, bad lengths).</summary>
    Malformed = 1,

    /// <summary>The format version is not one this build reads.</summary>
    UnsupportedVersion,

    /// <summary>The data key is wrapped by a key id that is not configured (removed too early, or never configured).</summary>
    UnknownKey,

    /// <summary>The wrapped key or the ciphertext does not authenticate: tampered, wrong key, or sealed for another row.</summary>
    AuthenticationFailed,

    /// <summary>It decrypted, but the content is not a valid descriptor.</summary>
    InvalidDescriptor,
}

/// <summary>
/// A sealed store descriptor cannot be opened. A server-side integrity problem, not a business rule, so it is not a
/// domain exception (it surfaces as a 500 if it ever reaches the HTTP layer). Its message names the
/// <see cref="Failure"/> only and it never wraps the underlying exception, whose text could echo descriptor content.
/// </summary>
public sealed class StoreCredentialsUnreadableException : Exception
{
    public StoreCredentialsUnreadableException(StoreCredentialsFailure failure)
        : base($"The sealed store descriptor cannot be opened ({failure}).")
    {
        Failure = failure;
    }

    public StoreCredentialsFailure Failure { get; }
}
