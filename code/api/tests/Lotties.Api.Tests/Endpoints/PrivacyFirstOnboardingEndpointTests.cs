using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>Names optional, labels, and a doctor who shares only what she chooses (docs/design/46-privacy-first-onboarding.md).</summary>
public sealed class PrivacyFirstOnboardingEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string ProfilePath = "/api/v1/me/professional-profile";

    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.ReadAsync<JsonElement>();

    [Fact]
    public async Task UserProfile_NameIsOptionalAndTheRoleLabelIsNormalized()
    {
        var client = factory.CreateClientFor(TestUsers.NewSubject());

        var saved = await JsonAsync(await client.PutAsJsonAsync("/api/v1/me/profile", new { displayName = "", roleLabel = "GRANDMOTHER" }));
        var me = await JsonAsync(await client.GetAsync("/api/v1/me"));

        Assert.Equal(("", "grandmother"), (saved.GetProperty("displayName").GetString(), saved.GetProperty("roleLabel").GetString()));
        Assert.Equal(("", "grandmother"), (me.GetProperty("displayName").GetString(), me.GetProperty("roleLabel").GetString()));
    }

    [Fact]
    public async Task DoctorProfile_OnlyTheSpecialtyIsRequired_AndNothingElseIsSharedByDefault()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctor = factory.CreateClientFor(baby.SubjectOf(BabyRole.Doctor));

        var declared = await doctor.PutAsJsonAsync(ProfilePath, new { displayName = "Ana Souza", specialty = "Pediatrics", registrationNumber = "CRM-SP 123456" });
        var missingSpecialty = await doctor.PutAsJsonAsync(ProfilePath, new { displayName = "Ana Souza" });
        var members = await JsonAsync(await factory.CreateClientFor(baby.OwnerSubject).GetAsync($"{BabyPath(baby.BabyId)}/members"));
        var member = members.EnumerateArray().Single(item => item.GetProperty("role").GetString() == "Doctor");

        Assert.Equal(HttpStatusCode.Created, declared.StatusCode);
        await missingSpecialty.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("", member.GetProperty("displayName").GetString());
        var professional = member.GetProperty("professional");
        Assert.Equal(("", "Pediatrics", JsonValueKind.Null), (professional.GetProperty("displayName").GetString(), professional.GetProperty("specialty").GetString(), professional.GetProperty("registrationNumber").ValueKind));
    }

    [Fact]
    public async Task DoctorProfile_SharingAFieldShowsOnlyThatField()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctor = factory.CreateClientFor(baby.SubjectOf(BabyRole.Doctor));
        await doctor.PutAsJsonAsync(ProfilePath, new { displayName = "Ana Souza", specialty = "Pediatrics", registrationNumber = "CRM-SP 123456", shareRegistration = true });

        var members = await JsonAsync(await factory.CreateClientFor(baby.OwnerSubject).GetAsync($"{BabyPath(baby.BabyId)}/members"));
        var professional = members.EnumerateArray().Single(item => item.GetProperty("role").GetString() == "Doctor").GetProperty("professional");

        Assert.Equal(("", "CRM-SP 123456"), (professional.GetProperty("displayName").GetString(), professional.GetProperty("registrationNumber").GetString()));
    }
}
