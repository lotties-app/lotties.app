using System.Net;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;

namespace Lotties.Api.Tests.Authorization;

public sealed class BabyPolicyEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Read_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().GetAsync(ProbeEndpointsStartupFilter.ReadPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Read_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(ProbeEndpointsStartupFilter.ReadPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Read_UnknownBaby_Returns403()
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(ProbeEndpointsStartupFilter.ReadPath(Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Read_NonGuidBabyId_Returns404()
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync("/probe/babies/not-a-guid/read");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Owner)]
    public async Task Read_AnyMember_Returns200(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer, BabyRole.Parent);

        var response = await factory.CreateClientFor(baby.SubjectOf(role)).GetAsync(ProbeEndpointsStartupFilter.ReadPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData(BabyRole.Viewer, HttpStatusCode.Forbidden)]
    [InlineData(BabyRole.Parent, HttpStatusCode.OK)]
    [InlineData(BabyRole.Owner, HttpStatusCode.OK)]
    public async Task Write_ByRole_RequiresParentOrOwner(BabyRole role, HttpStatusCode expected)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer, BabyRole.Parent);

        var response = await factory.CreateClientFor(baby.SubjectOf(role)).PostAsync(ProbeEndpointsStartupFilter.WritePath(baby.BabyId), null);

        Assert.Equal(expected, response.StatusCode);
    }

    [Theory]
    [InlineData(BabyRole.Viewer, HttpStatusCode.Forbidden)]
    [InlineData(BabyRole.Parent, HttpStatusCode.Forbidden)]
    [InlineData(BabyRole.Owner, HttpStatusCode.OK)]
    public async Task ManageMembers_ByRole_RequiresOwner(BabyRole role, HttpStatusCode expected)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer, BabyRole.Parent);

        var response = await factory.CreateClientFor(baby.SubjectOf(role)).PostAsync(ProbeEndpointsStartupFilter.ManageMembersPath(baby.BabyId), null);

        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task Write_MemberOfAnotherBaby_Returns403()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(mine.OwnerSubject).PostAsync(ProbeEndpointsStartupFilter.WritePath(other.BabyId), null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
