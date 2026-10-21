using BabyRoutine.Api.Errors;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Api.Limits;

/// <summary>
/// Enforces the request body size limit of the matched endpoint (<see cref="RequestLimitsOptions.MaxRequestBodyBytes"/>,
/// or <see cref="RequestLimitsOptions.ImportMaxRequestBodyBytes"/> for endpoints with
/// <see cref="ImportRequestLimitsMetadata"/>): a declared <c>Content-Length</c> above it is rejected before the body is
/// read, and the server limit is lowered to it so chunked bodies stop there too. Rejections are 413 problems with
/// <c>code</c> <see cref="ErrorCode"/> and extension <see cref="MaxBytesExtension"/>.
/// </summary>
internal sealed class RequestBodyLimitMiddleware(RequestDelegate next, IOptions<RequestLimitsOptions> options, IProblemDetailsService problemDetails, ILogger<RequestBodyLimitMiddleware> logger)
{
    public const string ErrorCode = "request_body_too_large";
    public const string MaxBytesExtension = "maxBytes";

    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var limit = LimitFor(context.GetEndpoint());
        if (context.Request.ContentLength > limit)
        {
            await RejectAsync(context, limit);
            return;
        }

        ApplyServerLimit(context, limit);
        try
        {
            await next(context);
        }
        catch (BadHttpRequestException exception) when (exception.StatusCode == StatusCodes.Status413PayloadTooLarge && !context.Response.HasStarted)
        {
            await RejectAsync(context, limit);
        }
    }

    private long LimitFor(Endpoint? endpoint) =>
        endpoint?.Metadata.GetMetadata<ImportRequestLimitsMetadata>() is null
            ? options.Value.MaxRequestBodyBytes
            : options.Value.ImportMaxRequestBodyBytes;

    private static void ApplyServerLimit(HttpContext context, long limit)
    {
        var feature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (feature is { IsReadOnly: false })
        {
            feature.MaxRequestBodySize = limit;
        }
    }

    private async Task RejectAsync(HttpContext context, long limit)
    {
        logger.LogInformation("Request body for {Endpoint} rejected: larger than {MaxBytes} bytes", context.GetEndpoint()?.DisplayName, limit);
        context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status413PayloadTooLarge,
            Detail = $"The request body must be at most {limit} bytes.",
        };
        problem.Extensions[DomainExceptionHandler.CodeExtension] = ErrorCode;
        problem.Extensions[MaxBytesExtension] = limit;
        await problemDetails.WriteAsync(new ProblemDetailsContext { HttpContext = context, ProblemDetails = problem });
    }
}
