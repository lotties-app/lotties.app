using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace BabyRoutine.Infrastructure.Persistence.Converters;

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
}
