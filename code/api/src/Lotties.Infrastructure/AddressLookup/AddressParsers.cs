using System.Globalization;
using System.Text.Json;
using Lotties.Application.AddressLookup;

namespace Lotties.Infrastructure.AddressLookup;

/// <summary>Reads the JSON of the three upstream services into our answers; <see cref="JsonException"/> means the answer is not what the service documents.</summary>
internal static class AddressParsers
{
    private const int MaxFieldLength = 200;

    public const string BrasilApiSource = "brasilapi";
    public const string ViaCepSource = "viacep";

    /// <summary>BrasilAPI CEP v2: <c>{cep, state, city, neighborhood, street, location: {coordinates: {latitude, longitude}}}</c> (coordinates are often missing).</summary>
    public static CepAddressResponse ParseBrasilApi(string json, string cep)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new JsonException("Not an object.");
        }

        double? latitude = null;
        double? longitude = null;
        if (root.TryGetProperty("location", out var location) && location.ValueKind == JsonValueKind.Object
            && location.TryGetProperty("coordinates", out var coordinates) && coordinates.ValueKind == JsonValueKind.Object)
        {
            latitude = Number(coordinates, "latitude", -90, 90);
            longitude = Number(coordinates, "longitude", -180, 180);
            if (latitude is null || longitude is null)
            {
                latitude = longitude = null;
            }
        }

        return new CepAddressResponse(
            cep,
            Text(root, "street"),
            Text(root, "neighborhood"),
            Text(root, "city"),
            Text(root, "state"),
            latitude,
            longitude,
            BrasilApiSource);
    }

    /// <summary>ViaCEP: <c>{logradouro, bairro, localidade, uf}</c> or <c>{"erro": true}</c> for an unknown CEP (<c>null</c>).</summary>
    public static CepAddressResponse? ParseViaCep(string json, string cep)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new JsonException("Not an object.");
        }

        if (root.TryGetProperty("erro", out var error) && (error.ValueKind == JsonValueKind.True || (error.ValueKind == JsonValueKind.String && error.GetString() == "true")))
        {
            return null;
        }

        return new CepAddressResponse(
            cep,
            Text(root, "logradouro"),
            Text(root, "bairro"),
            Text(root, "localidade"),
            Text(root, "uf"),
            null,
            null,
            ViaCepSource);
    }

    /// <summary>Nominatim <c>jsonv2</c> with <c>addressdetails=1</c>: an array of places; a place without usable coordinates or name is skipped.</summary>
    public static IReadOnlyList<PlaceResult> ParseNominatim(string json)
    {
        using var document = JsonDocument.Parse(json);
        if (document.RootElement.ValueKind != JsonValueKind.Array)
        {
            throw new JsonException("Not an array.");
        }

        var places = new List<PlaceResult>();
        foreach (var item in document.RootElement.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object && PlaceOf(item) is { } place)
            {
                places.Add(place);
            }

            if (places.Count == AddressQueryRules.MaxResults)
            {
                break;
            }
        }

        return places;
    }

    private static PlaceResult? PlaceOf(JsonElement item)
    {
        var latitude = Number(item, "lat", -90, 90);
        var longitude = Number(item, "lon", -180, 180);
        var displayName = Text(item, "display_name");
        if (latitude is null || longitude is null || displayName is null)
        {
            return null;
        }

        var address = item.TryGetProperty("address", out var details) && details.ValueKind == JsonValueKind.Object ? details : default;
        string? Part(params string[] keys) => address.ValueKind == JsonValueKind.Object ? keys.Select(key => Text(address, key)).FirstOrDefault(value => value is not null) : null;

        var street = Part("road", "pedestrian", "footway", "path", "cycleway");
        var uf = Part("ISO3166-2-lvl4") is { Length: > 3 } iso && iso.StartsWith("BR-", StringComparison.Ordinal) ? iso[3..] : null;
        var name = Text(item, "name");
        return new PlaceResult(
            displayName,
            name is not null && !string.Equals(name, street, StringComparison.OrdinalIgnoreCase) ? name : null,
            street,
            Part("house_number"),
            Part("suburb", "neighbourhood", "quarter", "city_district", "borough"),
            Part("city", "town", "village", "municipality", "county"),
            uf ?? Part("state", "region"),
            Part("postcode"),
            Part("country"),
            latitude.Value,
            longitude.Value);
    }

    private static string? Text(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var text = new string(value.GetString()!.Where(character => !char.IsControl(character)).ToArray()).Trim();
        return text.Length == 0 ? null : text.Length > MaxFieldLength ? text[..MaxFieldLength] : text;
    }

    private static double? Number(JsonElement element, string property, double min, double max)
    {
        if (!element.TryGetProperty(property, out var value))
        {
            return null;
        }

        var parsed = value.ValueKind switch
        {
            JsonValueKind.Number => value.GetDouble(),
            JsonValueKind.String when double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) => number,
            _ => double.NaN,
        };
        return double.IsFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
    }
}
