import AppIntents

/// The phrases Siri understands without the person setting anything up. Only in the app target (the provider must be
/// in the main bundle); the intents themselves are shared with the widget (Shared/LottiesIntents.swift).
struct LottiesShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogDiaperIntent(),
            phrases: ["Log a diaper in \(.applicationName)", "Diaper change in \(.applicationName)"],
            shortTitle: "Diaper",
            systemImageName: "drop.fill")
        AppShortcut(
            intent: LogBottleIntent(),
            phrases: ["Log a bottle in \(.applicationName)"],
            shortTitle: "Bottle",
            systemImageName: "cup.and.saucer.fill")
        AppShortcut(
            intent: LogBreastFeedIntent(),
            phrases: ["Start a breastfeed in \(.applicationName)"],
            shortTitle: "Breastfeed",
            systemImageName: "heart.fill")
        AppShortcut(
            intent: BabyFellAsleepIntent(),
            phrases: ["Baby fell asleep in \(.applicationName)"],
            shortTitle: "Fell asleep",
            systemImageName: "moon.zzz.fill")
        AppShortcut(
            intent: BabyWokeUpIntent(),
            phrases: ["Baby woke up in \(.applicationName)"],
            shortTitle: "Woke up",
            systemImageName: "sun.max.fill")
        AppShortcut(
            intent: LastFeedIntent(),
            phrases: ["When was the last feed in \(.applicationName)"],
            shortTitle: "Last feed",
            systemImageName: "clock.fill")
    }
}
