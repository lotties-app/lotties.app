using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Support;

internal static class HttpAssertions
{
    /// <summary>Asserts a 2xx response and reads its JSON body as <typeparamref name="TBody"/>.</summary>
    public static async Task<TBody> ReadAsync<TBody>(this HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<TBody>())!;
    }

    /// <summary>Asserts an RFC 7807 problem with the given status and domain error code.</summary>
    public static async Task<JsonElement> AssertProblemAsync(this HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal((int)status, problem.GetProperty("status").GetInt32());
        Assert.Equal(code, problem.GetProperty(DomainExceptionHandler.CodeExtension).GetString());
        return problem;
    }

    public static Task<Guid> UserIdAsync(this ApiFactory factory, string subject) =>
        factory.QueryAsync(context => context.Users.Where(user => user.Subject == subject).Select(user => user.Id).SingleAsync());
}
