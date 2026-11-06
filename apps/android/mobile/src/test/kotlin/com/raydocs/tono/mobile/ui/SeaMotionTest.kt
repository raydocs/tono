package com.raydocs.tono.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SeaMotionTest {
    @Test fun batterySaverStopsTheAmbientLoopsAndReducedMotionWins() {
        assertFalse(SeaMotion.of(reduceMotion = false, powerSave = true).ambient)
        assertEquals(SeaMotion.LITE, SeaMotion.of(reduceMotion = false, powerSave = true))
        assertEquals(SeaMotion.STILL, SeaMotion.of(reduceMotion = true, powerSave = true))
        assertTrue(SeaMotion.of(reduceMotion = false, powerSave = false).ambient)
    }
}
