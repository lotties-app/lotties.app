package app.lotties.app.widgets

import android.content.Context
import android.os.SystemClock
import android.widget.RemoteViews
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.action.Action
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.color.ColorProvider as DayNightColorProvider
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.RowScope
import androidx.glance.layout.Spacer
import androidx.glance.LocalSize
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.lotties.app.MainActivity
import app.lotties.app.R
import app.lotties.app.shared.LottiesStore
import java.util.Date

/*
 * The widgets' look and shared pieces (Jetpack Glance), after code/mobile/ios/App/LottiesWidgets/LottiesWidgets.swift:
 * "Linen & Ink" (docs/design/02-visual-identity.md): paper and ink by day, ink by night, terracotta accent, one tint per
 * category, Tabler icons, a serif for the big numbers. Glance has no border: a framed tile is a box in the border colour
 * with the fill inset by the border width. Rounded corners need Android 12; older launchers draw square tiles.
 */

private fun dayNight(light: Long, dark: Long): ColorProvider =
    DayNightColorProvider(day = Color(light), night = Color(dark))

internal object Ink {
    val background = dayNight(0xFFF5EFE4, 0xFF1B1814)
    val text = dayNight(0xFF2A251F, 0xFFF2EADC)
    val muted = dayNight(0xFF6A6054, 0xFFB5AA99)
    val accent = dayNight(0xFFA8482A, 0xFFE58F68)

    /** The accent at 12% over the background (the sleep button's fill), opaque so the frame does not show through. */
    val accentSoft = dayNight(0xFFECDBCE, 0xFF33261E)
}

internal fun Category.tint(): ColorProvider = when (this) {
    Category.SLEEP -> dayNight(0xFFE2E7F0, 0xFF26303F)
    Category.FEEDING -> dayNight(0xFFE1EADB, 0xFF263425)
    Category.DIAPER -> dayNight(0xFFF2E5C6, 0xFF3A3120)
    Category.CARE -> dayNight(0xFFDCEBE8, 0xFF1F3330)
}

internal fun Category.tone(): ColorProvider = when (this) {
    Category.SLEEP -> dayNight(0xFF2C4870, 0xFFA9C1E3)
    Category.FEEDING -> dayNight(0xFF375F39, 0xFFA9CF9F)
    Category.DIAPER -> dayNight(0xFF6E4E0E, 0xFFE8C47A)
    Category.CARE -> dayNight(0xFF2F6B60, 0xFF9FD3C7)
}

@DrawableRes
internal fun iconRes(name: String): Int = when (name) {
    "baby_carriage" -> R.drawable.ic_tabler_baby_carriage
    "bath" -> R.drawable.ic_tabler_bath
    "bottle" -> R.drawable.ic_tabler_bottle
    "diaper" -> R.drawable.ic_tabler_diaper
    "dots" -> R.drawable.ic_tabler_dots
    "droplet" -> R.drawable.ic_tabler_droplet
    "droplet_half_2" -> R.drawable.ic_tabler_droplet_half_2
    "heart" -> R.drawable.ic_tabler_heart
    "massage" -> R.drawable.ic_tabler_massage
    "mood_cry" -> R.drawable.ic_tabler_mood_cry
    "moon_stars" -> R.drawable.ic_tabler_moon_stars
    "player_pause" -> R.drawable.ic_tabler_player_pause
    "player_play" -> R.drawable.ic_tabler_player_play
    "player_stop" -> R.drawable.ic_tabler_player_stop
    "scissors" -> R.drawable.ic_tabler_scissors
    "sun" -> R.drawable.ic_tabler_sun
    "trees" -> R.drawable.ic_tabler_trees
    "wind" -> R.drawable.ic_tabler_wind
    "x" -> R.drawable.ic_tabler_x
    "zzz" -> R.drawable.ic_tabler_zzz
    else -> R.drawable.ic_tabler_dots
}

@StringRes
internal fun WidgetActivity.titleRes(): Int = when (this) {
    WidgetActivity.BOTTLE -> R.string.widget_activity_bottle
    WidgetActivity.BREAST -> R.string.widget_activity_breast
    WidgetActivity.DIAPER -> R.string.widget_activity_diaper
    WidgetActivity.BATH -> R.string.widget_activity_bath
    WidgetActivity.BELLY_MASSAGE -> R.string.widget_activity_belly_massage
    WidgetActivity.TUMMY_TIME -> R.string.widget_activity_tummy_time
    WidgetActivity.NASAL_SUCTION -> R.string.widget_activity_nasal_suction
    WidgetActivity.NAIL_TRIM -> R.string.widget_activity_nail_trim
    WidgetActivity.SKIN_CARE -> R.string.widget_activity_skin_care
    WidgetActivity.OUTDOOR -> R.string.widget_activity_outdoor
    WidgetActivity.FUSSY -> R.string.widget_activity_fussy
}

/** Strings in the app's language, times in the phone's 12/24-hour setting. */
internal class Words(private val context: Context) {
    fun s(@StringRes id: Int, vararg args: Any): String = context.getString(id, *args)

    fun time(millis: Long): String = android.text.format.DateFormat.getTimeFormat(context).format(Date(millis))

    /** The rows' "há 35 min" / "35 min ago", "agora", or "Nada hoje" when the last one is not from today. */
    fun agoRounded(at: Long?, now: Long): String {
        if (at == null || !isSameDay(at, now)) return s(R.string.widget_nothing_today)
        val units = Ago.rounded(at, now).units() ?: return s(R.string.widget_just_now)
        return s(R.string.widget_ago, units)
    }
}

/** Everything one render needs, read once per refresh (the snapshot file, the open choice, the time). */
internal class WidgetData(
    val snapshot: WidgetSnapshot?,
    val baby: WidgetSnapshot.Baby?,
    val picker: OpenPicker?,
    val now: Long,
    val words: Words,
    val showName: Boolean,
) {
    val due: Due get() = baby?.let { DueRules.due(it, now) } ?: Due()

    companion object {
        fun load(context: Context, appWidgetId: Int, onLockScreen: Boolean): WidgetData {
            val now = System.currentTimeMillis()
            val snapshot = WidgetSnapshot.parse(LottiesStore.readSnapshot(context))
            val baby = snapshot?.takeIf { it.signedIn }?.selectedBaby
            return WidgetData(
                snapshot = snapshot,
                baby = baby,
                picker = WidgetPrefs.picker(context, appWidgetId, now),
                now = now,
                words = Words(localizedContext(context, snapshot?.language)),
                showName = !(onLockScreen && snapshot?.hideNamesOnLockScreen != false),
            )
        }
    }
}

/** Reads the data again each time [WidgetRefresher] bumps the widget's state version. */
@Composable
internal fun rememberWidgetData(appWidgetId: Int, onLockScreen: Boolean): WidgetData {
    val context = LocalContext.current
    val version = currentState(WidgetRefresher.versionKey) ?: 0
    return remember(version) { WidgetData.load(context, appWidgetId, onLockScreen) }
}

internal fun openAppAction(): Action = actionStartActivity<MainActivity>()

/** The widget's background and the "Open Lotties" hint when there is no signed-in data. */
@Composable
internal fun WidgetHost(data: WidgetData, content: @Composable (WidgetSnapshot.Baby) -> Unit) {
    Box(
        modifier = GlanceModifier.fillMaxSize().background(Ink.background).cornerRadius(16.dp)
            .padding(if (isCompact()) 6.dp else 10.dp)
            .clickable(openAppAction()),
        contentAlignment = Alignment.Center,
    ) {
        val baby = data.baby
        if (baby == null) OpenHint(data) else content(baby)
    }
}

@Composable
private fun OpenHint(data: WidgetData) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon("moon_stars", 22.dp, Ink.text)
        Text(
            data.words.s(R.string.widget_open_app),
            style = TextStyle(color = Ink.text, fontSize = 12.sp, fontWeight = FontWeight.Bold),
        )
    }
}

@Composable
internal fun Icon(name: String, size: Dp, color: ColorProvider) {
    Image(
        provider = ImageProvider(iconRes(name)),
        contentDescription = null,
        modifier = GlanceModifier.size(size),
        colorFilter = ColorFilter.tint(color),
    )
}

/** One-row widget (about 4x1): tiles are short, icon and label side by side in the choices. */
@Composable
internal fun isCompact(): Boolean = LocalSize.current.height < 100.dp

/** A box with a fill and, when [border] is set, a frame of [borderWidth] around it. */
@Composable
internal fun Framed(
    modifier: GlanceModifier,
    fill: ColorProvider,
    radius: Dp,
    border: ColorProvider? = null,
    borderWidth: Dp = 2.dp,
    content: @Composable () -> Unit,
) {
    if (border == null) {
        Box(modifier.background(fill).cornerRadius(radius), contentAlignment = Alignment.Center) { content() }
    } else {
        Box(modifier.background(border).cornerRadius(radius).padding(borderWidth), contentAlignment = Alignment.Center) {
            Box(
                GlanceModifier.fillMaxSize().background(fill).cornerRadius(radius - borderWidth),
                contentAlignment = Alignment.Center,
            ) { content() }
        }
    }
}

/**
 * A live count-up from [since] (a Chronometer in a RemoteViews: Glance has no timer text). Its colour comes from
 * res/values(-night)/widgets_colors.xml, resolved by the launcher in the system's light or dark mode.
 */
@Composable
internal fun Timer(since: Long, now: Long, big: Boolean, modifier: GlanceModifier = GlanceModifier) {
    val context = LocalContext.current
    val views = RemoteViews(
        context.packageName,
        if (big) R.layout.widget_chronometer_big else R.layout.widget_chronometer_small,
    )
    val base = SystemClock.elapsedRealtime() - maxOf(0L, now - since)
    views.setChronometer(R.id.widget_chronometer, base, null, true)
    AndroidRemoteViews(views, modifier)
}

internal fun captionStyle(color: ColorProvider = Ink.muted) = TextStyle(color = color, fontSize = 12.sp)

// Sleep

internal class SleepFacts(baby: WidgetSnapshot.Baby) {
    val asleep = baby.sleep?.asleep == true
    val since = baby.sleep?.startedAt
    val known = baby.sleep != null
    val icon = if (asleep) "zzz" else "sun"
}

@Composable
internal fun SleepBlock(data: WidgetData, baby: WidgetSnapshot.Baby) {
    val facts = SleepFacts(baby)
    val words = data.words
    Column {
        if (data.showName) Text(baby.name, style = captionStyle(), maxLines = 1)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(facts.icon, 14.dp, Category.SLEEP.tone())
            Spacer(GlanceModifier.width(4.dp))
            val caption = when {
                !facts.known -> R.string.widget_sleep
                facts.asleep -> R.string.widget_asleep_for
                else -> R.string.widget_awake_for
            }
            Text(words.s(caption), style = TextStyle(color = Category.SLEEP.tone(), fontSize = 14.sp), maxLines = 1)
        }
        val since = facts.since
        if (since != null) {
            Timer(since, data.now, big = true)
        } else {
            Text(
                "—",
                style = TextStyle(color = Ink.text, fontSize = 26.sp, fontWeight = FontWeight.Medium, fontFamily = FontFamily.Serif),
            )
        }
        val nap = baby.nextNap?.expected
        if (!facts.asleep && nap != null && nap > data.now) {
            Text(words.s(R.string.widget_next_nap, words.time(nap)), style = captionStyle(Category.SLEEP.tone()), maxLines = 1)
        }
    }
}

@Composable
internal fun SleepButton(data: WidgetData, baby: WidgetSnapshot.Baby) {
    val facts = SleepFacts(baby)
    val napDue = baby.nextNap?.expected?.takeIf { data.due.nap }
    val words = data.words
    val label = when {
        napDue != null -> words.s(R.string.widget_nap_at, words.time(napDue))
        facts.asleep -> words.s(R.string.widget_woke_up)
        else -> words.s(R.string.widget_fell_asleep)
    }
    val request = if (facts.asleep) WidgetRequest.sleepEnd() else WidgetRequest.sleepStart()
    val color = if (napDue != null) Ink.background else Ink.accent
    Framed(
        modifier = GlanceModifier.fillMaxWidth().height(38.dp).clickable(logAction(request)),
        fill = if (napDue != null) Ink.accent else Ink.accentSoft,
        radius = 19.dp,
        border = Ink.accent,
        borderWidth = 1.5.dp,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (facts.asleep) "sun" else "moon_stars", 16.dp, color)
            Spacer(GlanceModifier.width(6.dp))
            Text(label, style = TextStyle(color = color, fontSize = 14.sp, fontWeight = FontWeight.Medium), maxLines = 1)
        }
    }
}

// Tiles

/** A tinted square: icon over label; framed in the category tone while the action is coming up. */
@Composable
internal fun SquareTile(
    icon: String,
    title: String,
    category: Category,
    action: Action,
    modifier: GlanceModifier,
    due: Boolean = false,
) {
    val compact = isCompact()
    Framed(
        modifier = modifier.clickable(action),
        fill = category.tint(),
        radius = if (compact) 12.dp else 14.dp,
        border = if (due) category.tone() else null,
        borderWidth = if (compact) 2.dp else 2.5.dp,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, if (compact) 20.dp else 24.dp, category.tone())
            Text(
                title,
                style = TextStyle(
                    color = category.tone(),
                    fontSize = if (compact) 10.sp else 11.sp,
                    fontWeight = FontWeight.Medium,
                ),
                maxLines = 1,
            )
        }
    }
}

@Composable
internal fun ActivitySquare(data: WidgetData, activity: WidgetActivity, modifier: GlanceModifier) {
    SquareTile(
        icon = activity.icon,
        title = data.words.s(activity.titleRes()),
        category = activity.category,
        action = activityAction(activity),
        modifier = modifier,
        due = activity.isDue(data.due),
    )
}

@Composable
internal fun MoreSquare(data: WidgetData, modifier: GlanceModifier) {
    SquareTile("dots", data.words.s(R.string.widget_more), Category.CARE, pickerAction(PickerTarget.MORE), modifier)
}

/** A row of the medium Summary: icon, name (and the estimate under it), and how long ago on the right. */
@Composable
internal fun ActivityRow(data: WidgetData, baby: WidgetSnapshot.Baby, activity: WidgetActivity, modifier: GlanceModifier) {
    // As on iOS, the rows highlight the bottle and diaper estimates only (the breast row has none).
    val due = activity != WidgetActivity.BREAST && activity.isDue(data.due)
    val next = activity.nextAt(baby)?.takeIf { it > data.now || due }
    val words = data.words
    Framed(
        modifier = modifier.clickable(activityAction(activity)),
        fill = if (due) activity.category.tint() else ColorProvider(Color.Transparent),
        radius = 10.dp,
    ) {
        Row(
            modifier = GlanceModifier.fillMaxSize().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(GlanceModifier.width(24.dp), contentAlignment = Alignment.Center) {
                Icon(activity.icon, 20.dp, activity.category.tone())
            }
            Spacer(GlanceModifier.width(8.dp))
            Column(GlanceModifier.defaultWeight()) {
                Text(words.s(activity.titleRes()), style = TextStyle(color = Ink.text, fontSize = 14.sp), maxLines = 1)
                if (next != null) {
                    Text(
                        words.s(R.string.widget_next_short, words.time(next)),
                        style = TextStyle(color = activity.category.tone(), fontSize = 11.sp),
                        maxLines = 1,
                    )
                }
            }
            Spacer(GlanceModifier.width(4.dp))
            Text(
                words.agoRounded(activity.lastAt(baby), data.now),
                style = TextStyle(color = Ink.text, fontSize = 13.sp, fontWeight = FontWeight.Medium),
                maxLines = 1,
            )
        }
    }
}

@Composable
internal fun MoreRow(data: WidgetData, modifier: GlanceModifier) {
    Row(
        modifier = modifier.padding(horizontal = 8.dp).clickable(pickerAction(PickerTarget.MORE)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(GlanceModifier.width(24.dp), contentAlignment = Alignment.Center) { Icon("dots", 20.dp, Ink.muted) }
        Spacer(GlanceModifier.width(8.dp))
        Text(data.words.s(R.string.widget_more), style = TextStyle(color = Ink.muted, fontSize = 14.sp), maxLines = 1)
    }
}

/** The bottle or breastfeed running now: its time, and pause or resume (bottle) and stop. */
@Composable
internal fun RunningFeedRow(data: WidgetData, run: WidgetSnapshot.RunningFeed, modifier: GlanceModifier) {
    val bottle = run.kind == "bottle"
    val tone = Category.FEEDING.tone()
    Framed(modifier = modifier, fill = Category.FEEDING.tint(), radius = 12.dp, border = tone, borderWidth = 1.5.dp) {
        Row(
            modifier = GlanceModifier.fillMaxSize().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(if (bottle) "bottle" else "heart", 18.dp, tone)
            Spacer(GlanceModifier.width(6.dp))
            Column(GlanceModifier.defaultWeight()) {
                Text(
                    data.words.s(if (bottle) R.string.widget_activity_bottle else R.string.widget_activity_breast),
                    style = TextStyle(color = Ink.text, fontSize = 14.sp, fontWeight = FontWeight.Medium),
                    maxLines = 1,
                )
                if (run.paused) {
                    Text(data.words.s(R.string.widget_paused_minutes, run.elapsedSeconds / 60), style = captionStyle(), maxLines = 1)
                } else {
                    Timer(run.since, data.now, big = false)
                }
            }
            if (bottle) {
                val request = if (run.paused) WidgetRequest.feedResume() else WidgetRequest.feedPause()
                TimerCircle(if (run.paused) "player_play" else "player_pause", logAction(request))
                Spacer(GlanceModifier.width(6.dp))
            }
            TimerCircle("player_stop", logAction(WidgetRequest.feedStop()))
        }
    }
}

@Composable
private fun TimerCircle(icon: String, action: Action) {
    Framed(
        modifier = GlanceModifier.size(30.dp).clickable(action),
        fill = Ink.background,
        radius = 15.dp,
        border = Category.FEEDING.tone(),
        borderWidth = 1.dp,
    ) { Icon(icon, 15.dp, Category.FEEDING.tone()) }
}

// Choices inside the widget

@Composable
private fun ChoiceChip(title: String, category: Category, action: Action, modifier: GlanceModifier) {
    Framed(modifier = modifier.clickable(action), fill = category.tint(), radius = 12.dp) {
        Text(title, style = TextStyle(color = category.tone(), fontSize = 14.sp, fontWeight = FontWeight.Medium), maxLines = 1)
    }
}

/** What a tap on Diaper, Bottle, Breast or More opens inside the widget (offline, no app); closes after 25 s. */
@Composable
internal fun PickerPanel(data: WidgetData, baby: WidgetSnapshot.Baby, target: PickerTarget) {
    val words = data.words
    val title = when (target) {
        PickerTarget.DIAPER -> R.string.widget_pick_diaper
        PickerTarget.BOTTLE -> R.string.widget_pick_bottle
        PickerTarget.BREAST -> R.string.widget_pick_breast
        PickerTarget.MORE -> R.string.widget_pick_more
    }
    if (isCompact()) {
        CompactPicker(data, baby, target)
        return
    }
    Column(GlanceModifier.fillMaxSize()) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                words.s(title),
                style = TextStyle(color = Ink.text, fontSize = 14.sp, fontWeight = FontWeight.Medium),
                maxLines = 1,
                modifier = GlanceModifier.defaultWeight(),
            )
            Box(GlanceModifier.size(28.dp).clickable(closePickerAction()), contentAlignment = Alignment.Center) {
                Image(
                    provider = ImageProvider(iconRes("x")),
                    contentDescription = words.s(R.string.widget_close),
                    modifier = GlanceModifier.size(16.dp),
                    colorFilter = ColorFilter.tint(Ink.muted),
                )
            }
        }
        Spacer(GlanceModifier.height(6.dp))
        when (target) {
            PickerTarget.DIAPER -> ChoiceRow {
                val labels = listOf(R.string.widget_choice_wet, R.string.widget_choice_dirty, R.string.widget_choice_both)
                Choices.diaperKinds.forEachIndexed { index, kind ->
                    if (index > 0) Spacer(GlanceModifier.width(8.dp))
                    ChoiceChip(
                        words.s(labels[index]), Category.DIAPER, logAction(WidgetRequest.diaper(kind)),
                        GlanceModifier.defaultWeight().fillMaxHeight(),
                    )
                }
            }
            PickerTarget.BOTTLE -> ChoiceRow {
                Choices.bottleAmounts(baby).forEachIndexed { index, ml ->
                    if (index > 0) Spacer(GlanceModifier.width(8.dp))
                    ChoiceChip(
                        words.s(R.string.widget_ml, ml), Category.FEEDING, logAction(WidgetRequest.bottle(ml)),
                        GlanceModifier.defaultWeight().fillMaxHeight(),
                    )
                }
            }
            PickerTarget.BREAST -> ChoiceRow {
                val labels = listOf(R.string.widget_choice_left, R.string.widget_choice_right)
                Choices.breastSides.forEachIndexed { index, side ->
                    if (index > 0) Spacer(GlanceModifier.width(8.dp))
                    ChoiceChip(
                        words.s(labels[index]), Category.FEEDING, logAction(WidgetRequest.breast(side)),
                        GlanceModifier.defaultWeight().fillMaxHeight(),
                    )
                }
            }
            PickerTarget.MORE -> ActivityGrid(data, GlanceModifier.fillMaxWidth().defaultWeight())
        }
    }
}

/** The choices of a one-row widget: the title is the first chip's context, so only chips and the close button. */
@Composable
private fun CompactPicker(data: WidgetData, baby: WidgetSnapshot.Baby, target: PickerTarget) {
    val words = data.words
    Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
        val chip = GlanceModifier.defaultWeight().fillMaxHeight()
        when (target) {
            PickerTarget.DIAPER -> {
                val labels = listOf(R.string.widget_choice_wet, R.string.widget_choice_dirty, R.string.widget_choice_both)
                Choices.diaperKinds.forEachIndexed { i, kind ->
                    ChoiceChip(words.s(labels[i]), Category.DIAPER, logAction(WidgetRequest.diaper(kind)), chip)
                    Spacer(GlanceModifier.width(6.dp))
                }
            }
            PickerTarget.BOTTLE -> Choices.bottleAmounts(baby).forEach { ml ->
                ChoiceChip(words.s(R.string.widget_ml, ml), Category.FEEDING, logAction(WidgetRequest.bottle(ml)), chip)
                Spacer(GlanceModifier.width(6.dp))
            }
            PickerTarget.BREAST -> {
                val labels = listOf(R.string.widget_choice_left, R.string.widget_choice_right)
                Choices.breastSides.forEachIndexed { i, side ->
                    ChoiceChip(words.s(labels[i]), Category.FEEDING, logAction(WidgetRequest.breast(side)), chip)
                    Spacer(GlanceModifier.width(6.dp))
                }
            }
            PickerTarget.MORE -> WidgetActivity.panel.forEach { activity ->
                ActivitySquare(data, activity, chip)
                Spacer(GlanceModifier.width(4.dp))
            }
        }
        Box(GlanceModifier.size(32.dp).clickable(closePickerAction()), contentAlignment = Alignment.Center) {
            Image(
                provider = ImageProvider(iconRes("x")),
                contentDescription = words.s(R.string.widget_close),
                modifier = GlanceModifier.size(16.dp),
                colorFilter = ColorFilter.tint(Ink.muted),
            )
        }
    }
}

@Composable
private fun ChoiceRow(content: @Composable RowScope.() -> Unit) {
    Row(GlanceModifier.fillMaxWidth().height(56.dp), verticalAlignment = Alignment.CenterVertically, content = content)
}

/** The eight activities, two rows of four (the Activities widget and "More"). */
@Composable
internal fun ActivityGrid(data: WidgetData, modifier: GlanceModifier) {
    Column(modifier) {
        WidgetActivity.panel.chunked(4).forEachIndexed { rowIndex, row ->
            if (rowIndex > 0) Spacer(GlanceModifier.height(6.dp))
            Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
                row.forEachIndexed { index, activity ->
                    if (index > 0) Spacer(GlanceModifier.width(6.dp))
                    ActivitySquare(data, activity, GlanceModifier.defaultWeight().fillMaxHeight())
                }
            }
        }
    }
}
