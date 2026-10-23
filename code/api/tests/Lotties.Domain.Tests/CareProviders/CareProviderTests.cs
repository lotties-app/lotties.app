using Lotties.Domain.Appointments;
using Lotties.Domain.CareProviders;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.CareProviders;

/// <summary>The care provider entity and its terms (docs/design/22-care-providers.md).</summary>
public sealed class CareProviderTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();
    private static readonly DateTimeOffset Now = TestClock.Now;

    private static CareProviderTerms Terms(string? name = "Dr. Ana", string? website = "https://clinic.example", bool favorite = false, bool deleted = false, string? notes = null, string? phone = " +55 11 5555-0000 ") =>
        CareProviderTerms.Create(name, "pediatrician", "CRM", "123456", "SP", " Clinic Central ", "Rua 1\nSP", phone, null, "ana@clinic.example", website, notes, favorite, deleted);

    private static CareProvider NewProvider(CareProviderTerms? terms = null, Guid? babyId = null, DateTimeOffset? clientUpdatedAt = null) =>
        CareProvider.Create(Guid.NewGuid(), babyId ?? BabyId, terms ?? Terms(), UserId, Now, clientUpdatedAt);

    [Fact]
    public void Create_TrimsTextKeepsTheTermsAndStampsBothTimes()
    {
        var provider = CareProvider.Create(Guid.NewGuid(), BabyId, Terms(name: "  Dr. Ana  "), UserId, Now);

        Assert.Equal(("Dr. Ana", "Clinic Central", "+55 11 5555-0000", "Rua 1\nSP"), (provider.Name, provider.ClinicName, provider.Phone, provider.Address));
        Assert.Equal(("CRM", "123456", "SP"), (provider.RegistrationCouncil, provider.RegistrationNumber, provider.RegistrationRegion));
        Assert.Equal((Now, Now, false, false), (provider.UpdatedAt, provider.ClientUpdatedAt, provider.IsFavorite, provider.IsDeleted));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    [InlineData("123456789012345678901234567890123456789012345678901234567890123456789012345678901")]
    [InlineData("Dr\u0000")]
    public void TermsCreate_InvalidName_ThrowsForName(string? name)
    {
        Assert.Equal("name", Assert.Throws<DomainValidationException>(() => Terms(name: name)).Field);
    }

    [Fact]
    public void TermsCreate_BlankOptionalTextIsAbsent()
    {
        var terms = Terms(phone: "  ", website: " ");

        Assert.Equal((null, null), (terms.Phone, terms.Website));
    }

    [Fact]
    public void TermsCreate_TooLongFields_ThrowForTheField()
    {
        static CareProviderTerms WithLength(string field, int length)
        {
            var text = new string('x', length);
            return CareProviderTerms.Create(
                "Dr",
                field == "specialty" ? text : null,
                field == "registrationCouncil" ? text : null,
                field == "registrationNumber" ? text : null,
                field == "registrationRegion" ? text : null,
                field == "clinicName" ? text : null,
                field == "address" ? text : null,
                field == "phone" ? text : null,
                field == "whatsapp" ? text : null,
                field == "email" ? text : null,
                null,
                field == "notes" ? text : null,
                false,
                false);
        }

        var limits = new Dictionary<string, int>
        {
            ["specialty"] = 60, ["registrationCouncil"] = 20, ["registrationNumber"] = 30, ["registrationRegion"] = 10, ["clinicName"] = 120,
            ["address"] = 400, ["phone"] = 30, ["whatsapp"] = 30, ["email"] = 120, ["notes"] = 1000,
        };

        foreach (var (field, limit) in limits)
        {
            WithLength(field, limit);
            Assert.Equal(field, Assert.Throws<DomainValidationException>(() => WithLength(field, limit + 1)).Field);
        }
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("ftp://clinic.example")]
    [InlineData("data:text/html,x")]
    public void TermsCreate_WebsiteWithAnotherScheme_ThrowsForWebsite(string website)
    {
        Assert.Equal("website", Assert.Throws<DomainValidationException>(() => Terms(website: website)).Field);
    }

    [Theory]
    [InlineData("clinic.example/ana")]
    [InlineData("https://clinic.example/ana")]
    [InlineData("HTTP://clinic.example")]
    [InlineData("clinic.example:8080/x")]
    public void TermsCreate_WebsiteWithHttpOrNoScheme_IsKept(string website)
    {
        Assert.Equal(website, Terms(website: website).Website);
    }

    [Fact]
    public void Edit_EqualTerms_ChangesNothing()
    {
        var provider = NewProvider();

        provider.Edit(Terms(), Now.AddHours(1), Now.AddHours(1));

        Assert.Equal((Now, Now), (provider.UpdatedAt, provider.ClientUpdatedAt));
    }

    [Fact]
    public void Edit_NewTerms_AppliesThemAndStampsTheTimes()
    {
        var provider = NewProvider();

        provider.Edit(Terms(favorite: true, deleted: true, notes: "x"), Now.AddHours(1), Now.AddMinutes(30));

        Assert.Equal((true, true, "x", Now.AddHours(1), Now.AddMinutes(30)), (provider.IsFavorite, provider.IsDeleted, provider.Notes, provider.UpdatedAt, provider.ClientUpdatedAt));
    }

    [Fact]
    public void DecideUpsert_OtherBaby_Throws()
    {
        Assert.Throws<CareProviderBabyMismatchException>(() => NewProvider().DecideUpsert(Guid.NewGuid(), null, Now));
    }

    [Fact]
    public void DecideUpsert_OlderClientTimeLoses_TieAndAbsentApply()
    {
        var provider = NewProvider(clientUpdatedAt: Now.AddMinutes(-5));

        Assert.Equal(CareProviderUpsertDecision.IgnoreStale, provider.DecideUpsert(BabyId, Now.AddMinutes(-6), Now));
        Assert.Equal(CareProviderUpsertDecision.Apply, provider.DecideUpsert(BabyId, Now.AddMinutes(-5), Now));
        Assert.Equal(CareProviderUpsertDecision.Apply, provider.DecideUpsert(BabyId, null, Now));
    }

    [Fact]
    public void AppointmentTerms_ProviderLinkIsOptional_AndAnEmptyGuidIsNoLink()
    {
        var providerId = Guid.NewGuid();

        var linked = AppointmentTerms.Create("Visit", AppointmentType.Consultation, Now.AddDays(1), null, null, null, null, null, AppointmentStatus.Upcoming, AppointmentReminders.None, providerId);
        var empty = AppointmentTerms.Create("Visit", AppointmentType.Consultation, Now.AddDays(1), null, null, null, null, null, AppointmentStatus.Upcoming, AppointmentReminders.None, Guid.Empty);
        var none = AppointmentTerms.Create("Visit", AppointmentType.Consultation, Now.AddDays(1), null, null, null, null, null, AppointmentStatus.Upcoming, AppointmentReminders.None);

        Assert.Equal((providerId, (Guid?)null, (Guid?)null), (linked.ProviderId, empty.ProviderId, none.ProviderId));
        var appointment = Appointment.Create(Guid.NewGuid(), BabyId, linked, UserId, Now);
        Assert.Equal(providerId, appointment.ProviderId);
        appointment.Edit(none, Now.AddHours(1));
        Assert.Null(appointment.ProviderId);
    }
}
