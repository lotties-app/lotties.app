import Foundation

/// Data shared by the app, the widget extension and the Siri/Shortcuts intents through the App Group container
/// (docs/design/37-widgets-siri.md section 2). Nothing here touches the network and nothing here is a secret.
/// This file is compiled into both targets (App and LottiesWidgets).
enum LottiesShared {
    static let groupId = "group.app.lotties.app"
    static let snapshotFile = "widget-snapshot.json"
    static let outboxFile = "widget-outbox.json"

    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId)
    }

    // MARK: JSON (the web app writes ISO 8601 with milliseconds, `Date.toISOString()`)

    private static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let plain = ISO8601DateFormatter()

    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = withFraction.date(from: text) ?? plain.date(from: text) { return date }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Not an ISO 8601 date: \(text)"))
        }
        return decoder
    }

    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(withFraction.string(from: date))
        }
        return encoder
    }

    // MARK: Files (two processes can touch them, so every access goes through a file coordinator)

    private static func url(_ name: String) -> URL? { containerURL?.appendingPathComponent(name) }

    static func readData(_ name: String) -> Data? {
        guard let url = url(name) else { return nil }
        var result: Data?
        var error: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &error) { readable in
            result = try? Data(contentsOf: readable)
        }
        return result
    }

    @discardableResult
    static func writeData(_ data: Data, to name: String) -> Bool {
        guard let url = url(name) else { return false }
        var ok = false
        var error: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &error) { writable in
            ok = (try? data.write(to: writable, options: .atomic)) != nil
        }
        return ok
    }

    static func delete(_ name: String) {
        guard let url = url(name) else { return }
        var error: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &error) { writable in
            try? FileManager.default.removeItem(at: writable)
        }
    }

    // MARK: Snapshot (written by the app, read by the widget and the intents)

    static func readSnapshot() -> WidgetSnapshot? {
        guard let data = readData(snapshotFile) else { return nil }
        return try? decoder.decode(WidgetSnapshot.self, from: data)
    }

    @discardableResult
    static func writeSnapshot(_ snapshot: WidgetSnapshot) -> Bool {
        guard let data = try? encoder.encode(snapshot) else { return false }
        return writeData(data, to: snapshotFile)
    }

    // MARK: Outbox (appended by the intents, drained by the app)

    static func readOutbox() -> [OutboxEntry] {
        guard let data = readData(outboxFile) else { return [] }
        return (try? decoder.decode([OutboxEntry].self, from: data)) ?? []
    }

    /// Read-modify-write under one coordinated write, so two intents never lose each other's entry.
    static func updateOutbox(_ change: (inout [OutboxEntry]) -> Void) {
        guard let url = url(outboxFile) else { return }
        var error: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forMerging, error: &error) { writable in
            var entries: [OutboxEntry] = []
            if let data = try? Data(contentsOf: writable) {
                entries = (try? decoder.decode([OutboxEntry].self, from: data)) ?? []
            }
            change(&entries)
            if let data = try? encoder.encode(entries) { try? data.write(to: writable, options: .atomic) }
        }
    }

    static func removeOutbox(ids: Set<String>) {
        updateOutbox { $0.removeAll { ids.contains($0.id) } }
    }

    /// Sign-out and account erasure: nothing of the account stays in the container.
    static func clearAll() {
        delete(snapshotFile)
        delete(outboxFile)
    }
}

/// `widget-snapshot.json`: what the widget shows (docs/design/37-widgets-siri.md 2.1).
struct WidgetSnapshot: Codable, Equatable {
    var version: Int
    var updatedAt: Date
    var signedIn: Bool
    var selectedBabyId: String?
    /// The lock screen is visible to others: names are left out there when this is true (the default).
    var hideNamesOnLockScreen: Bool?
    var babies: [Baby]

    struct Baby: Codable, Equatable, Identifiable {
        var id: String
        var name: String
        var sleep: Sleep?
        var lastFeed: Feed?
        var lastDiaper: Diaper?
    }
    struct Sleep: Codable, Equatable {
        var state: String  // "asleep" | "awake"
        var startedAt: Date?
    }
    struct Feed: Codable, Equatable {
        var at: Date
        var kind: String
        var amountMl: Int?
        var side: String?
    }
    struct Diaper: Codable, Equatable {
        var at: Date
        var kind: String
    }

    var selectedBaby: Baby? {
        babies.first { $0.id == selectedBabyId } ?? babies.first
    }
}

/// One entry of `widget-outbox.json`: an event the user asked for by voice or from the widget while the app was closed.
/// `id` is the event GUID the app will use, so draining is an idempotent upsert (docs/design/37-widgets-siri.md 2.2).
struct OutboxEntry: Codable, Equatable {
    var id: String
    var babyId: String
    var type: String  // "feed" | "diaper" | "sleep_start" | "sleep_end"
    var occurredAt: Date
    var payload: Payload
    var source: String  // "siri" | "widget"

    struct Payload: Codable, Equatable {
        var kind: String?
        var amountMl: Int?
    }
}

/// Small text helpers for the intents and the widget (the app ships English and Brazilian Portuguese only).
enum LottiesText {
    static var isPortuguese: Bool {
        (Locale.current.language.languageCode?.identifier ?? "en") == "pt"
    }

    static func t(_ pt: String, _ en: String) -> String { isPortuguese ? pt : en }

    /// "2 h 10 min", "35 min", "agora"/"now". Facts only.
    static func ago(_ date: Date, now: Date = Date()) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(date) / 60))
        if minutes < 1 { return t("agora", "just now") }
        if minutes < 60 { return "\(minutes) min" }
        let hours = minutes / 60
        let rest = minutes % 60
        if hours >= 24 { return "\(hours / 24) d \(hours % 24) h" }
        return rest == 0 ? "\(hours) h" : "\(hours) h \(rest) min"
    }
}
