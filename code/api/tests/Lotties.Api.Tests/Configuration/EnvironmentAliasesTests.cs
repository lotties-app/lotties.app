using Lotties.Api.Configuration;
using Microsoft.Extensions.Configuration;

namespace Lotties.Api.Tests.Configuration;

public sealed class EnvironmentAliasesTests
{
    [Fact]
    public void AddEnvironmentAliases_SetVariables_MapToConfigurationKeys()
    {
        var variables = new Dictionary<string, string>
        {
            ["AUTH_AUTHORITY"] = "https://issuer.example.test/",
            ["AUTH_AUDIENCE"] = "api",
            ["CORS_ALLOWED_ORIGINS"] = "http://localhost:5173",
        };

        var configuration = new ConfigurationBuilder().AddEnvironmentAliases(variables.GetValueOrDefault).Build();

        Assert.Equal("https://issuer.example.test/", configuration["Auth:Authority"]);
        Assert.Equal("api", configuration["Auth:Audience"]);
        Assert.Equal("http://localhost:5173", configuration["Cors:AllowedOrigins"]);
    }

    [Fact]
    public void AddEnvironmentAliases_PushVapidVariables_MapToPushSection()
    {
        var variables = new Dictionary<string, string>
        {
            ["PUSH_VAPID_PUBLIC_KEY"] = "public",
            ["PUSH_VAPID_PRIVATE_KEY"] = "private",
            ["PUSH_VAPID_SUBJECT"] = "mailto:operator@example.test",
        };

        var configuration = new ConfigurationBuilder().AddEnvironmentAliases(variables.GetValueOrDefault).Build();

        Assert.Equal(
            ("public", "private", "mailto:operator@example.test"),
            (configuration["Push:Vapid:PublicKey"], configuration["Push:Vapid:PrivateKey"], configuration["Push:Vapid:Subject"]));
    }

    [Fact]
    public void AddEnvironmentAliases_AutoMigrateVariable_MapsToDatabaseSection()
    {
        var variables = new Dictionary<string, string> { ["DB_AUTO_MIGRATE"] = "true" };

        var configuration = new ConfigurationBuilder().AddEnvironmentAliases(variables.GetValueOrDefault).Build();

        Assert.Equal("true", configuration["Database:AutoMigrate"]);
    }

    [Fact]
    public void AddEnvironmentAliases_TrustedProxyNetworksVariable_MapsToForwardedHeadersSection()
    {
        var variables = new Dictionary<string, string> { ["FORWARDED_HEADERS_TRUSTED_NETWORKS"] = "10.42.0.0/16" };

        var configuration = new ConfigurationBuilder().AddEnvironmentAliases(variables.GetValueOrDefault).Build();

        Assert.Equal("10.42.0.0/16", configuration["ForwardedHeaders:TrustedNetworks"]);
    }

    [Fact]
    public void AddEnvironmentAliases_UnsetVariables_KeepEarlierValues()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection([KeyValuePair.Create<string, string?>("Auth:Audience", "from-appsettings")])
            .AddEnvironmentAliases(_ => null)
            .Build();

        Assert.Equal("from-appsettings", configuration["Auth:Audience"]);
    }
}
