using Microsoft.Extensions.Options;

namespace Lotties.Api.Limits;

/// <summary>Fails startup when a request limit is zero or negative.</summary>
internal sealed class RequestLimitsOptionsValidator : IValidateOptions<RequestLimitsOptions>
{
    public ValidateOptionsResult Validate(string? name, RequestLimitsOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var invalid = options.NonPositiveSettings();
        return invalid.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(invalid.Select(setting => $"{setting} must be positive."));
    }
}
