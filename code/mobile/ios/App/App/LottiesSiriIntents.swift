import AppIntents
import Foundation

/*
 * The Siri / Shortcuts side of the Alexa intents (docs/design/37-widgets-siri.md section 8): every intent is one MCP tool
 * call (LottiesMcp.swift), answered with the sentence the Alexa skill would say. Generated once from the Alexa model's
 * intent list, then kept by hand. App target only. The widget buttons keep their own offline intents
 * (Shared/LottiesIntents.swift), hidden from Shortcuts. Medication has no tool by design (docs/design/32-assistants.md).
 */

enum SiriSay {
    static func text(_ pt: String, _ en: String) -> IntentDialog { IntentDialog(stringLiteral: LottiesText.t(pt, en)) }

    /// Runs one tool and turns the outcome into the dialog Siri speaks.
    static func tool(_ name: String, _ arguments: [String: Any] = [:], write: Bool = false) async -> IntentDialog {
        var arguments = arguments
        if write { arguments["idempotencyKey"] = UUID().uuidString.lowercased() }
        do {
            let answer = try await LottiesMcp.call(name, arguments)
            if let speech = answer.speech, !speech.isEmpty { return IntentDialog(stringLiteral: speech) }
            return answer.isError
                ? text("O Lotties não conseguiu fazer isso.", "Lotties could not do that.")
                : text("Pronto.", "Done.")
        } catch McpFailure.notConnected {
            return text("Conecte a Siri no Lotties: Ajustes, Assistentes de voz.", "Connect Siri in Lotties: Settings, Voice assistants.")
        } catch McpFailure.offline {
            return text("Sem conexão com o Lotties agora. Nada foi registrado.", "Cannot reach Lotties now. Nothing was logged.")
        } catch {
            return text("O Lotties não respondeu. Tente de novo.", "Lotties did not answer. Try again.")
        }
    }
}

enum SiriDiaperKind: String, AppEnum {
    case wet, dirty, both

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Diaper content"
    static var caseDisplayRepresentations: [SiriDiaperKind: DisplayRepresentation] = [
        .wet: "Wet", .dirty: "Dirty", .both: "Both",
    ]
}

enum SiriBottleKind: String, AppEnum {
    case formula
    case breastMilk = "breast_milk"

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Bottle content"
    static var caseDisplayRepresentations: [SiriBottleKind: DisplayRepresentation] = [
        .formula: "Formula", .breastMilk: "Breast milk",
    ]
}

struct SiriLogDiaperIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a diaper"
    static var description = IntentDescription("Logs a diaper change now.")

    @Parameter(title: "Content", default: .wet)
    var content: SiriDiaperKind

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_diaper", ["kind": content.rawValue], write: true))
    }
}

struct SiriLogBottleIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a bottle"
    static var description = IntentDescription("Logs a bottle now.")

    @Parameter(title: "Amount (ml)")
    var amountMl: Int?

    @Parameter(title: "Content", default: .formula)
    var content: SiriBottleKind

    func perform() async throws -> some IntentResult & ProvidesDialog {
        var amount = amountMl
        if amount == nil { amount = try await $amountMl.requestValue(SiriSay.text("Quantos ml?", "How many ml?")) }
        guard let ml = amount, ml > 0 else { return .result(dialog: SiriSay.text("Nada registrado.", "Nothing logged.")) }
        return .result(dialog: await SiriSay.tool("log_bottle", ["amountMl": ml, "kind": content.rawValue], write: true))
    }
}

struct SiriLogBellyPainIntent: AppIntent {
    static var title: LocalizedStringResource = "Log belly pain"
    static var description = IntentDescription("Logs belly pain now, from 1 to 5.")

    @Parameter(title: "Level (1-5)", inclusiveRange: (1, 5))
    var level: Int

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_belly_pain", ["level": level], write: true))
    }
}

struct SiriLogTemperatureIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a temperature"
    static var description = IntentDescription("Records a temperature reading in Celsius; a record only.")

    @Parameter(title: "Temperature (°C)")
    var celsius: Double

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_temperature", ["temperatureC": celsius], write: true))
    }
}

struct SiriLastFeedIntent: AppIntent {
    static var title: LocalizedStringResource = "When was the last feed?"
    static var description = IntentDescription("Says when the baby last fed.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_last_feed"))
    }
}

struct SiriSleepStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Is the baby asleep?"
    static var description = IntentDescription("Says whether the baby sleeps or is awake, and since when.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_sleep_status"))
    }
}

struct SiriDiapersTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Diapers today"
    static var description = IntentDescription("Says how many diapers were changed today.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_diapers_today"))
    }
}

struct SiriLastDiaperIntent: AppIntent {
    static var title: LocalizedStringResource = "When was the last diaper?"
    static var description = IntentDescription("Says when the last diaper was changed.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_last_diaper"))
    }
}

struct SiriSleepTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Sleep today"
    static var description = IntentDescription("Says how long the baby slept today.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_sleep_today"))
    }
}

struct SiriBottleTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Bottles today"
    static var description = IntentDescription("Says how much the baby drank from bottles today.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_bottle_today"))
    }
}

struct SiriFeedsTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Feeds today"
    static var description = IntentDescription("Says how many feeds there were today.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_feeds_today"))
    }
}

struct SiriNextNapWindowIntent: AppIntent {
    static var title: LocalizedStringResource = "Next nap window"
    static var description = IntentDescription("Says when the next nap window opens, from the log.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_next_nap_window"))
    }
}

struct SiriNextFeedIntent: AppIntent {
    static var title: LocalizedStringResource = "Next feed"
    static var description = IntentDescription("Says when the next feed is likely, from the log.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_next_feed"))
    }
}

struct SiriNextDiaperIntent: AppIntent {
    static var title: LocalizedStringResource = "Next diaper change"
    static var description = IntentDescription("Says when the next diaper change is likely, from the log.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_next_diaper"))
    }
}

struct SiriDiapersAverageIntent: AppIntent {
    static var title: LocalizedStringResource = "Diapers per day"
    static var description = IntentDescription("Says how many diapers a day the baby usually uses.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_diapers_average"))
    }
}

struct SiriBottleAverageIntent: AppIntent {
    static var title: LocalizedStringResource = "Usual bottle"
    static var description = IntentDescription("Says how much the baby usually drinks per bottle.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_bottle_average"))
    }
}

struct SiriNextAppointmentIntent: AppIntent {
    static var title: LocalizedStringResource = "Next appointment"
    static var description = IntentDescription("Says the next appointment.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_next_appointment"))
    }
}

struct SiriDueVaccinesIntent: AppIntent {
    static var title: LocalizedStringResource = "Vaccines due"
    static var description = IntentDescription("Says which vaccines are due.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_due_vaccines"))
    }
}

struct SiriCryReasonsIntent: AppIntent {
    static var title: LocalizedStringResource = "Why is the baby crying?"
    static var description = IntentDescription("Lists likely causes from the log; never medical advice.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_cry_reasons"))
    }
}

struct SiriDaySummaryIntent: AppIntent {
    static var title: LocalizedStringResource = "Today's summary"
    static var description = IntentDescription("Summarizes today.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_day_summary"))
    }
}

struct SiriWeekSummaryIntent: AppIntent {
    static var title: LocalizedStringResource = "This week's summary"
    static var description = IntentDescription("Summarizes the last seven days.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_week_summary"))
    }
}

struct SiriListBabiesIntent: AppIntent {
    static var title: LocalizedStringResource = "My babies"
    static var description = IntentDescription("Lists the babies you can ask about.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("list_babies"))
    }
}

struct SiriBabyProfileIntent: AppIntent {
    static var title: LocalizedStringResource = "Baby profile"
    static var description = IntentDescription("Says the baby's age and profile facts.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("get_baby_profile"))
    }
}

struct SiriLogSleepStartIntent: AppIntent {
    static var title: LocalizedStringResource = "Baby fell asleep"
    static var description = IntentDescription("Starts a sleep now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_sleep_start", write: true))
    }
}

struct SiriLogSleepEndIntent: AppIntent {
    static var title: LocalizedStringResource = "Baby woke up"
    static var description = IntentDescription("Ends the running sleep.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_sleep_end", write: true))
    }
}

struct SiriLogNursingIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a breastfeed"
    static var description = IntentDescription("Starts a nursing timer now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_nursing", write: true))
    }
}

struct SiriLogBathIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a bath"
    static var description = IntentDescription("Logs a bath now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_bath", write: true))
    }
}

struct SiriLogTummyTimeIntent: AppIntent {
    static var title: LocalizedStringResource = "Start tummy time"
    static var description = IntentDescription("Starts tummy time now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_tummy_time", write: true))
    }
}

struct SiriLogNasalSuctionIntent: AppIntent {
    static var title: LocalizedStringResource = "Log nasal suction"
    static var description = IntentDescription("Logs nasal suction now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_nasal_suction", write: true))
    }
}

struct SiriLogBellyMassageIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a belly massage"
    static var description = IntentDescription("Starts a belly massage now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_belly_massage", write: true))
    }
}

struct SiriLogNailTrimIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a nail trim"
    static var description = IntentDescription("Logs a nail trim now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_nail_trim", write: true))
    }
}

struct SiriLogSpitUpIntent: AppIntent {
    static var title: LocalizedStringResource = "Log spit-up"
    static var description = IntentDescription("Logs spit-up now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_spit_up", write: true))
    }
}

struct SiriLogTeethingIntent: AppIntent {
    static var title: LocalizedStringResource = "Log teething"
    static var description = IntentDescription("Logs teething now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_teething", write: true))
    }
}

struct SiriLogOutdoorIntent: AppIntent {
    static var title: LocalizedStringResource = "Start outdoor time"
    static var description = IntentDescription("Starts outdoor time now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_outdoor", write: true))
    }
}

struct SiriLogSkinCareIntent: AppIntent {
    static var title: LocalizedStringResource = "Log skin care"
    static var description = IntentDescription("Logs skin care now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_skin_care", write: true))
    }
}

struct SiriLogFussyIntent: AppIntent {
    static var title: LocalizedStringResource = "Baby is fussy"
    static var description = IntentDescription("Starts a fussy timer now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_fussy", write: true))
    }
}

struct SiriLogMilestoneIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a milestone"
    static var description = IntentDescription("Logs a milestone now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_milestone", write: true))
    }
}

struct SiriLogSymptomIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a symptom"
    static var description = IntentDescription("Logs a symptom now; a record only.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_symptom", write: true))
    }
}

struct SiriLogBreastPumpIntent: AppIntent {
    static var title: LocalizedStringResource = "Start the breast pump"
    static var description = IntentDescription("Starts a pumping session now.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("log_breast_pump", write: true))
    }
}

struct SiriLogRequestDeleteLastIntent: AppIntent {
    static var title: LocalizedStringResource = "Undo the last entry"
    static var description = IntentDescription("Asks to delete the last entry; the app asks you to confirm.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: await SiriSay.tool("request_delete_last_entry", write: true))
    }
}
