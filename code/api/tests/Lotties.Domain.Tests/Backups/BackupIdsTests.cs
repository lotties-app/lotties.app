using Lotties.Domain.Babies;
using Lotties.Domain.Backups;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Backups;

public sealed class BackupIdsTests
{
    private static readonly Guid Importer = Guid.NewGuid();
    private static readonly Guid SourceBaby = Guid.NewGuid();
    private static readonly Guid SourceRecord = Guid.NewGuid();

    [Fact]
    public void Record_IntoTheBabyTheFileCameFrom_KeepsTheId()
    {
        Assert.Equal(SourceRecord, BackupIds.Record(SourceBaby, SourceBaby, "event", SourceRecord));
    }

    [Fact]
    public void Record_IntoAnotherBaby_IsDerivedAndStable()
    {
        var target = Guid.NewGuid();

        var first = BackupIds.Record(target, SourceBaby, "event", SourceRecord);

        Assert.NotEqual(SourceRecord, first);
        Assert.Equal(first, BackupIds.Record(target, SourceBaby, "event", SourceRecord));
    }

    [Fact]
    public void Record_DiffersByTargetKindAndSourceId()
    {
        var target = Guid.NewGuid();
        var ids = new[]
        {
            BackupIds.Record(target, SourceBaby, "event", SourceRecord),
            BackupIds.Record(Guid.NewGuid(), SourceBaby, "event", SourceRecord),
            BackupIds.Record(target, SourceBaby, "note", SourceRecord),
            BackupIds.Record(target, SourceBaby, "event", Guid.NewGuid()),
        };

        Assert.Equal(ids.Length, ids.Distinct().Count());
    }

    [Fact]
    public void RestoredBaby_IsTheSameForTheSameImporterAndFile_AndNotTheSourceBaby()
    {
        var restored = BackupIds.RestoredBaby(Importer, SourceBaby);

        Assert.Equal(restored, BackupIds.RestoredBaby(Importer, SourceBaby));
        Assert.NotEqual(SourceBaby, restored);
        Assert.NotEqual(restored, BackupIds.RestoredBaby(Guid.NewGuid(), SourceBaby));
        Assert.NotEqual(restored, BackupIds.RestoredBaby(Importer, Guid.NewGuid()));
    }

    [Fact]
    public void Author_IsStablePerBabyAndUser_AndDoesNotEchoTheUserId()
    {
        var user = Guid.NewGuid();

        var stand = BackupIds.Author(SourceBaby, user);

        Assert.Equal(stand, BackupIds.Author(SourceBaby, user));
        Assert.NotEqual(user, stand);
        Assert.NotEqual(stand, BackupIds.Author(Guid.NewGuid(), user));
        Assert.NotEqual(stand, BackupIds.Author(SourceBaby, Guid.NewGuid()));
    }

    [Fact]
    public void Record_WithoutAKind_Throws()
    {
        Assert.Throws<ArgumentException>(() => BackupIds.Record(Guid.NewGuid(), SourceBaby, string.Empty, SourceRecord));
    }

    [Fact]
    public void BabyCreate_WithAnId_UsesItAndStillValidates()
    {
        var id = BackupIds.RestoredBaby(Importer, SourceBaby);

        var baby = Baby.Create(id, "Lia", TestClock.Today, Importer, TestClock.Now);

        Assert.Equal(id, baby.Id);
        Assert.Equal((Importer, BabyRole.Owner), (baby.Members.Single().UserId, baby.Members.Single().Role));
        Assert.Throws<DomainValidationException>(() => Baby.Create(id, " ", TestClock.Today, Importer, TestClock.Now));
        Assert.Throws<ArgumentException>(() => Baby.Create(Guid.Empty, "Lia", TestClock.Today, Importer, TestClock.Now));
    }
}
