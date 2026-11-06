package com.raydocs.tono.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class SceneAnimationPolicyTest {
    @Test fun sceneKeepsMovingWhileSeenSlowsWhenPowerIsShortAndHoldsOnlyWhenUnseenOrCritical() {
        fun motion(started: Boolean = true, powerSave: Boolean = false, thermal: Int = 0) =
            SceneAnimationPolicy.motion(started, powerSave, SceneAnimationPolicy.thermalFrom(thermal))
        assertEquals(SceneMotion.FULL, motion())
        assertEquals(SceneMotion.FULL, motion(thermal = 2)) // MODERATE
        assertEquals(SceneMotion.THROTTLED, motion(powerSave = true))
        assertEquals(SceneMotion.THROTTLED, motion(thermal = 3)) // SEVERE
        assertEquals(SceneMotion.PAUSED, motion(thermal = 4)) // CRITICAL
        assertEquals(SceneMotion.PAUSED, motion(thermal = 6)) // SHUTDOWN
        assertEquals(SceneMotion.PAUSED, motion(started = false))
    }
}
