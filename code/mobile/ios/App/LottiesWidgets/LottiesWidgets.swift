import AppIntents
import SwiftUI
import WidgetKit

/*
 * The Lotties widget (docs/design/37-widgets-siri.md): the selected baby's sleep state and the last feed and diaper,
 * read from the snapshot the app keeps in the App Group container. Times are live (`Text(date, style: .relative)`), so
 * the widget stays right between refreshes. The buttons (iOS 17) run the same intents Siri does.
 */

struct LottiesEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct LottiesProvider: TimelineProvider {
    func placeholder(in context: Context) -> LottiesEntry {
        LottiesEntry(date: Date(), snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (LottiesEntry) -> Void) {
        completion(LottiesEntry(date: Date(), snapshot: LottiesShared.readSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LottiesEntry>) -> Void) {
        let entry = LottiesEntry(date: Date(), snapshot: LottiesShared.readSnapshot())
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: entry.date) ?? entry.date
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: Look (calm purple night, white text; the home-screen widget does not follow the light/dark appearance)

private enum Look {
    static let top = Color(red: 0.30, green: 0.27, blue: 0.47)
    static let bottom = Color(red: 0.13, green: 0.12, blue: 0.22)
    static let tile = Color.white.opacity(0.13)
    static let accent = Color(red: 0.96, green: 0.76, blue: 0.62)
    static var gradient: LinearGradient {
        LinearGradient(colors: [top, bottom], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

private struct SleepFacts {
    let symbol: String
    let caption: String
    let since: Date?
    let asleep: Bool

    init(_ baby: WidgetSnapshot.Baby) {
        asleep = baby.sleep?.state == "asleep"
        since = baby.sleep?.startedAt
        symbol = asleep ? "moon.zzz.fill" : "sun.max.fill"
        if baby.sleep == nil {
            caption = LottiesText.t("Sono", "Sleep")
        } else {
            caption = asleep ? LottiesText.t("Dormindo há", "Asleep for") : LottiesText.t("Acordado há", "Awake for")
        }
    }
}

/// "Nada hoje" when the event is not from today, else how long ago (live).
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

private struct Tile<Intent: AppIntent>: View {
    let symbol: String
    let title: String
    let date: Date?
    let intent: Intent

    private var label: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).font(.title3).frame(width: 26)
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                AgoText(date: date).font(.caption2).opacity(0.7).lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "plus").font(.caption.weight(.bold)).opacity(0.7)
        }
        .padding(.horizontal, 10)
        .frame(maxHeight: .infinity)
        .background(Look.tile, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .foregroundStyle(.white)
    }

    @ViewBuilder
    var body: some View {
        if #available(iOS 17.0, *) {
            Button(intent: intent) { label }.buttonStyle(.plain)
        } else {
            label
        }
    }
}

private struct SleepButton: View {
    let facts: SleepFacts

    private var label: some View {
        HStack(spacing: 6) {
            Image(systemName: facts.asleep ? "sun.max.fill" : "moon.zzz.fill")
            Text(facts.asleep ? LottiesText.t("Acordou", "Woke up") : LottiesText.t("Dormiu", "Fell asleep"))
                .font(.subheadline.weight(.semibold))
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .foregroundStyle(.white)
        .background(Look.accent.opacity(0.22), in: Capsule())
        .overlay(Capsule().stroke(Look.accent, lineWidth: 1.5))
    }

    @ViewBuilder
    var body: some View {
        if #available(iOS 17.0, *) {
            if facts.asleep {
                Button(intent: BabyWokeUpIntent()) { label }.buttonStyle(.plain)
            } else {
                Button(intent: BabyFellAsleepIntent()) { label }.buttonStyle(.plain)
            }
        } else {
            label
        }
    }
}

private struct SleepBlock: View {
    let facts: SleepFacts
    let name: String
    let big: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name).font(.caption).opacity(0.7).lineLimit(1)
            Text(facts.caption).font(.subheadline).opacity(0.85)
            if let since = facts.since {
                Text(since, style: .relative)
                    .font(.system(size: big, weight: .semibold, design: .rounded))
                    .minimumScaleFactor(0.5)
                    .lineLimit(2)
                    .monospacedDigit()
            } else {
                Text("—").font(.system(size: big, weight: .semibold, design: .rounded))
            }
        }
        .foregroundStyle(.white)
    }
}

struct LottiesWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: LottiesEntry

    var body: some View {
        if let snapshot = entry.snapshot, snapshot.signedIn, let baby = snapshot.selectedBaby {
            content(snapshot, baby)
        } else {
            VStack(spacing: 4) {
                Image(systemName: "moon.zzz.fill")
                Text(LottiesText.t("Abra o Lotties", "Open Lotties")).font(.caption.bold())
            }
            .foregroundStyle(family.isLockScreen ? Color.primary : Color.white)
        }
    }

    @ViewBuilder
    private func content(_ snapshot: WidgetSnapshot, _ baby: WidgetSnapshot.Baby) -> some View {
        let facts = SleepFacts(baby)
        let showName = snapshot.hideNamesOnLockScreen == false
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: facts.symbol).font(.title2)
            }
        case .accessoryInline:
            Label {
                if let since = facts.since { Text(since, style: .relative) } else { Text("—") }
            } icon: {
                Image(systemName: facts.symbol)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                if showName { Text(baby.name).font(.caption.bold()) }
                Label { if let s = facts.since { Text(s, style: .relative) } else { Text("—") } } icon: { Image(systemName: facts.symbol) }
                Label { AgoText(date: baby.lastFeed?.at) } icon: { Image(systemName: "cup.and.saucer.fill") }
                Label { AgoText(date: baby.lastDiaper?.at) } icon: { Image(systemName: "drop.fill") }
            }
            .font(.caption)
        case .systemMedium:
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    SleepBlock(facts: facts, name: baby.name, big: 28)
                    Spacer(minLength: 0)
                    SleepButton(facts: facts)
                }
                .frame(maxWidth: .infinity)
                VStack(spacing: 6) {
                    Tile(symbol: "cup.and.saucer.fill", title: LottiesText.t("Mamadeira", "Bottle"),
                         date: baby.lastFeed?.kind == "bottle" ? baby.lastFeed?.at : nil, intent: LogBottleIntent())
                    Tile(symbol: "drop.fill", title: LottiesText.t("Fralda", "Diaper"),
                         date: baby.lastDiaper?.at, intent: LogDiaperIntent())
                    Tile(symbol: "heart.fill", title: LottiesText.t("Peito", "Breast"),
                         date: baby.lastFeed?.kind == "bottle" ? nil : baby.lastFeed?.at, intent: LogBreastFeedIntent())
                }
                .frame(maxWidth: .infinity)
            }
        default:
            VStack(alignment: .leading, spacing: 6) {
                SleepBlock(facts: facts, name: baby.name, big: 24)
                Spacer(minLength: 0)
                SleepButton(facts: facts)
            }
        }
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
            self.containerBackground(for: .widget) { Look.gradient }
        } else {
            self.padding().background(Look.gradient)
        }
    }
}

private struct Host: View {
    @Environment(\.widgetFamily) private var family
    let entry: LottiesEntry

    var body: some View {
        LottiesWidgetView(entry: entry).lottiesBackground(family)
    }
}

struct LottiesWidget: Widget {
    let kind = "LottiesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LottiesProvider()) { entry in
            Host(entry: entry)
        }
        .configurationDisplayName("Lotties")
        .description(LottiesText.t("Sono, última mamada e última fralda.", "Sleep, last feed and last diaper."))
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct LottiesWidgetsBundle: WidgetBundle {
    var body: some Widget {
        LottiesWidget()
    }
}
