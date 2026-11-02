package app.lotties.app.widgets

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.Action
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback

/*
 * The widget buttons (Glance action callbacks, run in a broadcast of this app's process, the app need not be open).
 * They only touch local files: the outbox entry and the snapshot (WidgetActions), or the open choice (WidgetPrefs).
 */

internal object Keys {
    val type = ActionParameters.Key<String>("type")
    val kind = ActionParameters.Key<String>("kind")
    val amountMl = ActionParameters.Key<Int>("amountMl")
    val side = ActionParameters.Key<String>("side")
    val target = ActionParameters.Key<String>("target")
}

/** Logs one request now (and closes this widget's open choice). */
class LogCallback : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val type = parameters[Keys.type] ?: return
        if (type !in OutboxType.all) return
        val request = WidgetRequest(type, parameters[Keys.kind], parameters[Keys.amountMl], parameters[Keys.side])
        WidgetPrefs.closePicker(context, GlanceAppWidgetManager(context).getAppWidgetId(glanceId))
        WidgetActions.log(context, request)
        WidgetRefresher.register(context)
        WidgetRefresher.refreshAll(context)
    }
}

/** Shows the choices (diaper, bottle, breast, more) in place of this widget's buttons for 25 seconds. */
class OpenPickerCallback : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val target = PickerTarget.fromKey(parameters[Keys.target]) ?: return
        WidgetPrefs.openPicker(context, GlanceAppWidgetManager(context).getAppWidgetId(glanceId), target)
        WidgetRefresher.refreshAll(context)
    }
}

/** The close button (x) of the choices. */
class ClosePickerCallback : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        WidgetPrefs.closePicker(context, GlanceAppWidgetManager(context).getAppWidgetId(glanceId))
        WidgetRefresher.refreshAll(context)
    }
}

internal fun logAction(request: WidgetRequest): Action {
    val pairs = mutableListOf<ActionParameters.Pair<out Any>>(Keys.type to request.type)
    request.kind?.let { pairs.add(Keys.kind to it) }
    request.amountMl?.let { pairs.add(Keys.amountMl to it) }
    request.side?.let { pairs.add(Keys.side to it) }
    return actionRunCallback<LogCallback>(actionParametersOf(*pairs.toTypedArray()))
}

internal fun pickerAction(target: PickerTarget): Action =
    actionRunCallback<OpenPickerCallback>(actionParametersOf(Keys.target to target.key))

internal fun closePickerAction(): Action = actionRunCallback<ClosePickerCallback>()

/** A tile's action: open its choices (bottle, breast, diaper) or log the activity at once. */
internal fun activityAction(activity: WidgetActivity): Action {
    activity.pickerTarget?.let { return pickerAction(it) }
    return logAction(WidgetRequest.activity(activity.eventKey ?: activity.key))
}
