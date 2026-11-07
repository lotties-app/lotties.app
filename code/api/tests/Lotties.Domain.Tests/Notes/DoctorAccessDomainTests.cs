using Lotties.Domain.AccessLogs;
using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Measurements;
using Lotties.Domain.Notes;
using Lotties.Domain.Professionals;

namespace Lotties.Domain.Tests.Notes;

/// <summary>Professional profiles, the access log throttle and consultation measurements.</summary>
public sealed class DoctorAccessDomainTests
{
    [Fact]
    public void Declare_ValidTerms_IsSelfDeclaredAndTrimmed()
    {
        var userId = Guid.NewGuid();

        var profile = ProfessionalProfile.Declare(userId, ProfessionalProfileTerms.Create(ProfessionalKind.Doctor, " Ana Souza ", " Pediatrics ", " CRM-SP 123456 "), TestClock.Now);

        Assert.Equal((userId, "Ana Souza", "Pediatrics", "CRM-SP 123456", false), (profile.UserId, profile.DisplayName, profile.Specialty, profile.RegistrationNumber, profile.Verified));
    }

    [Theory]
    [InlineData("Ana", null, null, "specialty")]
    [InlineData(null, "  ", null, "specialty")]
    [InlineData("Ana", "Pediatrics", "12345678901234567890123456789012345678901", "registrationNumber")]
    [InlineData("Ana", "a\0b", null, "specialty")]
    public void Terms_Invalid_ThrowsNamingTheField(string? name, string? specialty, string? registration, string field)
    {
        var error = Assert.Throws<DomainValidationException>(() => ProfessionalProfileTerms.Create(ProfessionalKind.Doctor, name, specialty, registration));

        Assert.Equal(field, error.Field);
    }

    [Fact]
    public void Update_SameTermsKeepsTimeAndChangedTermsStampIt()
    {
        var terms = ProfessionalProfileTerms.Create(ProfessionalKind.Doctor, "Ana", "Pediatrics", null);
        var profile = ProfessionalProfile.Declare(Guid.NewGuid(), terms, TestClock.Now);

        profile.Update(terms, TestClock.Now.AddHours(1));
        var unchanged = profile.UpdatedAt;
        profile.Update(ProfessionalProfileTerms.Create(ProfessionalKind.Doctor, "Ana Souza", "Pediatrics", null), TestClock.Now.AddHours(2));

        Assert.Equal((TestClock.Now, TestClock.Now.AddHours(2), false), (unchanged, profile.UpdatedAt, profile.Verified));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData(59, false)]
    [InlineData(60, true)]
    [InlineData(180, true)]
    public void IsDue_LatestEntryMinutesAgo(int? minutesAgo, bool expected)
    {
        DateTimeOffset? latest = minutesAgo is { } minutes ? TestClock.Now.AddMinutes(-minutes) : null;

        Assert.Equal(expected, AccessLogThrottle.IsDue(latest, TestClock.Now));
    }

    [Theory]
    [InlineData(BabyRole.Owner, false)]
    [InlineData(BabyRole.Parent, false)]
    [InlineData(BabyRole.Caregiver, false)]
    [InlineData(BabyRole.Viewer, false)]
    [InlineData(BabyRole.Doctor, true)]
    public void IsRecorded_OnlyDoctors(BabyRole role, bool expected)
    {
        Assert.Equal(expected, AccessLogThrottle.IsRecorded(role));
    }

    [Fact]
    public void View_AfterTheSamePreviousEntry_SameIdEvenAcrossAnHourBoundary()
    {
        var babyId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var top = new DateTimeOffset(2026, 10, 22, 14, 0, 0, TimeSpan.Zero);
        var previous = AccessLogEntry.View(babyId, userId, BabyRole.Doctor, top.AddHours(-2));

        var beforeTheHour = AccessLogEntry.View(babyId, userId, BabyRole.Doctor, top.AddSeconds(-1), previous);
        var afterTheHour = AccessLogEntry.View(babyId, userId, BabyRole.Doctor, top.AddSeconds(1), previous);
        var next = AccessLogEntry.View(babyId, userId, BabyRole.Doctor, top.AddHours(1), afterTheHour);

        Assert.Equal(beforeTheHour.Id, afterTheHour.Id);
        Assert.NotEqual(previous.Id, afterTheHour.Id);
        Assert.NotEqual(afterTheHour.Id, next.Id);
        Assert.Equal(AccessLogEntry.IdAfter(babyId, userId, null), previous.Id);
        Assert.Equal((AccessKind.View, BabyRole.Doctor), (previous.Kind, previous.Role));
    }

    [Theory]
    [InlineData(NoteKind.Recommendation, NoteVisibility.Shared, false, false, true)]
    [InlineData(NoteKind.Recommendation, NoteVisibility.Shared, true, false, false)]
    [InlineData(NoteKind.Recommendation, NoteVisibility.Shared, false, true, false)]
    [InlineData(NoteKind.Note, NoteVisibility.Shared, false, false, false)]
    [InlineData(NoteKind.Recommendation, NoteVisibility.Private, false, false, false)]
    public void IsUnreadRecommendation_SharedRecommendationsOfOthersUntilRead(NoteKind kind, NoteVisibility visibility, bool hasRead, bool isAuthor, bool expected)
    {
        var authorId = Guid.NewGuid();
        var note = BabyNote.Create(Guid.NewGuid(), Guid.NewGuid(), NoteTerms.Create(kind, visibility, "Offer water."), authorId, TestClock.Now);

        Assert.Equal(expected, NoteRead.IsUnreadRecommendation(note, isAuthor ? authorId : Guid.NewGuid(), hasRead));
    }

    [Fact]
    public void NoteRead_Of_KeepsTheNoteBabyAndTheReader()
    {
        var note = BabyNote.Create(Guid.NewGuid(), Guid.NewGuid(), NoteTerms.Create(NoteKind.Recommendation, NoteVisibility.Shared, "Offer water."), Guid.NewGuid(), TestClock.Now);
        var readerId = Guid.NewGuid();

        var read = NoteRead.Of(note, readerId, TestClock.Now.AddMinutes(3));

        Assert.Equal((note.Id, note.BabyId, readerId, TestClock.Now.AddMinutes(3)), (read.NoteId, read.BabyId, read.UserId, read.ReadAt));
    }

    [Theory]
    [InlineData(BabyRole.Doctor, true)]
    [InlineData(BabyRole.Parent, false)]
    [InlineData(null, false)]
    public void Create_CreatorRole_MarksConsultationMeasurements(BabyRole? role, bool expected)
    {
        var measurement = Measurement.Create(Guid.NewGuid(), Guid.NewGuid(), TestClock.Today, 4.2m, null, null, null, Guid.NewGuid(), TestClock.Now, role);

        Assert.Equal(expected, measurement.RecordedByDoctor);
    }

    [Fact]
    public void EnsureChangeableBy_DoctorAndOthersMeasurement_Throws()
    {
        var doctorId = Guid.NewGuid();
        var parents = Measurement.Create(Guid.NewGuid(), Guid.NewGuid(), TestClock.Today, 4.2m, null, null, null, Guid.NewGuid(), TestClock.Now);
        var hers = Measurement.Create(Guid.NewGuid(), Guid.NewGuid(), TestClock.Today, 4.2m, null, null, null, doctorId, TestClock.Now, BabyRole.Doctor);

        var error = Assert.Throws<MeasurementNotOwnedException>(() => parents.EnsureChangeableBy(doctorId, BabyRole.Doctor));
        hers.EnsureChangeableBy(doctorId, BabyRole.Doctor);
        hers.EnsureChangeableBy(Guid.NewGuid(), BabyRole.Parent);

        Assert.Equal("measurement_not_owned", error.Code);
    }
}
