package app.lotties.app.push

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/*
 * The widgets' silent push on Android (docs/design/37b-widget-silent-push.md sections 5 and 9), the part without Android
 * types: what an FCM data message means, what the plugin answers for the token, and how a ping reaches the app's live
 * WebView and waits for its answer. Unit-tested in SilentPushTest.
 */

/** The API's data message (`{"lotties": "sync", "v": "1"}`, design 37b section 3): it carries nothing else. */
object SilentPushMessage {
    const val KEY = "lotties"
    const val SYNC = "sync"

    /** Whether [data] is the "something changed, sync now" ping; any other message is ignored (as on iOS). */
    fun isSync(data: Map<String, String>?): Boolean = data?.get(KEY) == SYNC

    /**
     * The plugin's answer to `pushToken` (code/web/src/widgets/silentPushBridge.ts `toPushToken`): the FCM token with
     * its channel, or nothing (no Firebase in this build, no Google Play services, no network), which registers nothing.
     */
    fun tokenReply(token: String?): Map<String, String> =
        if (token.isNullOrBlank()) emptyMap() else mapOf("channel" to "fcm", "token" to token)
}

/** What became of one ping. */
enum class PingOutcome {
    /** No live WebView listens (the app is closed, signed out, or not started yet): the cold path, nothing to do. */
    NO_APP,

    /** The WebView pulled the sync (and wrote the snapshot when it changed). */
    SYNCED,

    /** The WebView answered without a successful sync (no network, signed out meanwhile). */
    NOT_SYNCED,

    /** No answer in time. */
    TIMED_OUT,
}

/** The app's live WebView, registered by the `LottiesShared` plugin while it is loaded. */
fun interface PingReceiver {
    /** Hands one ping to the page; false when no page listens for it (nothing will answer). */
    fun onRemoteChange(): Boolean
}

/**
 * Process-wide link between the messaging service (a ping arrived) and the `LottiesShared` plugin (the WebView that
 * syncs). [deliver] hands the ping to the live page and blocks its caller, the service's worker thread, until the page
 * answers `silentPushDone` ([answered]) or the time runs out: the process then stays up while the WebView syncs and
 * writes the snapshot, as the completion handler does on iOS. One answer ends every ping waiting (one sync served them).
 */
class SilentPushRelay {
    private val lock = Any()
    private var receiver: PingReceiver? = null
    private val waiting = mutableListOf<Waiter>()

    /** The plugin's load: it replaces any receiver before it (a recreated activity). */
    fun attach(receiver: PingReceiver) {
        synchronized(lock) { this.receiver = receiver }
    }

    /**
     * The plugin's destroy. Only the receiver attached: a stale plugin must not detach its successor. Pings waiting on
     * it end as not synced (its page is gone).
     */
    fun detach(receiver: PingReceiver) {
        val ended = synchronized(lock) {
            if (this.receiver !== receiver) return
            this.receiver = null
            takeWaiting()
        }
        ended.forEach { it.complete(false) }
    }

    /** Hands a ping to the live page and waits up to [timeoutMs] for its answer. Never throws. */
    fun deliver(timeoutMs: Long): PingOutcome {
        val waiter = Waiter()
        val target = synchronized(lock) {
            val current = receiver ?: return PingOutcome.NO_APP
            waiting.add(waiter)
            current
        }
        try {
            val handed = try {
                target.onRemoteChange()
            } catch (_: RuntimeException) {
                false
            }
            return if (handed) waiter.await(timeoutMs) else PingOutcome.NO_APP
        } finally {
            synchronized(lock) { waiting.remove(waiter) }
        }
    }

    /** `silentPushDone {changed}` from the page: ends every ping waiting. */
    fun answered(changed: Boolean) {
        val ended = synchronized(lock) { takeWaiting() }
        ended.forEach { it.complete(changed) }
    }

    private fun takeWaiting(): List<Waiter> = waiting.toList().also { waiting.clear() }

    private class Waiter {
        private val latch = CountDownLatch(1)

        @Volatile
        private var changed = false

        fun complete(value: Boolean) {
            changed = value
            latch.countDown()
        }

        fun await(timeoutMs: Long): PingOutcome {
            val answered = try {
                latch.await(timeoutMs, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                false
            }
            return when {
                !answered -> PingOutcome.TIMED_OUT
                changed -> PingOutcome.SYNCED
                else -> PingOutcome.NOT_SYNCED
            }
        }
    }

    companion object {
        /** The app's relay: the messaging service and the plugin run in the same process. */
        @JvmStatic
        val shared = SilentPushRelay()
    }
}
