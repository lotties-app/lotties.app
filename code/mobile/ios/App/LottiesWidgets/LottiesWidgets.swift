import AppIntents
import SwiftUI
import WidgetKit

/*
 * The Lotties widgets (docs/design/37-widgets-siri.md): the selected baby's sleep state, last feed and last diaper, read
 * from the snapshot the app keeps in the App Group container. Times are live (`Text(date, style: .relative)`), so the
 * widgets stay right between refreshes. The buttons (iOS 17) run the same intents Siri does.
 *
 * Look: "Linen & Ink" (docs/design/02-visual-identity.md, code/web/src/theme/tokens.ts): paper and ink by day, ink by
 * night (the system appearance), terracotta accent, one tint per category, Tabler icons at a 1.5 stroke, a serif for
 * the big numbers.
 */

// MARK: Data

struct LottiesEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    /// What the three configurable buttons log (the widget's configuration); the defaults when it has none.
    var slots: [WidgetActivity] = WidgetActivity.defaultSlots
    /// The choices the widget shows instead of its buttons (a tap on Diaper, Bottle, Breast or More), if one is open.
    var picker: PickerTarget?
}

extension WidgetActivity {
    static let defaultSlots: [WidgetActivity] = [.bottle, .diaper, .breast]
}

private struct LottiesNowKey: EnvironmentKey {
    static let defaultValue = Date()
}

extension EnvironmentValues {
    /// The moment the timeline entry stands for (WidgetKit renders entries ahead of time, so `Date()` would be wrong).
    fileprivate var lottiesNow: Date {
        get { self[LottiesNowKey.self] }
        set { self[LottiesNowKey.self] = newValue }
    }
}

/// What the gallery and the placeholder show: invented, never a real child.
private func sampleSnapshot(now: Date = Date()) -> WidgetSnapshot {
    let baby = WidgetSnapshot.Baby(
        id: "sample", name: "Lia",
        sleep: .init(state: "awake", startedAt: now.addingTimeInterval(-70 * 60)),
        lastFeed: .init(at: now.addingTimeInterval(-95 * 60), kind: "bottle", amountMl: 120, side: nil),
        lastDiaper: .init(at: now.addingTimeInterval(-40 * 60), kind: "wet"),
        nextNap: .init(
            earliest: now.addingTimeInterval(25 * 60), expected: now.addingTimeInterval(40 * 60),
            latest: now.addingTimeInterval(55 * 60)),
        nextFeed: .init(at: now.addingTimeInterval(12 * 60), amountMl: 120),
        nextDiaper: .init(at: now.addingTimeInterval(50 * 60), kind: "wet"))
    return WidgetSnapshot(
        version: 1, updatedAt: now, signedIn: true, selectedBabyId: "sample",
        hideNamesOnLockScreen: false, babies: [baby])
}

struct LottiesProvider: TimelineProvider {
    func placeholder(in context: Context) -> LottiesEntry {
        LottiesEntry(date: Date(), snapshot: sampleSnapshot())
    }

    func getSnapshot(in context: Context, completion: @escaping (LottiesEntry) -> Void) {
        let snapshot = context.isPreview ? sampleSnapshot() : LottiesShared.readSnapshot()
        completion(LottiesEntry(date: Date(), snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LottiesEntry>) -> Void) {
        completion(lottiesTimeline(slots: WidgetActivity.defaultSlots))
    }
}

/// One entry now, one at each moment an action starts or stops being "coming up" (the highlight changes without the app
/// opening) and one at each moment a text changes with time alone (`textChanges`: the rows' "há 35 min", an estimate
/// passing, midnight), so the widget stays right even when WidgetKit's budget delays the reload asked for in 15 minutes.
/// Each snapshot the app writes reloads the timeline (`reloadAllTimelines`). docs/design/37-widgets-siri.md "Freshness".
private func lottiesTimeline(slots: [WidgetActivity]) -> Timeline<LottiesEntry> {
    let now = Date()
    let snapshot = LottiesShared.readSnapshot()
    if let open = LottiesPicker.current(at: now) {
        // The choices stay for a few seconds, then the buttons come back by themselves.
        return Timeline(
            entries: [
                LottiesEntry(date: now, snapshot: snapshot, slots: slots, picker: open.target),
                LottiesEntry(date: open.until, snapshot: snapshot, slots: slots),
            ], policy: .after(open.until))
    }
    var dates: Set<Date> = [now]
    if let baby = snapshot?.selectedBaby {
        dates.formUnion(baby.dueChanges(after: now).prefix(8))
        dates.formUnion(baby.textChanges(after: now))
    }
    let next = Calendar.current.date(byAdding: .minute, value: 15, to: now) ?? now
    return Timeline(
        entries: dates.sorted().map { LottiesEntry(date: $0, snapshot: snapshot, slots: slots) }, policy: .after(next))
}

/// "Edit widget": what each of the three buttons logs. Anything the app can log with one tap is on the list.
struct LottiesButtonsIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Buttons"
    static var description = IntentDescription("Choose what each button of the widget logs.")

    @Parameter(title: "Button 1", default: .bottle)
    var first: WidgetActivity

    @Parameter(title: "Button 2", default: .diaper)
    var second: WidgetActivity

    @Parameter(title: "Button 3", default: .breast)
    var third: WidgetActivity

    var slots: [WidgetActivity] { [first, second, third] }
}

struct LottiesConfigProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> LottiesEntry {
        LottiesEntry(date: Date(), snapshot: sampleSnapshot())
    }

    func snapshot(for configuration: LottiesButtonsIntent, in context: Context) async -> LottiesEntry {
        let snapshot = context.isPreview ? sampleSnapshot() : LottiesShared.readSnapshot()
        return LottiesEntry(date: Date(), snapshot: snapshot, slots: configuration.slots)
    }

    func timeline(for configuration: LottiesButtonsIntent, in context: Context) async -> Timeline<LottiesEntry> {
        lottiesTimeline(slots: configuration.slots)
    }
}

// MARK: Look

private extension Color {
    /// One colour for the light (Linen) and one for the dark (Ink) appearance.
    init(_ light: UInt32, _ dark: UInt32) {
        self.init(UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((value >> 16) & 0xff) / 255,
                green: CGFloat((value >> 8) & 0xff) / 255,
                blue: CGFloat(value & 0xff) / 255,
                alpha: 1)
        })
    }
}

private enum Ink {
    static let background = Color(0xf5efe4, 0x1b1814)
    static let text = Color(0x2a251f, 0xf2eadc)
    static let muted = Color(0x6a6054, 0xb5aa99)
    static let accent = Color(0xa8482a, 0xe58f68)
    static let hairline = Color(0xd9cfbd, 0x3a342b)
}

/// The category tints of the app (tokens.ts `category`): the tint behind an icon and the stronger tone of the icon.
private enum Category {
    case sleep, feeding, diaper, care

    var tint: Color {
        switch self {
        case .sleep: return Color(0xe2e7f0, 0x26303f)
        case .feeding: return Color(0xe1eadb, 0x263425)
        case .diaper: return Color(0xf2e5c6, 0x3a3120)
        case .care: return Color(0xdcebe8, 0x1f3330)
        }
    }

    var tone: Color {
        switch self {
        case .sleep: return Color(0x2c4870, 0xa9c1e3)
        case .feeding: return Color(0x375f39, 0xa9cf9f)
        case .diaper: return Color(0x6e4e0e, 0xe8c47a)
        case .care: return Color(0x2f6b60, 0x9fd3c7)
        }
    }
}

private struct Icon: View {
    let name: String
    var size: CGFloat = 20

    var body: some View {
        Image("tabler-\(name)")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}

/// Runs an intent from a widget button (iOS 17); a plain label before that.
private struct Act<I: AppIntent, Content: View>: View {
    let intent: I
    let content: Content

    init(_ intent: I, @ViewBuilder content: () -> Content) {
        self.intent = intent
        self.content = content()
    }

    @ViewBuilder
    var body: some View {
        if #available(iOS 17.0, *) {
            Button(intent: intent) { content }.buttonStyle(.plain)
        } else {
            content
        }
    }
}

private func activityIntent(_ activity: WidgetActivity) -> LogActivityIntent {
    var intent = LogActivityIntent()
    intent.activity = activity
    return intent
}

private extension WidgetActivity {
    var category: Category {
        switch self {
        case .bottle, .breast: return .feeding
        case .diaper: return .diaper
        default: return .care
        }
    }
}

private func diaperIntent(_ content: DiaperContent) -> LogDiaperIntent {
    var intent = LogDiaperIntent()
    intent.content = content
    return intent
}

// MARK: Facts

private struct SleepFacts {
    let icon: String
    let caption: String
    let since: Date?
    let asleep: Bool

    init(_ baby: WidgetSnapshot.Baby) {
        asleep = baby.sleep?.state == "asleep"
        since = baby.sleep?.startedAt
        icon = asleep ? "zzz" : "sun"
        if baby.sleep == nil {
            caption = LottiesText.t("Sono", "Sleep")
        } else {
            caption = asleep ? LottiesText.t("Dormindo há", "Asleep for") : LottiesText.t("Acordado há", "Awake for")
        }
    }
}

/// How long ago (live), or "Nada hoje" when the event is not from today.
private struct AgoText: View {
    @Environment(\.lottiesNow) private var now
    let date: Date?
    /// "há 2 h 30+" / "2 h 30+ ago" (rounded down to the half hour) as of the entry's date (short, for the rows) instead of the live "2 hrs, 39 min".
    var compact = false

    var body: some View {
        // "Today" as of the entry's moment, not of the render (WidgetKit renders entries ahead of time).
        if let date, Calendar.current.isDate(date, inSameDayAs: now) {
            if compact {
                let text = LottiesText.agoRounded(date, now: now)
                if text == LottiesText.t("agora", "just now") {
                    Text(text)
                } else {
                    Text(LottiesText.t("há \(text)", "\(text) ago"))
                }
            } else {
                Text(date, style: .relative).monospacedDigit()
            }
        } else {
            Text(LottiesText.t("Nada hoje", "Nothing today"))
        }
    }
}

/// An estimate still ahead of now ("Próx. 15:10"); nothing for a time already past.
private struct NextText: View {
    @Environment(\.lottiesNow) private var now
    let label: String
    let date: Date?
    /// Keep showing the time for a little while after it (the action is "coming up" until 30 minutes past it).
    var showPast = false

    var body: some View {
        if let date, date > now || showPast {
            (Text("\(label) ") + Text(date, style: .time)).monospacedDigit()
        }
    }
}

private func feedDetail(_ feed: WidgetSnapshot.Feed?) -> String? {
    guard let feed else { return nil }
    if feed.kind == "bottle" {
        let name = LottiesText.t("Mamadeira", "Bottle")
        return feed.amountMl.map { "\(name) · \($0) ml" } ?? name
    }
    return LottiesText.t("Peito", "Breast")
}

// MARK: Pieces

private struct SleepBlock: View {
    let facts: SleepFacts
    let name: String
    var big: CGFloat = 28
    var nextNap: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name).font(.caption).foregroundStyle(Ink.muted).lineLimit(1)
            HStack(spacing: 4) {
                Icon(name: facts.icon, size: 14)
                Text(facts.caption).font(.subheadline)
            }
            .foregroundStyle(Category.sleep.tone)
            if let since = facts.since {
                Text(since, style: .relative)
                    .font(.system(size: big, weight: .semibold, design: .serif))
                    .minimumScaleFactor(0.5)
                    .lineLimit(2)
                    .monospacedDigit()
                    .foregroundStyle(Ink.text)
            } else {
                Text("—").font(.system(size: big, weight: .semibold, design: .serif)).foregroundStyle(Ink.text)
            }
            if !facts.asleep {
                NextText(label: LottiesText.t("Próxima soneca", "Next nap"), date: nextNap)
                    .font(.caption).foregroundStyle(Category.sleep.tone).lineLimit(1).minimumScaleFactor(0.7)
            }
        }
    }
}

private struct SleepButton: View {
    let facts: SleepFacts
    /// The nap window is coming up: "Soneca 14:20" replaces "Fell asleep", filled in the accent colour.
    var napDue: Date?

    private var label: some View {
        HStack(spacing: 6) {
            Icon(name: facts.asleep ? "sun" : "moon-stars", size: 16)
            if let napDue {
                (Text("\(LottiesText.t("Soneca", "Nap")) ") + Text(napDue, style: .time))
                    .font(.subheadline.weight(.semibold)).monospacedDigit()
            } else {
                Text(facts.asleep ? LottiesText.t("Acordou", "Woke up") : LottiesText.t("Dormiu", "Fell asleep"))
                    .font(.subheadline.weight(.semibold))
            }
        }
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity)
        .foregroundStyle(napDue != nil ? Ink.background : Ink.accent)
        .background(napDue != nil ? Ink.accent : Ink.accent.opacity(0.12), in: Capsule())
        .overlay(Capsule().stroke(Ink.accent, lineWidth: 1.5))
    }

    @ViewBuilder
    var body: some View {
        if facts.asleep {
            Act(BabyWokeUpIntent()) { label }
        } else {
            Act(BabyFellAsleepIntent()) { label }
        }
    }
}

/// A row of the medium widget: icon, name (and the estimate under it when there is one), and on the right how long ago the
/// last one was ("há 1 h 5"). No borders; only the row that is coming up gets the category tint.
private struct RowTile<I: AppIntent>: View {
    let icon: String
    let title: String
    let date: Date?
    let category: Category
    let intent: I
    var next: Date?
    /// Coming up now: a tinted fill in the category colour and the estimate kept on screen.
    var due = false

    var body: some View {
        Act(intent) {
            HStack(spacing: 8) {
                Icon(name: icon, size: 20)
                    .foregroundStyle(category.tone)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.system(size: 14)).foregroundStyle(Ink.text)
                        .lineLimit(1).minimumScaleFactor(0.8)
                    NextText(label: LottiesText.t("próx.", "next"), date: next, showPast: due)
                        .font(.system(size: 11)).foregroundStyle(category.tone)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                Spacer(minLength: 4)
                AgoText(date: date, compact: true)
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(Ink.text)
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 8)
            .frame(maxHeight: .infinity)
            .background(due ? category.tint : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
}

/// A tinted square: icon over label (quick actions, large widget).
private struct SquareTile<I: AppIntent>: View {
    let icon: String
    let title: String
    let category: Category
    let intent: I
    var due = false

    var body: some View {
        Act(intent) {
            VStack(spacing: 4) {
                Icon(name: icon, size: 24)
                Text(title).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
            }
            .foregroundStyle(category.tone)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(category.tint, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(category.tone, lineWidth: due ? 2.5 : 0))
        }
    }
}

/// A row of the medium widget for one activity: when it last happened, and the estimate when the app has one.
private struct ActivityRow: View {
    let activity: WidgetActivity
    let baby: WidgetSnapshot.Baby
    let due: WidgetSnapshot.Baby.Due

    private var last: Date? {
        switch activity {
        case .bottle: return baby.lastFeed?.kind == "bottle" ? baby.lastFeed?.at : nil
        case .breast: return baby.lastFeed?.kind == "bottle" ? nil : baby.lastFeed?.at
        case .diaper: return baby.lastDiaper?.at
        default: return activity.eventKey.flatMap { baby.lastActivity?[$0] }
        }
    }

    private var next: Date? {
        switch activity {
        case .bottle: return baby.nextFeed?.at
        case .diaper: return baby.nextDiaper?.at
        default: return nil
        }
    }

    private var isDue: Bool {
        switch activity {
        case .bottle: return due.feed
        case .diaper: return due.diaperKind != nil
        default: return false
        }
    }

    @ViewBuilder
    var body: some View {
        if let target = activity.pickerTarget {
            RowTile(
                icon: activity.icon, title: activity.title, date: last, category: activity.category,
                intent: pickerIntent(target), next: next, due: isDue)
        } else {
            RowTile(
                icon: activity.icon, title: activity.title, date: last, category: activity.category,
                intent: activityIntent(activity), next: next, due: isDue)
        }
    }
}

/// A square button for one activity (large and quick-actions widgets, activities panel).
private struct ActivitySquare: View {
    let activity: WidgetActivity
    let due: WidgetSnapshot.Baby.Due

    private var isDue: Bool {
        switch activity {
        case .bottle, .breast: return due.feed
        case .diaper: return due.diaperKind != nil
        default: return false
        }
    }

    @ViewBuilder
    var body: some View {
        if let target = activity.pickerTarget {
            SquareTile(
                icon: activity.icon, title: activity.title, category: activity.category,
                intent: pickerIntent(target), due: isDue)
        } else {
            SquareTile(
                icon: activity.icon, title: activity.title, category: activity.category,
                intent: activityIntent(activity), due: isDue)
        }
    }
}

private func pickerIntent(_ target: PickerTarget) -> OpenPickerIntent {
    var intent = OpenPickerIntent()
    intent.target = target
    return intent
}

private func choiceIntent(_ activity: WidgetActivity, _ option: String) -> LogChoiceIntent {
    var intent = LogChoiceIntent()
    intent.activity = activity
    intent.option = option
    return intent
}

private func feedTimerIntent(_ action: FeedTimerAction) -> FeedTimerIntent {
    var intent = FeedTimerIntent()
    intent.action = action
    return intent
}

/// "More": the small button that opens the list of every activity.
private struct MoreSquare: View {
    var body: some View {
        SquareTile(
            icon: "dots", title: LottiesText.t("Mais", "More"), category: .care, intent: pickerIntent(.more))
    }
}

/// "More": the last row of the medium widget; opens the list of every activity.
private struct MoreRow: View {
    var body: some View {
        Act(pickerIntent(.more)) {
            HStack(spacing: 8) {
                Icon(name: "dots", size: 20).foregroundStyle(Ink.muted).frame(width: 24)
                Text(LottiesText.t("Mais", "More")).font(.system(size: 14)).foregroundStyle(Ink.muted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(maxHeight: .infinity)
        }
    }
}

/// The bottle or breastfeed running now: its time, and pause or resume and stop.
private struct RunningFeedRow: View {
    let run: WidgetSnapshot.RunningFeed

    private var title: String {
        run.kind == "bottle" ? LottiesText.t("Mamadeira", "Bottle") : LottiesText.t("Peito", "Breast")
    }

    private func circle(_ icon: String) -> some View {
        Icon(name: icon, size: 15)
            .foregroundStyle(Category.feeding.tone)
            .frame(width: 30, height: 30)
            .background(Ink.background.opacity(0.6), in: Circle())
            .overlay(Circle().stroke(Category.feeding.tone, lineWidth: 1))
    }

    var body: some View {
        HStack(spacing: 6) {
            Icon(name: run.kind == "bottle" ? "bottle" : "heart", size: 18).foregroundStyle(Category.feeding.tone)
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Ink.text).lineLimit(1)
                Group {
                    if run.paused {
                        Text("\(run.elapsedSeconds / 60) min · \(LottiesText.t("pausada", "paused"))")
                    } else {
                        Text(run.since, style: .timer)
                    }
                }
                .font(.caption2).monospacedDigit().foregroundStyle(Ink.muted).lineLimit(1)
            }
            Spacer(minLength: 0)
            if run.kind == "bottle" {
                Act(feedTimerIntent(run.paused ? .resume : .pause)) { circle(run.paused ? "player-play" : "player-pause") }
            }
            Act(feedTimerIntent(.stop)) { circle("player-stop") }
        }
        .padding(.horizontal, 8)
        .frame(maxHeight: .infinity)
        .background(Category.feeding.tint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Category.feeding.tone, lineWidth: 1.5))
    }
}

/// A choice button of the open picker: a word or a number, tinted like its category.
private struct ChoiceChip<I: AppIntent>: View {
    let title: String
    let category: Category
    let intent: I

    var body: some View {
        Act(intent) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .foregroundStyle(category.tone)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(category.tint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

/// What a tap on Diaper, Bottle, Breast or More opens inside the widget (works offline, no app).
private struct PickerPanel: View {
    let target: PickerTarget
    let baby: WidgetSnapshot.Baby
    let due: WidgetSnapshot.Baby.Due
    /// The small widget: the amounts go in two rows of two, the title is a size smaller.
    var compact = false

    private var title: String {
        switch target {
        case .diaper: return LottiesText.t("Fralda: o que foi?", "Diaper: what was it?")
        case .bottle: return LottiesText.t("Mamadeira: quantos ml?", "Bottle: how many ml?")
        case .breast: return LottiesText.t("Peito: qual lado?", "Breast: which side?")
        case .more: return LottiesText.t("Mais atividades", "More activities")
        }
    }

    private var amounts: [Int] {
        var list: [Int] = []
        if let last = baby.lastFeed, last.kind == "bottle", let ml = last.amountMl, ml > 0 { list.append(ml) }
        for ml in [60, 90, 120, 150] where !list.contains(ml) { list.append(ml) }
        return Array(list.prefix(4))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 4 : 8) {
            HStack {
                Text(title).font((compact ? Font.caption : Font.subheadline).weight(.semibold))
                    .foregroundStyle(Ink.text).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Act(ClosePickerIntent()) {
                    Icon(name: "x", size: 16).foregroundStyle(Ink.muted).padding(4)
                }
            }
            switch target {
            case .diaper:
                HStack(spacing: 8) {
                    ChoiceChip(title: LottiesText.t("Xixi", "Wet"), category: .diaper, intent: choiceIntent(.diaper, "wet"))
                    ChoiceChip(title: LottiesText.t("Cocô", "Dirty"), category: .diaper, intent: choiceIntent(.diaper, "dirty"))
                    ChoiceChip(title: LottiesText.t("Os dois", "Both"), category: .diaper, intent: choiceIntent(.diaper, "mixed"))
                }
            case .bottle:
                if compact {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 2), spacing: 6) {
                        ForEach(amounts, id: \.self) { ml in
                            ChoiceChip(title: "\(ml) ml", category: .feeding, intent: choiceIntent(.bottle, String(ml)))
                                .frame(height: 32)
                        }
                    }
                } else {
                    HStack(spacing: 8) {
                        ForEach(amounts, id: \.self) { ml in
                            ChoiceChip(title: "\(ml) ml", category: .feeding, intent: choiceIntent(.bottle, String(ml)))
                        }
                    }
                }
            case .breast:
                HStack(spacing: 8) {
                    ChoiceChip(title: LottiesText.t("Esquerdo", "Left"), category: .feeding, intent: choiceIntent(.breast, "left"))
                    ChoiceChip(title: LottiesText.t("Direito", "Right"), category: .feeding, intent: choiceIntent(.breast, "right"))
                }
            case .more:
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(WidgetActivity.panel, id: \.self) { activity in
                        ActivitySquare(activity: activity, due: due).frame(height: 44)
                    }
                }
            }
        }
    }
}

/// The tiles of the quick-actions widget: the three chosen buttons (or pause and stop while a feed runs) and More.
private enum QuickItem: Hashable {
    case activity(WidgetActivity)
    case pause(Bool)
    case stop
    case more

    static func items(slots: [WidgetActivity], run: WidgetSnapshot.RunningFeed?) -> [QuickItem] {
        var items: [QuickItem] = []
        if let run {
            if run.kind == "bottle" { items.append(.pause(run.paused)) }
            items.append(.stop)
            items += slots.filter { !$0.isFeed }.map { QuickItem.activity($0) }
        } else {
            items = slots.map { QuickItem.activity($0) }
        }
        return Array(items.prefix(3)) + [.more]
    }
}

/// One tile of the quick buttons: a chosen activity, pause or resume, stop, or More (quick-actions and adaptive widgets).
private struct QuickItemTile: View {
    let item: QuickItem
    let due: WidgetSnapshot.Baby.Due

    @ViewBuilder
    var body: some View {
        switch item {
        case .activity(let activity):
            ActivitySquare(activity: activity, due: due)
        case .pause(let paused):
            SquareTile(
                icon: paused ? "player-play" : "player-pause",
                title: paused ? LottiesText.t("Retomar", "Resume") : LottiesText.t("Pausar", "Pause"),
                category: .feeding, intent: feedTimerIntent(paused ? .resume : .pause))
        case .stop:
            SquareTile(
                icon: "player-stop", title: LottiesText.t("Parar", "Stop"),
                category: .feeding, intent: feedTimerIntent(.stop))
        case .more:
            MoreSquare()
        }
    }
}

/// The sleep tile of the quick buttons: "Woke up" while asleep, else "Asleep" (framed while the nap is coming up).
private struct SleepSquare: View {
    let facts: SleepFacts
    let due: WidgetSnapshot.Baby.Due

    @ViewBuilder
    var body: some View {
        if facts.asleep {
            SquareTile(icon: "sun", title: LottiesText.t("Acordou", "Woke up"),
                       category: .sleep, intent: BabyWokeUpIntent())
        } else {
            SquareTile(icon: "moon-stars", title: LottiesText.t("Dormiu", "Asleep"),
                       category: .sleep, intent: BabyFellAsleepIntent(), due: due.nap)
        }
    }
}

private struct OpenHint: View {
    let lockScreen: Bool

    var body: some View {
        VStack(spacing: 4) {
            Icon(name: "moon-stars", size: 22)
            Text(LottiesText.t("Abra o Lotties", "Open Lotties")).font(.caption.bold())
        }
        .foregroundStyle(lockScreen ? Color.primary : Ink.text)
    }
}

private extension WidgetFamily {
    var isLockScreen: Bool {
        self == .accessoryCircular || self == .accessoryRectangular || self == .accessoryInline
    }
}

private extension View {
    @ViewBuilder
    func lottiesBackground(_ family: WidgetFamily) -> some View {
        if family.isLockScreen {
            if #available(iOS 17.0, *) {
                self.containerBackground(for: .widget) { Color.clear }
            } else {
                self
            }
        } else if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { Ink.background }
        } else {
            self.padding().background(Ink.background)
        }
    }
}

/// Shared by every widget: reads the entry, shows the hint when there is no signed-in data, adds the background.
private struct Host<Content: View>: View {
    @Environment(\.widgetFamily) private var family
    let entry: LottiesEntry
    let content: (WidgetSnapshot, WidgetSnapshot.Baby, WidgetFamily) -> Content

    init(
        entry: LottiesEntry,
        @ViewBuilder content: @escaping (WidgetSnapshot, WidgetSnapshot.Baby, WidgetFamily) -> Content
    ) {
        self.entry = entry
        self.content = content
    }

    var body: some View {
        Group {
            if let snapshot = entry.snapshot, snapshot.signedIn, let baby = snapshot.selectedBaby {
                content(snapshot, baby, family)
            } else {
                OpenHint(lockScreen: family.isLockScreen)
            }
        }
        .environment(\.lottiesNow, entry.date)
        .lottiesBackground(family)
    }
}

// MARK: Lock screen (shared by the widgets)

@ViewBuilder
private func lockScreen(
    _ family: WidgetFamily, _ snapshot: WidgetSnapshot, _ baby: WidgetSnapshot.Baby, icon: String, date: Date?
) -> some View {
    switch family {
    case .accessoryCircular:
        ZStack {
            AccessoryWidgetBackground()
            Icon(name: icon, size: 26)
        }
    case .accessoryInline:
        Label {
            if let date { Text(date, style: .relative) } else { Text("—") }
        } icon: {
            Icon(name: icon, size: 14)
        }
    default:
        VStack(alignment: .leading, spacing: 1) {
            if snapshot.hideNamesOnLockScreen == false { Text(baby.name).font(.caption.bold()) }
            Label {
                if let s = SleepFacts(baby).since { Text(s, style: .relative) } else { Text("—") }
            } icon: { Icon(name: SleepFacts(baby).icon, size: 14) }
            Label { AgoText(date: baby.lastFeed?.at) } icon: { Icon(name: "bottle", size: 14) }
            Label { AgoText(date: baby.lastDiaper?.at) } icon: { Icon(name: "diaper", size: 14) }
        }
        .font(.caption)
    }
}

// MARK: Widget 1: summary (small, medium, large, lock screen)

struct LottiesSummaryWidget: Widget {
    let kind = "LottiesWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: LottiesButtonsIntent.self, provider: LottiesConfigProvider()) { entry in
            Host(entry: entry) { snapshot, baby, family in
                let facts = SleepFacts(baby)
                let due = baby.due(at: entry.date)
                switch family {
                case .accessoryCircular, .accessoryInline, .accessoryRectangular:
                    lockScreen(family, snapshot, baby, icon: facts.icon, date: facts.since)
                case .systemMedium:
                    if let picker = entry.picker {
                        PickerPanel(target: picker, baby: baby, due: due)
                    } else {
                        SummaryMedium(entry: entry, baby: baby, facts: facts, due: due)
                    }
                case .systemLarge, .systemExtraLarge:
                    VStack(alignment: .leading, spacing: 10) {
                        SleepBlock(facts: facts, name: baby.name, big: 40, nextNap: baby.nextNap?.expected)
                        SleepButton(facts: facts, napDue: due.nap ? baby.nextNap?.expected : nil)
                        if let run = baby.runningFeed { RunningFeedRow(run: run).frame(height: 54) }
                        Group {
                            if let picker = entry.picker {
                                PickerPanel(target: picker, baby: baby, due: due)
                            } else {
                                HStack(spacing: 8) {
                                    ForEach(Array(entry.slots.enumerated()), id: \.offset) { _, activity in
                                        ActivitySquare(activity: activity, due: due)
                                    }
                                    MoreSquare()
                                }
                            }
                        }
                        .frame(maxHeight: .infinity)
                        Text(feedDetail(baby.lastFeed) ?? "")
                            .font(.caption).foregroundStyle(Ink.muted).lineLimit(1)
                        HStack(spacing: 10) {
                            NextText(label: LottiesText.t("Soneca", "Nap"), date: baby.nextNap?.expected)
                            NextText(label: LottiesText.t("Mamada", "Feed"), date: baby.nextFeed?.at)
                            NextText(label: LottiesText.t("Fralda", "Diaper"), date: baby.nextDiaper?.at)
                        }
                        .font(.caption).foregroundStyle(Ink.muted).lineLimit(1).minimumScaleFactor(0.7)
                    }
                default:
                    VStack(alignment: .leading, spacing: 6) {
                        SleepBlock(facts: facts, name: baby.name, big: 24, nextNap: baby.nextNap?.expected)
                        Spacer(minLength: 0)
                        SleepButton(facts: facts, napDue: due.nap ? baby.nextNap?.expected : nil)
                    }
                }
            }
        }
        .configurationDisplayName(LottiesText.t("Resumo", "Summary"))
        .description(LottiesText.t(
            "Sono e três botões à sua escolha (toque e segure para editar).",
            "Sleep and three buttons of your choice (touch and hold to edit)."))
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
    }
}

// MARK: Widget 2: sleep

struct LottiesSleepWidget: Widget {
    let kind = "LottiesSleepWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LottiesProvider()) { entry in
            Host(entry: entry) { snapshot, baby, family in
                let facts = SleepFacts(baby)
                let due = baby.due(at: entry.date)
                if family.isLockScreen {
                    lockScreen(family, snapshot, baby, icon: facts.icon, date: facts.since)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        SleepBlock(facts: facts, name: baby.name, big: 26, nextNap: baby.nextNap?.expected)
                        Spacer(minLength: 0)
                        SleepButton(facts: facts, napDue: due.nap ? baby.nextNap?.expected : nil)
                    }
                }
            }
        }
        .configurationDisplayName(LottiesText.t("Sono", "Sleep"))
        .description(LottiesText.t("Há quanto tempo dorme ou está acordado, e um toque para registrar.",
                                   "How long asleep or awake, and one tap to log."))
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: Widget 3: feed

struct LottiesFeedWidget: Widget {
    let kind = "LottiesFeedWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LottiesProvider()) { entry in
            Host(entry: entry) { snapshot, baby, family in
                let due = baby.due(at: entry.date)
                if family.isLockScreen {
                    lockScreen(family, snapshot, baby, icon: "bottle", date: baby.lastFeed?.at)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(baby.name).font(.caption).foregroundStyle(Ink.muted).lineLimit(1)
                        HStack(spacing: 4) {
                            Icon(name: "bottle", size: 14)
                            Text(LottiesText.t("Última mamada", "Last feed")).font(.subheadline)
                        }
                        .foregroundStyle(Category.feeding.tone)
                        Group {
                            if let at = baby.lastFeed?.at {
                                Text(at, style: .relative).monospacedDigit()
                            } else {
                                Text("—")
                            }
                        }
                        .font(.system(size: 24, weight: .semibold, design: .serif))
                        .minimumScaleFactor(0.5)
                        .lineLimit(2)
                        .foregroundStyle(Ink.text)
                        Text(feedDetail(baby.lastFeed) ?? "").font(.caption2).foregroundStyle(Ink.muted).lineLimit(1)
                        NextText(label: LottiesText.t("Próxima", "Next"), date: baby.nextFeed?.at)
                            .font(.caption2).foregroundStyle(Category.feeding.tone).lineLimit(1)
                        Spacer(minLength: 0)
                        HStack(spacing: 6) {
                            SquareTile(icon: "bottle", title: LottiesText.t("Mamadeira", "Bottle"),
                                       category: .feeding, intent: LogBottleIntent(), due: due.feed)
                            SquareTile(icon: "heart", title: LottiesText.t("Peito", "Breast"),
                                       category: .feeding, intent: LogBreastFeedIntent(), due: due.feed)
                        }
                        .frame(height: 46)
                    }
                }
            }
        }
        .configurationDisplayName(LottiesText.t("Mamada", "Feed"))
        .description(LottiesText.t("Última mamada e dois toques para registrar.", "Last feed and two taps to log."))
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: Widget 4: diaper

struct LottiesDiaperWidget: Widget {
    let kind = "LottiesDiaperWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LottiesProvider()) { entry in
            Host(entry: entry) { snapshot, baby, family in
                let due = baby.due(at: entry.date)
                if family.isLockScreen {
                    lockScreen(family, snapshot, baby, icon: "diaper", date: baby.lastDiaper?.at)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(baby.name).font(.caption).foregroundStyle(Ink.muted).lineLimit(1)
                        HStack(spacing: 4) {
                            Icon(name: "diaper", size: 14)
                            Text(LottiesText.t("Última fralda", "Last diaper")).font(.subheadline)
                        }
                        .foregroundStyle(Category.diaper.tone)
                        Group {
                            if let at = baby.lastDiaper?.at {
                                Text(at, style: .relative).monospacedDigit()
                            } else {
                                Text("—")
                            }
                        }
                        .font(.system(size: 24, weight: .semibold, design: .serif))
                        .minimumScaleFactor(0.5)
                        .lineLimit(2)
                        .foregroundStyle(Ink.text)
                        NextText(label: LottiesText.t("Próxima", "Next"), date: baby.nextDiaper?.at)
                            .font(.caption2).foregroundStyle(Category.diaper.tone).lineLimit(1)
                        Spacer(minLength: 0)
                        HStack(spacing: 6) {
                            SquareTile(icon: "droplet", title: LottiesText.t("Xixi", "Wet"),
                                       category: .diaper, intent: diaperIntent(.wet), due: due.diaperKind == "wet")
                            SquareTile(icon: "diaper", title: LottiesText.t("Cocô", "Dirty"),
                                       category: .diaper, intent: diaperIntent(.dirty), due: due.diaperKind == "dirty")
                        }
                        .frame(height: 46)
                    }
                }
            }
        }
        .configurationDisplayName(LottiesText.t("Fralda", "Diaper"))
        .description(LottiesText.t("Última fralda e toques para registrar xixi ou cocô.", "Last diaper and taps to log wet or dirty."))
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: Widget 5: quick actions

struct LottiesQuickWidget: Widget {
    let kind = "LottiesQuickWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: LottiesButtonsIntent.self, provider: LottiesConfigProvider()) { entry in
            Host(entry: entry) { _, baby, _ in
                let facts = SleepFacts(baby)
                let due = baby.due(at: entry.date)
                if let picker = entry.picker {
                    PickerPanel(target: picker, baby: baby, due: due)
                } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(baby.name).font(.caption).foregroundStyle(Ink.muted).lineLimit(1)
                    HStack(spacing: 8) {
                        ForEach(QuickItem.items(slots: entry.slots, run: baby.runningFeed), id: \.self) { item in
                            QuickItemTile(item: item, due: due)
                        }
                        SleepSquare(facts: facts, due: due)
                    }
                }
                }
            }
        }
        .configurationDisplayName(LottiesText.t("Ações rápidas", "Quick actions"))
        .description(LottiesText.t(
            "Três botões à sua escolha e o de sono, para registrar sem abrir o app.",
            "Three buttons of your choice and the sleep one, to log without opening the app."))
        .supportedFamilies([.systemMedium])
    }
}

// MARK: Widget 6: activities

struct LottiesActivitiesWidget: Widget {
    let kind = "LottiesActivitiesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LottiesProvider()) { entry in
            Host(entry: entry) { _, baby, _ in
                let due = baby.due(at: entry.date)
                VStack(alignment: .leading, spacing: 8) {
                    Text(baby.name).font(.caption).foregroundStyle(Ink.muted).lineLimit(1)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                        ForEach(WidgetActivity.panel, id: \.self) { activity in
                            ActivitySquare(activity: activity, due: due).frame(height: 54)
                        }
                    }
                }
            }
        }
        .configurationDisplayName(LottiesText.t("Atividades", "Activities"))
        .description(LottiesText.t(
            "Banho, massagem, bruços e outros: um toque registra.", "Bath, massage, tummy time and more: one tap logs."))
        .supportedFamilies([.systemMedium])
    }
}

/// The medium content of the Summary and adaptive widgets: the sleep column (state, timer, sleep button) and the list of
/// rows (the running feed first, the three chosen buttons with "há X" and estimates, then More).
private struct SummaryMedium: View {
    let entry: LottiesEntry
    let baby: WidgetSnapshot.Baby
    let facts: SleepFacts
    let due: WidgetSnapshot.Baby.Due

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                SleepBlock(facts: facts, name: baby.name, nextNap: baby.nextNap?.expected)
                Spacer(minLength: 0)
                SleepButton(facts: facts, napDue: due.nap ? baby.nextNap?.expected : nil)
            }
            .frame(width: 124)
            VStack(spacing: 2) {
                if let run = baby.runningFeed {
                    RunningFeedRow(run: run)
                    ForEach(Array(entry.slots.filter { !$0.isFeed }.prefix(2).enumerated()), id: \.offset) { _, activity in
                        ActivityRow(activity: activity, baby: baby, due: due)
                    }
                } else {
                    ForEach(Array(entry.slots.enumerated()), id: \.offset) { _, activity in
                        ActivityRow(activity: activity, baby: baby, due: due)
                    }
                }
                MoreRow()
            }
            .frame(maxWidth: .infinity)
        }
    }
}

/// The small content of the adaptive widget: the sleep state and its timer on one line, then four tiles (the chosen
/// buttons, or pause and stop while a feed runs, and the sleep one).
private struct SmallBody: View {
    let entry: LottiesEntry
    let baby: WidgetSnapshot.Baby
    let facts: SleepFacts
    let due: WidgetSnapshot.Baby.Due

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 0) {
                Text(baby.name).font(.caption2).foregroundStyle(Ink.muted).lineLimit(1)
                HStack(spacing: 4) {
                    Icon(name: facts.icon, size: 14).foregroundStyle(Category.sleep.tone)
                    if let since = facts.since {
                        Text(since, style: .relative)
                            .font(.system(size: 18, weight: .semibold, design: .serif))
                            .minimumScaleFactor(0.5).lineLimit(1).monospacedDigit().foregroundStyle(Ink.text)
                    } else {
                        Text("—").font(.system(size: 18, weight: .semibold, design: .serif)).foregroundStyle(Ink.text)
                    }
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 2), spacing: 6) {
                ForEach(QuickItem.items(slots: entry.slots, run: baby.runningFeed).prefix(3), id: \.self) { item in
                    QuickItemTile(item: item, due: due)
                }
                SleepSquare(facts: facts, due: due)
            }
            .frame(maxHeight: .infinity)
        }
    }
}

// MARK: Widget 7: adaptive (small, medium, large)

/// One widget that shows more as the size grows (iOS sizes are fixed: the person picks one when adding it).
/// Small: sleep and four tiles. Medium: the Summary content. Large: medium plus the eight activities.
struct LottiesAdaptiveWidget: Widget {
    let kind = "LottiesAdaptiveWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: LottiesButtonsIntent.self, provider: LottiesConfigProvider()) { entry in
            Host(entry: entry) { _, baby, family in
                let facts = SleepFacts(baby)
                let due = baby.due(at: entry.date)
                switch family {
                case .systemMedium:
                    if let picker = entry.picker {
                        PickerPanel(target: picker, baby: baby, due: due)
                    } else {
                        SummaryMedium(entry: entry, baby: baby, facts: facts, due: due)
                    }
                case .systemLarge, .systemExtraLarge:
                    if let picker = entry.picker {
                        PickerPanel(target: picker, baby: baby, due: due)
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            SummaryMedium(entry: entry, baby: baby, facts: facts, due: due)
                                .frame(maxHeight: .infinity)
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                                ForEach(WidgetActivity.panel, id: \.self) { activity in
                                    ActivitySquare(activity: activity, due: due).frame(height: 54)
                                }
                            }
                        }
                    }
                default:
                    // The list of every activity does not fit here; a More open from a bigger widget is ignored.
                    if let picker = entry.picker, picker != .more {
                        PickerPanel(target: picker, baby: baby, due: due, compact: true)
                    } else {
                        SmallBody(entry: entry, baby: baby, facts: facts, due: due)
                    }
                }
            }
        }
        .configurationDisplayName(LottiesText.t("Lotties", "Lotties"))
        .description(LottiesText.t(
            "Pequeno: sono e quatro botões. Médio: resumo. Grande: resumo e atividades. Toque e segure para editar os botões.",
            "Small: sleep and four buttons. Medium: summary. Large: summary and activities. Touch and hold to edit the buttons."))
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct LottiesWidgetsBundle: WidgetBundle {
    var body: some Widget {
        LottiesSummaryWidget()
        LottiesSleepWidget()
        LottiesFeedWidget()
        LottiesDiaperWidget()
        LottiesQuickWidget()
        LottiesActivitiesWidget()
        LottiesAdaptiveWidget()
    }
}
