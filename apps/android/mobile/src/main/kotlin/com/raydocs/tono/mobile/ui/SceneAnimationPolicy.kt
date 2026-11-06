package com.raydocs.tono.mobile.ui

/** How the sea scene's ambient motion (drift, twinkle, breath, moving water) runs right now. */
enum class SceneMotion { FULL, THROTTLED, PAUSED }

/** The thermal status as the scene reads it (`PowerManager.THERMAL_STATUS_*` mapped by [thermalFrom]). */
enum class SceneThermal { NORMAL, SEVERE, CRITICAL }

/**
 * When the sea scene redraws. While someone can see it, every element keeps moving: at the display
 * rate normally, at about [THROTTLED_FPS] when the phone asks apps to spend less (Battery Saver, severe
 * thermal status). It holds a still frame only while nobody can see it move (the activity is below
 * STARTED) or the phone is critically hot. Mirrors iOS `SceneAnimationPolicy`.
 */
object SceneAnimationPolicy {
    const val THROTTLED_FPS = 15

    fun motion(started: Boolean, powerSave: Boolean, thermal: SceneThermal): SceneMotion = when {
        !started || thermal == SceneThermal.CRITICAL -> SceneMotion.PAUSED
        powerSave || thermal == SceneThermal.SEVERE -> SceneMotion.THROTTLED
        else -> SceneMotion.FULL
    }

    /** `PowerManager.THERMAL_STATUS_*`: SEVERE is 3, CRITICAL 4, EMERGENCY 5, SHUTDOWN 6. */
    fun thermalFrom(status: Int): SceneThermal = when {
        status >= 4 -> SceneThermal.CRITICAL
        status == 3 -> SceneThermal.SEVERE
        else -> SceneThermal.NORMAL
    }
}
