using System.Globalization;
using System.Text.Json;
using Lotties.Domain.Prescriptions;
using static Lotties.Domain.Tests.Prescriptions.PrescriptionFixtures;

namespace Lotties.Domain.Tests.Prescriptions;

/// <summary>
/// The part-of-the-day vectors shared with the web port (code/web/src/medications/dayPartVectors.json, linked into the
/// test output): the same inputs must give the same windows and states on both sides.
/// </summary>
public sealed class DayPartVectorTests
{
    private static readonly Lazy<JsonDocument> Vectors = new(() => JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Prescriptions", "dayPartVectors.json"))));

    public static TheoryData<string> DayPartOfNames => NamesOf("dayPartOf");

    public static TheoryData<string> WindowNames => NamesOf("windows");

    public static TheoryData<string> StatusNames => NamesOf("status");

    [Theory]
    [MemberData(nameof(DayPartOfNames))]
    public void Of_SharedVector_GivesTheRoutineDayAndPart(string name)
    {
        var vector = Find("dayPartOf", name);

        var result = DayPartWindows.Of(Instant(vector, "at"), Offset(vector));

        Assert.Equal(new DayPartOfDay(Day(vector, "day"), Part(vector.GetProperty("part"))), result);
    }

    [Theory]
    [MemberData(nameof(WindowNames))]
    public void WindowOf_SharedVector_GivesStartAndEnd(string name)
    {
        var vector = Find("windows", name);

        var window = DayPartWindows.WindowOf(Day(vector, "day"), Part(vector.GetProperty("part")), Offset(vector));

        Assert.Equal((Instant(vector, "start"), Instant(vector, "end")), (window.Start, window.End));
    }

    [Theory]
    [MemberData(nameof(StatusNames))]
    public void Calculate_SharedVector_GivesThePartStates(string name)
    {
        var vector = Find("status", name);
        var medicationId = Guid.NewGuid();
        var prescription = PrescriptionOf(vector.GetProperty("prescription"), medicationId);
        var doses = vector.GetProperty("doses").EnumerateArray().Select(dose => DoseOf(dose, medicationId, prescription.Id)).ToArray();

        var status = MedicationStatusCalculator.Calculate(new MedicationStatusInput([prescription], doses, Instant(vector, "now"), Offset(vector), null)).Single();

        AssertMatches(vector.GetProperty("expected"), status);
    }

    private static void AssertMatches(JsonElement expected, MedicationStatus status)
    {
        var parts = status.DayParts!;
        Assert.Equal(Day(expected, "day"), parts.Day);
        Assert.Equal(expected.GetProperty("parts").EnumerateArray().Select(ExpectedSlot).ToArray(), parts.Parts.Select(ActualSlot).ToArray());
        Assert.Equal(OptionalPart(expected.GetProperty("current")), parts.Current?.Part);
        Assert.Equal(ExpectedNext(expected.GetProperty("next")), parts.Next is { } next ? $"{DayPartWindows.CodeOf(next.Part)}@{next.Window.Day:yyyy-MM-dd}" : null);
        Assert.Equal(expected.GetProperty("givenCount").GetInt32(), parts.GivenCount);
        Assert.Equal(expected.GetProperty("guard").GetString(), CamelCase(parts.Guard.ToString()));
        Assert.Equal((expected.GetProperty("courseStarted").GetBoolean(), expected.GetProperty("courseEnded").GetBoolean()), (status.CourseStarted, status.CourseEnded));
    }

    private static string ExpectedSlot(JsonElement slot) =>
        string.Join('|', slot.GetProperty("part").GetString(), slot.GetProperty("state").GetString(), OptionalInstant(slot, "givenAt"), OptionalInt(slot, "doseCount"), OptionalInstant(slot, "reminderAt"));

    private static string ActualSlot(DayPartSlot slot) =>
        string.Join('|', DayPartWindows.CodeOf(slot.Part), CamelCase(slot.State.ToString()), Text(slot.GivenAt), slot.DoseCount.ToString(CultureInfo.InvariantCulture), Text(slot.ReminderAt));

    private static string? ExpectedNext(JsonElement next) =>
        next.ValueKind == JsonValueKind.Null ? null : $"{next.GetProperty("part").GetString()}@{next.GetProperty("day").GetString()}";

    private static Prescription PrescriptionOf(JsonElement rx, Guid medicationId)
    {
        var parts = DayPartSet.Parse(rx.GetProperty("parts").EnumerateArray().Select(part => part.GetString()!).ToArray());
        var reminders = rx.TryGetProperty("reminders", out var list)
            ? DayPartReminders.Create(list.EnumerateArray().Select(entry => DayPartReminder.Parse(entry.GetProperty("part").GetString(), entry.GetProperty("time").GetString())).ToArray())
            : null;
        var schedule = PrescriptionSchedule.Create(PrescriptionKind.Scheduled, null, null, null, null, null, parts, reminders);
        var end = rx.TryGetProperty("endDate", out var endDate) ? DateOnly.Parse(endDate.GetString()!, CultureInfo.InvariantCulture) : (DateOnly?)null;
        var createdAt = rx.TryGetProperty("createdAt", out var created) ? DateTimeOffset.Parse(created.GetString()!, CultureInfo.InvariantCulture) : (DateTimeOffset?)null;
        return Create(Terms(medicationId, schedule, start: Day(rx, "startDate"), end: end), createdAt);
    }

    private static MedicationDose DoseOf(JsonElement dose, Guid medicationId, Guid prescriptionId)
    {
        var named = dose.TryGetProperty("named", out var self) && self.GetBoolean();
        var other = dose.TryGetProperty("otherPrescription", out var another) && another.GetBoolean();
        var reference = named ? prescriptionId : other ? Guid.NewGuid() : (Guid?)null;
        return Dose(Instant(dose, "at"), medicationId, reference);
    }

    private static JsonElement Find(string section, string name) =>
        Vectors.Value.RootElement.GetProperty(section).EnumerateArray().Single(vector => vector.GetProperty("name").GetString() == name);

    private static TheoryData<string> NamesOf(string section)
    {
        var data = new TheoryData<string>();
        foreach (var vector in Vectors.Value.RootElement.GetProperty(section).EnumerateArray())
        {
            data.Add(vector.GetProperty("name").GetString()!);
        }

        return data;
    }

    private static DateTimeOffset Instant(JsonElement element, string property) =>
        DateTimeOffset.Parse(element.GetProperty(property).GetString()!, CultureInfo.InvariantCulture);

    private static TimeSpan Offset(JsonElement element) => TimeSpan.FromMinutes(element.GetProperty("offsetMinutes").GetInt32());

    private static DateOnly Day(JsonElement element, string property) =>
        DateOnly.ParseExact(element.GetProperty(property).GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static DayPart Part(JsonElement code) =>
        DayPartWindows.TryParse(code.GetString(), out var part) ? part : throw new InvalidDataException($"Unknown part {code}.");

    private static DayPart? OptionalPart(JsonElement code) => code.ValueKind == JsonValueKind.Null ? null : Part(code);

    private static string OptionalInstant(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) ? Text(DateTimeOffset.Parse(value.GetString()!, CultureInfo.InvariantCulture)) : string.Empty;

    private static string OptionalInt(JsonElement element, string property) =>
        (element.TryGetProperty(property, out var value) ? value.GetInt32() : 0).ToString(CultureInfo.InvariantCulture);

    private static string Text(DateTimeOffset? instant) =>
        instant is { } value ? value.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture) : string.Empty;

    private static string CamelCase(string name) => char.ToLowerInvariant(name[0]) + name[1..];
}
