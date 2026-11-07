using System.Text.Json;
using Lotties.Domain.Babies;

namespace Lotties.Domain.Tests.Babies;

/// <summary>The Monday rule shared with the web port (code/web/src/baby/birthWeekVectors.json).</summary>
public sealed class BirthWeekTests
{
    [Fact]
    public void MondayOf_MatchesTheSharedVectors()
    {
        using var vectors = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Babies", "birthWeekVectors.json")));

        var cases = vectors.RootElement.GetProperty("monday").EnumerateArray().ToArray();

        Assert.NotEmpty(cases);
        foreach (var vector in cases)
        {
            Assert.Equal(DateOnly.Parse(vector.GetProperty("monday").GetString()!), BirthWeek.MondayOf(DateOnly.Parse(vector.GetProperty("date").GetString()!)));
        }
    }
}
