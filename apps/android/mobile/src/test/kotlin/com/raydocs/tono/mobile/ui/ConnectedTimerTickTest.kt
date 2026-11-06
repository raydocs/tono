package com.raydocs.tono.mobile.ui

import android.os.Looper
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ConnectedTimerTickTest {
    @Test fun connectedTimerDoesNotWakeWhileTheActivityIsStopped() {
        val owner = object : LifecycleOwner { override val lifecycle = LifecycleRegistry(this) }
        owner.lifecycle.currentState = Lifecycle.State.STARTED
        var ticks = 0
        val scope = CoroutineScope(Dispatchers.Main)
        scope.launch { tickEverySecondWhileStarted(owner.lifecycle) { ticks++ } }
        val looper = shadowOf(Looper.getMainLooper())
        looper.idleFor(Duration.ofMillis(2_500))
        assertTrue(ticks > 0)

        owner.lifecycle.currentState = Lifecycle.State.CREATED
        looper.idle()
        val stopped = ticks
        looper.idleFor(Duration.ofSeconds(10))
        assertEquals(stopped, ticks)

        owner.lifecycle.currentState = Lifecycle.State.STARTED
        looper.idle()
        assertEquals(stopped + 1, ticks)
        scope.cancel()
    }
}
