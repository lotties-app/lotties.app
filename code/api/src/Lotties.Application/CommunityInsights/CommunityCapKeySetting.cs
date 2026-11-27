using System.Security.Cryptography;
using Lotties.Domain.CommunityInsights;

namespace Lotties.Application.CommunityInsights;

/// <summary>Why the configured cap key cannot be used (never the key or a part of it).</summary>
public enum CommunityCapKeyProblem
{
    None,
    Missing,
    NotBase64,
    TooShort,
}

/// <summary>The configured cap key, or why there is none.</summary>
public sealed record CommunityCapKeyReading(CommunityCapKey? Key, CommunityCapKeyProblem Problem);

/// <summary>
/// Reads <c>CommunityAggregation:CapKey</c> (docs/design/34-community-insights.md section 5.3): base64 of at least
/// <see cref="CommunityCapKey.MinimumLength"/> bytes, supplied by the operator from a Kubernetes Secret and kept the same between
/// releases. Nothing is ever generated here: a missing or unusable key stops the run (fail closed). The decoded bytes are wiped once
/// the key holds its own copy.
/// </summary>
public static class CommunityCapKeySetting
{
    public static CommunityCapKeyReading Read(string? configured)
    {
        var text = configured?.Trim();
        if (string.IsNullOrEmpty(text))
        {
            return new CommunityCapKeyReading(null, CommunityCapKeyProblem.Missing);
        }

        var buffer = new byte[(text.Length * 3 / 4) + 3];
        try
        {
            return Convert.TryFromBase64String(text, buffer, out var length) ? KeyOf(buffer.AsSpan(0, length)) : new CommunityCapKeyReading(null, CommunityCapKeyProblem.NotBase64);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(buffer);
        }
    }

    private static CommunityCapKeyReading KeyOf(ReadOnlySpan<byte> secret) =>
        secret.Length < CommunityCapKey.MinimumLength
            ? new CommunityCapKeyReading(null, CommunityCapKeyProblem.TooShort)
            : new CommunityCapKeyReading(CommunityCapKey.From(secret), CommunityCapKeyProblem.None);
}
