namespace Lotties.Domain.Exceptions;

/// <summary>A measurement carried none of weight, height or head circumference.</summary>
public sealed class MeasurementWithoutValuesException : DomainException
{
    public MeasurementWithoutValuesException()
        : base("measurement_without_values", "A measurement needs at least one of weightKg, heightCm or headCircumferenceCm.")
    {
    }
}
