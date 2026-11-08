using Lotties.Application.Stores;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores.Moves;

public static class StoreMoveServiceCollectionExtensions
{
    /// <summary>
    /// When <c>Stores:Enabled</c> is true: validates <see cref="StoreMoveOptions"/> (<c>Stores:Moves</c>) at startup and runs the move
    /// worker (<see cref="StoreMoveWorker"/>, task T7). When the flag is off or absent (the default) it registers nothing: no move can
    /// start, and nothing sweeps (an old copy left from before is deleted once the flag is on again).
    /// </summary>
    public static IServiceCollection AddStoreMoveWorker(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        if (!configuration.GetSection(StoreRoutingOptions.SectionName).GetValue<bool>(nameof(StoreRoutingOptions.Enabled)))
        {
            return services;
        }

        services.AddOptions<StoreMoveOptions>().ValidateOnStart();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<StoreMoveOptions>, StoreMoveOptionsValidator>());
        services.AddHostedService<StoreMoveWorker>();
        return services;
    }
}

/// <summary>Fails startup on <c>Stores:Moves</c> settings out of range (<see cref="StoreMoveOptions.Problems"/>).</summary>
internal sealed class StoreMoveOptionsValidator : IValidateOptions<StoreMoveOptions>
{
    public ValidateOptionsResult Validate(string? name, StoreMoveOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var problems = options.Problems();
        return problems.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(problems);
    }
}
