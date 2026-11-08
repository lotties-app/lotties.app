using System.Linq.Expressions;
using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Lotties.Api.Tests.Backups;
using Lotties.Api.Tests.Board;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.Board;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Notifications;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.Seed;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// Account deletion against the whole EF model (docs/design/33-privacy-audit.md, G1). Every column that points at a baby
/// or a user is found from the model (a foreign key to <c>babies</c>, <c>users</c> or <c>baby_members</c>, or a Guid column
/// named like a reference), and <see cref="Rules"/> says what deletion does to it. A new table or column with such a
/// reference fails <see cref="Rules_CoverEveryBabyAndUserReferenceInTheModel"/> until it gets a rule, an erasure step in
/// <c>EfAccountDataEraser</c> and a row in the fixture below (<see cref="Delete_AloneOnABabyWithARowInEveryTable_ErasesEverything"/>
/// fails when a scoped table has no row before the deletion).
/// </summary>
public sealed class AccountErasureTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string MePath = "/api/v1/me";

    /// <summary>What deleting the account does to a reference to the deleted user (or to a baby she was alone in).</summary>
    public enum Rule
    {
        /// <summary>The row goes.</summary>
        Erase,

        /// <summary>The row stays and the column is set to null.</summary>
        Clear,

        /// <summary>
        /// On a baby other people keep, the row stays, attributed to the anonymized user row (the stand-in "Former member");
        /// on an erased baby it goes with the baby.
        /// </summary>
        KeepForTheFamily,

        /// <summary>Some rows go and some stay (private notes, pending proposals, unaccepted invites go); asserted one by one.</summary>
        Partial,
    }

    /// <summary>Every reference to a baby or a user in the model, by <c>table.column</c>.</summary>
    public static readonly IReadOnlyDictionary<string, Rule> Rules = new Dictionary<string, Rule>(StringComparer.Ordinal)
    {
        // References to the baby: everything goes with an erased baby; another user's default baby is cleared.
        ["access_log.baby_id"] = Rule.Erase,
        ["appointments.baby_id"] = Rule.Erase,
        ["baby_members.baby_id"] = Rule.Erase,
        ["baby_notes.baby_id"] = Rule.Erase,
        ["baby_notification_preferences.baby_id"] = Rule.Erase,
        ["care_providers.baby_id"] = Rule.Erase,
        ["data_store_moves.baby_id"] = Rule.Erase,
        ["event_types.baby_id"] = Rule.Erase,
        ["events.baby_id"] = Rule.Erase,
        ["formulas.baby_id"] = Rule.Erase,
        ["invites.baby_id"] = Rule.Erase,
        ["measurements.baby_id"] = Rule.Erase,
        ["medications.baby_id"] = Rule.Erase,
        ["note_reads.baby_id"] = Rule.Erase,
        ["notification_actions.baby_id"] = Rule.Erase,
        ["notification_deliveries.baby_id"] = Rule.Erase,
        ["prescription_proposals.baby_id"] = Rule.Erase,
        ["prescriptions.baby_id"] = Rule.Erase,
        ["user_assistant_settings.default_baby_id"] = Rule.Clear,
        ["vaccinations.baby_id"] = Rule.Erase,

        // References to the user.
        ["access_log.user_id"] = Rule.KeepForTheFamily,
        ["appointments.created_by"] = Rule.KeepForTheFamily,
        ["baby_members.user_id"] = Rule.Erase,
        ["baby_notes.author_user_id"] = Rule.Partial,
        ["baby_notification_preferences.user_id"] = Rule.Erase,

        // The project board is the project's (docs/design/36 section 8): items, history and keys stay, unlinked from her,
        // with "Former member" instead of her name snapshot.
        ["board_api_keys.created_by_user_id"] = Rule.Clear,
        ["board_item_events.actor_user_id"] = Rule.Clear,
        ["board_items.created_by_user_id"] = Rule.Clear,
        ["care_providers.created_by"] = Rule.KeepForTheFamily,

        // Her bring-your-own-database stores (sealed descriptors) go with her (docs/design/47 section 9).
        ["data_stores.owner_user_id"] = Rule.Erase,
        ["events.created_by"] = Rule.KeepForTheFamily,
        ["formulas.created_by"] = Rule.KeepForTheFamily,
        ["invites.accepted_by"] = Rule.KeepForTheFamily,
        ["invites.created_by"] = Rule.Partial,
        ["measurements.created_by"] = Rule.KeepForTheFamily,
        ["note_reads.user_id"] = Rule.Erase,
        ["notification_actions.user_id"] = Rule.Erase,
        ["notification_deliveries.user_id"] = Rule.Erase,
        ["prescription_proposals.author_user_id"] = Rule.Partial,
        ["prescription_proposals.decided_by"] = Rule.KeepForTheFamily,
        ["prescriptions.created_by"] = Rule.KeepForTheFamily,
        ["prescriptions.prescribed_by_user_id"] = Rule.KeepForTheFamily,
        ["products.created_by"] = Rule.Clear,
        ["professional_profiles.user_id"] = Rule.Erase,
        ["push_subscriptions.user_id"] = Rule.Erase,
        ["user_assistant_settings.user_id"] = Rule.Erase,
        ["user_consent_history.user_id"] = Rule.Erase,
        ["user_consents.user_id"] = Rule.Erase,
        ["user_notification_settings.user_id"] = Rule.Erase,
        ["user_rest_mornings.user_id"] = Rule.Erase,
        ["user_rest_settings.user_id"] = Rule.Erase,
        ["user_unit_settings.user_id"] = Rule.Erase,
        ["user_feeding_settings.user_id"] = Rule.Erase,
        ["vaccinations.created_by"] = Rule.KeepForTheFamily,
    };

    private static readonly DateTimeOffset Start = new(2026, 1, 10, 8, 0, 0, TimeSpan.Zero);

    private enum Target
    {
        Baby,
        User,
    }

    [Fact]
    public async Task Rules_CoverEveryBabyAndUserReferenceInTheModel()
    {
        var references = await factory.QueryAsync(context => Task.FromResult(ReferencesIn(context.Model).Select(reference => reference.Key).ToHashSet(StringComparer.Ordinal)));

        Assert.Empty(references.Except(Rules.Keys).Order(StringComparer.Ordinal));
        Assert.Empty(Rules.Keys.Except(references).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Delete_AloneOnABabyWithARowInEveryTable_ErasesEverything()
    {
        var seeded = await SeedAloneOwnerAsync();
        var references = await factory.QueryAsync(context => Task.FromResult(ReferencesIn(context.Model)));
        var before = await CountAsync(references, seeded.BabyId, seeded.UserId);
        var emptyTables = references.GroupBy(reference => reference.Table)
            .Where(table => table.All(reference => before[reference.Key] == 0))
            .Select(table => table.Key)
            .Order(StringComparer.Ordinal);
        Assert.Empty(emptyTables);

        var response = await factory.CreateClientFor(seeded.Subject).DeleteAsync(MePath);

        Assert.True(response.StatusCode == HttpStatusCode.OK, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        var after = await CountAsync(references, seeded.BabyId, seeded.UserId);
        Assert.Empty(after.Where(count => count.Value != 0).Select(count => $"{count.Key}: {count.Value}"));
        Assert.Empty(await factory.QueryAsync(context => context.Babies.Where(baby => baby.Id == seeded.BabyId).ToListAsync()));
        Assert.True(await factory.QueryAsync(context => context.Products.AnyAsync(product => product.Id == seeded.ProductId)));
        await AssertAnonymizedAsync(seeded.UserId, seeded.Subject);
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task Delete_MemberOfABabyOthersKeep_ErasesHerRecordsAndKeepsTheFamilysUnderTheStandIn(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(role == BabyRole.Doctor ? [BabyRole.Doctor] : [role, BabyRole.Doctor]);
        var subject = MemberSubject(baby, role);
        var userId = await factory.UserIdAsync(subject);
        await SeedAsMemberAsync(baby, role, userId);
        var references = await factory.QueryAsync(context => Task.FromResult(ReferencesIn(context.Model)));
        var before = await CountAsync(references, baby.BabyId, userId);
        var othersBefore = await CountOthersAsync(references, baby.BabyId, userId);
        var keptBefore = await KeptOfPartialAsync(baby.BabyId, userId);
        var membersBefore = await MembersAsync(baby.BabyId);
        Assert.Equal(1, before["baby_members.user_id"]);
        Assert.True(before.Where(count => Rules[count.Key] == Rule.KeepForTheFamily).Sum(count => count.Value) > 0 || role == BabyRole.Viewer);

        var response = await factory.CreateClientFor(subject).DeleteAsync(MePath);

        Assert.True(response.StatusCode == HttpStatusCode.OK, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        var after = await CountAsync(references, baby.BabyId, userId);
        foreach (var reference in references.Where(reference => reference.Target == Target.User))
        {
            var expected = Rules[reference.Key] switch
            {
                Rule.KeepForTheFamily => before[reference.Key],
                Rule.Partial => after[reference.Key],
                _ => 0,
            };
            Assert.True(expected == after[reference.Key], $"{reference.Key}: {before[reference.Key]} before, {after[reference.Key]} after, {expected} expected");
        }

        Assert.Equal(keptBefore, await KeptOfPartialAsync(baby.BabyId, userId));
        Assert.Equal((0, 0, 0), await ErasedOfPartialAsync(baby.BabyId, userId));
        Assert.Equal(othersBefore, await CountOthersAsync(references, baby.BabyId, userId));
        Assert.Single(await factory.QueryAsync(context => context.Babies.Where(item => item.Id == baby.BabyId).ToListAsync()));
        Assert.Equal(membersBefore.Where(member => member != userId), await MembersAsync(baby.BabyId));
        await AssertAnonymizedAsync(userId, subject);
    }

    [Fact]
    public async Task Delete_DoctorWithPatientsOnly_LeavesThePatientsAndKeepsHerSharedNotesUnderTheStandIn()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctor = factory.CreateClientFor(baby.SubjectOf(BabyRole.Doctor));
        var doctorId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Doctor));
        await SeedAsMemberAsync(baby, BabyRole.Doctor, doctorId);

        var preview = await (await doctor.GetAsync("/api/v1/me/deletion-preview")).ReadAsync<JsonElement>();
        var response = await doctor.DeleteAsync(MePath);

        Assert.True(preview.GetProperty("canDelete").GetBoolean());
        Assert.Empty(preview.GetProperty("deletedBabies").EnumerateArray());
        Assert.Equal([baby.BabyId], preview.GetProperty("sharedBabies").EnumerateArray().Select(item => item.GetProperty("id").GetGuid()));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var notes = await factory.QueryAsync(context => context.BabyNotes.IgnoreQueryFilters().Where(note => note.BabyId == baby.BabyId).Select(note => note.AuthorUserId).ToListAsync());
        Assert.Equal([doctorId], notes);
        Assert.Null(await factory.QueryAsync(context => context.ProfessionalProfiles.SingleOrDefaultAsync(profile => profile.UserId == doctorId)));
        var owner = factory.CreateClientFor(baby.OwnerSubject);
        var shared = await (await owner.GetAsync($"/api/v1/babies/{baby.BabyId}/notes")).ReadAsync<JsonElement>();
        Assert.Equal("Former member", Assert.Single(shared.EnumerateArray()).GetProperty("author").GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task Delete_KeepsHerProjectBoardRowsUnderTheStandIn()
    {
        var subject = TestUsers.NewSubject();
        var author = factory.BoardUser(BoardTestKit.Admin, subject, "Board Author");
        var item = await author.CreateAsync(BoardTestKit.Item("Her task"));
        await author.PostAsJsonAsync($"{BoardTestKit.Path}/items/{item.IdOf()}/comments", new { comment = "Noted" }).Ok();
        var key = (await (await author.PostAsJsonAsync($"{BoardTestKit.Path}/keys", new { name = "Her key", scope = "read" })).ReadAsync<JsonElement>()).GetProperty("key").GetProperty("id").GetGuid();
        var userId = await factory.UserIdAsync(subject);

        await factory.CreateClientFor(subject).DeleteAsync(MePath).Ok();

        var admin = factory.BoardUser(BoardTestKit.Admin);
        var detail = await (await admin.GetAsync($"{BoardTestKit.Path}/items/{item.IdOf()}")).ReadAsync<JsonElement>();
        var keys = await (await admin.GetAsync($"{BoardTestKit.Path}/keys")).ReadAsync<JsonElement>();
        Assert.Equal("Former member", detail.GetProperty("item").GetProperty("createdBy").GetProperty("name").GetString());
        Assert.All(detail.GetProperty("history").EnumerateArray(), entry => Assert.Equal("Former member", entry.GetProperty("actor").GetProperty("name").GetString()));
        Assert.Equal("Former member", keys.EnumerateArray().Single(row => row.GetProperty("id").GetGuid() == key).GetProperty("createdBy").GetString());
        Assert.False(await factory.QueryAsync(context => context.BoardItems.AnyAsync(row => row.CreatedByUserId == userId)));
        Assert.False(await factory.QueryAsync(context => context.BoardItemEvents.AnyAsync(row => row.ActorUserId == userId)));
        Assert.False(await factory.QueryAsync(context => context.BoardApiKeys.AnyAsync(row => row.CreatedByUserId == userId)));
        Assert.False(await factory.QueryAsync(context => context.BoardItems.AnyAsync(row => row.CreatedByName == "Board Author")));
    }

    private static IReadOnlyList<Reference> ReferencesIn(IModel model) =>
    [
        .. from entity in model.GetEntityTypes()
           where !entity.IsOwned() && entity.GetTableName() is not ("users" or "babies")
           from property in entity.GetProperties()
           where property.ClrType == typeof(Guid) || property.ClrType == typeof(Guid?)
           let target = TargetOf(property)
           where target is not null
           orderby entity.GetTableName(), property.Name
           select new Reference(entity, property, target.Value),
    ];

    private static Target? TargetOf(IProperty property)
    {
        foreach (var foreignKey in property.GetContainingForeignKeys())
        {
            var principal = foreignKey.PrincipalEntityType.ClrType;
            var principalProperty = foreignKey.PrincipalKey.Properties[foreignKey.Properties.ToList().IndexOf(property)];
            if (principal == typeof(Baby) || (principal == typeof(BabyMember) && principalProperty.Name == nameof(BabyMember.BabyId)))
            {
                return Target.Baby;
            }

            if (principal == typeof(User) || (principal == typeof(BabyMember) && principalProperty.Name == nameof(BabyMember.UserId)))
            {
                return Target.User;
            }
        }

        if (property.IsForeignKey())
        {
            return null;
        }

        // A reference stored without a foreign key (notification rows, the prescriber of a doctor's prescription).
        var name = property.Name;
        if (name.EndsWith("BabyId", StringComparison.Ordinal))
        {
            return Target.Baby;
        }

        return name.EndsWith("UserId", StringComparison.Ordinal) || name is "CreatedBy" or "DecidedBy" or "AcceptedBy" ? Target.User : null;
    }

    private async Task<Dictionary<string, int>> CountAsync(IReadOnlyList<Reference> references, Guid babyId, Guid userId)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var reference in references)
        {
            counts[reference.Key] = await factory.QueryAsync(context => reference.CountAsync(context, reference.Target == Target.Baby ? babyId : userId));
        }

        return counts;
    }

    /// <summary>Per baby-scoped table, the rows of the baby that do not point at the user: other people's data, never touched.</summary>
    private async Task<Dictionary<string, int>> CountOthersAsync(IReadOnlyList<Reference> references, Guid babyId, Guid userId)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var baby in references.Where(reference => reference.Target == Target.Baby))
        {
            var users = references.Where(reference => reference.Table == baby.Table && reference.Target == Target.User).ToList();
            counts[baby.Key] = await factory.QueryAsync(context => baby.CountOthersAsync(context, babyId, users, userId));
        }

        return counts;
    }

    private Task<(int SharedNotes, int DecidedProposals, int AcceptedInvites)> KeptOfPartialAsync(Guid babyId, Guid userId) =>
        factory.QueryAsync(async context => (
            await context.BabyNotes.IgnoreQueryFilters().CountAsync(note => note.BabyId == babyId && note.AuthorUserId == userId && note.Visibility == Domain.Notes.NoteVisibility.Shared),
            await context.PrescriptionProposals.CountAsync(proposal => proposal.BabyId == babyId && proposal.AuthorUserId == userId && proposal.Status != Domain.Proposals.ProposalStatus.Pending),
            await context.Invites.CountAsync(invite => invite.BabyId == babyId && invite.CreatedBy == userId && invite.AcceptedAt != null)));

    private Task<(int PrivateNotes, int PendingProposals, int OpenInvites)> ErasedOfPartialAsync(Guid babyId, Guid userId) =>
        factory.QueryAsync(async context => (
            await context.BabyNotes.IgnoreQueryFilters().CountAsync(note => note.AuthorUserId == userId && note.Visibility == Domain.Notes.NoteVisibility.Private),
            await context.PrescriptionProposals.CountAsync(proposal => proposal.AuthorUserId == userId && proposal.Status == Domain.Proposals.ProposalStatus.Pending),
            await context.Invites.CountAsync(invite => invite.CreatedBy == userId && invite.AcceptedAt == null)));

    private async Task AssertAnonymizedAsync(Guid userId, string subject)
    {
        var user = await factory.QueryAsync(context => context.Users.SingleAsync(item => item.Id == userId));
        Assert.Equal((User.DeletedIssuer, "Former member", true), (user.Issuer, user.DisplayName, user.IsDeleted));
        Assert.Empty(await factory.QueryAsync(context => context.Users.Where(item => item.Subject == subject).ToListAsync()));
    }

    /// <summary>
    /// The user alone on a baby with a row in every table: her own records, and those of a doctor who worked with the baby
    /// and was removed (her notes, proposals, consultation measurement and access log stay on the baby until it is erased).
    /// </summary>
    private async Task<AloneOwner> SeedAloneOwnerAsync()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var owner = factory.CreateClientFor(baby.OwnerSubject);
        var userId = await factory.UserIdAsync(baby.OwnerSubject);
        var path = BabyPath(baby.BabyId);
        await SeedFamilyRecordsAsync(owner, path, owner: true);
        await SeedDoctorRecordsAsync(baby, owner, path);

        var productId = (await (await owner.PostAsJsonAsync("/api/v1/catalog/products", new { name = UniqueName("Erasol"), form = "drops", country = "BR", substances = new[] { new { substanceId = MedicationCatalogSeed.Paracetamol.Id } } }).Ok())
            .ReadAsync<JsonElement>()).GetProperty("id").GetGuid();
        await owner.PostAsJsonAsync($"{path}/invites", new { role = "Viewer" }).Ok();
        await SeedPersonalRecordsAsync(owner, baby.BabyId, userId);

        var doctorId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Doctor));
        await owner.DeleteAsync($"{path}/members/{doctorId}").Ok();
        return new AloneOwner(baby.BabyId, baby.OwnerSubject, userId, productId);
    }

    /// <summary>The member of <paramref name="role"/> who deletes her account (a second owner for <see cref="BabyRole.Owner"/>).</summary>
    private static string MemberSubject(SeededBaby baby, BabyRole role) => baby.MemberSubjects[role];

    private Task<List<Guid>> MembersAsync(Guid babyId) =>
        factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == babyId).Select(member => member.UserId).OrderBy(id => id).ToListAsync());

    /// <summary>
    /// What a member of <paramref name="role"/> writes on a baby others keep (writes the role may not do are refused and
    /// skipped), next to the owner's records and a doctor's (the member herself when she is the Doctor).
    /// </summary>
    private async Task SeedAsMemberAsync(SeededBaby baby, BabyRole role, Guid userId)
    {
        var client = factory.CreateClientFor(MemberSubject(baby, role));
        var owner = factory.CreateClientFor(baby.OwnerSubject);
        var path = BabyPath(baby.BabyId);
        await SeedFamilyRecordsAsync(client, path, owner: role == BabyRole.Owner);
        await SeedFamilyRecordsAsync(owner, path, owner: true);
        var recommendation = await SeedDoctorRecordsAsync(baby, owner, path);
        await client.PutAsync($"{path}/notes/{recommendation}/read", null);
        if (role == BabyRole.Owner)
        {
            await client.PostAsJsonAsync($"{path}/invites", new { role = "Viewer" }).Ok();
            var accepted = await (await client.PostAsJsonAsync($"{path}/invites", new { role = "Viewer" }).Ok()).ReadAsync<JsonElement>();
            await factory.CreateClientFor(TestUsers.NewSubject(), "Grandma").PostAsJsonAsync("/api/v1/invites/accept", new { token = accepted.GetProperty("token").GetString() }).Ok();
            await owner.DeleteAsync($"{path}/members/{await NewestViewerAsync(baby.BabyId)}").Ok();
        }

        await SeedPersonalRecordsAsync(client, baby.BabyId, userId);
    }

    private Task<Guid> NewestViewerAsync(Guid babyId) =>
        factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == babyId && member.Role == BabyRole.Viewer).Select(member => member.UserId).SingleAsync());

    /// <summary>The family's records through the endpoints (each written by <paramref name="client"/> when her role may).</summary>
    private static async Task SeedFamilyRecordsAsync(HttpClient client, string path, bool owner)
    {
        async Task Write(Task<HttpResponseMessage> request)
        {
            var response = await request;
            Assert.True(response.IsSuccessStatusCode || (!owner && response.StatusCode == HttpStatusCode.Forbidden), $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        }

        var customType = await client.PostAsJsonAsync(
            $"{path}/event-types",
            new { key = UniqueName("pump").ToLowerInvariant(), name = "Pump", icon = "water_drop", color = "#123456", hasDuration = false, fields = new[] { new { key = "amount_ml", label = "Amount", kind = "number", min = 0, unit = "ml" } } });
        await Write(Task.FromResult(customType));
        var medicationId = Guid.NewGuid();
        await Write(client.PutAsJsonAsync($"{path}/medications/{medicationId}", new { name = "Colidis", isUsual = true }));
        await Write(client.PutAsJsonAsync(
            $"{path}/prescriptions/{Guid.NewGuid()}",
            new { medicationId, kind = "asNeeded", dose = new { amount = 2, unit = "drops" }, minIntervalMinutes = 480, maxDosesPer24h = 3, startDate = "2026-01-01", prescriber = "Dr. Ana" }));
        await Write(client.PutAsJsonAsync($"{path}/formulas/{Guid.NewGuid()}", new { name = "Aptamil 2", brand = "Aptamil", stage = "2", isCurrent = true, archived = false }));
        var providerId = Guid.NewGuid();
        await Write(client.PutAsJsonAsync($"{path}/care-providers/{providerId}", new { name = "Dr. Ana Lima", specialty = "pediatrician", phone = "+55 11 5555-0000" }));
        await Write(client.PutAsJsonAsync(
            $"{path}/appointments/{Guid.NewGuid()}",
            new { title = "Pediatrician", type = "consultation", startsAt = DateTimeOffset.UtcNow.AddDays(40), durationMinutes = 30, providerId, status = "upcoming" }));
        await Write(client.PutAsJsonAsync($"{path}/vaccinations/{Guid.NewGuid()}", new { vaccineKey = "bcg", doseId = "bcg-1", doseLabel = "Dose única", givenOn = "2026-01-05", network = "public" }));
        await Write(client.PutAsJsonAsync($"{path}/measurements/{Guid.NewGuid()}", new { date = "2026-01-09", weightKg = 5.4m }));
        await Write(client.PutAsJsonAsync($"{path}/events/{Guid.NewGuid()}", new { typeId = BuiltInEventTypes.FeedingId, startedAt = Start, payload = new { method = "breast", side = "left" } }));
        var deleted = Guid.NewGuid();
        await Write(client.PutAsJsonAsync($"{path}/events/{deleted}", new { typeId = BuiltInEventTypes.BathId, startedAt = Start.AddHours(1), payload = new { } }));
        await Write(client.DeleteAsync($"{path}/events/{deleted}"));
        if (customType.IsSuccessStatusCode)
        {
            var typeId = (await customType.ReadAsync<JsonElement>()).GetProperty("id").GetGuid();
            await Write(client.PutAsJsonAsync($"{path}/events/{Guid.NewGuid()}", new { typeId, startedAt = Start.AddHours(2), payload = new { amount_ml = 80 } }));
        }
    }

    /// <summary>The doctor's notes, proposals (pending, accepted and declined), consultation measurement and access log entry.</summary>
    private async Task<Guid> SeedDoctorRecordsAsync(SeededBaby baby, HttpClient owner, string path)
    {
        var doctor = factory.CreateClientFor(baby.SubjectOf(BabyRole.Doctor));
        await doctor.PutAsJsonAsync("/api/v1/me/professional-profile", new { displayName = "Dr. Ana Souza", specialty = "Pediatrics", shareDisplayName = true, shareRegistration = true }).Ok();
        await doctor.GetAsync(path).Ok();
        var recommendation = Guid.NewGuid();
        await doctor.PutAsJsonAsync($"{path}/notes/{recommendation}", new { kind = "recommendation", visibility = "shared", body = "Offer 120 ml every 3 hours." }).Ok();
        await doctor.PutAsJsonAsync($"{path}/notes/{Guid.NewGuid()}", new { kind = "note", visibility = "private", body = "Mother seemed anxious." }).Ok();
        await owner.PutAsync($"{path}/notes/{recommendation}/read", null).Ok();
        await doctor.PutAsJsonAsync($"{path}/measurements/{Guid.NewGuid()}", new { date = "2026-01-08", weightKg = 5.3m }).Ok();
        var proposals = new[] { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };
        foreach (var proposal in proposals)
        {
            await doctor.PutAsJsonAsync($"{path}/prescription-proposals/{proposal}", Proposal()).Ok();
        }

        await owner.PostAsJsonAsync($"{path}/prescription-proposals/{proposals[1]}/accept", new { prescriptionId = Guid.NewGuid() }).Ok();
        await owner.PostAsJsonAsync($"{path}/prescription-proposals/{proposals[2]}/decline", new { reason = "Already on it." }).Ok();
        return recommendation;
    }

    /// <summary>The user's own records that no endpoint here creates in one call: push, reminders, voice assistant, profile.</summary>
    private async Task SeedPersonalRecordsAsync(HttpClient client, Guid babyId, Guid userId)
    {
        await client.PutAsJsonAsync("/api/v1/me/unit-settings", new { system = "us" }).Ok();
        await client.PutAsJsonAsync("/api/v1/me/feeding-settings", new { timeBottleFeedings = true }).Ok();
        await client.PutAsJsonAsync("/api/v1/me/rest-settings", new
        {
            enabled = true,
            timeZone = "UTC",
            workWindows = new[] { new { days = new[] { 1, 2 }, start = "08:00", end = "17:00" } },
            nightStart = "19:00",
            nightEnd = "07:00",
            fallAsleepMinutes = 20,
            wakeLeadMinutes = 20,
        }).Ok();
        await client.PutAsJsonAsync("/api/v1/me/rest/morning", new { night = DateTime.UtcNow.AddDays(-1).ToString("yyyy-MM-dd"), upAt = DateTimeOffset.UtcNow.AddHours(-1) }).Ok();
        await client.PutAsJsonAsync("/api/v1/me/professional-profile", new { displayName = "Ana Souza", specialty = "Pediatrics", shareDisplayName = true, shareRegistration = true }).Ok();
        if (!(await client.PutAsJsonAsync("/api/v1/me/assistant-settings", new { defaultBabyId = babyId })).IsSuccessStatusCode)
        {
            // Only a baby she may log events for can be the default (a Viewer's or a Doctor's settings have none).
            await client.PutAsJsonAsync("/api/v1/me/assistant-settings", new { defaultBabyId = (Guid?)null }).Ok();
        }

        var subscription = PushSubscription.Create(userId, PushEndpoint.From(PushTestData.NewEndpoint()), PushTestData.Keys, NotificationLocale.English, "Chrome on Android", null, Start);
        var actor = BoardActor.ForUser(userId, "Her board name");
        var (boardItem, boardCreated) = BoardItem.Create(
            Guid.NewGuid(),
            BoardItemContent.Create(BoardItemType.Task, "process-meta", "Her board task", null, BoardItemStatus.Open, BoardSide.Owner, BoardPriority.Normal, null, null, null, false, null, null, null, null),
            null,
            actor,
            Start);
        var (boardKey, _) = BoardApiKey.Create("Her key", BoardKeyScope.Read, null, null, actor, Start);
        await factory.SeedAsync(context =>
        {
            context.BoardItems.Add(boardItem);
            context.BoardItemEvents.Add(boardCreated);
            context.BoardApiKeys.Add(boardKey);
            context.PushSubscriptions.Add(subscription);
            context.NotificationDeliveries.Add(NotificationDelivery.Claim(Guid.NewGuid(), subscription.Id, PushEndpointTests.DosePlan(userId, babyId, Start), Start).Delivery);
            context.NotificationActions.Add(NotificationAction.Snooze(userId, babyId, NotificationKey.ForNap(babyId, Start), Start));
            context.UserNotificationSettings.Add(UserNotificationSettings.Create(userId, new NotificationSettingsTerms(NotificationTimeZone.From("America/Sao_Paulo"), QuietHours.Default, false, false), Start));
            context.BabyNotificationPreferences.Add(BabyNotificationPreferences.Create(babyId, userId, ReminderPreferences.Default, Start));
            context.DataStores.Add(DataStore.Create(Guid.NewGuid(), userId, Start));
            context.DataStoreMoves.Add(DataStoreMove.Start(babyId, DataStoreMoveDirection.In, Guid.NewGuid(), "erasure-test", Start, TimeSpan.FromMinutes(2)));
            return Task.CompletedTask;
        });
    }

    private static object Proposal() => new
    {
        medicationName = "Paracetamol drops",
        kind = "scheduled",
        dose = new { amount = 2, unit = "drops" },
        timesOfDay = new[] { "20:00", "08:00" },
        startDate = "2026-10-22",
        endDate = "2026-10-29",
        instructions = "Give after the morning feed.",
    };

    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static string UniqueName(string prefix) => prefix + string.Concat(Guid.NewGuid().ToString("N").Take(10).Select(digit => (char)('a' + Convert.ToInt32(digit.ToString(), 16))));

    private sealed record AloneOwner(Guid BabyId, string Subject, Guid UserId, Guid ProductId);

    private sealed record Reference(IEntityType Entity, IProperty Property, Target Target)
    {
        public string Table => Entity.GetTableName()!;

        public string Key => $"{Table}.{Property.GetColumnName()}";

        public Task<int> CountAsync(LottiesDbContext context, Guid value) =>
            (Task<int>)Generic(nameof(CountTypedAsync)).Invoke(null, [context, Property, value])!;

        public Task<int> CountOthersAsync(LottiesDbContext context, Guid babyId, IReadOnlyList<Reference> users, Guid userId) =>
            (Task<int>)Generic(nameof(CountOthersTypedAsync)).Invoke(null, [context, Property, babyId, users.Select(user => user.Property).ToList(), userId])!;

        private MethodInfo Generic(string name) =>
            typeof(Reference).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static)!.MakeGenericMethod(Entity.ClrType);

        private static Task<int> CountTypedAsync<TEntity>(LottiesDbContext context, IProperty property, Guid value)
            where TEntity : class
        {
            var row = Expression.Parameter(typeof(TEntity), "row");
            return context.Set<TEntity>().IgnoreQueryFilters().CountAsync(Expression.Lambda<Func<TEntity, bool>>(Is(row, property, value), row));
        }

        private static Task<int> CountOthersTypedAsync<TEntity>(LottiesDbContext context, IProperty baby, Guid babyId, List<IProperty> users, Guid userId)
            where TEntity : class
        {
            var row = Expression.Parameter(typeof(TEntity), "row");
            var body = users.Aggregate(Is(row, baby, babyId), (filter, user) => Expression.AndAlso(filter, Expression.Not(Is(row, user, userId))));
            return context.Set<TEntity>().IgnoreQueryFilters().CountAsync(Expression.Lambda<Func<TEntity, bool>>(body, row));
        }

        /// <summary><c>row.Property == value</c>, false for null.</summary>
        private static Expression Is(ParameterExpression row, IProperty property, Guid value)
        {
            var column = Expression.Call(typeof(EF), nameof(EF.Property), [property.ClrType], row, Expression.Constant(property.Name));
            var equal = Expression.Equal(column, Expression.Convert(Expression.Constant(value), property.ClrType));
            return property.ClrType == typeof(Guid)
                ? equal
                : Expression.AndAlso(Expression.NotEqual(column, Expression.Constant(null, property.ClrType)), equal);
        }
    }
}
