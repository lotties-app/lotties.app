using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lotties.Application.Events;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;

namespace Lotties.Application.Demo;

/// <summary>One sample event: a stable slot (its UUID v5 id derives from it) and the request that writes it.</summary>
public sealed record DemoSampleEvent(int Slot, UpsertEventRequest Request);

/// <summary>
/// Believable synthetic events for a demo baby (docs/design/45-try-it-demo.md section 5): a pure function of the baby id and "now",
/// with a small generator seeded from the baby id as the only source of variation, so the same inputs give the same events and ids.
/// Nothing is generated in the future of <c>now</c>.
/// </summary>
public static class DemoSampleData
{
    /// <summary>Days of history, ending now.</summary>
    public const int Days = 7;

    /// <summary>Age of the sample baby in days.</summary>
    public const int BabyAgeDays = 120;

    private static readonly Guid UuidNamespace = new("6f1d6a1e-6d1c-4c69-9a53-3a3c0a7b4c11");

    private delegate void AddEvent(Guid typeId, DateTimeOffset start, TimeSpan? length, object payload);

    /// <summary>The id of the sample record in <paramref name="slot"/> of this baby: UUID v5 of the baby id and the slot.</summary>
    public static Guid EventId(Guid babyId, int slot) => UuidV5(UuidNamespace, $"{babyId:N}:{slot}");

    public static IReadOnlyList<DemoSampleEvent> Build(Guid babyId, DateTimeOffset now)
    {
        var random = new Sequence(babyId);
        var events = new List<DemoSampleEvent>();
        var latestEnd = now - TimeSpan.FromMinutes(5);
        var earliest = now - TimeSpan.FromDays(Days);
        var today = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero);
        var slot = 0;

        void Add(Guid typeId, DateTimeOffset start, TimeSpan? length, object payload)
        {
            var end = length is null ? (DateTimeOffset?)null : start + length.Value;
            var thisSlot = slot++;
            if ((end ?? start) > latestEnd || start < earliest)
            {
                return;
            }

            events.Add(new DemoSampleEvent(thisSlot, new UpsertEventRequest
            {
                TypeId = typeId,
                StartedAt = start,
                EndedAt = end,
                Payload = EventPayload.From(JsonSerializer.Serialize(payload)),
                UpdatedAt = end ?? start,
            }));
        }

        for (var back = Days; back >= 0; back--)
        {
            var day = today - TimeSpan.FromDays(back);
            AddFeeds(Add, day, random, back);
            AddSleeps(Add, day, random);
            AddDiapers(Add, day, random);
            if (back % 2 == 1)
            {
                Add(BuiltInEventTypes.BathId, day.AddHours(19.5), null, new { temperature_c = 36 + random.Next(0, 2) });
            }
        }

        return events;
    }

    private static void AddFeeds(AddEvent add, DateTimeOffset day, Sequence random, int back)
    {
        var hours = new[] { 0.5, 3.5, 6.5, 9.5, 12.5, 15.5, 18.5, 21.5 };
        for (var index = 0; index < hours.Length; index++)
        {
            var start = day.AddHours(hours[index]).AddMinutes(random.Next(-15, 16));
            if ((index + back) % 3 == 0)
            {
                var prepared = 120 + 10 * random.Next(0, 7);
                add(BuiltInEventTypes.FeedingId, start, TimeSpan.FromMinutes(random.Next(12, 22)), new
                {
                    method = "bottle",
                    amount_ml = prepared,
                    amount_drunk_ml = prepared - 10 * random.Next(0, 3),
                    bottle_feeding_type = index % 2 == 0 ? "formula" : "breast_milk",
                });
                continue;
            }

            var left = random.Next(240, 600);
            var right = random.Next(240, 600);
            add(BuiltInEventTypes.FeedingId, start, TimeSpan.FromSeconds(left + right), new
            {
                method = "breast",
                side = "both",
                breast_left_seconds = left,
                breast_right_seconds = right,
            });
        }
    }

    private static void AddSleeps(AddEvent add, DateTimeOffset day, Sequence random)
    {
        add(BuiltInEventTypes.SleepId, day.AddHours(-3.5).AddMinutes(random.Next(-20, 21)), TimeSpan.FromHours(8.5).Add(TimeSpan.FromMinutes(random.Next(-30, 31))), new { kind = "night" });
        foreach (var hour in new[] { 8.5, 12, 15.5 })
        {
            add(BuiltInEventTypes.SleepId, day.AddHours(hour).AddMinutes(random.Next(-20, 21)), TimeSpan.FromMinutes(random.Next(40, 95)), new { kind = "nap" });
        }
    }

    private static void AddDiapers(AddEvent add, DateTimeOffset day, Sequence random)
    {
        var contents = new[] { "WET", "WET", "DIRTY", "WET", "MIXED", "WET", "DIRTY" };
        for (var index = 0; index < contents.Length; index++)
        {
            add(BuiltInEventTypes.DiaperId, day.AddHours(2.5 + index * 3).AddMinutes(random.Next(-20, 21)), null, new { content = contents[index] });
        }
    }

    /// <summary>UUID version 5 (RFC 4122): SHA-1 of the namespace and the name.</summary>
    private static Guid UuidV5(Guid namespaceId, string name)
    {
        var namespaceBytes = namespaceId.ToByteArray();
        Array.Reverse(namespaceBytes, 0, 4);
        Array.Reverse(namespaceBytes, 4, 2);
        Array.Reverse(namespaceBytes, 6, 2);
        var nameBytes = Encoding.UTF8.GetBytes(name);
        var input = new byte[namespaceBytes.Length + nameBytes.Length];
        namespaceBytes.CopyTo(input, 0);
        nameBytes.CopyTo(input, namespaceBytes.Length);
        var bytes = SHA1.HashData(input)[..16];
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        Array.Reverse(bytes, 0, 4);
        Array.Reverse(bytes, 4, 2);
        Array.Reverse(bytes, 6, 2);
        return new Guid(bytes);
    }

    /// <summary>A tiny deterministic generator (xorshift) seeded from the baby id.</summary>
    private sealed class Sequence(Guid seed)
    {
        private ulong _state = BitConverter.ToUInt64(seed.ToByteArray(), 0) | 1UL;

        public int Next(int minInclusive, int maxExclusive)
        {
            _state ^= _state << 13;
            _state ^= _state >> 7;
            _state ^= _state << 17;
            return minInclusive + (int)(_state % (ulong)(maxExclusive - minInclusive));
        }
    }
}
