namespace Lotties.Domain.Rest;

/// <summary>
/// The caregiver rest estimate (docs/design/41-caregiver-rest.md rules R1 to R6). A pure function of its input: no I/O, no
/// clock, no judgement. It works on UTC instants and uses the person's zone only to place the night window and the work
/// windows, so a daylight-saving night is computed on real instants. It returns the parts only; no total, score or comparison.
/// </summary>
public static class RestEstimator
{
    /// <summary>Own events and the baby's final wake are looked for up to this long after the night window ends (R5 "first event of the day").</summary>
    public static readonly TimeSpan MorningHorizon = TimeSpan.FromHours(4);

    /// <summary>An event logged later than this after it started is a backfill and proves nothing about who was awake.</summary>
    public static readonly TimeSpan BackfillTolerance = TimeSpan.FromMinutes(15);

    public static RestNight Estimate(RestInput input)
    {
        var settings = input.Settings;
        var constants = new RestConstants(settings.FallAsleepMinutes, settings.WakeLeadMinutes);
        if (!settings.Enabled)
        {
            return new RestNight(input.Night, RestStatus.Disabled, [], false, constants);
        }

        return new Run(input, constants).Execute();
    }

    private readonly record struct Span(DateTimeOffset Start, DateTimeOffset End);

    private sealed class Run
    {
        private readonly RestInput _input;
        private readonly RestConstants _constants;
        private readonly TimeZoneInfo _zone;
        private readonly TimeSpan _fall;
        private readonly TimeSpan _lead;
        private readonly DateTimeOffset _nightStart;
        private readonly DateTimeOffset _nightEnd;
        private readonly DateTimeOffset _horizon;
        private readonly List<Span> _work;
        private readonly List<RestPart> _parts = [];
        private List<Span> _allAsleep = [];
        private List<DateTimeOffset> _own = [];
        private DateTimeOffset? _finalWake;
        private DateTimeOffset _skipUntil = DateTimeOffset.MinValue;
        private (DateTimeOffset From, DateTimeOffset At)? _pendingResume;

        public Run(RestInput input, RestConstants constants)
        {
            _input = input;
            _constants = constants;
            var s = input.Settings;
            _zone = TimeZoneInfo.FindSystemTimeZoneById(s.TimeZone);
            _fall = TimeSpan.FromMinutes(s.FallAsleepMinutes);
            _lead = TimeSpan.FromMinutes(s.WakeLeadMinutes);
            _nightStart = ToUtc(input.Night, s.NightStart);
            var endDate = s.NightEnd <= s.NightStart ? input.Night.AddDays(1) : input.Night;
            _nightEnd = ToUtc(endDate, s.NightEnd);
            _horizon = _nightEnd + MorningHorizon;
            _work = BuildWorkWindows();
        }

        public RestNight Execute()
        {
            var now = _input.Now;
            var events = _input.Events.ToList();

            var sleeps = events.Where(e => e.IsBabySleep && e.StartedAt <= now).ToList();
            if (!sleeps.Any(e => e.StartedAt >= _nightStart && e.StartedAt < _nightEnd))
            {
                return Result(RestStatus.NotEnoughLog, false);
            }

            // The babies that matter tonight: those with a sleep overlapping the night window (R: every baby must be asleep).
            var babies = sleeps
                .Where(e => e.StartedAt < _nightEnd && (e.EndedAt is null || e.EndedAt > _nightStart))
                .Select(e => e.BabyId)
                .Distinct()
                .ToList();
            _allAsleep = AllAsleep(sleeps, babies);
            var triggers = _allAsleep.Where(a => a.Start >= _nightStart && a.Start < _nightEnd).ToList();
            if (triggers.Count == 0)
            {
                return Result(RestStatus.Ok, false);
            }

            var last = triggers[^1];
            _finalWake = last.End == DateTimeOffset.MaxValue ? null : last.End;

            _own = events
                .Where(e => e.CreatedBy == _input.PersonId
                    && !e.Imported
                    && !e.IsBabySleep
                    && e.StartedAt <= now
                    && e.CreatedAt - e.StartedAt <= BackfillTolerance
                    && !InWork(e.StartedAt))
                .Select(e => e.StartedAt)
                .OrderBy(x => x)
                .ToList();

            foreach (var trigger in triggers)
            {
                DrainResume(trigger.Start);
                if (trigger.Start <= _skipUntil || trigger.Start > now)
                {
                    continue;
                }

                if (_input.MorningAnswer is { } answer && trigger.Start >= answer)
                {
                    continue;
                }

                TryRest(trigger.Start, trigger.Start + _fall, resume: false);
            }

            DrainResume(DateTimeOffset.MaxValue);

            var first = triggers[0].Start;
            var ownAfterBed = _own.Any(e => e > first && e < _horizon);
            var ask = _finalWake is not null
                && _finalWake <= now
                && !ownAfterBed
                && _input.MorningAnswer is null
                && _parts.Count > 0
                && _parts[^1].EndSource == RestEndSource.BabyFinalWake;
            return Result(RestStatus.Ok, ask);
        }

        private RestNight Result(RestStatus status, bool ask) => new(_input.Night, status, _parts, ask, _constants);

        private void DrainResume(DateTimeOffset before)
        {
            while (_pendingResume is { } pending && pending.At <= before)
            {
                _pendingResume = null;
                TryRest(pending.From, pending.At, resume: true);
            }
        }

        // Tries to start a rest part from a trigger (or from the end of a work window). Returns true when a part was added.
        private bool TryRest(DateTimeOffset from, DateTimeOffset candidate, bool resume)
        {
            var start = candidate;
            var source = resume ? RestStartSource.WorkWindowEnd : RestStartSource.BabyLog;
            while (WorkContaining(start) is { } window)
            {
                start = window.End;
                source = RestStartSource.WorkWindowEnd;
            }

            if (source == RestStartSource.WorkWindowEnd && (!AsleepAt(start) || start >= _nightEnd))
            {
                return false;
            }

            if (start > _input.Now || (_input.MorningAnswer is { } a && start >= a))
            {
                return false;
            }

            DateTimeOffset? own = null;
            foreach (var e in _own)
            {
                if (e > from && e < _horizon)
                {
                    own = e;
                    break;
                }
            }

            DateTimeOffset? end = null;
            var endSource = RestEndSource.Ongoing;
            var confidence = RestConfidence.Normal;

            void Consider(DateTimeOffset at, RestEndSource sourceOf, RestConfidence conf)
            {
                if (at > start && (end is null || at < end))
                {
                    end = at;
                    endSource = sourceOf;
                    confidence = conf;
                }
            }

            if (own is { } ownAt)
            {
                if (ownAt - _lead <= start)
                {
                    // The person was up: the event comes before the rest could begin.
                    if (ownAt > _skipUntil)
                    {
                        _skipUntil = ownAt;
                    }

                    return false;
                }

                Consider(ownAt - _lead, RestEndSource.OwnEvent, RestConfidence.Normal);
            }

            foreach (var w in _work.OrderBy(x => x.Start))
            {
                if (w.Start > start && w.Start < _horizon)
                {
                    Consider(w.Start, RestEndSource.WorkWindow, RestConfidence.Normal);
                    break;
                }
            }

            if (_input.MorningAnswer is { } answer)
            {
                Consider(answer, RestEndSource.Confirmed, RestConfidence.Normal);
            }

            if (own is null && _input.MorningAnswer is null && _finalWake is { } wake)
            {
                if (wake <= start && end is null)
                {
                    return false;
                }

                Consider(wake, RestEndSource.BabyFinalWake, RestConfidence.Low);
            }

            _parts.Add(new RestPart(start, end, source, endSource, confidence));
            _pendingResume = null;
            switch (endSource)
            {
                case RestEndSource.OwnEvent:
                    _skipUntil = own!.Value;
                    break;
                case RestEndSource.WorkWindow:
                    var cutAt = end!.Value;
                    _skipUntil = cutAt;
                    var resumeAt = cutAt;
                    while (WorkContaining(resumeAt) is { } w)
                    {
                        resumeAt = w.End;
                    }

                    _pendingResume = (cutAt, resumeAt);
                    break;
                default:
                    _skipUntil = DateTimeOffset.MaxValue;
                    break;
            }

            return true;
        }

        private bool AsleepAt(DateTimeOffset at) => _allAsleep.Any(a => a.Start <= at && at < a.End);

        private bool InWork(DateTimeOffset at) => WorkContaining(at) is not null;

        private Span? WorkContaining(DateTimeOffset at)
        {
            foreach (var w in _work)
            {
                if (w.Start <= at && at < w.End)
                {
                    return w;
                }
            }

            return null;
        }

        private DateTimeOffset ToUtc(DateOnly date, TimeOnly time)
        {
            var local = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
            // A gap time (spring forward) gets the standard offset, so it lands just after the gap; an ambiguous time the standard (later) one.
            var offset = _zone.GetUtcOffset(local);
            return new DateTimeOffset(local - offset, TimeSpan.Zero);
        }

        private List<Span> BuildWorkWindows()
        {
            var spans = new List<Span>();
            for (var day = _input.Night.AddDays(-2); day <= _input.Night.AddDays(3); day = day.AddDays(1))
            {
                var iso = day.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)day.DayOfWeek;
                foreach (var window in _input.Settings.WorkWindows)
                {
                    if (!window.Days.Contains(iso))
                    {
                        continue;
                    }

                    var endDay = window.End <= window.Start ? day.AddDays(1) : day;
                    spans.Add(new Span(ToUtc(day, window.Start), ToUtc(endDay, window.End)));
                }
            }

            return spans;
        }

        // Intervals during which every one of the babies is asleep (an open sleep runs to MaxValue).
        private static List<Span> AllAsleep(List<RestEvent> sleeps, List<Guid> babies)
        {
            List<Span>? acc = null;
            foreach (var baby in babies)
            {
                var merged = Merge(sleeps.Where(s => s.BabyId == baby)
                    .Select(s => new Span(s.StartedAt, s.EndedAt ?? DateTimeOffset.MaxValue))
                    .Where(s => s.End > s.Start));
                acc = acc is null ? merged : Intersect(acc, merged);
            }

            return acc ?? [];
        }

        private static List<Span> Merge(IEnumerable<Span> spans)
        {
            var result = new List<Span>();
            foreach (var s in spans.OrderBy(x => x.Start))
            {
                if (result.Count > 0 && s.Start <= result[^1].End)
                {
                    var prev = result[^1];
                    result[^1] = new Span(prev.Start, s.End > prev.End ? s.End : prev.End);
                }
                else
                {
                    result.Add(s);
                }
            }

            return result;
        }

        private static List<Span> Intersect(List<Span> a, List<Span> b)
        {
            var result = new List<Span>();
            int i = 0, j = 0;
            while (i < a.Count && j < b.Count)
            {
                var start = a[i].Start > b[j].Start ? a[i].Start : b[j].Start;
                var end = a[i].End < b[j].End ? a[i].End : b[j].End;
                if (end > start)
                {
                    result.Add(new Span(start, end));
                }

                if (a[i].End < b[j].End)
                {
                    i++;
                }
                else
                {
                    j++;
                }
            }

            return result;
        }
    }
}
