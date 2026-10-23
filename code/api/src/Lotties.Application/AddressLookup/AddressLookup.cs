using System.Text;
using System.Text.RegularExpressions;
using Lotties.Domain.Exceptions;

namespace Lotties.Application.AddressLookup;

/// <summary>An address found by Brazilian postal code (CEP): the pieces a form fills; the user adds the number and complement.</summary>
public sealed record CepAddressResponse(
    string PostalCode,
    string? Street,
    string? Neighborhood,
    string? City,
    string? State,
    double? Latitude,
    double? Longitude,
    string Source);

/// <summary>One OpenStreetMap place for a free-text search; the coordinates are shown or ignored, never stored by the API.</summary>
public sealed record PlaceResult(
    string DisplayName,
    string? Name,
    string? Street,
    string? HouseNumber,
    string? Neighborhood,
    string? City,
    string? State,
    string? PostalCode,
    string? Country,
    double Latitude,
    double Longitude);

/// <summary>The places of a search (at most <see cref="AddressQueryRules.MaxResults"/>), best match first.</summary>
public sealed record PlaceSearchResponse(IReadOnlyList<PlaceResult> Results);

/// <summary>
/// The thin proxy the web app uses to fill an address (docs/design/23-address-lookup.md): validates the typed text, then asks
/// the upstream directory. Only the typed postal code or search text leaves the server, never anything about a baby.
/// </summary>
public interface IAddressLookupService
{
    /// <summary>Looks up a postal code (8 digits, an optional hyphen); 400 <c>validation_failed</c> / 404 <c>address_not_found</c> / 502 <c>address_lookup_unavailable</c>.</summary>
    Task<CepAddressResponse> LookupCepAsync(string? cep, CancellationToken cancellationToken = default);

    /// <summary>Searches places by free text (3 to 120 characters, language optional); 400 / 502 <c>address_lookup_unavailable</c>.</summary>
    Task<PlaceSearchResponse> SearchAsync(string? query, string? language, CancellationToken cancellationToken = default);
}

/// <summary>The upstream address sources (BrasilAPI / ViaCEP / OpenStreetMap Nominatim), with caching and their usage policies; implemented by Infrastructure.</summary>
public interface IAddressDirectory
{
    /// <summary>The address of a normalized CEP (8 digits).</summary>
    Task<CepAddressResponse> FindByCepAsync(string cep, CancellationToken cancellationToken = default);

    /// <summary>Places matching a normalized query; <paramref name="language"/> is a language tag or <c>null</c>.</summary>
    Task<IReadOnlyList<PlaceResult>> SearchPlacesAsync(string query, string? language, CancellationToken cancellationToken = default);
}

/// <summary>Input rules of the address lookup (the only validation: the text is never interpreted beyond them).</summary>
public static partial class AddressQueryRules
{
    public const int MinQueryLength = 3;
    public const int MaxQueryLength = 120;
    public const int MaxResults = 5;

    [GeneratedRegex(@"^\d{5}-?\d{3}$")]
    private static partial Regex CepPattern();

    [GeneratedRegex(@"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$")]
    private static partial Regex LanguagePattern();

    /// <summary>The 8 digits of a CEP typed as <c>01001000</c> or <c>01001-000</c>; 400 <c>validation_failed</c> (field <c>cep</c>) otherwise.</summary>
    public static string NormalizeCep(string? cep)
    {
        var trimmed = cep?.Trim() ?? string.Empty;
        if (!CepPattern().IsMatch(trimmed))
        {
            throw new DomainValidationException("cep", "The postal code (CEP) must have 8 digits, e.g. 01001-000.");
        }

        return trimmed.Replace("-", string.Empty, StringComparison.Ordinal);
    }

    /// <summary>Trimmed text with runs of whitespace collapsed; 400 (field <c>q</c>) when shorter than 3 or longer than 120 characters or holding a control character.</summary>
    public static string NormalizeQuery(string? query)
    {
        var builder = new StringBuilder();
        var pendingSpace = false;
        foreach (var character in query ?? string.Empty)
        {
            if (char.IsWhiteSpace(character))
            {
                pendingSpace = builder.Length > 0;
                continue;
            }

            if (char.IsControl(character))
            {
                throw new DomainValidationException("q", "The search text has characters that are not allowed.");
            }

            if (pendingSpace)
            {
                builder.Append(' ');
                pendingSpace = false;
            }

            builder.Append(character);
        }

        if (builder.Length < MinQueryLength || builder.Length > MaxQueryLength)
        {
            throw new DomainValidationException("q", $"The search text must have {MinQueryLength} to {MaxQueryLength} characters.");
        }

        return builder.ToString();
    }

    /// <summary>A language tag (<c>en</c>, <c>pt-BR</c>) or <c>null</c> when absent; 400 (field <c>lang</c>) for anything else.</summary>
    public static string? NormalizeLanguage(string? language)
    {
        var trimmed = language?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return LanguagePattern().IsMatch(trimmed)
            ? trimmed
            : throw new DomainValidationException("lang", "The language must be a tag such as en or pt-BR.");
    }
}

internal sealed class AddressLookupService(IAddressDirectory directory) : IAddressLookupService
{
    public Task<CepAddressResponse> LookupCepAsync(string? cep, CancellationToken cancellationToken = default) =>
        directory.FindByCepAsync(AddressQueryRules.NormalizeCep(cep), cancellationToken);

    public async Task<PlaceSearchResponse> SearchAsync(string? query, string? language, CancellationToken cancellationToken = default)
    {
        var normalized = AddressQueryRules.NormalizeQuery(query);
        var tag = AddressQueryRules.NormalizeLanguage(language);
        return new PlaceSearchResponse(await directory.SearchPlacesAsync(normalized, tag, cancellationToken));
    }
}
