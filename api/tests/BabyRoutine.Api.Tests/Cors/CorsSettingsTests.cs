using BabyRoutine.Api.Cors;

namespace BabyRoutine.Api.Tests.Cors;

public sealed class CorsSettingsTests
{
    [Fact]
    public void Origins_CommaSeparated_AreTrimmedWithoutTrailingSlash()
    {
        var settings = new CorsSettings { AllowedOrigins = " http://localhost:5173 ,https://app.example.test/,, " };

        Assert.Equal(["http://localhost:5173", "https://app.example.test"], settings.Origins);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" , ")]
    public void Origins_NotConfigured_AreEmpty(string? allowedOrigins)
    {
        Assert.Empty(new CorsSettings { AllowedOrigins = allowedOrigins }.Origins);
    }
}
