namespace Lotties.Postgres.Tests.Support;

/// <summary>
/// A fact that needs a real Postgres: skipped, with the reason, where no container runtime is reachable
/// (<see cref="ContainerRuntime"/>). Pair it with <c>[Trait("Category", "Postgres")]</c> on the class.
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (ContainerRuntime.SkipReason is { } reason)
            Skip = reason;
    }
}
