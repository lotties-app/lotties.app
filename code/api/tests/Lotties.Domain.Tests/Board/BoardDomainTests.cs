using Lotties.Domain.Board;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Board;

public sealed class BoardDomainTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 24, 12, 0, 0, TimeSpan.Zero);
    private static readonly BoardActor Owner = BoardActor.ForUser(Guid.NewGuid(), "Owner");

    [Fact]
    public void Secret_HasTheScannerFriendlyFormat_AndIsNeverRepeated()
    {
        var secrets = Enumerable.Range(0, 50).Select(_ => BoardKeySecret.Generate()).ToArray();

        Assert.All(secrets, secret => Assert.Matches("^lbk_[A-Za-z0-9_-]{43}$", secret));
        Assert.All(secrets, secret => Assert.True(BoardKeySecret.IsWellFormed(secret)));
        Assert.Equal(secrets.Length, secrets.Distinct(StringComparer.Ordinal).Count());
        Assert.False(BoardKeySecret.IsWellFormed("lbk_" + new string('a', 42)));
        Assert.False(BoardKeySecret.IsWellFormed("xyz_" + new string('a', 43)));
    }

    [Fact]
    public void Key_StoresOnlyTheHashAndPrefix_AndMatchesOnlyItsSecret()
    {
        var (key, secret) = BoardApiKey.Create("Claude", BoardKeyScope.Write, ["product"], null, Owner, Now);

        Assert.Equal(BoardKeySecret.HashOf(secret), key.KeyHash);
        Assert.Equal(64, key.KeyHash.Length);
        Assert.Equal(secret[..12], key.Prefix);
        Assert.DoesNotContain(secret, key.KeyHash, StringComparison.Ordinal);
        Assert.True(key.Matches(secret));
        Assert.False(key.Matches(BoardKeySecret.Generate()));
        Assert.Equal(["product"], key.AllowedTopics);
        Assert.True(key.AllowsTopic("product"));
        Assert.False(key.AllowsTopic("privacy-legal"));
    }

    [Fact]
    public void Key_Activity_ExpiryRevocationAndUseRecording()
    {
        var (key, _) = BoardApiKey.Create("Temp", BoardKeyScope.Read, null, Now.AddDays(1), Owner, Now);

        Assert.True(key.IsActive(Now));
        Assert.False(key.IsActive(Now.AddDays(2)));
        Assert.True(key.ShouldRecordUse(Now));
        Assert.True(key.Revoke(Now));
        Assert.False(key.Revoke(Now));
        Assert.False(key.IsActive(Now));
        Assert.Throws<DomainValidationException>(() => BoardApiKey.Create("Past", BoardKeyScope.Read, null, Now.AddMinutes(-1), Owner, Now));
        Assert.Throws<InvalidOperationException>(() => BoardApiKey.Create("By a key", BoardKeyScope.Read, null, null, BoardActor.ForKey(Guid.NewGuid(), "Key"), Now));
    }

    [Fact]
    public void Labels_AreNormalizedDistinctAndBounded()
    {
        var labels = BoardLabels.Create([" API ", "api", "keycloak:roles", "v1.2/x_y-z"]);

        Assert.Equal(["api", "keycloak:roles", "v1.2/x_y-z"], labels.Values);
        Assert.Equal(",api,keycloak:roles,v1.2/x_y-z,", labels.ToStorage());
        Assert.Equal(labels, BoardLabels.FromStorage(labels.ToStorage()));
        Assert.Throws<DomainValidationException>(() => BoardLabels.Create(["with,comma"]));
        Assert.Throws<DomainValidationException>(() => BoardLabels.Create([new string('a', 41)]));
        Assert.Throws<DomainValidationException>(() => BoardLabels.Create(Enumerable.Range(0, 11).Select(index => $"l{index}")));
    }

    [Fact]
    public void Item_ClosingSetsClosedAt_ReopeningClearsIt_AndEveryWriteBumpsTheVersion()
    {
        var (item, created) = BoardItem.Create(Guid.NewGuid(), Content("Task"), null, Owner, Now);

        var closed = item.Edit(Content("Task", BoardItemStatus.Done), Owner, Now.AddMinutes(1));
        var stillClosed = item.Edit(Content("Task renamed", BoardItemStatus.Dropped), Owner, Now.AddMinutes(2));
        var closedAt = item.ClosedAt;
        var reopened = item.Edit(Content("Task renamed", BoardItemStatus.Open), Owner, Now.AddMinutes(3));
        var unchanged = item.Edit(Content("Task renamed", BoardItemStatus.Open), Owner, Now.AddMinutes(4));

        Assert.Equal(BoardEventKind.Created, created.Kind);
        Assert.Equal((BoardEventKind.StatusChanged, BoardEventKind.StatusChanged, BoardEventKind.StatusChanged), (closed!.Kind, stillClosed!.Kind, reopened!.Kind));
        Assert.Equal(Now.AddMinutes(1), closedAt);
        Assert.Null(item.ClosedAt);
        Assert.Null(unchanged);
        Assert.Equal(4, item.Version);
    }

    [Fact]
    public void Item_History_CutsLongTextsAndDeletedItemsRefuseEdits()
    {
        var (item, _) = BoardItem.Create(Guid.NewGuid(), Content("Body", body: new string('a', 1000)), null, Owner, Now);

        var entry = item.Edit(Content("Body", body: new string('b', 1000)), Owner, Now);
        item.Delete(Owner, Now);

        var change = Assert.Single(entry!.Changes);
        Assert.Equal("body", change.Field);
        Assert.Equal(200, change.From!.Length);
        Assert.EndsWith("…", change.To, StringComparison.Ordinal);
        Assert.Throws<BoardItemDeletedException>(() => item.Edit(Content("Other"), Owner, Now));
        Assert.Throws<BoardItemDeletedException>(() => item.Comment("hi", Owner, Now));
        Assert.Null(item.Delete(Owner, Now));
        Assert.NotNull(item.Restore(Owner, Now));
    }

    [Fact]
    public void Item_EnsureVersion_RefusesAStaleVersion()
    {
        var (item, _) = BoardItem.Create(Guid.NewGuid(), Content("Versioned"), null, Owner, Now);
        item.Edit(Content("Versioned twice"), Owner, Now);

        item.EnsureVersion(null);
        item.EnsureVersion(2);
        var stale = Assert.Throws<BoardVersionMismatchException>(() => item.EnsureVersion(1));

        Assert.Equal(2, stale.CurrentVersion);
    }

    [Fact]
    public void Content_TypeRules()
    {
        Assert.Throws<DomainValidationException>(() => Content("Pinned task", pinned: true));
        Assert.Throws<DomainValidationException>(() => Content("Task with a decision", decisionSummary: "No"));
        var memory = Content("Pinned memory", type: BoardItemType.Memory, pinned: true);
        var decision = Content("Decision", type: BoardItemType.Decision, decisionSummary: "Yes").WithDecisionTime(Now);

        Assert.True(memory.Pinned);
        Assert.Equal(Now, decision.DecidedAt);
    }

    [Fact]
    public void Links_OnlyAbsoluteHttpOrHttps()
    {
        Assert.Equal("https://lotties.app/x", BoardLink.Create("Lotties", "https://lotties.app/x").Url);
        Assert.Throws<DomainValidationException>(() => BoardLink.Create("JS", "javascript:alert(1)"));
        Assert.Throws<DomainValidationException>(() => BoardLink.Create("Relative", "/docs/36"));
        Assert.Throws<DomainValidationException>(() => BoardLink.Create("File", "file:///etc/passwd"));
        Assert.Throws<DomainValidationException>(() => BoardLinks.Create(Enumerable.Range(0, 11).Select(index => BoardLink.Create($"L{index}", $"https://example.com/{index}"))));
    }

    private static BoardItemContent Content(
        string title,
        BoardItemStatus status = BoardItemStatus.Open,
        string? body = null,
        BoardItemType type = BoardItemType.Task,
        bool pinned = false,
        string? decisionSummary = null) =>
        BoardItemContent.Create(type, "product", title, body, status, BoardSide.Both, BoardPriority.Normal, null, null, null, pinned, decisionSummary, null, null, null);
}
