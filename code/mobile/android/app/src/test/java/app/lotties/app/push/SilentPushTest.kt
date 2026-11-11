package app.lotties.app.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class SilentPushTest {

    // The data message (design 37b section 3)

    @Test
    fun onlyTheSyncPingCounts() {
        assertTrue(SilentPushMessage.isSync(mapOf("lotties" to "sync", "v" to "1")))
        assertTrue(SilentPushMessage.isSync(mapOf("lotties" to "sync")))
        assertFalse(SilentPushMessage.isSync(mapOf("lotties" to "SYNC")))
        assertFalse(SilentPushMessage.isSync(mapOf("lotties" to "other", "v" to "1")))
        assertFalse(SilentPushMessage.isSync(mapOf("v" to "1")))
        assertFalse(SilentPushMessage.isSync(emptyMap()))
        assertFalse(SilentPushMessage.isSync(null))
    }

    @Test
    fun theTokenReplyHasTheChannelOrNothing() {
        assertEquals(mapOf("channel" to "fcm", "token" to "abc:APA91b-x_y"), SilentPushMessage.tokenReply("abc:APA91b-x_y"))
        assertEquals(emptyMap<String, String>(), SilentPushMessage.tokenReply(null))
        assertEquals(emptyMap<String, String>(), SilentPushMessage.tokenReply(""))
        assertEquals(emptyMap<String, String>(), SilentPushMessage.tokenReply("  "))
    }

    // The relay between the messaging service and the plugin

    @Test
    fun withoutALivePageNothingWaits() {
        val relay = SilentPushRelay()
        assertEquals(PingOutcome.NO_APP, relay.deliver(5_000))
    }

    @Test
    fun aPageThatDoesNotListenAnswersAtOnce() {
        val relay = SilentPushRelay()
        relay.attach { false }
        assertEquals(PingOutcome.NO_APP, relay.deliver(5_000))
    }

    @Test
    fun aFailingPageCountsAsNoPage() {
        val relay = SilentPushRelay()
        relay.attach { throw IllegalStateException("bridge gone") }
        assertEquals(PingOutcome.NO_APP, relay.deliver(5_000))
    }

    @Test
    fun theAnswerOfThePageEndsTheWait() {
        val relay = SilentPushRelay()
        relay.attach {
            thread { relay.answered(true) }
            true
        }
        assertEquals(PingOutcome.SYNCED, relay.deliver(5_000))

        relay.attach {
            relay.answered(false) // an answer before the receiver returns still counts
            true
        }
        assertEquals(PingOutcome.NOT_SYNCED, relay.deliver(5_000))
    }

    @Test
    fun noAnswerInTimeIsATimeout() {
        val relay = SilentPushRelay()
        relay.attach { true }
        assertEquals(PingOutcome.TIMED_OUT, relay.deliver(50))
    }

    @Test
    fun anAnswerWithNoPingWaitingIsIgnored() {
        val relay = SilentPushRelay()
        relay.answered(true)
        relay.attach { true }
        assertEquals(PingOutcome.TIMED_OUT, relay.deliver(50))
    }

    @Test
    fun oneAnswerEndsEveryPingWaiting() {
        val relay = SilentPushRelay()
        val handed = CountDownLatch(2)
        relay.attach {
            handed.countDown()
            true
        }
        val outcomes = arrayOfNulls<PingOutcome>(2)
        val waiters = (0..1).map { index -> thread { outcomes[index] = relay.deliver(5_000) } }
        assertTrue(handed.await(5, TimeUnit.SECONDS))
        relay.answered(true)
        waiters.forEach { it.join(5_000) }
        assertEquals(listOf(PingOutcome.SYNCED, PingOutcome.SYNCED), outcomes.toList())
    }

    @Test
    fun theDestroyedPageEndsItsPingsAndStopsReceiving() {
        val relay = SilentPushRelay()
        val handed = CountDownLatch(1)
        val receiver = PingReceiver {
            handed.countDown()
            true
        }
        relay.attach(receiver)
        var outcome: PingOutcome? = null
        val waiter = thread { outcome = relay.deliver(5_000) }
        assertTrue(handed.await(5, TimeUnit.SECONDS))

        relay.detach(receiver)
        waiter.join(5_000)

        assertEquals(PingOutcome.NOT_SYNCED, outcome)
        assertEquals(PingOutcome.NO_APP, relay.deliver(5_000))
    }

    @Test
    fun aStalePageDoesNotDetachItsSuccessor() {
        val relay = SilentPushRelay()
        val old = PingReceiver { true }
        val current = PingReceiver {
            relay.answered(true)
            true
        }
        relay.attach(old)
        relay.attach(current)

        relay.detach(old)

        assertEquals(PingOutcome.SYNCED, relay.deliver(5_000))
    }
}
