using Lotties.Domain.AccessLogs;
using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Measurements;
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
    [InlineData(null, null, null, "displayName")]
    [InlineData("  ", null, null, "displayName")]
    [InlineData("Ana", null, "12345678901234567890123456789012345678901", "registrationNumber")]
    [InlineData("Ana", "a\0b", null, "specialty")]
    public void Terms_Invalid_ThrowsNamingTheField(string? name, string? specialty, string? registration, string field)
    {
        var error = Assert.Throws<DomainValidationException>(() => ProfessionalProfileTerms.Create(ProfessionalKind.Doctor, name, specialty, registration));

        Assert.Equal(field, error.Field);
    }

    [Fact]
    public void Update_SameTermsKeepsTimeAndChangedTermsStampIt()
    {
        var terms = ProfessionalProfileTerms.Create(ProfessionalKind.Doctor, "Ana", null, null);
        var profile = ProfessionalProfile.Declare(Guid.NewGuid(), terms, TestClock.Now);

        profile.Update(terms, TestClock.Now.AddHours(1));
        var unchanged = profile.UpdatedAt;
        profile.Update(ProfessionalProfileTerms.Create(ProfessionalKind.Doctor, "Ana Souza", null, null), TestClock.Now.AddHours(2));

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
    public void View_SameUtcHour_SameIdAndNextHourAnother()
    {
        var babyId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var top = new DateTimeOffset(2026, 10, 22, 14, 0, 0, TimeSpan.Zero);

        var first = AccessLogEntry.View(babyId, userId, BabyRole.Doctor, top.AddMinutes(5));
        var sameHour = AccessLogEntry.View(babyId, userId, BabyRole.Doctor, top.AddMinutes(59));
        var nextHour = AccessLogEntry.View(babyId, userId, BabyRole.Doctor, top.AddMinutes(61));

        Assert.Equal(first.Id, sameHour.Id);
        Assert.NotEqual(first.Id, nextHour.Id);
        Assert.Equal((AccessKind.View, BabyRole.Doctor), (first.Kind, first.Role));
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
