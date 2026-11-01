import AppIntents
import Foundation
import WidgetKit

/*
 * Widget-button actions (docs/design/37-widgets-siri.md); hidden from Shortcuts, Siri uses LottiesSiriIntents.swift. Each one only appends to the outbox in the
 * App Group container (and updates the snapshot so the widget shows it at once); the app, signed in as the account,
 * turns the entry into a real event when it opens or resumes. No network, no token. Compiled into the app and into the
 * widget extension (interactive buttons run the intent in the extension process).
 */

enum LottiesLogger {
    enum Outcome {
        case logged(babyName: String)
        case notSignedIn
        case noBaby
    }

    static func log(type: String, kind: String? = nil, amountMl: Int? = nil, source: String) -> Outcome {
        guard var snapshot = LottiesShared.readSnapshot(), snapshot.signedIn else { return .notSignedIn }
        guard let baby = snapshot.selectedBaby else { return .noBaby }
        let now = Date()
        let entry = OutboxEntry(
            id: UUID().uuidString.lowercased(),
            babyId: baby.id,
            type: type,
            occurredAt: now,
            payload: .init(kind: kind, amountMl: amountMl),
            source: source)
        LottiesShared.updateOutbox { $0.append(entry) }

        if let index = snapshot.babies.firstIndex(where: { $0.id == baby.id }) {
            switch type {
            case "feed":
                snapshot.babies[index].lastFeed = .init(at: now, kind: kind ?? "breast", amountMl: amountMl, side: nil)
            case "diaper":
                snapshot.babies[index].lastDiaper = .init(at: now, kind: kind ?? "wet")
            case "sleep_start":
                snapshot.babies[index].sleep = .init(state: "asleep", startedAt: now)
            case "sleep_end":
                snapshot.babies[index].sleep = .init(state: "awake", startedAt: now)
            default:
                break
            }
            snapshot.updatedAt = now
            LottiesShared.writeSnapshot(snapshot)
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .logged(babyName: baby.name)
    }

    static func dialog(_ outcome: Outcome, done: String, doneEn: String) -> IntentDialog {
        switch outcome {
        case .logged(let name):
            return IntentDialog(stringLiteral: LottiesText.t("\(done) (\(name)).", "\(doneEn) (\(name))."))
        case .notSignedIn:
            return IntentDialog(stringLiteral: LottiesText.t(
                "Abra o Lotties e entre na sua conta primeiro.", "Open Lotties and sign in first."))
        case .noBaby:
            return IntentDialog(stringLiteral: LottiesText.t(
                "Abra o Lotties para escolher um bebê.", "Open Lotties to choose a baby."))
        }
    }
}

enum DiaperContent: String, AppEnum {
    case wet, dirty, mixed

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Diaper content"
    static var caseDisplayRepresentations: [DiaperContent: DisplayRepresentation] = [
        .wet: "Wet",
        .dirty: "Dirty",
        .mixed: "Mixed",
    ]
}

struct LogDiaperIntent: AppIntent {
    static var isDiscoverable: Bool { false }
    static var title: LocalizedStringResource = "Log a diaper"
    static var description = IntentDescription("Logs a diaper change for the selected baby, now.")

    @Parameter(title: "Content", default: .wet)
    var content: DiaperContent

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let outcome = LottiesLogger.log(type: "diaper", kind: content.rawValue, source: "siri")
        return .result(dialog: LottiesLogger.dialog(outcome, done: "Fralda registrada", doneEn: "Diaper logged"))
    }
}

struct LogBottleIntent: AppIntent {
    static var isDiscoverable: Bool { false }
    static var title: LocalizedStringResource = "Log a bottle"
    static var description = IntentDescription("Logs a bottle feed now. Without an amount, the last bottle's amount is used.")

    @Parameter(title: "Amount (ml)")
    var amountMl: Int?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        var amount = amountMl
        if amount == nil, let last = LottiesShared.readSnapshot()?.selectedBaby?.lastFeed, last.kind == "bottle" {
            amount = last.amountMl
        }
        if amount == nil {
            amount = try await $amountMl.requestValue(
                IntentDialog(stringLiteral: LottiesText.t("Quantos ml?", "How many ml?")))
        }
        guard let ml = amount, ml > 0 else {
            return .result(dialog: IntentDialog(stringLiteral: LottiesText.t("Nada registrado.", "Nothing logged.")))
        }
        let outcome = LottiesLogger.log(type: "feed", kind: "bottle", amountMl: ml, source: "siri")
        return .result(dialog: LottiesLogger.dialog(outcome, done: "Mamadeira registrada", doneEn: "Bottle logged"))
    }
}

struct LogBreastFeedIntent: AppIntent {
    static var isDiscoverable: Bool { false }
    static var title: LocalizedStringResource = "Start a breastfeed"
    static var description = IntentDescription("Starts a breastfeeding session now; stop it in the app.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let outcome = LottiesLogger.log(type: "feed", kind: "breast", source: "siri")
        return .result(dialog: LottiesLogger.dialog(outcome, done: "Mamada iniciada", doneEn: "Breastfeed started"))
    }
}

struct BabyFellAsleepIntent: AppIntent {
    static var isDiscoverable: Bool { false }
    static var title: LocalizedStringResource = "Baby fell asleep"
    static var description = IntentDescription("Starts a sleep for the selected baby, now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let outcome = LottiesLogger.log(type: "sleep_start", source: "siri")
        return .result(dialog: LottiesLogger.dialog(outcome, done: "Sono iniciado", doneEn: "Sleep started"))
    }
}

struct BabyWokeUpIntent: AppIntent {
    static var isDiscoverable: Bool { false }
    static var title: LocalizedStringResource = "Baby woke up"
    static var description = IntentDescription("Ends the selected baby's sleep, now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let outcome = LottiesLogger.log(type: "sleep_end", source: "siri")
        return .result(dialog: LottiesLogger.dialog(outcome, done: "Acordou registrado", doneEn: "Wake-up logged"))
    }
}

/// Facts from the snapshot only, never advice.
struct LastFeedIntent: AppIntent {
    static var isDiscoverable: Bool { false }
    static var title: LocalizedStringResource = "When was the last feed?"
    static var description = IntentDescription("Says when the selected baby last fed, from what the app saved.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let snapshot = LottiesShared.readSnapshot(), snapshot.signedIn, let baby = snapshot.selectedBaby else {
            return .result(dialog: IntentDialog(stringLiteral: LottiesText.t(
                "Abra o Lotties e entre na sua conta primeiro.", "Open Lotties and sign in first.")))
        }
        guard let feed = baby.lastFeed else {
            return .result(dialog: IntentDialog(stringLiteral: LottiesText.t(
                "Sem mamada registrada nos últimos dias.", "No feed logged in the last days.")))
        }
        let ago = LottiesText.ago(feed.at)
        var detail = ""
        if let ml = feed.amountMl { detail = ", \(ml) ml" }
        return .result(dialog: IntentDialog(stringLiteral: LottiesText.t(
            "A última mamada de \(baby.name) foi há \(ago)\(detail).",
            "\(baby.name)'s last feed was \(ago) ago\(detail).")))
    }
}
