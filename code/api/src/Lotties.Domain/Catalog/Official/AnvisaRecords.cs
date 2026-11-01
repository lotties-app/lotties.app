namespace Lotties.Domain.Catalog.Official;

/// <summary>
/// One row of the ANVISA registered-medicines open data file (<c>DADOS_ABERTOS_MEDICAMENTOS.csv</c>): the fields the
/// importer reads. A registration repeats on several rows (one per process); only <see cref="Status"/> differs.
/// </summary>
public sealed record AnvisaRegistrationRow(string ProductName, string RegistrationNumber, string Status, string ActiveIngredients)
{
    /// <summary>The <c>SITUACAO_REGISTRO</c> value of a registration in force.</summary>
    public const string ActiveStatus = "Ativo";

    public bool IsActive => string.Equals(Status.Trim(), ActiveStatus, StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// One presentation of the CMED medicine price list (<c>TA_PRECO_MEDICAMENTO.csv</c>): the 13-digit presentation
/// registration (its first nine digits are the product registration), the product name and the presentation text
/// (form, strength, package), e.g. <c>75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML</c>.
/// </summary>
public sealed record CmedPresentationRow(string Registration, string ProductName, string Presentation);

/// <summary>ANVISA registration numbers: digits only, product registrations are nine digits (leading zeros restored).</summary>
public static class RegistrationNumbers
{
    public const int ProductLength = 9;
    public const int PresentationLength = 13;

    /// <summary>The nine-digit product registration of a registration-file value, or empty when it has no digits.</summary>
    public static string Product(string? value) => Padded(value, ProductLength);

    /// <summary>The nine-digit product registration of a CMED presentation registration, or empty.</summary>
    public static string OfPresentation(string? value)
    {
        var digits = Padded(value, PresentationLength);
        return digits.Length >= ProductLength ? digits[..ProductLength] : string.Empty;
    }

    private static string Padded(string? value, int length)
    {
        var digits = new string((value ?? string.Empty).Where(char.IsAsciiDigit).ToArray());
        return digits.Length == 0 ? string.Empty : digits.PadLeft(length, '0');
    }
}
