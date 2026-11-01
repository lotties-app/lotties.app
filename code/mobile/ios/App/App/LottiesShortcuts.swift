import AppIntents

/// The phrases Siri understands without the person setting anything up (iOS allows ten, 8 are used). Each one is a Siri
/// intent (LottiesSiriIntents.swift) that calls the MCP server like the Alexa skill; the other intents of that file are in
/// Shortcuts and Spotlight. Four shortcuts are generic: an AppEnum parameter inside the phrase (activity, health item, sleep
/// change, question) so one slot covers many things (docs/design/37-widgets-siri.md section 8). Numbers cannot be spoken
/// inside a phrase, so Siri asks for them afterwards. Only in the app target (the provider must be in the main bundle).
struct LottiesShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SiriLogDiaperIntent(),
            phrases: [
                "Log a diaper in \(.applicationName)",
                "Diaper change in \(.applicationName)",
                "Log a \(\.$content) diaper in \(.applicationName)",
            ],
            shortTitle: "Diaper",
            systemImageName: "drop.fill")
        AppShortcut(
            intent: SiriLogBottleIntent(),
            phrases: ["Log a bottle in \(.applicationName)"],
            shortTitle: "Bottle",
            systemImageName: "cup.and.saucer.fill")
        AppShortcut(
            intent: SiriLogNursingIntent(),
            phrases: ["Start a breastfeed in \(.applicationName)"],
            shortTitle: "Breastfeed",
            systemImageName: "heart.fill")
        AppShortcut(
            intent: SiriSleepChangeIntent(),
            phrases: ["Baby \(\.$change) in \(.applicationName)"],
            shortTitle: "Sleep",
            systemImageName: "moon.zzz.fill")
        AppShortcut(
            intent: SiriLogActivityIntent(),
            phrases: [
                "Log \(\.$activity) in \(.applicationName)",
                "Start \(\.$activity) in \(.applicationName)",
            ],
            shortTitle: "Activity",
            systemImageName: "figure.and.child.holdinghands")
        AppShortcut(
            intent: SiriLogHealthIntent(),
            phrases: ["Log \(\.$health) in \(.applicationName)"],
            shortTitle: "Health",
            systemImageName: "thermometer.medium")
        AppShortcut(
            intent: SiriAskIntent(),
            phrases: ["Ask \(\.$topic) in \(.applicationName)"],
            shortTitle: "Ask",
            systemImageName: "questionmark.bubble.fill")
        AppShortcut(
            intent: SiriLogRequestDeleteLastIntent(),
            phrases: ["Undo the last entry in \(.applicationName)"],
            shortTitle: "Undo",
            systemImageName: "arrow.uturn.backward")
    }
}
