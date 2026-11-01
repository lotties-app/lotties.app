using Lotties.Domain.Babies;
using Lotties.Domain.Catalog;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Prescriptions;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Lotties.Infrastructure.Persistence.Converters;

/// <summary>EF Core converters that store domain value objects as their primitive value.</summary>
internal static class ValueObjectConverters
{
    public static readonly ValueConverter<EventTypeKey, string> EventTypeKey =
        new(key => key.Value, value => Domain.EventTypes.EventTypeKey.From(value));

    public static readonly ValueConverter<HexColor, string> HexColor =
        new(color => color.Value, value => Domain.EventTypes.HexColor.From(value));

    public static readonly ValueConverter<InviteToken, string> InviteToken =
        new(token => token.Value, value => Domain.Babies.InviteToken.From(value));

    public static readonly ValueConverter<EventPayload, string> EventPayload =
        new(payload => payload.Value, value => Domain.Events.EventPayload.Rehydrate(value));

    public static readonly ValueConverter<CountryCode, string> CountryCode =
        new(country => country.Value, value => Domain.Catalog.CountryCode.From(value));

    public static readonly ValueConverter<IntervalGroup, string> IntervalGroup =
        new(group => group.Value, value => Domain.Prescriptions.IntervalGroup.Rehydrate(value));

    /// <summary><see cref="TimesOfDay"/> as comma-separated <c>HH:mm</c> texts, e.g. <c>08:00,20:00</c> (EF never converts <c>null</c>).</summary>
    public static readonly ValueConverter<TimesOfDay?, string> TimesOfDay =
        new(times => string.Join(',', times!.ToStrings()), value => Domain.Prescriptions.TimesOfDay.Parse(value.Split(',', StringSplitOptions.None)));

    /// <summary><see cref="DayPartSet"/> as comma-separated part codes, e.g. <c>morning,night</c> (EF never converts <c>null</c>).</summary>
    public static readonly ValueConverter<DayPartSet?, string> DayParts =
        new(parts => string.Join(',', parts!.ToCodes()), value => DayPartSet.Parse(value.Split(',', StringSplitOptions.None)));

    /// <summary><see cref="Domain.Prescriptions.DayPartReminders"/> as <c>morning=08:00,night=22:00</c> (EF never converts <c>null</c>).</summary>
    public static readonly ValueConverter<DayPartReminders?, string> DayPartReminders =
        new(reminders => reminders!.ToStorage(), value => Domain.Prescriptions.DayPartReminders.FromStorage(value));

    /// <summary>Substance synonyms joined by <see cref="Substance.SynonymSeparator"/> (empty text for none).</summary>
    public static readonly ValueConverter<IReadOnlyList<string>, string> Synonyms =
        new(
            synonyms => string.Join(Substance.SynonymSeparator, synonyms),
            value => value.Length == 0 ? Array.Empty<string>() : value.Split(Substance.SynonymSeparator, StringSplitOptions.None));

    /// <summary>Compares synonym lists by content (they are immutable, so the snapshot is the list itself).</summary>
    public static readonly ValueComparer<IReadOnlyList<string>> SynonymsComparer =
        new((left, right) => left!.SequenceEqual(right!), list => list.Aggregate(0, (hash, item) => HashCode.Combine(hash, item)), list => list);
}
