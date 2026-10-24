using System.Net;
using System.Text.Json;
using Lotties.Api.Errors;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Exceptions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Tests.Errors;

/// <summary>
/// Problem responses and exception diagnostics stay as they were on ASP.NET Core 8 (docs/design/37-dotnet10-upgrade.md):
/// no <c>traceId</c> member in problem bodies, and exceptions an <see cref="IExceptionHandler"/> answered are still recorded.
/// </summary>
public sealed class ExceptionDiagnosticsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public void DomainExceptionAnsweredByTheHandler_IsStillRecorded()
    {
        var options = factory.Services.GetRequiredService<IOptions<ExceptionHandlerOptions>>().Value;
        var context = new ExceptionHandlerSuppressDiagnosticsContext
        {
            HttpContext = new DefaultHttpContext(),
            Exception = new DomainValidationException("name", "Name is required."),
            ExceptionHandledBy = ExceptionHandledType.ExceptionHandlerService,
        };

        Assert.NotNull(options.SuppressDiagnosticsCallback);
        Assert.False(options.SuppressDiagnosticsCallback(context));
    }

    [Fact]
    public async Task StatusCodeProblem_HasNoTraceId()
    {
        var response = await factory.CreateClient().GetAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(401, body.RootElement.GetProperty("status").GetInt32());
        Assert.False(body.RootElement.TryGetProperty(ProblemDetailsExtensions.TraceIdExtension, out _));
    }

    [Fact]
    public async Task DomainExceptionProblem_HasNoTraceId()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(baby.OwnerSubject).PutAsync($"/api/v1/babies/{baby.BabyId}/medications/{Guid.NewGuid()}", JsonContent("""{"name":"Coli\u0000dis","isUsual":false}"""));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.False(problem.TryGetProperty(ProblemDetailsExtensions.TraceIdExtension, out _));
    }

    private static StringContent JsonContent(string json) => new(json, System.Text.Encoding.UTF8, "application/json");
}
