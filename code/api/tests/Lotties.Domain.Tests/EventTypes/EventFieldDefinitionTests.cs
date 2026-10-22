using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.EventTypes;

public sealed class EventFieldDefinitionTests
{
    [Fact]
    public void Create_Select_KeepsOptions()
    {
        var field = EventFieldDefinition.Create("side", "Side", EventFieldKind.Select, options: ["left", "right"]);

        Assert.Equal(["left", "right"], field.Options);
    }

    [Fact]
    public void Create_WithoutFlags_IsVisibleAndNotInteger()
    {
        var field = EventFieldDefinition.Create("amount", "Amount", EventFieldKind.Number);

        Assert.Equal((false, false), (field.IsHidden, field.IsInteger));
    }

    [Fact]
    public void Create_HiddenIntegerNumber_KeepsBothFlags()
    {
        var field = EventFieldDefinition.Create("pause_count", "Pauses", EventFieldKind.Number, isHidden: true, isInteger: true);

        Assert.Equal((true, true), (field.IsHidden, field.IsInteger));
    }

    [Fact]
    public void Create_HiddenText_IsAllowed()
    {
        Assert.True(EventFieldDefinition.Create("paused_at", "Paused at", EventFieldKind.Text, isHidden: true).IsHidden);
    }

    [Theory]
    [InlineData(EventFieldKind.Text)]
    [InlineData(EventFieldKind.Bool)]
    public void Create_IntegerOnNonNumber_ThrowsValidationNamingIsInteger(EventFieldKind kind)
    {
        var exception = Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create("flag", "Flag", kind, isInteger: true));

        Assert.Equal(nameof(EventFieldDefinition.IsInteger), exception.Field);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(3)]
    public void Create_NumberWithDecimals_KeepsThem(int decimals)
    {
        var field = EventFieldDefinition.Create("value_c", "Temperature", EventFieldKind.Number, decimals: decimals);

        Assert.Equal((decimals, false), (field.Decimals, field.IsInteger));
    }

    [Fact]
    public void Create_WithoutDecimals_HasNoLimit()
    {
        Assert.Null(EventFieldDefinition.Create("amount", "Amount", EventFieldKind.Number).Decimals);
    }

    [Theory]
    [InlineData(EventFieldKind.Text, 1, false)]
    [InlineData(EventFieldKind.Select, 1, false)]
    [InlineData(EventFieldKind.Number, 0, false)]
    [InlineData(EventFieldKind.Number, 4, false)]
    [InlineData(EventFieldKind.Number, 1, true)]
    public void Create_InvalidDecimals_ThrowsValidationNamingDecimals(EventFieldKind kind, int decimals, bool isInteger)
    {
        var options = kind == EventFieldKind.Select ? new[] { "a" } : null;

        var exception = Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create("value", "Value", kind, options: options, isInteger: isInteger, decimals: decimals));

        Assert.Equal(nameof(EventFieldDefinition.Decimals), exception.Field);
    }

    [Fact]
    public void Create_SelectWithoutOptions_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create("side", "Side", EventFieldKind.Select));
    }

    [Fact]
    public void Create_SelectWithDuplicateOptions_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(
            () => EventFieldDefinition.Create("side", "Side", EventFieldKind.Select, options: ["left", "left"]));
    }

    [Fact]
    public void Create_TextWithOptions_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(
            () => EventFieldDefinition.Create("note", "Note", EventFieldKind.Text, options: ["a"]));
    }

    [Fact]
    public void Create_NumberWithRange_KeepsRangeAndUnit()
    {
        var field = EventFieldDefinition.Create("amount", "Amount", EventFieldKind.Number, min: 0, max: 300, unit: "ml");

        Assert.Equal((0m, 300m, "ml"), (field.Min, field.Max, field.Unit));
        Assert.Empty(field.Options);
    }

    [Fact]
    public void Create_NumberMinGreaterThanMax_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(
            () => EventFieldDefinition.Create("intensity", "Intensity", EventFieldKind.Number, min: 5, max: 1));
    }

    [Theory]
    [InlineData(EventFieldKind.Text)]
    [InlineData(EventFieldKind.Select)]
    [InlineData(EventFieldKind.Bool)]
    public void Create_NonNumberWithMin_ThrowsValidation(EventFieldKind kind)
    {
        Assert.Throws<DomainValidationException>(
            () => EventFieldDefinition.Create("field", "Field", kind, options: kind == EventFieldKind.Select ? ["a"] : null, min: 1));
    }

    [Fact]
    public void Create_BoolWithUnit_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create("done", "Done", EventFieldKind.Bool, unit: "ml"));
    }

    [Theory]
    [InlineData("Side")]
    [InlineData("")]
    [InlineData("1side")]
    public void Create_InvalidKey_ThrowsValidation(string key)
    {
        Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create(key, "Side", EventFieldKind.Text));
    }

    [Fact]
    public void Create_BlankLabel_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create("side", " ", EventFieldKind.Text));
    }

    [Fact]
    public void Create_UndefinedKind_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create("side", "Side", (EventFieldKind)99));
    }
}
