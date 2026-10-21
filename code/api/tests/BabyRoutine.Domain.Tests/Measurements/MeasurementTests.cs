using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Measurements;

namespace BabyRoutine.Domain.Tests.Measurements;

public sealed class MeasurementTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private static Measurement Create(
        DateOnly? date = null,
        decimal? weightKg = 5.2m,
        decimal? heightCm = null,
        decimal? headCm = null,
        string? notes = null) =>
        Measurement.Create(Guid.NewGuid(), BabyId, date ?? TestClock.Today, weightKg, heightCm, headCm, notes, UserId, TestClock.Now);

    [Fact]
    public void Create_AllValues_SetsProperties()
    {
        var measurement = Create(weightKg: 5.2m, heightCm: 58.5m, headCm: 38m, notes: " well ");

        Assert.Equal(
            (BabyId, UserId, TestClock.Today, 5.2m, 58.5m, 38m, "well"),
            (measurement.BabyId, measurement.CreatedBy, measurement.Date, measurement.WeightKg, measurement.HeightCm, measurement.HeadCircumferenceCm, measurement.Notes));
        Assert.Equal((TestClock.Now, TestClock.Now), (measurement.CreatedAt, measurement.UpdatedAt));
    }

    [Theory]
    [InlineData(5.2, null, null)]
    [InlineData(null, 58.5, null)]
    [InlineData(null, null, 38.0)]
    public void Create_SingleValue_IsAllowed(double? weight, double? height, double? head)
    {
        var measurement = Create(weightKg: (decimal?)weight, heightCm: (decimal?)height, headCm: (decimal?)head);

        Assert.NotNull(measurement);
    }

    [Fact]
    public void Create_NoValues_ThrowsWithoutValues()
    {
        Assert.Throws<MeasurementWithoutValuesException>(() => Create(weightKg: null));
    }

    [Theory]
    [InlineData(0.29, null, null)]
    [InlineData(40.01, null, null)]
    [InlineData(null, 19.99, null)]
    [InlineData(null, 130.01, null)]
    [InlineData(null, null, 19.99)]
    [InlineData(null, null, 60.01)]
    public void Create_OutOfRange_ThrowsValidation(double? weight, double? height, double? head)
    {
        Assert.Throws<DomainValidationException>(() => Create(weightKg: (decimal?)weight, heightCm: (decimal?)height, headCm: (decimal?)head));
    }

    [Theory]
    [InlineData(0.3, null, null)]
    [InlineData(40.0, null, null)]
    [InlineData(null, 20.0, null)]
    [InlineData(null, 130.0, null)]
    [InlineData(null, null, 20.0)]
    [InlineData(null, null, 60.0)]
    public void Create_Boundaries_AreAccepted(double? weight, double? height, double? head)
    {
        var measurement = Create(weightKg: (decimal?)weight, heightCm: (decimal?)height, headCm: (decimal?)head);

        Assert.NotNull(measurement);
    }

    [Fact]
    public void Create_ManyDecimals_RoundsToTwoPlaces()
    {
        var measurement = Create(weightKg: 5.2349m, heightCm: 58.455m);

        Assert.Equal((5.23m, 58.46m), (measurement.WeightKg, measurement.HeightCm));
    }

    [Fact]
    public void Create_TomorrowAndEarliest_AreAccepted()
    {
        Assert.NotNull(Create(date: TestClock.Today.AddDays(1)));
        Assert.NotNull(Create(date: Measurement.EarliestDate));
    }

    [Fact]
    public void Create_TooFarInFuture_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => Create(date: TestClock.Today.AddDays(2)));
    }

    [Fact]
    public void Create_BeforeEarliest_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => Create(date: Measurement.EarliestDate.AddDays(-1)));
    }

    [Fact]
    public void Create_TooLongNotes_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => Create(notes: new string('n', Measurement.NotesMaxLength + 1)));
    }

    [Fact]
    public void Create_EmptyIds_ThrowArgument()
    {
        Assert.Throws<ArgumentException>(() => Measurement.Create(Guid.Empty, BabyId, TestClock.Today, 5m, null, null, null, UserId, TestClock.Now));
        Assert.Throws<ArgumentException>(() => Measurement.Create(Guid.NewGuid(), Guid.Empty, TestClock.Today, 5m, null, null, null, UserId, TestClock.Now));
        Assert.Throws<ArgumentException>(() => Measurement.Create(Guid.NewGuid(), BabyId, TestClock.Today, 5m, null, null, null, Guid.Empty, TestClock.Now));
    }

    [Fact]
    public void Edit_ChangedState_AppliesAndBumpsUpdatedAt()
    {
        var measurement = Create();
        var later = TestClock.Now.AddHours(1);

        measurement.Edit(TestClock.Today, null, 60m, null, "tall", later);

        Assert.Equal(
            ((decimal?)null, (decimal?)60m, "tall", later, TestClock.Now),
            (measurement.WeightKg, measurement.HeightCm, measurement.Notes, measurement.UpdatedAt, measurement.CreatedAt));
    }

    [Fact]
    public void Edit_SameState_KeepsUpdatedAt()
    {
        var measurement = Create();

        measurement.Edit(TestClock.Today, 5.2m, null, null, null, TestClock.Now.AddHours(1));

        Assert.Equal(TestClock.Now, measurement.UpdatedAt);
    }

    [Fact]
    public void Edit_Invalid_ThrowsAndKeepsState()
    {
        var measurement = Create();

        Assert.Throws<MeasurementWithoutValuesException>(() => measurement.Edit(TestClock.Today, null, null, null, "x", TestClock.Now.AddHours(1)));
        Assert.Equal(((decimal?)5.2m, (string?)null, TestClock.Now), (measurement.WeightKg, measurement.Notes, measurement.UpdatedAt));
    }
}
