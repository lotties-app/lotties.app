import AppIntents
import SwiftUI
import WidgetKit

/*
 * The Lotties widget (docs/design/37-widgets-siri.md): the selected baby's sleep state, last feed and last diaper, read
 * from the snapshot the app keeps in the App Group container. Times are live (`Text(date, style: .relative)`), so the
 * widget stays right between refreshes. The buttons (iOS 17) run the same intents Siri does.
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

private struct FactLine: View {
    let symbol: String
    let label: String
    let date: Date?

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
            Text(label)
            if let date {
                Text(date, style: .relative).monospacedDigit()
            } else {
                Text("—")
            }
        }
        .font(.caption)
        .lineLimit(1)
    }
}

private func sleepLine(_ baby: WidgetSnapshot.Baby) -> (String, String, Date?) {
    guard let sleep = baby.sleep else { return ("moon.zzz", LottiesText.t("Sono", "Sleep"), nil) }
    if sleep.state == "asleep" {
        return ("moon.zzz.fill", LottiesText.t("Dormindo há", "Asleep for"), sleep.startedAt)
    }
    return ("sun.max.fill", LottiesText.t("Acordado há", "Awake for"), sleep.startedAt)
}

struct LottiesWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: LottiesEntry

    private var snapshot: WidgetSnapshot? {
        guard let snapshot = entry.snapshot, snapshot.signedIn else { return nil }
        return snapshot
    }

    var body: some View {
        if let snapshot, let baby = snapshot.selectedBaby {
            content(snapshot, baby)
        } else {
            Text(LottiesText.t("Abra o Lotties", "Open Lotties"))
                .font(.caption.bold())
        }
    }

    @ViewBuilder
    private func content(_ snapshot: WidgetSnapshot, _ baby: WidgetSnapshot.Baby) -> some View {
        let sleep = sleepLine(baby)
        let showName = !(family == .accessoryRectangular || family == .accessoryInline)
            || snapshot.hideNamesOnLockScreen == false
        switch family {
        case .accessoryInline:
            Label {
                if let date = baby.sleep?.startedAt { Text(date, style: .relative) } else { Text("—") }
            } icon: {
                Image(systemName: sleep.0)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                if showName { Text(baby.name).font(.caption.bold()) }
                FactLine(symbol: sleep.0, label: "", date: sleep.2)
                FactLine(symbol: "cup.and.saucer.fill", label: "", date: baby.lastFeed?.at)
                FactLine(symbol: "drop.fill", label: "", date: baby.lastDiaper?.at)
            }
        case .systemMedium:
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(baby.name).font(.headline).lineLimit(1)
                    FactLine(symbol: sleep.0, label: sleep.1, date: sleep.2)
                    FactLine(symbol: "cup.and.saucer.fill", label: LottiesText.t("Mamada", "Feed"), date: baby.lastFeed?.at)
                    FactLine(symbol: "drop.fill", label: LottiesText.t("Fralda", "Diaper"), date: baby.lastDiaper?.at)
                }
                Spacer(minLength: 0)
                actions(baby)
            }
        default:
            VStack(alignment: .leading, spacing: 4) {
                Text(baby.name).font(.headline).lineLimit(1)
                FactLine(symbol: sleep.0, label: sleep.1, date: sleep.2)
                FactLine(symbol: "cup.and.saucer.fill", label: LottiesText.t("Mamada", "Feed"), date: baby.lastFeed?.at)
                FactLine(symbol: "drop.fill", label: LottiesText.t("Fralda", "Diaper"), date: baby.lastDiaper?.at)
            }
        }
    }

    @ViewBuilder
    private func actions(_ baby: WidgetSnapshot.Baby) -> some View {
        if #available(iOS 17.0, *) {
            VStack(spacing: 6) {
                Button(intent: LogDiaperIntent()) { Label(LottiesText.t("Fralda", "Diaper"), systemImage: "drop.fill") }
                Button(intent: LogBottleIntent()) { Label(LottiesText.t("Mamadeira", "Bottle"), systemImage: "cup.and.saucer.fill") }
                if baby.sleep?.state == "asleep" {
                    Button(intent: BabyWokeUpIntent()) { Label(LottiesText.t("Acordou", "Woke up"), systemImage: "sun.max.fill") }
                } else {
                    Button(intent: BabyFellAsleepIntent()) { Label(LottiesText.t("Dormiu", "Asleep"), systemImage: "moon.zzz.fill") }
                }
            }
            .font(.caption2)
            .buttonStyle(.bordered)
        }
    }
}

private extension View {
    @ViewBuilder
    func lottiesBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { Color(.systemBackground) }
        } else {
            self.padding().background(Color(.systemBackground))
        }
    }
}

struct LottiesWidget: Widget {
    let kind = "LottiesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LottiesProvider()) { entry in
            LottiesWidgetView(entry: entry).lottiesBackground()
        }
        .configurationDisplayName("Lotties")
        .description(LottiesText.t("Sono, última mamada e última fralda.", "Sleep, last feed and last diaper."))
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct LottiesWidgetsBundle: WidgetBundle {
    var body: some Widget {
        LottiesWidget()
    }
}
