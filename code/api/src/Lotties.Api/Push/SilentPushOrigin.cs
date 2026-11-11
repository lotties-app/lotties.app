using Lotties.Application.SilentPush;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Lotties.Api.Push;

/// <summary>
/// The registered device a request came from: the header <see cref="HeaderName"/> with the id <c>POST /push/devices</c>
/// returned (docs/design/37b-widget-silent-push.md section 4.2). Anything that is not a GUID is no device.
/// </summary>
internal sealed class HttpCurrentPushDevice(IHttpContextAccessor accessor) : ICurrentPushDevice
{
    public const string HeaderName = "Lotties-Push-Device";

    public Guid? DeviceId =>
        accessor.HttpContext?.Request.Headers[HeaderName].ToString() is { Length: > 0 } value && Guid.TryParse(value, out var id) && id != Guid.Empty
            ? id
            : null;
}

internal static class SilentPushOriginServiceCollectionExtensions
{
    /// <summary>Replaces the application's "no origin device" with the request header (needs <c>AddHttpContextAccessor()</c>).</summary>
    public static IServiceCollection AddSilentPushOrigin(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddHttpContextAccessor();
        services.Replace(ServiceDescriptor.Scoped<ICurrentPushDevice, HttpCurrentPushDevice>());
        return services;
    }
}
