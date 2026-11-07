namespace Lotties.Application.Demo;

/// <summary>
/// The try-it demo settings (section <c>Demo</c>, env <c>Demo__SigningKey</c> ...; docs/design/45-try-it-demo.md section 3).
/// The demo is off while <see cref="SigningKey"/> is blank.
/// </summary>
public sealed class DemoOptions
{
    public const string SectionName = "Demo";

    /// <summary>The shortest signing key, in bytes (HS256).</summary>
    public const int MinSigningKeyBytes = 32;

    /// <summary>Secret that signs the demo tokens; a deployment secret, never committed. Blank switches the demo off.</summary>
    public string? SigningKey { get; set; }

    /// <summary>Days a demo account lives before it is deleted (default 3).</summary>
    public int LifetimeDays { get; set; } = 3;

    /// <summary>Most demo accounts alive at once; over it a start answers 503 <c>demo_capacity</c> (default 200).</summary>
    public int MaxLiveAccounts { get; set; } = 200;

    /// <summary>Demo starts per remote address per hour (default 3).</summary>
    public int StartPermitsPerHour { get; set; } = 3;

    /// <summary>Minutes between cleanup runs (default 30; 0 or less never runs it).</summary>
    public int CleanupMinutes { get; set; } = 30;

    public bool IsEnabled => !string.IsNullOrWhiteSpace(SigningKey);

    public TimeSpan Lifetime => TimeSpan.FromDays(LifetimeDays);
}
