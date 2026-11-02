package app.lotties.app.widgets

import android.appwidget.AppWidgetManager
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import androidx.glance.text.TextStyle
import androidx.glance.layout.Alignment
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

// Lotties (adaptive): one widget that shows more as it is resized

class LottiesWidget : GlanceAppWidget() {
    companion object {
        /** About 4x1, 4x2, 4x3 and 4x4 cells (on a Pixel launcher 1 to 4 cells are about 105, 225, 345 and 465 dp tall). */
        private val ONE_ROW = DpSize(180.dp, 40.dp)
        private val TWO_ROWS = DpSize(180.dp, 110.dp)
        private val THREE_ROWS = DpSize(250.dp, 250.dp)
        private val FOUR_ROWS = DpSize(250.dp, 420.dp)
    }

    override val sizeMode = SizeMode.Responsive(setOf(ONE_ROW, TWO_ROWS, THREE_ROWS, FOUR_ROWS))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val (appWidgetId, onLockScreen) = hostInfo(context, id)
        provideContent {
            val data = rememberWidgetData(appWidgetId, onLockScreen)
            val height = LocalSize.current.height
            val tier = when {
                height >= FOUR_ROWS.height -> 4
                height >= THREE_ROWS.height -> 3
                height >= TWO_ROWS.height -> 2
                else -> 1
            }
            WidgetHost(data) { baby -> LottiesContent(data, baby, tier) }
        }
    }
}

/** [tier] = rows: 1 buttons; 2 + sleep line and running feed; 3 + the summary list; 4 + the activity grid. */
@Composable
private fun LottiesContent(data: WidgetData, baby: WidgetSnapshot.Baby, tier: Int) {
    val picker = data.picker
    if (picker != null) {
        PickerPanel(data, baby, picker.target)
        return
    }
    Column(GlanceModifier.fillMaxSize()) {
        if (tier >= 2) {
            SleepLine(data, baby)
            Spacer(GlanceModifier.height(6.dp))
        }
        val run = baby.runningFeed
        if (tier == 2 && run != null) {
            RunningFeedRow(data, run, GlanceModifier.fillMaxWidth().height(40.dp))
            Spacer(GlanceModifier.height(4.dp))
        }
        QuickTiles(data, baby, if (tier <= 2) GlanceModifier.fillMaxWidth().defaultWeight() else GlanceModifier.fillMaxWidth().height(52.dp))
        if (tier >= 3) {
            Spacer(GlanceModifier.height(6.dp))
            SummaryRows(data, baby, GlanceModifier.fillMaxWidth().defaultWeight())
        }
        if (tier >= 4) {
            Spacer(GlanceModifier.height(6.dp))
            ActivityGrid(data, GlanceModifier.fillMaxWidth().height(96.dp))
        }
    }
}

/** Name, sleep state and its timer on one line. */
@Composable
private fun SleepLine(data: WidgetData, baby: WidgetSnapshot.Baby) {
    val facts = SleepFacts(baby)
    val words = data.words
    Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (data.showName) {
            Text(baby.name, style = captionStyle(), maxLines = 1)
            Spacer(GlanceModifier.width(8.dp))
        }
        Icon(facts.icon, 14.dp, Category.SLEEP.tone())
        Spacer(GlanceModifier.width(4.dp))
        val caption = when {
            !facts.known -> R.string.widget_sleep
            facts.asleep -> R.string.widget_asleep_for
            else -> R.string.widget_awake_for
        }
        Text(words.s(caption), style = TextStyle(color = Category.SLEEP.tone(), fontSize = 13.sp), maxLines = 1)
        val since = facts.since
        if (since != null) {
            Spacer(GlanceModifier.width(6.dp))
            Timer(since, data.now, big = false)
        }
    }
}

/** Last feed, diaper and breast with "x ago" and what is coming up (the Summary's list), plus the running feed. */
@Composable
private fun SummaryRows(data: WidgetData, baby: WidgetSnapshot.Baby, modifier: GlanceModifier) {
    Column(modifier) {
        val row = GlanceModifier.fillMaxWidth().defaultWeight()
        val run = baby.runningFeed
        if (run != null) {
            RunningFeedRow(data, run, GlanceModifier.fillMaxWidth().height(48.dp))
            WidgetActivity.defaultSlots.filter { !it.isFeed }.forEach { ActivityRow(data, baby, it, row) }
        } else {
            WidgetActivity.defaultSlots.forEach { ActivityRow(data, baby, it, row) }
        }
    }
}

/** The button row (bottle, diaper, breast or pause/stop, more, sleep). */
@Composable
internal fun QuickTiles(data: WidgetData, baby: WidgetSnapshot.Baby, modifier: GlanceModifier) {
    val words = data.words
    val facts = SleepFacts(baby)
    val gap = if (isCompact()) 6.dp else 8.dp
    Row(modifier) {
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
            Spacer(GlanceModifier.width(gap))
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

abstract class BaseWidgetReceiver : GlanceAppWidgetReceiver() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        // Glance already holds this broadcast (goAsync) for its own update; the refresh plans the next render.
        WidgetRefresher.register(context)
        WidgetRefresher.request(context)
    }
}

class SummaryWidgetReceiver : BaseWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SummaryWidget()
}

class LottiesWidgetReceiver : BaseWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = LottiesWidget()
}

class ActivitiesWidgetReceiver : BaseWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ActivitiesWidget()
}
