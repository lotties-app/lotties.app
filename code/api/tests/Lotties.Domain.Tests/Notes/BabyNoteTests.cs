using Lotties.Domain.Exceptions;
using Lotties.Domain.Notes;

namespace Lotties.Domain.Tests.Notes;

/// <summary>Notes: terms, visibility, author-only writes and the sync rules (docs/design/16-doctor-access.md).</summary>
public sealed class BabyNoteTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly Guid AuthorId = Guid.NewGuid();
    private static readonly Guid OtherId = Guid.NewGuid();

    private static NoteTerms Terms(NoteVisibility visibility = NoteVisibility.Shared, string body = "Offer the bottle every 3 hours.", NoteKind kind = NoteKind.Note) =>
        NoteTerms.Create(kind, visibility, body);

    private static BabyNote Note(NoteVisibility visibility = NoteVisibility.Shared) =>
        BabyNote.Create(Guid.NewGuid(), BabyId, Terms(visibility), AuthorId, TestClock.Now, TestClock.Now.AddMinutes(-10));

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    [InlineData("a\0b")]
    public void Terms_InvalidBody_ThrowsNamingBody(string? body)
    {
        var error = Assert.Throws<DomainValidationException>(() => NoteTerms.Create(NoteKind.Note, NoteVisibility.Shared, body));

        Assert.Equal("body", error.Field);
    }

    [Fact]
    public void Terms_BodyLimits_TrimmedAndAtMost4000()
    {
        Assert.Equal("Hi\nthere", NoteTerms.Create(NoteKind.Note, NoteVisibility.Shared, "  Hi\nthere \n").Body);
        Assert.Equal(4000, NoteTerms.Create(NoteKind.Note, NoteVisibility.Shared, new string('x', 4000)).Body.Length);
        Assert.Throws<DomainValidationException>(() => NoteTerms.Create(NoteKind.Note, NoteVisibility.Shared, new string('x', 4001)));
    }

    [Fact]
    public void Create_KeepsAuthorKindVisibilityAndClientTime()
    {
        var note = BabyNote.Create(Guid.NewGuid(), BabyId, Terms(NoteVisibility.Private, kind: NoteKind.Recommendation), AuthorId, TestClock.Now, TestClock.Now.AddMinutes(-10));

        Assert.Equal((AuthorId, NoteKind.Recommendation, NoteVisibility.Private, false), (note.AuthorUserId, note.Kind, note.Visibility, note.IsDeleted));
        Assert.Equal((TestClock.Now, TestClock.Now.AddMinutes(-10)), (note.UpdatedAt, note.ClientUpdatedAt));
    }

    [Theory]
    [InlineData(NoteVisibility.Shared, true, true)]
    [InlineData(NoteVisibility.Private, true, false)]
    public void IsVisibleTo_AuthorAndOthers(NoteVisibility visibility, bool author, bool other)
    {
        var note = Note(visibility);

        Assert.Equal((author, other), (note.IsVisibleTo(AuthorId), note.IsVisibleTo(OtherId)));
    }

    [Fact]
    public void DecideUpsert_AnotherBaby_ThrowsMismatch()
    {
        Assert.Throws<NoteBabyMismatchException>(() => Note().DecideUpsert(Guid.NewGuid(), AuthorId, null, TestClock.Now));
    }

    [Fact]
    public void DecideUpsert_PrivateNoteOfSomeoneElse_IsNotRevealed()
    {
        Assert.Throws<NoteNotFoundException>(() => Note(NoteVisibility.Private).DecideUpsert(BabyId, OtherId, null, TestClock.Now));
    }

    [Fact]
    public void DecideUpsert_SharedNoteOfSomeoneElse_ThrowsNotOwned()
    {
        var error = Assert.Throws<NoteNotOwnedException>(() => Note().DecideUpsert(BabyId, OtherId, null, TestClock.Now));

        Assert.Equal("note_not_owned", error.Code);
    }

    [Fact]
    public void DecideUpsert_StaleDeletedAndCurrent()
    {
        var note = Note();

        Assert.Equal(NoteUpsertDecision.IgnoreStale, note.DecideUpsert(BabyId, AuthorId, TestClock.Now.AddMinutes(-11), TestClock.Now));
        Assert.Equal(NoteUpsertDecision.Apply, note.DecideUpsert(BabyId, AuthorId, TestClock.Now.AddMinutes(-10), TestClock.Now));
        Assert.Equal(NoteUpsertDecision.Apply, note.DecideUpsert(BabyId, AuthorId, null, TestClock.Now));
        note.SoftDelete(TestClock.Now);
        Assert.Equal(NoteUpsertDecision.IgnoreDeleted, note.DecideUpsert(BabyId, AuthorId, TestClock.Now.AddMinutes(1), TestClock.Now));
    }

    [Fact]
    public void Edit_SameTerms_ChangesNothing()
    {
        var note = Note();
        var before = (note.UpdatedAt, note.ClientUpdatedAt);

        note.Edit(Terms(), TestClock.Now.AddHours(1), TestClock.Now.AddHours(1));

        Assert.Equal(before, (note.UpdatedAt, note.ClientUpdatedAt));
    }

    [Fact]
    public void Edit_NewBody_StampsServerAndClientTimes()
    {
        var note = Note();

        note.Edit(Terms(body: "Changed"), TestClock.Now.AddHours(1), TestClock.Now.AddMinutes(50));

        Assert.Equal(("Changed", TestClock.Now.AddHours(1), TestClock.Now.AddMinutes(50)), (note.Body, note.UpdatedAt, note.ClientUpdatedAt));
    }

    [Fact]
    public void Edit_SharedToPrivate_IsRefusedAndPrivateToSharedAllowed()
    {
        var shared = Note();
        var hidden = Note(NoteVisibility.Private);

        var error = Assert.Throws<NoteAlreadySharedException>(() => shared.Edit(Terms(NoteVisibility.Private), TestClock.Now));
        hidden.Edit(Terms(NoteVisibility.Shared), TestClock.Now);

        Assert.Equal("note_already_shared", error.Code);
        Assert.Equal((NoteVisibility.Shared, NoteVisibility.Shared), (shared.Visibility, hidden.Visibility));
    }

    [Fact]
    public void DecideDelete_Rules()
    {
        Assert.True(Note().DecideDelete(BabyId, AuthorId));
        Assert.False(Note().DecideDelete(Guid.NewGuid(), AuthorId));
        Assert.False(Note(NoteVisibility.Private).DecideDelete(BabyId, OtherId));
        Assert.Throws<NoteNotOwnedException>(() => Note().DecideDelete(BabyId, OtherId));
    }

    [Fact]
    public void SoftDelete_StampsEveryTimeOnceAndIsIdempotent()
    {
        var note = Note();

        note.SoftDelete(TestClock.Now.AddHours(1));
        note.SoftDelete(TestClock.Now.AddHours(2));

        Assert.Equal((TestClock.Now.AddHours(1), TestClock.Now.AddHours(1), TestClock.Now.AddHours(1)), (note.DeletedAt!.Value, note.UpdatedAt, note.ClientUpdatedAt));
    }
}
