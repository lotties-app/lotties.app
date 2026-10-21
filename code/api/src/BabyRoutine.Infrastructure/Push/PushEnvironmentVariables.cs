namespace BabyRoutine.Infrastructure.Push;

/// <summary>
/// The flat environment variables holding the VAPID secrets and the configuration keys they map to. The Api host adds
/// <see cref="VariableToKey"/> to its environment aliases (task N4).
/// </summary>
public static class PushEnvironmentVariables
{
    public const string PublicKey = "PUSH_VAPID_PUBLIC_KEY";
    public const string PrivateKey = "PUSH_VAPID_PRIVATE_KEY";
    public const string Subject = "PUSH_VAPID_SUBJECT";

    public static readonly IReadOnlyDictionary<string, string> VariableToKey = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [PublicKey] = $"{PushOptions.SectionName}:Vapid:PublicKey",
        [PrivateKey] = $"{PushOptions.SectionName}:Vapid:PrivateKey",
        [Subject] = $"{PushOptions.SectionName}:Vapid:Subject",
    };
}
