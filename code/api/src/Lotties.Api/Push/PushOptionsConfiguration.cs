using Lotties.Application.Push;
using Lotties.Infrastructure.Push;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Push;

/// <summary><see cref="IPushConfiguration"/> read from the validated <see cref="PushOptions"/> (section <c>Push</c>).</summary>
internal sealed class PushOptionsConfiguration(IOptions<PushOptions> options) : IPushConfiguration
{
    public bool IsEnabled => options.Value.IsEnabled;

    public string? PublicKey => IsEnabled ? options.Value.Vapid.PublicKey!.Trim() : null;

    public int MaxSubscriptionsPerUser => options.Value.MaxSubscriptionsPerUser;
}
