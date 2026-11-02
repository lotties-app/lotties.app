package app.lotties.app.widgets

import android.appwidget.AppWidgetManager
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.width
import androidx.glance.text.Text
import app.lotties.app.R

/*
 * The three Android home-screen widgets (docs/design/37-widgets-siri.md section 13), the twins of the iOS Summary,
 * Quick actions and Activities widgets (code/mobile/ios/App/LottiesWidgets/LottiesWidgets.swift). They read the snapshot
 * the web app writes (LottiesStore) and their buttons only append to the outbox: no network, the app need not be open.
 */

/** The id the launcher knows the widget by, and whether it sits on a lock screen. */
private suspend fun hostInfo(context: Context, id: GlanceId): Pair<Int, Boolean> {
    val appWidgetId = GlanceAppWidgetManager(context).getAppWidgetId(id)
    return appWidgetId to WidgetRefresher.isOnLockScreen(context, appWidgetId)
}

// Summary (small and medium)

class SummaryWidget : GlanceAppWidget() {
    companion object {
        private val SMALL = DpSize(110.dp, 110.dp)
        private val MEDIUM = DpSize(250.dp, 110.dp)
    }

    override val sizeMode = SizeMode.Responsive(setOf(SMALL, MEDIUM))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val (appWidgetId, onLockScreen) = hostInfo(context, id)
        provideContent {
            val data = rememberWidgetData(appWidgetId, onLockScreen)
            val medium = LocalSize.current.width >= MEDIUM.width
            WidgetHost(data) { baby -> if (medium) SummaryMedium(data, baby) else SummarySmall(data, baby) }
        }
    }
}

@Composable
private fun SummarySmall(data: WidgetData, baby: WidgetSnapshot.Baby) {
    Column(GlanceModifier.fillMaxSize()) {
        SleepBlock(data, baby)
        Spacer(GlanceModifier.defaultWeight())
        SleepButton(data, baby)
    }
}

@Composable
private fun SummaryMedium(data: WidgetData, baby: WidgetSnapshot.Baby) {
    val picker = data.picker
    if (picker != null) {
        PickerPanel(data, baby, picker.target)
        return
    }
    val slots = WidgetActivity.defaultSlots
    Row(GlanceModifier.fillMaxSize()) {
        Column(GlanceModifier.width(124.dp).fillMaxHeight()) {
            SleepBlock(data, baby)
            Spacer(GlanceModifier.defaultWeight())
            SleepButton(data, baby)
        }
        Spacer(GlanceModifier.width(10.dp))
        Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
            val row = GlanceModifier.fillMaxWidth().defaultWeight()
            val run = baby.runningFeed
            if (run != null) {
                RunningFeedRow(data, run, row)
                slots.filter { !it.isFeed }.take(2).forEach { ActivityRow(data, baby, it, row) }
            } else {
                slots.forEach { ActivityRow(data, baby, it, row) }
            }
            MoreRow(data, row)
        }
    }
}

// Quick actions (medium)

class QuickWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Single

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val (appWidgetId, onLockScreen) = hostInfo(context, id)
        provideContent {
            val data = rememberWidgetData(appWidgetId, onLockScreen)
            WidgetHost(data) { baby -> QuickContent(data, baby) }
        }
    }
}

@Composable
private fun QuickContent(data: WidgetData, baby: WidgetSnapshot.Baby) {
    val picker = data.picker
    if (picker != null) {
        PickerPanel(data, baby, picker.target)
        return
    }
    val words = data.words
    val facts = SleepFacts(baby)
    Column(GlanceModifier.fillMaxSize()) {
        if (data.showName) {
            Text(baby.name, style = captionStyle(), maxLines = 1)
            Spacer(GlanceModifier.height(6.dp))
        }
        Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
            val tile = GlanceModifier.defaultWeight().fillMaxHeight()
            QuickItem.items(WidgetActivity.defaultSlots, baby.runningFeed).forEach { item ->
                when (item) {
                    is QuickItem.Activity -> ActivitySquare(data, item.activity, tile)
                    is QuickItem.Pause -> SquareTile(
                        icon = if (item.paused) "player_play" else "player_pause",
                        title = words.s(if (item.paused) R.string.widget_resume else R.string.widget_pause),
                        category = Category.FEEDING,
                        action = logAction(if (item.paused) WidgetRequest.feedResume() else WidgetRequest.feedPause()),
                        modifier = tile,
                    )
                    QuickItem.Stop -> SquareTile(
                        "player_stop", words.s(R.string.widget_stop), Category.FEEDING,
                        logAction(WidgetRequest.feedStop()), tile,
                    )
                    QuickItem.More -> MoreSquare(data, tile)
                }
                Spacer(GlanceModifier.width(8.dp))
            }
            if (facts.asleep) {
                SquareTile("sun", words.s(R.string.widget_woke_up), Category.SLEEP, logAction(WidgetRequest.sleepEnd()), tile)
            } else {
                SquareTile(
                    "moon_stars", words.s(R.string.widget_asleep_short), Category.SLEEP,
                    logAction(WidgetRequest.sleepStart()), tile, due = data.due.nap,
                )
            }
        }
    }
}

// Activities (medium)

class ActivitiesWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Single

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val (appWidgetId, onLockScreen) = hostInfo(context, id)
        provideContent {
            val data = rememberWidgetData(appWidgetId, onLockScreen)
            WidgetHost(data) { baby ->
                Column(GlanceModifier.fillMaxSize()) {
                    if (data.showName) {
                        Text(baby.name, style = captionStyle(), maxLines = 1)
                        Spacer(GlanceModifier.height(6.dp))
                    }
                    ActivityGrid(data, GlanceModifier.fillMaxWidth().defaultWeight())
                }
            }
        }
    }
}

// Receivers (AndroidManifest.xml); each one also keeps the process-wide refresh hooked to the snapshot.

abstract class LottiesWidgetReceiver : GlanceAppWidgetReceiver() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        // Glance already holds this broadcast (goAsync) for its own update; the refresh plans the next render.
        WidgetRefresher.register(context)
        WidgetRefresher.request(context)
    }
}

class SummaryWidgetReceiver : LottiesWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SummaryWidget()
}

class QuickWidgetReceiver : LottiesWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = QuickWidget()
}

class ActivitiesWidgetReceiver : LottiesWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ActivitiesWidget()
}
