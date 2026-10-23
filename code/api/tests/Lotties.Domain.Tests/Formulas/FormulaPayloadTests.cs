using System.Text.Json;
using Lotties.Domain.Events;
using Lotties.Domain.Formulas;

namespace Lotties.Domain.Tests.Formulas;

public sealed class FormulaPayloadTests
{
    [Fact]
    public void WithoutFormula_BottleNamingAFormula_RemovesOnlyTheFormulaMembers()
    {
        var payload = EventPayload.From("""{"method":"bottle","amount_ml":90.5,"formula_id":"5d8f1d2e-3c47-4a8e-9a43-0d6d1f2a4b11","formula_name":"Nan","note":"ok"}""");

        var result = FormulaPayload.WithoutFormula(payload);

        using var document = JsonDocument.Parse(result.Value);
        var names = document.RootElement.EnumerateObject().Select(member => member.Name).ToArray();
        Assert.Equal(["method", "amount_ml", "note"], names);
        Assert.Equal(90.5, document.RootElement.GetProperty("amount_ml").GetDouble());
    }

    [Fact]
    public void WithoutFormula_OnlyTheName_RemovesIt()
    {
        var payload = EventPayload.From("""{"method":"bottle","formula_name":"Nan"}""");

        Assert.True(FormulaPayload.WithoutFormula(payload).IsEquivalentTo(EventPayload.From("""{"method":"bottle"}""")));
    }

    [Fact]
    public void WithoutFormula_NoFormula_ReturnsTheSamePayload()
    {
        var payload = EventPayload.From("""{"method":"breast", "side":"left"}""");

        Assert.Equal(payload, FormulaPayload.WithoutFormula(payload));
    }

    [Fact]
    public void WithoutFormula_EmptyPayload_ReturnsIt()
    {
        Assert.Equal(EventPayload.Empty, FormulaPayload.WithoutFormula(EventPayload.Empty));
    }
}
