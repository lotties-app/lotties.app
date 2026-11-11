package app.lotties.app.widgets

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import app.lotties.app.shared.LottiesStore
import app.lotties.app.shared.SnapshotListener
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

/*
 * The Android side of the widgets that is not drawing (docs/design/37-widgets-siri.md section 13): the open choice per
 * widget (SharedPreferences, 25 s), the button actions (outbox + snapshot through LottiesStore, no network, no app), the
 * refresh when the web app writes the snapshot (a LottiesStore listener) and the next render at a due moment (one inexact
 * alarm).
 */

/** The open choice of each widget, by app widget id (iOS keeps one for all widgets in the App Group defaults). */
object WidgetPrefs {
    private const val FILE = "lotties-widgets"
    private const val TARGET = "picker.target."
    private const val UNTIL = "picker.until."

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun openPicker(context: Context, appWidgetId: Int, target: PickerTarget, now: Long = System.currentTimeMillis()) {
        val open = OpenPicker.opening(target, now)
        prefs(context).edit().putString(TARGET + appWidgetId, open.target.key).putLong(UNTIL + appWidgetId, open.until).apply()
    }

    fun closePicker(context: Context, appWidgetId: Int) {
        prefs(context).edit().remove(TARGET + appWidgetId).remove(UNTIL + appWidgetId).apply()
    }

    fun picker(context: Context, appWidgetId: Int, now: Long): OpenPicker? {
        val prefs = prefs(context)
        return OpenPicker.current(prefs.getString(TARGET + appWidgetId, null), prefs.getLong(UNTIL + appWidgetId, 0L), now)
    }

    /** The soonest end of an open choice of any widget, after [now]. */
    fun nextPickerEnd(context: Context, now: Long): Long? =
        prefs(context).all.filterKeys { it.startsWith(UNTIL) }.values.mapNotNull { it as? Long }.filter { it > now }.minOrNull()
}

/** Strings in the app's language (the snapshot's `language`), else the phone's. */
fun localizedContext(context: Context, language: String?): Context {
    if (language.isNullOrBlank()) return context
    val locale = if (language.startsWith("pt")) Locale.forLanguageTag("pt-BR") else Locale.ENGLISH
    val config = Configuration(context.resources.configuration)
    config.setLocale(locale)
    return context.createConfigurationContext(config)
}

/** What a button does: writes the outbox entry and shows it in the snapshot at once. Returns false when signed out. */
object WidgetActions {
    fun log(context: Context, request: WidgetRequest, now: Long = System.currentTimeMillis()): Boolean {
        val snapshot = LottiesStore.readSnapshot(context)
        val babyId = WidgetOutbox.targetBaby(snapshot) ?: return false
        return try {
            LottiesStore.appendOutbox(context, WidgetOutbox.entry(request, babyId, now).toString())
            WidgetOutbox.applyToSnapshot(snapshot, request, babyId, now)?.let { LottiesStore.writeSnapshot(context, it) }
            true
        } catch (_: Exception) {
            false
        }
    }
}

/** Re-renders every Lotties widget (all three kinds) and plans the next render. */
object WidgetRefresher {
    const val ACTION_REFRESH = "app.lotties.app.widgets.REFRESH"
    private val VERSION = intPreferencesKey("lotties.version")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lock = Any()
    private var pending: Job? = null

    @Volatile
    private var appContext: Context? = null

    private val listener = SnapshotListener { appContext?.let { request(it) } }

    private fun widgets(): List<Pair<Class<out GlanceAppWidget>, GlanceAppWidget>> = listOf(
        SummaryWidget::class.java to SummaryWidget(),
        LottiesWidget::class.java to LottiesWidget(),
        ActivitiesWidget::class.java to ActivitiesWidget(),
    )

    /** Process-wide: the widgets follow every snapshot write (called by the plugin's load and the receivers). */
    @JvmStatic
    fun register(context: Context) {
        appContext = context.applicationContext
        LottiesStore.addListener(listener)
    }

    /** A refresh soon; several requests in a row (the app writes after each event) make one. */
    fun request(context: Context) {
        val app = context.applicationContext
        synchronized(lock) {
            pending?.cancel()
            pending = scope.launch {
                delay(300)
                refreshAll(app)
            }
        }
    }

    /**
     * Waits until the refresh [request] asked for has run (a silent push keeps the process up only while its handler
     * runs, push/LottiesMessagingService.kt). Returns at once when none is pending; a newer request is waited for too.
     */
    suspend fun awaitPending() {
        while (true) {
            val job = synchronized(lock) { pending } ?: return
            job.join()
            if (synchronized(lock) { pending } === job) return
        }
    }

    suspend fun refreshAll(context: Context) {
        val app = context.applicationContext
        val manager = GlanceAppWidgetManager(app)
        var count = 0
        for ((type, widget) in widgets()) {
            for (id in manager.getGlanceIds(type)) {
                count++
                bump(app, id)
                widget.update(app, id)
            }
        }
        schedule(app, count > 0)
    }

    private suspend fun bump(context: Context, id: GlanceId) {
        updateAppWidgetState(context, id) { prefs -> prefs[VERSION] = (prefs[VERSION] ?: 0) + 1 }
    }

    /** The state key the widgets read so that a refresh recomposes them. */
    val versionKey get() = VERSION

    /**
     * One alarm for the next render (the end of an open choice, a highlight change, a row's "há 35 min" or an estimate
     * changing by itself, midnight; at most 15 minutes, [RefreshPlan]): non-waking and inexact on Android 12+ (no
     * exact-alarm permission), so it can come late, and nothing renders while the screen is off (the late alarm fires
     * when the phone wakes).
     */
    // setExact runs only below Android 12, where it needs no permission (lint cannot see the version check).
    @SuppressLint("MissingPermission")
    private fun schedule(context: Context, anyWidget: Boolean) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        val intent = PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, WidgetRefreshReceiver::class.java).setAction(ACTION_REFRESH),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        if (!anyWidget) {
            alarms.cancel(intent)
            return
        }
        val now = System.currentTimeMillis()
        val baby = WidgetSnapshot.parse(LottiesStore.readSnapshot(context))?.takeIf { it.signedIn }?.selectedBaby
        val pickerEnd = WidgetPrefs.nextPickerEnd(context, now)
        val at = RefreshPlan.next(now, baby, pickerEnd?.let { OpenPicker(PickerTarget.MORE, it) })
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            alarms.setExact(AlarmManager.RTC, at, intent)
        } else {
            alarms.set(AlarmManager.RTC, at, intent)
        }
    }

    /** Whether this widget sits on a lock screen (keyguard host): names are then hidden when the snapshot says so. */
    fun isOnLockScreen(context: Context, appWidgetId: Int): Boolean {
        val options = AppWidgetManager.getInstance(context).getAppWidgetOptions(appWidgetId)
        return options.getInt(AppWidgetManager.OPTION_APPWIDGET_HOST_CATEGORY, -1) ==
            android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD
    }
}

/** The alarm of [WidgetRefresher.schedule]: renders the widgets again (a choice expired, an estimate is coming up). */
class WidgetRefreshReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != WidgetRefresher.ACTION_REFRESH) return
        WidgetRefresher.register(context)
        val result = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                WidgetRefresher.refreshAll(context)
            } finally {
                result.finish()
            }
        }
    }
}
