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
        nextFeed: .init(at: now.addingTimeInterval(80 * 60), amountMl: 120),
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
        let entry = LottiesEntry(date: Date(), snapshot: LottiesShared.readSnapshot())
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: entry.date) ?? entry.date
        completion(Timeline(entries: [entry], policy: .after(next)))
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
    case sleep, feeding, diaper

    var tint: Color {
        switch self {
        case .sleep: return Color(0xe2e7f0, 0x26303f)
        case .feeding: return Color(0xe1eadb, 0x263425)
        case .diaper: return Color(0xf2e5c6, 0x3a3120)
        }
    }

    var tone: Color {
        switch self {
        case .sleep: return Color(0x2c4870, 0xa9c1e3)
        case .feeding: return Color(0x375f39, 0xa9cf9f)
        case .diaper: return Color(0x6e4e0e, 0xe8c47a)
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
    let date: Date?

    var body: some View {
        if let date, Calendar.current.isDateInToday(date) {
            Text(date, style: .relative).monospacedDigit()
        } else {
            Text(LottiesText.t("Nada hoje", "Nothing today"))
        }
    }
}

/// An estimate still ahead of now ("Próx. 15:10"); nothing for a time already past.
private struct NextText: View {
    let label: String
    let date: Date?

    var body: some View {
        if let date, date > Date() {
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

    private var label: some View {
        HStack(spacing: 6) {
            Icon(name: facts.asleep ? "sun" : "moon-stars", size: 16)
            Text(facts.asleep ? LottiesText.t("Acordou", "Woke up") : LottiesText.t("Dormiu", "Fell asleep"))
                .font(.subheadline.weight(.semibold))
        }
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity)
        .foregroundStyle(Ink.accent)
        .background(Ink.accent.opacity(0.12), in: Capsule())
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

/// A wide row: tinted icon, title, how long ago, plus (medium widget).
private struct RowTile<I: AppIntent>: View {
    let icon: String
    let title: String
    let date: Date?
    let category: Category
    let intent: I
    var next: Date?

    var body: some View {
        Act(intent) {
            HStack(spacing: 8) {
                Icon(name: icon, size: 20)
                    .foregroundStyle(category.tone)
                    .frame(width: 32, height: 32)
                    .background(category.tint, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Ink.text).lineLimit(1)
                    HStack(spacing: 3) {
                        AgoText(date: date)
                        NextText(label: "· " + LottiesText.t("próx.", "next"), date: next)
                    }
                    .font(.caption2).foregroundStyle(Ink.muted).lineLimit(1).minimumScaleFactor(0.7)
                }
                Spacer(minLength: 0)
                Icon(name: "plus", size: 14).foregroundStyle(Ink.muted)
            }
            .padding(.horizontal, 8)
            .frame(maxHeight: .infinity)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Ink.hairline, lineWidth: 1))
        }
    }
}

/// A tinted square: icon over label (quick actions, large widget).
private struct SquareTile<I: AppIntent>: View {
    let icon: String
    let title: String
    let category: Category
    let intent: I

    var body: some View {
        Act(intent) {
            VStack(spacing: 4) {
                Icon(name: icon, size: 24)
                Text(title).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
            }
            .foregroundStyle(category.tone)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(category.tint, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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
        StaticConfiguration(kind: kind, provider: LottiesProvider()) { entry in
            Host(entry: entry) { snapshot, baby, family in
                let facts = SleepFacts(baby)
                switch family {
                case .accessoryCircular, .accessoryInline, .accessoryRectangular:
                    lockScreen(family, snapshot, baby, icon: facts.icon, date: facts.since)
                case .systemMedium:
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            SleepBlock(facts: facts, name: baby.name, nextNap: baby.nextNap?.expected)
                            Spacer(minLength: 0)
                            SleepButton(facts: facts)
                        }
                        .frame(maxWidth: .infinity)
                        VStack(spacing: 6) {
                            RowTile(icon: "bottle", title: LottiesText.t("Mamadeira", "Bottle"),
                                    date: baby.lastFeed?.kind == "bottle" ? baby.lastFeed?.at : nil,
                                    category: .feeding, intent: LogBottleIntent(), next: baby.nextFeed?.at)
                            RowTile(icon: "diaper", title: LottiesText.t("Fralda", "Diaper"),
                                    date: baby.lastDiaper?.at, category: .diaper, intent: LogDiaperIntent(),
                                    next: baby.nextDiaper?.at)
                            RowTile(icon: "heart", title: LottiesText.t("Peito", "Breast"),
                                    date: baby.lastFeed?.kind == "bottle" ? nil : baby.lastFeed?.at,
                                    category: .feeding, intent: LogBreastFeedIntent())
                        }
                        .frame(maxWidth: .infinity)
                    }
                case .systemLarge, .systemExtraLarge:
                    VStack(alignment: .leading, spacing: 10) {
                        SleepBlock(facts: facts, name: baby.name, big: 40, nextNap: baby.nextNap?.expected)
                        SleepButton(facts: facts)
                        HStack(spacing: 8) {
                            SquareTile(icon: "bottle", title: LottiesText.t("Mamadeira", "Bottle"),
                                       category: .feeding, intent: LogBottleIntent())
                            SquareTile(icon: "heart", title: LottiesText.t("Peito", "Breast"),
                                       category: .feeding, intent: LogBreastFeedIntent())
                            SquareTile(icon: "diaper", title: LottiesText.t("Fralda", "Diaper"),
                                       category: .diaper, intent: LogDiaperIntent())
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
                        SleepButton(facts: facts)
                    }
                }
            }
        }
        .configurationDisplayName(LottiesText.t("Resumo", "Summary"))
        .description(LottiesText.t("Sono, mamada e fralda do bebê escolhido.", "Sleep, feed and diaper of the chosen baby."))
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
                if family.isLockScreen {
                    lockScreen(family, snapshot, baby, icon: facts.icon, date: facts.since)
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        SleepBlock(facts: facts, name: baby.name, big: 26, nextNap: baby.nextNap?.expected)
                        Spacer(minLength: 0)
                        SleepButton(facts: facts)
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
                                       category: .feeding, intent: LogBottleIntent())
                            SquareTile(icon: "heart", title: LottiesText.t("Peito", "Breast"),
                                       category: .feeding, intent: LogBreastFeedIntent())
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
                                       category: .diaper, intent: diaperIntent(.wet))
                            SquareTile(icon: "diaper", title: LottiesText.t("Cocô", "Dirty"),
                                       category: .diaper, intent: diaperIntent(.dirty))
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
        StaticConfiguration(kind: kind, provider: LottiesProvider()) { entry in
            Host(entry: entry) { _, baby, _ in
                let facts = SleepFacts(baby)
                VStack(alignment: .leading, spacing: 8) {
                    Text(baby.name).font(.caption).foregroundStyle(Ink.muted).lineLimit(1)
                    HStack(spacing: 8) {
                        SquareTile(icon: "bottle", title: LottiesText.t("Mamadeira", "Bottle"),
                                   category: .feeding, intent: LogBottleIntent())
                        SquareTile(icon: "heart", title: LottiesText.t("Peito", "Breast"),
                                   category: .feeding, intent: LogBreastFeedIntent())
                        SquareTile(icon: "diaper", title: LottiesText.t("Fralda", "Diaper"),
                                   category: .diaper, intent: LogDiaperIntent())
                        if facts.asleep {
                            SquareTile(icon: "sun", title: LottiesText.t("Acordou", "Woke up"),
                                       category: .sleep, intent: BabyWokeUpIntent())
                        } else {
                            SquareTile(icon: "moon-stars", title: LottiesText.t("Dormiu", "Asleep"),
                                       category: .sleep, intent: BabyFellAsleepIntent())
                        }
                    }
                }
            }
        }
        .configurationDisplayName(LottiesText.t("Ações rápidas", "Quick actions"))
        .description(LottiesText.t("Quatro botões para registrar sem abrir o app.", "Four buttons to log without opening the app."))
        .supportedFamilies([.systemMedium])
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
    }
}
