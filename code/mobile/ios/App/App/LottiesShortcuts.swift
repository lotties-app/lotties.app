import AppIntents

/// The phrases Siri understands without the person setting anything up (iOS allows ten). Each one is a Siri intent
/// (LottiesSiriIntents.swift) that calls the MCP server like the Alexa skill; the other intents of that file are in
/// Shortcuts and Spotlight. Only in the app target (the provider must be in the main bundle).
struct LottiesShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SiriLogDiaperIntent(),
            phrases: ["Log a diaper in \(.applicationName)", "Diaper change in \(.applicationName)"],
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
            intent: SiriLogSleepStartIntent(),
            phrases: ["Baby fell asleep in \(.applicationName)"],
            shortTitle: "Fell asleep",
            systemImageName: "moon.zzz.fill")
        AppShortcut(
            intent: SiriLogSleepEndIntent(),
            phrases: ["Baby woke up in \(.applicationName)"],
            shortTitle: "Woke up",
            systemImageName: "sun.max.fill")
        AppShortcut(
            intent: SiriLastFeedIntent(),
            phrases: ["When was the last feed in \(.applicationName)"],
            shortTitle: "Last feed",
            systemImageName: "clock.fill")
        AppShortcut(
            intent: SiriNextNapWindowIntent(),
            phrases: ["Next nap in \(.applicationName)"],
            shortTitle: "Next nap",
            systemImageName: "bed.double.fill")
        AppShortcut(
            intent: SiriDiapersTodayIntent(),
            phrases: ["Diapers today in \(.applicationName)"],
            shortTitle: "Diapers today",
            systemImageName: "number")
        AppShortcut(
            intent: SiriBottleTodayIntent(),
            phrases: ["Bottles today in \(.applicationName)"],
            shortTitle: "Bottles today",
            systemImageName: "number")
        AppShortcut(
            intent: SiriDaySummaryIntent(),
            phrases: ["Today's summary in \(.applicationName)"],
            shortTitle: "Summary",
            systemImageName: "list.bullet")
    }
}
