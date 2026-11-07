using Lotties.Domain.Users;

namespace Lotties.Domain.Tests.Users;

public sealed class RoleLabelTests
{
    [Theory]
    [InlineData(null, null)]
    [InlineData("  ", null)]
    [InlineData("MOTHER", "mother")]
    [InlineData("stepmother", "stepMother")]
    [InlineData(" Aunt Bea ", "Aunt Bea")]
    public void Normalize_PresetsBecomeCodesAndBlankIsNone(string? input, string? expected) =>
        Assert.Equal(expected, RoleLabels.Normalize(input));

    [Fact]
    public void UpdateProfile_AllowsAnEmptyNameWithALabel()
    {
        var user = User.Create("https://issuer", "sub", "Ana Souza", DateTimeOffset.UnixEpoch);

        user.UpdateProfile(" ", "mother");

        Assert.Equal((string.Empty, "mother"), (user.DisplayName, user.RoleLabel));
    }
}
