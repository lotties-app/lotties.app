using Lotties.Application.AddressLookup;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.AddressLookup;

public static class AddressLookupServiceCollectionExtensions
{
    /// <summary>Name of the HTTP client every upstream call uses; the log category <c>System.Net.Http.HttpClient.AddressLookup</c> is set to <c>None</c> in appsettings.json (it would print the request URL, i.e. the typed text).</summary>
    public const string HttpClientName = "AddressLookup";

    /// <summary>
    /// Binds and validates (at startup) <see cref="AddressLookupOptions"/> from the <c>AddressLookup</c> section and registers
    /// the upstream directory (a singleton: it owns the caches and the Nominatim spacing) over the named HTTP client
    /// <c>AddressLookup</c> (response size capped, no cookies).
    /// </summary>
    public static IServiceCollection AddAddressLookup(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<AddressLookupOptions>().Bind(configuration.GetSection(AddressLookupOptions.SectionName)).ValidateOnStart();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<AddressLookupOptions>, AddressLookupOptionsValidator>());
        services.TryAddSingleton(TimeProvider.System);
        services.AddHttpClient(HttpClientName, client => client.MaxResponseContentBufferSize = HttpAddressDirectory.MaxResponseBufferBytes)
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { UseCookies = false, AllowAutoRedirect = false });
        services.TryAddSingleton<IAddressDirectory, HttpAddressDirectory>();
        return services;
    }
}
