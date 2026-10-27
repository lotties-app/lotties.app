using System.Text.Json.Nodes;
using Lotties.Domain.Consents;

namespace Lotties.Domain.Tests.Consents;

/// <summary>
/// The consent versions: the C# list mirrors the web's file (code/web/src/legal/consentVersions.json, linked into the test output), and
/// the accept-again rules. The web checks that the texts did not change without a new entry (consentVersions.test.ts).
/// </summary>
public sealed class ConsentVersionTests
{
    [Fact]
    public void Entries_MirrorTheWebFile_InOrder()
    {
        var web = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Consents", "consentVersions.json")))!["versions"]!.AsArray()
            .Select(node => new ConsentVersionEntry(
                node!["version"]!.GetValue<string>(),
                node["terms"]!.GetValue<string>(),
                node["privacyPolicy"]!.GetValue<string>(),
                node["material"]!.GetValue<bool>(),
                node["date"]!.GetValue<string>()))
            .ToArray();

        Assert.Equal(web, ConsentVersions.Entries);
    }

    [Fact]
    public void Entries_AreUniqueAndTheFirstIsMaterial()
    {
        Assert.Equal(ConsentVersions.Entries.Count, ConsentVersions.Entries.Select(entry => entry.Version).Distinct().Count());
        Assert.True(ConsentVersions.Entries[0].Material);
        Assert.Equal(ConsentVersions.Entries[^1], ConsentVersions.Current);
    }

    [Fact]
    public void RequiresAcceptance_NeverAcceptedOrUnknown_IsTrue()
    {
        Assert.True(ConsentVersions.RequiresAcceptance(null));
        Assert.True(ConsentVersions.RequiresAcceptance("1999-01-01.1"));
    }

    [Fact]
    public void RequiresAcceptance_Current_IsFalseAndHasNoMinorChange()
    {
        Assert.False(ConsentVersions.RequiresAcceptance(ConsentVersions.Current.Version));
        Assert.False(ConsentVersions.HasMinorChangeSince(ConsentVersions.Current.Version));
    }

    [Fact]
    public void MinorAndMaterialEntries_DecideWhetherToAskAgain()
    {
        ConsentVersionEntry[] entries =
        [
            new("v1", "1", "1", Material: true, Date: "2026-01-01"),
            new("v2", "1", "2", Material: false, Date: "2026-02-01"),
            new("v3", "2", "2", Material: false, Date: "2026-03-01"),
            new("v4", "2", "3", Material: true, Date: "2026-04-01"),
        ];

        Assert.False(ConsentVersions.RequiresAcceptance(entries, "v4"));
        Assert.True(ConsentVersions.RequiresAcceptance(entries, "v1"));
        Assert.True(ConsentVersions.RequiresAcceptance(entries, "v3"));
        Assert.True(ConsentVersions.RequiresAcceptance(entries, "v0"));
        Assert.False(ConsentVersions.RequiresAcceptance(entries.Take(3).ToArray(), "v1"));
        Assert.True(ConsentVersions.HasMinorChangeSince(entries.Take(3).ToArray(), "v1"));
        Assert.False(ConsentVersions.HasMinorChangeSince(entries.Take(3).ToArray(), "v3"));
        Assert.False(ConsentVersions.HasMinorChangeSince(entries, "v1"));
    }

    [Fact]
    public void UserConsent_Core_NeedsACapacityAndKeepsTheCleanLocale()
    {
        var now = new DateTimeOffset(2026, 10, 27, 12, 0, 0, TimeSpan.Zero);

        Assert.Throws<ArgumentException>(() => UserConsent.Grant(Guid.NewGuid(), ConsentKind.Core, "v", null, "en", now));
        var consent = UserConsent.Grant(Guid.NewGuid(), ConsentKind.Core, "v", ConsentCapacity.Guardian, "pt-BR", now);

        Assert.Equal(("pt-BR", ConsentCapacity.Guardian, true), (consent.Locale, consent.Capacity, consent.IsGranted));
        Assert.Equal(UserConsent.UnknownLocale, UserConsent.CleanLocale("a locale with spaces"));
        Assert.Equal(UserConsent.UnknownLocale, UserConsent.CleanLocale(new string('a', 40)));
        Assert.Equal(UserConsent.UnknownLocale, UserConsent.CleanLocale(null));
    }

    [Fact]
    public void UserConsent_Optional_WithdrawsOnceAndRegrants()
    {
        var now = new DateTimeOffset(2026, 10, 27, 12, 0, 0, TimeSpan.Zero);
        var consent = UserConsent.Grant(Guid.NewGuid(), ConsentKind.Push, "v", ConsentCapacity.Guardian, "en", now);

        Assert.Null(consent.Capacity);
        Assert.True(consent.Withdraw("v", now.AddHours(1)));
        Assert.False(consent.Withdraw("v", now.AddHours(2)));
        Assert.False(consent.IsGranted);
        consent.Regrant("v", null, "en", now.AddHours(3));
        Assert.True(consent.IsGranted);
    }

    [Fact]
    public void Kinds_AndCapacities_RoundTripTheirWireNames()
    {
        foreach (var kind in Enum.GetValues<ConsentKind>())
        {
            Assert.True(ConsentKinds.TryParse(ConsentKinds.NameOf(kind), out var parsed));
            Assert.Equal(kind, parsed);
        }

        foreach (var capacity in Enum.GetValues<ConsentCapacity>())
        {
            Assert.True(ConsentCapacities.TryParse(ConsentCapacities.NameOf(capacity), out var parsed));
            Assert.Equal(capacity, parsed);
        }

        Assert.False(ConsentKinds.TryParse("everything", out _));
        Assert.False(ConsentCapacities.TryParse(null, out _));
    }
}
