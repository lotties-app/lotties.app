using Lotties.Domain.Exceptions;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace Lotties.Api.Errors;

/// <summary>
/// Writes a <see cref="DomainException"/> as an RFC 7807 problem: status from <see cref="DomainExceptionStatusCodes"/>,
/// <c>detail</c> = the exception message, extension <c>code</c> = <see cref="DomainException.Code"/> and, for
/// <see cref="DomainValidationException"/>, extension <c>field</c>; any <see cref="DomainException.Details"/> become extensions too. Other exceptions are left to the default handler (500).
/// </summary>
internal sealed class DomainExceptionHandler(IProblemDetailsService problemDetails, ILogger<DomainExceptionHandler> logger) : IExceptionHandler
{
    public const string CodeExtension = "code";
    public const string FieldExtension = "field";

    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not DomainException domainException)
        {
            return false;
        }

        var status = DomainExceptionStatusCodes.For(domainException);
        logger.LogInformation("Request rejected with {StatusCode}: {ErrorCode}", status, domainException.Code);
        httpContext.Response.StatusCode = status;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails = BuildProblem(domainException, status),
        });
    }

    private static ProblemDetails BuildProblem(DomainException exception, int status)
    {
        var problem = new ProblemDetails { Status = status, Detail = exception.Message };
        AddDetails(problem, exception);
        problem.Extensions[CodeExtension] = exception.Code;
        AddField(problem, exception);
        return problem;
    }

    private static void AddDetails(ProblemDetails problem, DomainException exception)
    {
        foreach (var detail in exception.Details)
        {
            problem.Extensions[detail.Key] = detail.Value;
        }
    }

    private static void AddField(ProblemDetails problem, DomainException exception)
    {
        if (exception is DomainValidationException validation)
        {
            problem.Extensions[FieldExtension] = validation.Field;
        }
    }
}
