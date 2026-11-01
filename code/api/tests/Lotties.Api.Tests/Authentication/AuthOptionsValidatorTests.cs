using Lotties.Api.Authentication;
using Lotties.Api.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.Internal;

namespace Lotties.Api.Tests.Authentication;

public sealed class AuthOptionsValidatorTests
{
    [Theory]
    [InlineData("Development")]
    [InlineData(ApiEnvironments.Testing)]
    public void Validate_MissingSettingsInDevelopmentOrTesting_Succeeds(string environment)
    {
        var result = Validator(environment).Validate(null, new AuthOptions());

        Assert.True(result.Succeeded);
    }

    [Theory]
    [InlineData(null, "api")]
    [InlineData("https://issuer.example.test/", null)]
    [InlineData(" ", " ")]
    public void Validate_MissingSettingsInProduction_FailsWithMessage(string? authority, string? audience)
    {
        var result = Validator(Environments.Production).Validate(null, new AuthOptions { Authority = authority, Audience = audience });

        Assert.Contains(AuthOptionsValidator.MissingSettingsMessage, result.Failures!);
    }

    [Theory]
    [InlineData("issuer.example.test")]
    [InlineData("ftp://issuer.example.test")]
    public void Validate_AuthorityNotHttpUrl_Fails(string authority)
    {
        var result = Validator("Development").Validate(null, new AuthOptions { Authority = authority, Audience = "api" });

        Assert.Contains(AuthOptionsValidator.InvalidAuthorityMessage, result.Failures!);
    }

    [Fact]
    public void Validate_CompleteSettingsInProduction_Succeeds()
    {
        var options = new AuthOptions { Authority = "https://issuer.example.test/", Audience = "api" };

        Assert.True(Validator(Environments.Production).Validate(null, options).Succeeded);
    }

    private static AuthOptionsValidator Validator(string environment) =>
        new(new HostingEnvironment { EnvironmentName = environment });
}
