package com.raydocs.tono.mobile.ui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.PowerManager
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.withInfiniteAnimationFrameNanos
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.sin
import kotlin.random.Random

/** Which sky the scene paints. Mirrors the desktop SeaScene destinations. */
enum class SkyState { NIGHT, DAWN, RISING, DAY, DUSK_WARNING, EMBER }

/**
 * Portrait adaptation of the desktop sea scene: sky, sun or moon, horizon and a glittering
 * reflection. Purely decorative (no semantics); state text lives in the UI above it. [moon]: false
 * where text could reach the moon's place (sign-in at large text sizes).
 * Only alpha/position animate; reduced motion renders the destination statically.
 */
@Composable
fun SeaScene(sky: SkyState, modifier: Modifier = Modifier, horizon: Float = 0.47f, moon: Boolean = true) {
    val reduce = LocalReduceMotion.current
    val target = when (sky) {
        SkyState.NIGHT -> 0f
        SkyState.DAWN -> 0.32f
        // Connecting stays clearly below the connected day (review: the two skies read alike at 0.7).
        SkyState.RISING -> 0.5f
        SkyState.DAY -> 1f
        SkyState.DUSK_WARNING -> 0.72f
        SkyState.EMBER -> 0.28f
    }
    // The sun sets in step with the words: "Not connected" or "Didn't connect" under a full daylight
    // sky for the ambient 1.8 s read as a contradiction in the frame-by-frame review.
    val spec = when {
        reduce -> tween(0)
        sky == SkyState.DAY -> TonoMotion.arrival
        sky == SkyState.NIGHT || sky == SkyState.EMBER -> TonoMotion.settle
        else -> TonoMotion.ambient
    }
    val sunRise by animateFloatAsState(target, spec, label = "sun")
    // Failed: the sun has set (only its afterglow stays), so the frame cannot be read as a half-risen
    // connecting sun (review: the two looked alike with a half disc on both).
    val disc by animateFloatAsState(if (sky == SkyState.EMBER) 0f else 1f, spec, label = "disc")
    val warn by animateFloatAsState(if (sky == SkyState.DUSK_WARNING || sky == SkyState.EMBER) 1f else 0f, if (reduce) tween(0) else TonoMotion.ambient, label = "warn")
    // Reduced motion runs no ambient loop at all (also saves battery). Otherwise the loop runs at the
    // display rate, about 15 fps under Battery Saver or severe heat, and stops while nobody can see the
    // scene or the phone is critically hot (SceneAnimationPolicy). Stopped, the scene shows the same
    // still frame as reduced motion, never whatever phase the clock stopped on.
    val policy = rememberSceneMotion()
    val motion = if (reduce) SceneMotion.PAUSED else policy
    val still = motion == SceneMotion.PAUSED
    val clock = rememberAmbientClock(motion)
    val stars = remember { List(70) { Triple(Random(it * 31).nextFloat(), Random(it * 17 + 3).nextFloat() * 0.9f, Random(it * 7 + 1).nextFloat()) } }
    val connecting = sky == SkyState.DAWN || sky == SkyState.RISING

    Canvas(modifier.clearAndSetSemantics { }) {
        // Read here, in the draw phase, so each tick redraws the canvas without recomposing.
        val ms = clock.value
        val drift = if (still) 0f else (ms % 26_000L) / 26_000f
        val breath = if (still) 1f else breathAt(ms)
        val horizonY = size.height * horizon
        // Leaving protection is immediate; an old full sun must not outlive the state word.
        val t = if (sky == SkyState.NIGHT || sky == SkyState.EMBER) target else sunRise
        // Sky: night ink → plum/amber dusk → warm day glow.
        val top = lerp(lerp(Color(0xFF070816), Color(0xFF1B1030), (t * 1.4f).coerceAtMost(1f)), Color(0xFF2A1426), warn * 0.4f)
        val mid = lerp(lerp(Color(0xFF111433), Color(0xFF5A2238), t), Color(0xFF4A1A1C), warn * 0.5f)
        val low = lerp(lerp(Color(0xFF1C2350), Color(0xFFE0784E), t), Color(0xFFB0452C), warn * 0.6f)
        drawRect(Brush.verticalGradient(listOf(top, mid, low), endY = horizonY), size = Size(size.width, horizonY))

        // Stars fade with daylight.
        val starAlpha = (1f - t * 1.6f).coerceIn(0f, 1f)
        if (starAlpha > 0f) stars.forEachIndexed { i, (x, y, tw) ->
            val twinkle = if (still || i % 3 != 0) 1f else 0.55f + 0.45f * sin((drift * 12 + tw) * 2 * PI).toFloat()
            drawCircle(Color.White.copy(alpha = starAlpha * (0.25f + 0.6f * tw) * twinkle), radius = 0.6f + tw * 1.3f, center = Offset(x * size.width, y * horizonY * 0.85f))
        }

        // Sun travels from below the horizon (night) to just clear of it (connected), staying under
        // the headline so text never sits on the sun.
        val sunR = size.minDimension * 0.13f
        // Wider than tall (a landscape phone): the sun moves off the controls column, towards the moon.
        val sunX = size.width * if (size.width > size.height) 0.68f else 0.5f
        val sunY = horizonY + sunR * 1.05f - t * sunR * 2.25f
        val glowPulse = if (connecting && !still) 0.75f + 0.25f * breath else 1f
        clipRect(bottom = horizonY) {
            if (t > 0.02f) {
                drawCircle(
                    Brush.radialGradient(listOf(TonoColors.SunMid.copy(alpha = 0.55f * glowPulse * t.coerceAtMost(1f)), Color.Transparent), Offset(sunX, sunY), sunR * 3.2f),
                    radius = sunR * 3.2f, center = Offset(sunX, sunY),
                )
                val core = lerp(TonoColors.SunCore, Color(0xFFFFC08A), warn)
                val edge = lerp(TonoColors.SunEdge, TonoColors.Ember, warn)
                // Setting below the horizon as well as fading, as a real sunset does.
                val discY = sunY + (1f - disc) * sunR * 1.1f
                if (disc > 0.01f) drawCircle(
                    Brush.verticalGradient(listOf(core, TonoColors.SunMid, edge), startY = discY - sunR, endY = discY + sunR),
                    radius = sunR, center = Offset(sunX, discY), alpha = disc,
                )
            }
        }
        // Moon while disconnected (desktop night/login scenes use a crescent).
        val moonAlpha = if (moon) (1f - t * 6f).coerceIn(0f, 1f) else 0f
        if (moonAlpha > 0f) crescent(Offset(size.width * 0.80f, horizonY * 0.66f), size.minDimension * 0.055f, moonAlpha)

        // Sea.
        drawRect(
            Brush.verticalGradient(listOf(lerp(Color(0xFF1A1E3E), Color(0xFF3A1E2E), t), Color(0xFF0B0C1A), TonoColors.NightDeep), startY = horizonY, endY = size.height),
            topLeft = Offset(0f, horizonY), size = Size(size.width, size.height - horizonY),
        )
        drawLine(lerp(Color(0x33B8C4FF), Color(0x66FFD2A0), t), Offset(0f, horizonY), Offset(size.width, horizonY), strokeWidth = 1.2f)

        // Reflection column: horizontal glints whose drift is the only ambient motion.
        val reflectAlpha = if (t > 0.02f) t.coerceAtMost(1f) * (0.35f + 0.65f * disc) else moonAlpha * 0.35f
        val reflectX = if (t > 0.02f) sunX else size.width * 0.80f
        val reflectColor = if (t > 0.02f) lerp(TonoColors.SunMid, TonoColors.Ember, warn) else TonoColors.Moon
        reflection(reflectX, horizonY, reflectAlpha, reflectColor, drift, sunR, glow = t > 0.02f)
    }
}

/** The breath of the connecting glow: 0..1 and back every 4.8 s, eased as the earlier tween, from 1 at 0 ms. */
private fun breathAt(ms: Long): Float {
    val u = (ms % 4_800L) / 2_400f
    return FastOutSlowInEasing.transform(if (u <= 1f) 1f - u else u - 1f)
}

/**
 * Milliseconds of ambient motion, advanced by the frame clock as an infinite animation (so UI tests,
 * which hold infinite animations, still reach idle). Throttled, it ticks about
 * [SceneAnimationPolicy.THROTTLED_FPS] times a second and keeps its phase across the switch. Paused, it
 * returns to 0 (the still frame's phase), so the scene restarts from the frame it was holding.
 */
@Composable
private fun rememberAmbientClock(motion: SceneMotion): State<Long> {
    val ms = remember { mutableLongStateOf(0L) }
    LaunchedEffect(motion) {
        if (motion == SceneMotion.PAUSED) {
            ms.longValue = 0L
            return@LaunchedEffect
        }
        val origin = ms.longValue
        val start = withInfiniteAnimationFrameNanos { it }
        while (true) {
            val now = withInfiniteAnimationFrameNanos { it }
            ms.longValue = origin + (now - start) / 1_000_000L
            if (motion == SceneMotion.THROTTLED) delay(1_000L / SceneAnimationPolicy.THROTTLED_FPS)
        }
    }
    return ms
}

/** The scene's [SceneMotion] from the activity lifecycle, Battery Saver and the thermal status, observed live. */
@Composable
private fun rememberSceneMotion(): SceneMotion {
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val context = LocalContext.current
    val power = remember(context) { context.getSystemService(PowerManager::class.java) }
    var powerSave by remember(power) { mutableStateOf(power?.isPowerSaveMode == true) }
    var thermal by remember(power) { mutableStateOf(SceneAnimationPolicy.thermalFrom(power?.currentThermalStatus ?: 0)) }
    DisposableEffect(context, power) {
        if (power == null) return@DisposableEffect onDispose { }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) { powerSave = power.isPowerSaveMode }
        }
        ContextCompat.registerReceiver(context, receiver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        val listener = PowerManager.OnThermalStatusChangedListener { thermal = SceneAnimationPolicy.thermalFrom(it) }
        power.addThermalStatusListener(context.mainExecutor, listener)
        // A change between the first read and the registration above is not missed.
        powerSave = power.isPowerSaveMode
        thermal = SceneAnimationPolicy.thermalFrom(power.currentThermalStatus)
        onDispose {
            context.unregisterReceiver(receiver)
            power.removeThermalStatusListener(listener)
        }
    }
    return SceneAnimationPolicy.motion(lifecycle.isAtLeast(Lifecycle.State.STARTED), powerSave, thermal)
}

private fun DrawScope.crescent(center: Offset, r: Float, alpha: Float) {
    drawCircle(Brush.radialGradient(listOf(TonoColors.Moon.copy(alpha = 0.18f * alpha), Color.Transparent), center, r * 4f), r * 4f, center)
    val path = Path().apply {
        addOval(androidx.compose.ui.geometry.Rect(center, r))
    }
    val cut = Path().apply { addOval(androidx.compose.ui.geometry.Rect(Offset(center.x - r * 0.45f, center.y - r * 0.3f), r * 0.95f)) }
    drawPath(Path.combine(androidx.compose.ui.graphics.PathOperation.Difference, path, cut), TonoColors.Moon.copy(alpha = alpha))
}

private fun DrawScope.reflection(x: Float, horizonY: Float, alpha: Float, color: Color, drift: Float, sunR: Float, glow: Boolean) {
    if (alpha <= 0f) return
    val depth = size.height - horizonY
    // A soft column of light under the sun first, so the glints read as light on water, not a ladder.
    // Sun only, kept narrow and drawn without a blend mode: on a software renderer every frame's cost
    // counts (with the first, heavier version the emulators' main thread never went idle).
    if (glow) scale(scaleX = 0.3f, scaleY = 1f, pivot = Offset(x, horizonY)) {
        drawCircle(
            Brush.radialGradient(listOf(color.copy(alpha = 0.20f * alpha), Color.Transparent), Offset(x, horizonY), depth * 0.42f),
            radius = depth * 0.42f, center = Offset(x, horizonY),
        )
    }
    // About as many strokes as the earlier one-per-row column (46), in fewer rows of two.
    val rows = 28
    val tau = 2 * PI.toFloat()
    for (i in 0 until rows) {
        val p = i / rows.toFloat()
        val y = horizonY + 3f + p * p * depth * 0.95f
        val span = sunR * (0.45f + p * 2.8f)
        val sway = sin(i * 2.3f + drift * tau * 5) * sunR * 0.22f * p
        // Each row breaks into a few glints of uneven length (fixed per row, so it does not flicker).
        val pieces = 2
        for (k in 0 until pieces) {
            val h = ((i * 131 + k * 71) % 97) / 97f
            if (h < 0.18f && k > 0) continue
            val centre = -0.5f + (k + 0.5f) / pieces + (h - 0.5f) * 0.18f
            val len = span / pieces * (0.35f + 0.65f * h) * (0.7f + 0.3f * sin(i * 1.7f + k + drift * tau * 3).let { it * it })
            val cx = x + sway + centre * span
            val a = alpha * (1f - p) * (1f - p * 0.3f) * (0.25f + 0.6f * h)
            drawLine(
                color.copy(alpha = a.coerceIn(0f, 1f)),
                Offset(cx - len / 2, y), Offset(cx + len / 2, y),
                strokeWidth = (1.4f + p * 2.6f) * (0.7f + 0.6f * h), blendMode = BlendMode.Screen,
            )
        }
    }
}
