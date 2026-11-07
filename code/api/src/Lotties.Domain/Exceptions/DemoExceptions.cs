namespace Lotties.Domain.Exceptions;

/// <summary>The route is not available inside a try-it demo account (docs/design/45-try-it-demo.md section 2).</summary>
public sealed class DemoNotAvailableException : DomainException
{
    public DemoNotAvailableException()
        : base("demo_not_available", "This is not available in the demo. Create an account to use it.")
    {
    }
}

/// <summary>The try-it demo is switched off on this server (no signing key configured).</summary>
public sealed class DemoDisabledException : DomainException
{
    public DemoDisabledException()
        : base("demo_disabled", "The demo is not available on this server.")
    {
    }
}

/// <summary>Too many live demo accounts; the visitor may try again later.</summary>
public sealed class DemoCapacityException : DomainException
{
    public DemoCapacityException()
        : base("demo_capacity", "The demo is busy right now. Try again in a few minutes.")
    {
    }
}
