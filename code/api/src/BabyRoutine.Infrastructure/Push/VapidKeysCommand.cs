namespace BabyRoutine.Infrastructure.Push;

/// <summary>
/// The <c>--generate-vapid-keys</c> startup switch: prints a new VAPID pair as env assignments to the given writer
/// (stdout) and tells the host to exit. Never writes a file. Wired into Program.cs by the Api host (task N4).
/// </summary>
public static class VapidKeysCommand
{
    public const string Switch = "--generate-vapid-keys";

    /// <summary>Runs the command when <paramref name="args"/> contains <see cref="Switch"/>; returns whether it ran.</summary>
    public static bool TryRun(IReadOnlyList<string> args, TextWriter output)
    {
        ArgumentNullException.ThrowIfNull(args);
        ArgumentNullException.ThrowIfNull(output);
        if (!args.Contains(Switch, StringComparer.Ordinal))
        {
            return false;
        }

        var pair = VapidKeys.Generate();
        output.WriteLine($"{PushEnvironmentVariables.PublicKey}={pair.PublicKey}");
        output.WriteLine($"{PushEnvironmentVariables.PrivateKey}={pair.PrivateKey}");
        return true;
    }
}
