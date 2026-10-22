using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.AccessLogs;
using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// Doctor access, step 2 (docs/design/16-doctor-access.md section 10): prescription proposals with server-side
/// visibility, the accept transaction with provenance, decline, withdraw, removal, parent edits of doctor-sourced
/// prescriptions, note reads and the access log under a burst of parallel requests.
/// </summary>
public sealed class ProposalEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static string BabyPath(Guid babyId) => $"/api/v1/babies/{babyId}";

    private static string ProposalPath(Guid babyId, Guid proposalId) => $"{BabyPath(babyId)}/prescription-proposals/{proposalId}";

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private static object Proposal(
        string medicationName = "Paracetamol drops",
        Guid? medicationId = null,
        decimal amount = 2,
        string unit = "drops",
        Guid? replaces = null,
        object? updatedAt = null,
        string instructions = "Give after the morning feed.") => new
    {
        medicationId,
        medicationName,
        kind = "scheduled",
        dose = new { amount, unit },
        timesOfDay = new[] { "20:00", "08:00" },
        startDate = "2026-10-22",
        endDate = "2026-10-29",
        instructions,
        replacesPrescriptionId = replaces,
        updatedAt,
    };

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => await response.ReadAsync<JsonElement>();

    private static async Task<JsonElement[]> ListAsync(HttpClient client, string path) =>
        (await JsonAsync(await client.GetAsync(path))).EnumerateArray().ToArray();

    private static async Task<Guid[]> ProposalIdsAsync(HttpClient client, Guid babyId, string? since = null)
    {
        var query = since is null ? string.Empty : $"?since={Uri.EscapeDataString(since)}";
        return (await ListAsync(client, $"{BabyPath(babyId)}/prescription-proposals{query}")).Select(item => item.GetProperty("id").GetGuid()).ToArray();
    }

    private async Task<Guid> ProposeAsync(SeededBaby baby, object? body = null, HttpClient? doctor = null)
    {
        var id = Guid.NewGuid();
        var response = await (doctor ?? As(baby, BabyRole.Doctor)).PutAsJsonAsync(ProposalPath(baby.BabyId, id), body ?? Proposal());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return id;
    }

    private static Task<HttpResponseMessage> AcceptAsync(HttpClient client, Guid babyId, Guid proposalId, Guid prescriptionId, string? acceptedOn = null) =>
        client.PostAsJsonAsync($"{ProposalPath(babyId, proposalId)}/accept", new { prescriptionId, acceptedOn });

    private static Task<HttpResponseMessage> DeclineAsync(HttpClient client, Guid babyId, Guid proposalId, string? reason = null) =>
        client.PostAsJsonAsync($"{ProposalPath(babyId, proposalId)}/decline", new { reason });

    private async Task<HttpClient> SecondDoctorAsync(SeededBaby baby)
    {
        var subject = TestUsers.NewSubject();
        await factory.SeedAsync(async context =>
        {
            var user = Lotties.Domain.Users.User.Create(Lotties.Domain.Users.User.UnknownIssuer, subject, "Second", TestUsers.Now);
            context.Users.Add(user);
            var stored = await context.Babies.Include(b => b.Members).SingleAsync(b => b.Id == baby.BabyId);
            stored.AddMember(user.Id, BabyRole.Doctor, TestUsers.Now);
        });
        return factory.CreateClientFor(subject);
    }

    private static async Task<Guid> CreateMedicationAsync(HttpClient client, Guid babyId, string name)
    {
        var medicationId = Guid.NewGuid();
        var response = await client.PutAsJsonAsync($"{BabyPath(babyId)}/medications/{medicationId}", new { name, isUsual = true });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return medicationId;
    }

    private static async Task<Guid> CreatePrescriptionAsync(HttpClient client, Guid babyId, Guid medicationId)
    {
        var id = Guid.NewGuid();
        var response = await client.PutAsJsonAsync($"{BabyPath(babyId)}/prescriptions/{id}", new
        {
            medicationId,
            kind = "scheduled",
            dose = new { amount = 1, unit = "ml" },
            timesOfDay = new[] { "08:00" },
            startDate = "2026-10-01",
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return id;
    }

    private static async Task<JsonElement> PrescriptionAsync(HttpClient client, Guid babyId, Guid prescriptionId) =>
        (await ListAsync(client, $"{BabyPath(babyId)}/prescriptions")).Single(item => item.GetProperty("id").GetGuid() == prescriptionId);

    [Fact]
    public async Task Put_ByTheDoctor_CreatesAPendingProposalAndAReplayChangesNothing()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctor = As(baby, BabyRole.Doctor);
        var id = Guid.NewGuid();
        var editTime = DateTimeOffset.UtcNow.AddMinutes(-2);

        var created = await doctor.PutAsJsonAsync(ProposalPath(baby.BabyId, id), Proposal(updatedAt: editTime));
        var replay = await doctor.PutAsJsonAsync(ProposalPath(baby.BabyId, id), Proposal(updatedAt: editTime));

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.OK), (created.StatusCode, replay.StatusCode));
        var body = await JsonAsync(created);
        Assert.Equal(("pending", "Paracetamol drops", "scheduled", "08:00", "Doctor"), (body.GetProperty("status").GetString(), body.GetProperty("medicationName").GetString(), body.GetProperty("kind").GetString(), body.GetProperty("timesOfDay")[0].GetString(), body.GetProperty("author").GetProperty("displayName").GetString()));
        Assert.Equal(body.GetProperty("updatedAt").GetDateTimeOffset(), (await JsonAsync(replay)).GetProperty("updatedAt").GetDateTimeOffset());
        Assert.Equal(0, await factory.QueryAsync(context => context.Prescriptions.CountAsync(prescription => prescription.BabyId == baby.BabyId)));
    }

    [Fact]
    public async Task Visibility_OwnersParentsAndTheAuthorSee_CaregiversViewersAndOtherDoctorsDoNot()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);
        var start = DateTimeOffset.UtcNow.AddMinutes(-1).ToString("O");
        var id = await ProposeAsync(baby);
        var otherDoctor = await SecondDoctorAsync(baby);

        foreach (var role in new[] { BabyRole.Owner, BabyRole.Parent, BabyRole.Doctor })
        {
            Assert.Equal([id], await ProposalIdsAsync(As(baby, role), baby.BabyId));
            Assert.Equal([id], await ProposalIdsAsync(As(baby, role), baby.BabyId, start));
            Assert.Equal(HttpStatusCode.OK, (await As(baby, role).GetAsync(ProposalPath(baby.BabyId, id))).StatusCode);
        }

        foreach (var client in new[] { As(baby, BabyRole.Caregiver), As(baby, BabyRole.Viewer), otherDoctor })
        {
            Assert.Empty(await ProposalIdsAsync(client, baby.BabyId));
            Assert.Empty(await ProposalIdsAsync(client, baby.BabyId, start));
            await (await client.GetAsync(ProposalPath(baby.BabyId, id))).AssertProblemAsync(HttpStatusCode.NotFound, "proposal_not_found");
        }
    }

    [Fact]
    public async Task Put_AnotherDoctorsProposal_Is404AndTheirWithdrawIsANoOp()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var id = await ProposeAsync(baby);
        var otherDoctor = await SecondDoctorAsync(baby);

        var edit = await otherDoctor.PutAsJsonAsync(ProposalPath(baby.BabyId, id), Proposal(amount: 5));
        var withdraw = await otherDoctor.DeleteAsync(ProposalPath(baby.BabyId, id));

        await edit.AssertProblemAsync(HttpStatusCode.NotFound, "proposal_not_found");
        Assert.Equal(HttpStatusCode.NoContent, withdraw.StatusCode);
        var stored = await JsonAsync(await As(baby, BabyRole.Owner).GetAsync(ProposalPath(baby.BabyId, id)));
        Assert.Equal(("pending", 2m), (stored.GetProperty("status").GetString(), stored.GetProperty("dose").GetProperty("amount").GetDecimal()));
    }

    [Fact]
    public async Task Put_UsesThePrescriptionRulesAndChecksTheReferences()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var other = await factory.SeedBabyAsync();
        var othersMedication = await CreateMedicationAsync(As(other, BabyRole.Owner), other.BabyId, "Not hers");
        var doctor = As(baby, BabyRole.Doctor);

        var zero = await doctor.PutAsJsonAsync(ProposalPath(baby.BabyId, Guid.NewGuid()), Proposal(amount: 0));
        var perKgSpray = await doctor.PutAsJsonAsync(ProposalPath(baby.BabyId, Guid.NewGuid()), new { medicationName = "Saline", kind = "asNeeded", dose = new { amount = 1, unit = "spray", perKg = true }, minIntervalMinutes = 240, startDate = "2026-10-22" });
        var foreignMedication = await doctor.PutAsJsonAsync(ProposalPath(baby.BabyId, Guid.NewGuid()), Proposal(medicationId: othersMedication));
        var unknownReplaced = await doctor.PutAsJsonAsync(ProposalPath(baby.BabyId, Guid.NewGuid()), Proposal(replaces: Guid.NewGuid()));
        var tooLong = await doctor.PutAsJsonAsync(ProposalPath(baby.BabyId, Guid.NewGuid()), Proposal(instructions: new string('a', 2001)));

        Assert.Equal("dose.amount", (await zero.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
        Assert.Equal("dose.perKg", (await perKgSpray.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
        await foreignMedication.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "prescription_medication_not_found");
        await unknownReplaced.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "replaced_prescription_not_found");
        Assert.Equal("instructions", (await tooLong.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
    }

    [Fact]
    public async Task Put_AnotherBabysProposalId_Is409()
    {
        var first = await factory.SeedBabyAsync(BabyRole.Doctor);
        var id = await ProposeAsync(first);
        var second = await factory.SeedBabyAsync(BabyRole.Doctor);

        var response = await As(second, BabyRole.Doctor).PutAsJsonAsync(ProposalPath(second.BabyId, id), Proposal());

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "proposal_baby_mismatch");
    }

    [Fact]
    public async Task Accept_IsOneTransaction_CreatingTheMedicationAndThePrescriptionWithProvenance()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Doctor);
        await As(baby, BabyRole.Doctor).PutAsJsonAsync("/api/v1/me/professional-profile", new { displayName = "Ana Souza" });
        var id = await ProposeAsync(baby);
        var prescriptionId = Guid.NewGuid();

        var accepted = await AcceptAsync(As(baby, BabyRole.Parent), baby.BabyId, id, prescriptionId);
        var replay = await AcceptAsync(As(baby, BabyRole.Parent), baby.BabyId, id, prescriptionId);
        var secondDevice = await AcceptAsync(As(baby, BabyRole.Owner), baby.BabyId, id, Guid.NewGuid());

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.OK), (accepted.StatusCode, replay.StatusCode, secondDevice.StatusCode));
        var body = await JsonAsync(accepted);
        Assert.Equal(("accepted", prescriptionId), (body.GetProperty("proposal").GetProperty("status").GetString(), body.GetProperty("proposal").GetProperty("acceptedPrescriptionId").GetGuid()));
        Assert.Equal(prescriptionId, (await JsonAsync(secondDevice)).GetProperty("prescription").GetProperty("id").GetGuid());
        var prescription = await PrescriptionAsync(As(baby, BabyRole.Owner), baby.BabyId, prescriptionId);
        Assert.Equal(("active", "Ana Souza", "Ana Souza", id, false), (prescription.GetProperty("status").GetString(), prescription.GetProperty("prescribedByName").GetString(), prescription.GetProperty("prescriber").GetString(), prescription.GetProperty("proposalId").GetGuid(), prescription.GetProperty("changedByParent").GetBoolean()));
        Assert.Equal(("Paracetamol drops", 2m, "Give after the morning feed."), (prescription.GetProperty("original").GetProperty("medicationName").GetString(), prescription.GetProperty("original").GetProperty("dose").GetProperty("amount").GetDecimal(), prescription.GetProperty("original").GetProperty("instructions").GetString()));
        Assert.False(prescription.GetProperty("prescribedBy").GetProperty("professional").GetProperty("verified").GetBoolean());
        var medications = await ListAsync(As(baby, BabyRole.Owner), $"{BabyPath(baby.BabyId)}/medications");
        var medication = Assert.Single(medications);
        Assert.Equal(("Paracetamol drops", prescription.GetProperty("medicationId").GetGuid()), (medication.GetProperty("name").GetString(), medication.GetProperty("id").GetGuid()));
        Assert.Equal(1, await factory.QueryAsync(context => context.Prescriptions.CountAsync(item => item.BabyId == baby.BabyId)));
    }

    [Fact]
    public async Task Accept_TheBabysOwnMedication_IsReusedAndNothingIsAdded()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var medicationId = await CreateMedicationAsync(As(baby, BabyRole.Owner), baby.BabyId, "Tylenol baby");
        var id = await ProposeAsync(baby, Proposal(medicationName: "Tylenol baby", medicationId: medicationId));

        var accepted = await JsonAsync(await AcceptAsync(As(baby, BabyRole.Owner), baby.BabyId, id, Guid.NewGuid()));

        Assert.Equal(medicationId, accepted.GetProperty("prescription").GetProperty("medicationId").GetGuid());
        Assert.Single(await ListAsync(As(baby, BabyRole.Owner), $"{BabyPath(baby.BabyId)}/medications"));
    }

    [Fact]
    public async Task Accept_AChange_EndsTheReplacedPrescriptionAndSupersedesTheOtherChange()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var owner = As(baby, BabyRole.Owner);
        var medicationId = await CreateMedicationAsync(owner, baby.BabyId, "Paracetamol drops");
        var current = await CreatePrescriptionAsync(owner, baby.BabyId, medicationId);
        var change = await ProposeAsync(baby, Proposal(medicationId: medicationId, amount: 3, replaces: current));
        var competing = await ProposeAsync(baby, Proposal(medicationId: medicationId, amount: 4, replaces: current));

        var accepted = await AcceptAsync(owner, baby.BabyId, change, Guid.NewGuid(), "2026-10-23");

        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var replaced = await PrescriptionAsync(owner, baby.BabyId, current);
        Assert.Equal(("stopped", "2026-10-23", false, JsonValueKind.Null), (replaced.GetProperty("status").GetString(), replaced.GetProperty("endDate").GetString(), replaced.GetProperty("changedByParent").GetBoolean(), replaced.GetProperty("deletedAt").ValueKind));
        Assert.Equal("superseded", (await JsonAsync(await owner.GetAsync(ProposalPath(baby.BabyId, competing)))).GetProperty("status").GetString());
        await (await AcceptAsync(owner, baby.BabyId, competing, Guid.NewGuid())).AssertProblemAsync(HttpStatusCode.Conflict, "proposal_not_pending");
    }

    [Fact]
    public async Task Decline_WithAReason_TheDoctorSeesItAndTheProposalIsImmutable()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Doctor);
        var id = await ProposeAsync(baby);

        var declined = await DeclineAsync(As(baby, BabyRole.Parent), baby.BabyId, id, " We already give drops at night. ");
        var replay = await DeclineAsync(As(baby, BabyRole.Parent), baby.BabyId, id);
        var acceptAfter = await AcceptAsync(As(baby, BabyRole.Owner), baby.BabyId, id, Guid.NewGuid());
        var editAfter = await As(baby, BabyRole.Doctor).PutAsJsonAsync(ProposalPath(baby.BabyId, id), Proposal(amount: 9));
        var unchangedReplay = await As(baby, BabyRole.Doctor).PutAsJsonAsync(ProposalPath(baby.BabyId, id), Proposal());

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK), (declined.StatusCode, replay.StatusCode));
        await acceptAfter.AssertProblemAsync(HttpStatusCode.Conflict, "proposal_not_pending");
        await editAfter.AssertProblemAsync(HttpStatusCode.Conflict, "proposal_decided");
        Assert.Equal(HttpStatusCode.OK, unchangedReplay.StatusCode);
        var seenByDoctor = await JsonAsync(await As(baby, BabyRole.Doctor).GetAsync(ProposalPath(baby.BabyId, id)));
        Assert.Equal(("declined", "We already give drops at night."), (seenByDoctor.GetProperty("status").GetString(), seenByDoctor.GetProperty("declineReason").GetString()));
    }

    [Fact]
    public async Task Decisions_OnlyOwnersAndParents_TheDoctorCannotTouchPrescriptions()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Caregiver, BabyRole.Viewer, BabyRole.Doctor);
        var id = await ProposeAsync(baby);
        var doctor = As(baby, BabyRole.Doctor);

        var byCaregiver = await AcceptAsync(As(baby, BabyRole.Caregiver), baby.BabyId, id, Guid.NewGuid());
        var byViewer = await DeclineAsync(As(baby, BabyRole.Viewer), baby.BabyId, id);
        var byDoctor = await AcceptAsync(doctor, baby.BabyId, id, Guid.NewGuid());
        var doctorWritesPrescription = await doctor.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/prescriptions/{Guid.NewGuid()}", new { medicationId = Guid.NewGuid(), kind = "asNeeded", dose = new { amount = 1, unit = "ml" }, minIntervalMinutes = 240, startDate = "2026-10-22" });
        var doctorWritesMedication = await doctor.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/medications/{Guid.NewGuid()}", new { name = "X" });
        var ownerProposes = await As(baby, BabyRole.Owner).PutAsJsonAsync(ProposalPath(baby.BabyId, Guid.NewGuid()), Proposal());

        Assert.All(new[] { byCaregiver, byViewer, byDoctor, doctorWritesPrescription, doctorWritesMedication, ownerProposes }, response => Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode));
        Assert.Equal("pending", (await JsonAsync(await As(baby, BabyRole.Owner).GetAsync(ProposalPath(baby.BabyId, id)))).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Withdraw_TheDoctorCancelsHerPendingProposal()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var id = await ProposeAsync(baby);

        var first = await As(baby, BabyRole.Doctor).DeleteAsync(ProposalPath(baby.BabyId, id));
        var again = await As(baby, BabyRole.Doctor).DeleteAsync(ProposalPath(baby.BabyId, id));

        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent), (first.StatusCode, again.StatusCode));
        var stored = await JsonAsync(await As(baby, BabyRole.Owner).GetAsync(ProposalPath(baby.BabyId, id)));
        Assert.Equal(("cancelled", "withdrawn"), (stored.GetProperty("status").GetString(), stored.GetProperty("cancelReason").GetString()));
    }

    [Fact]
    public async Task RemovingTheDoctor_CancelsHerPendingProposalsAndKeepsTheDecidedOnes()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var pending = await ProposeAsync(baby);
        var accepted = await ProposeAsync(baby, Proposal(medicationName: "Simethicone"));
        await AcceptAsync(As(baby, BabyRole.Owner), baby.BabyId, accepted, Guid.NewGuid());
        var doctorId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Doctor));

        var removed = await As(baby, BabyRole.Owner).DeleteAsync($"{BabyPath(baby.BabyId)}/members/{doctorId}");

        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        var proposals = await ListAsync(As(baby, BabyRole.Owner), $"{BabyPath(baby.BabyId)}/prescription-proposals");
        var cancelled = proposals.Single(item => item.GetProperty("id").GetGuid() == pending);
        Assert.Equal(("cancelled", "access_removed"), (cancelled.GetProperty("status").GetString(), cancelled.GetProperty("cancelReason").GetString()));
        Assert.Equal("accepted", proposals.Single(item => item.GetProperty("id").GetGuid() == accepted).GetProperty("status").GetString());
    }

    [Fact]
    public async Task ParentEdit_OfADoctorSourcedPrescription_MarksItChangedButStopDoesNot()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Doctor);
        var stopped = await ProposeAsync(baby);
        var edited = await ProposeAsync(baby, Proposal(medicationName: "Simethicone"));
        var stoppedId = Guid.NewGuid();
        var editedId = Guid.NewGuid();
        await AcceptAsync(As(baby, BabyRole.Owner), baby.BabyId, stopped, stoppedId);
        await AcceptAsync(As(baby, BabyRole.Owner), baby.BabyId, edited, editedId);
        var parent = As(baby, BabyRole.Parent);
        var stoppedNow = await PrescriptionAsync(parent, baby.BabyId, stoppedId);
        var editedNow = await PrescriptionAsync(parent, baby.BabyId, editedId);

        await parent.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/prescriptions/{stoppedId}", Body(stoppedNow, status: "stopped"));
        await parent.PutAsJsonAsync($"{BabyPath(baby.BabyId)}/prescriptions/{editedId}", Body(editedNow, amount: 3));

        var afterStop = await PrescriptionAsync(parent, baby.BabyId, stoppedId);
        var afterEdit = await PrescriptionAsync(parent, baby.BabyId, editedId);
        Assert.Equal(("stopped", false), (afterStop.GetProperty("status").GetString(), afterStop.GetProperty("changedByParent").GetBoolean()));
        Assert.Equal((3m, true, 2m), (afterEdit.GetProperty("dose").GetProperty("amount").GetDecimal(), afterEdit.GetProperty("changedByParent").GetBoolean(), afterEdit.GetProperty("original").GetProperty("dose").GetProperty("amount").GetDecimal()));
    }

    private static object Body(JsonElement prescription, string status = "active", decimal? amount = null) => new
    {
        medicationId = prescription.GetProperty("medicationId").GetGuid(),
        status,
        kind = prescription.GetProperty("kind").GetString(),
        dose = new { amount = amount ?? prescription.GetProperty("dose").GetProperty("amount").GetDecimal(), unit = prescription.GetProperty("dose").GetProperty("unit").GetString() },
        timesOfDay = prescription.GetProperty("timesOfDay").EnumerateArray().Select(time => time.GetString()).ToArray(),
        startDate = prescription.GetProperty("startDate").GetString(),
        endDate = prescription.GetProperty("endDate").GetString(),
        prescriber = prescription.GetProperty("prescriber").GetString(),
        instructions = prescription.GetProperty("instructions").GetString(),
        updatedAt = DateTimeOffset.UtcNow,
    };

    [Fact]
    public async Task NoteReads_AreKeptOncePerMemberAndOnlyForVisibleNotes()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Doctor);
        var noteId = Guid.NewGuid();
        var privateId = Guid.NewGuid();
        await As(baby, BabyRole.Doctor).PutAsJsonAsync($"{BabyPath(baby.BabyId)}/notes/{noteId}", new { kind = "recommendation", visibility = "shared", body = "Offer water between feeds." });
        await As(baby, BabyRole.Doctor).PutAsJsonAsync($"{BabyPath(baby.BabyId)}/notes/{privateId}", new { kind = "recommendation", visibility = "private", body = "Mine." });
        var owner = As(baby, BabyRole.Owner);
        var start = DateTimeOffset.UtcNow.AddMinutes(-1).ToString("O");

        var first = await JsonAsync(await owner.PutAsync($"{BabyPath(baby.BabyId)}/notes/{noteId}/read", null));
        var again = await JsonAsync(await owner.PutAsync($"{BabyPath(baby.BabyId)}/notes/{noteId}/read", null));
        var hidden = await owner.PutAsync($"{BabyPath(baby.BabyId)}/notes/{privateId}/read", null);

        Assert.Equal(first.GetProperty("readAt").GetDateTimeOffset(), again.GetProperty("readAt").GetDateTimeOffset());
        await hidden.AssertProblemAsync(HttpStatusCode.NotFound, "note_not_found");
        var reads = await ListAsync(owner, $"{BabyPath(baby.BabyId)}/note-reads?since={Uri.EscapeDataString(start)}");
        Assert.Equal(noteId, Assert.Single(reads).GetProperty("noteId").GetGuid());
        Assert.Empty(await ListAsync(As(baby, BabyRole.Parent), $"{BabyPath(baby.BabyId)}/note-reads"));
    }

    [Fact]
    public async Task AccessLog_ABurstOfParallelDoctorReads_WritesOneEntryPerHour()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Doctor);
        var doctorId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Doctor));
        await factory.SeedAsync(context =>
        {
            context.AccessLog.Add(AccessLogEntry.View(baby.BabyId, doctorId, BabyRole.Doctor, DateTimeOffset.UtcNow.AddHours(-2)));
            return Task.CompletedTask;
        });
        var paths = new[] { "events", "prescriptions", "notes", "medications", "measurements", "formulas", "appointments", "prescription-proposals" };

        var responses = await Task.WhenAll(paths.Select(path => factory.CreateClientFor(baby.SubjectOf(BabyRole.Doctor)).GetAsync($"{BabyPath(baby.BabyId)}/{path}")));
        await As(baby, BabyRole.Doctor).GetAsync($"{BabyPath(baby.BabyId)}/events");

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        Assert.Equal(2, await factory.QueryAsync(context => context.AccessLog.CountAsync(entry => entry.BabyId == baby.BabyId)));
    }
}
