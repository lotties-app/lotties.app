namespace Lotties.Postgres.Tests.Support;

/// <summary>
/// Decides once per test run whether the Postgres container tests run, so they report skipped (never failed) where
/// there is no usable container runtime. LOTTIES_POSTGRES_TESTS picks the mode:
/// <list type="bullet">
/// <item><c>skip</c>: always skipped.</item>
/// <item><c>run</c>: always run (they fail loudly if Testcontainers cannot start a container).</item>
/// <item>unset (auto): run only on Linux with DOCKER_HOST set or a Docker/Podman socket present (CI's ubuntu runners);
/// skipped on Windows and macOS. The dev machine is Windows with a Podman engine behind a Docker-compatible pipe that
/// cannot start bridge-networked containers and runs other projects' containers, so Testcontainers must never reach it
/// unless someone opts in.</item>
/// </list>
/// </summary>
public static class ContainerRuntime
{
    public const string ModeVariable = "LOTTIES_POSTGRES_TESTS";

    private static readonly Lazy<string?> LazySkipReason = new(DetectSkipReason);

    /// <summary>Null when the tests should run; otherwise the reason they are skipped.</summary>
    public static string? SkipReason => LazySkipReason.Value;

    public static bool IsAvailable => SkipReason is null;

    private static string? DetectSkipReason()
    {
        var mode = Environment.GetEnvironmentVariable(ModeVariable)?.Trim().ToLowerInvariant();
        if (mode == "skip")
            return $"Postgres container tests turned off ({ModeVariable}=skip).";
        if (mode == "run")
            return null;
        if (!OperatingSystem.IsLinux())
            return $"Postgres container tests run only on Linux by default (CI); set {ModeVariable}=run to run them here.";
        if (HasDockerHost() || LinuxSockets().Any(File.Exists))
            return null;
        return $"No container runtime found (no DOCKER_HOST, no Docker/Podman socket): Postgres container tests skipped; set {ModeVariable}=run to force them.";
    }

    private static bool HasDockerHost() =>
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("DOCKER_HOST"));

    private static IEnumerable<string> LinuxSockets()
    {
        yield return "/var/run/docker.sock";
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        yield return Path.Combine(home, ".docker", "run", "docker.sock");
        yield return Path.Combine(home, ".docker", "desktop", "docker.sock");
        var runtimeDir = Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR");
        if (string.IsNullOrEmpty(runtimeDir))
            yield break;
        yield return Path.Combine(runtimeDir, "docker.sock");
        yield return Path.Combine(runtimeDir, "podman", "podman.sock");
    }
}
