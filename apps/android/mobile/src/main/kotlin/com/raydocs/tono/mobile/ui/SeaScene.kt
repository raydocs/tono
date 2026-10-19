package com.raydocs.tono.mobile.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlin.math.PI
import kotlin.math.sin
import kotlin.random.Random

/** Which sky the scene paints. Mirrors the desktop SeaScene destinations. */
enum class SkyState { NIGHT, DAWN, RISING, DAY, DUSK_WARNING, EMBER }

/**
 * Portrait adaptation of the desktop sea scene: sky, sun or moon, horizon and a glittering
 * reflection. Purely decorative (no semantics); state text lives in the UI above it.
 * Only alpha/position animate; reduced motion renders the destination statically.
 */
@Composable
fun SeaScene(sky: SkyState, modifier: Modifier = Modifier, horizon: Float = 0.47f) {
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
    val warn by animateFloatAsState(if (sky == SkyState.DUSK_WARNING || sky == SkyState.EMBER) 1f else 0f, if (reduce) tween(0) else TonoMotion.ambient, label = "warn")
    // Reduced motion runs no infinite animation at all (also saves battery); values stay at rest.
    val still = remember { mutableFloatStateOf(0f) }
    val (driftState, breathState) = if (reduce) {
        still to still
    } else {
        val transition = rememberInfiniteTransition(label = "sea")
        transition.animateFloat(0f, 1f, infiniteRepeatable(tween(26_000, easing = LinearEasing)), label = "drift") to
            transition.animateFloat(0f, 1f, infiniteRepeatable(tween(2_400), RepeatMode.Reverse), label = "breath")
    }
    val drift by driftState
    val breath by breathState
    val stars = remember { List(70) { Triple(Random(it * 31).nextFloat(), Random(it * 17 + 3).nextFloat() * 0.9f, Random(it * 7 + 1).nextFloat()) } }
    val connecting = sky == SkyState.DAWN || sky == SkyState.RISING

    Canvas(modifier.clearAndSetSemantics { }) {
        val horizonY = size.height * horizon
        val t = sunRise
        // Sky: night ink → plum/amber dusk → warm day glow.
        val top = lerp(lerp(Color(0xFF070816), Color(0xFF1B1030), (t * 1.4f).coerceAtMost(1f)), Color(0xFF2A1426), warn * 0.4f)
        val mid = lerp(lerp(Color(0xFF111433), Color(0xFF5A2238), t), Color(0xFF4A1A1C), warn * 0.5f)
        val low = lerp(lerp(Color(0xFF1C2350), Color(0xFFE0784E), t), Color(0xFFB0452C), warn * 0.6f)
        drawRect(Brush.verticalGradient(listOf(top, mid, low), endY = horizonY), size = Size(size.width, horizonY))

        // Stars fade with daylight.
        val starAlpha = (1f - t * 1.6f).coerceIn(0f, 1f)
        if (starAlpha > 0f) stars.forEachIndexed { i, (x, y, tw) ->
            val twinkle = if (reduce || i % 3 != 0) 1f else 0.55f + 0.45f * sin((drift * 12 + tw) * 2 * PI).toFloat()
            drawCircle(Color.White.copy(alpha = starAlpha * (0.25f + 0.6f * tw) * twinkle), radius = 0.6f + tw * 1.3f, center = Offset(x * size.width, y * horizonY * 0.85f))
        }

        // Sun travels from below the horizon (night) to just clear of it (connected), staying under
        // the headline so text never sits on the sun.
        val sunR = size.minDimension * 0.13f
        // Wider than tall (a landscape phone): the sun moves off the controls column, towards the moon.
        val sunX = size.width * if (size.width > size.height) 0.68f else 0.5f
        val sunY = horizonY + sunR * 1.05f - t * sunR * 2.25f
        val glowPulse = if (connecting && !reduce) 0.75f + 0.25f * breath else 1f
        clipRect(bottom = horizonY) {
            if (t > 0.02f) {
                drawCircle(
                    Brush.radialGradient(listOf(TonoColors.SunMid.copy(alpha = 0.55f * glowPulse * t.coerceAtMost(1f)), Color.Transparent), Offset(sunX, sunY), sunR * 3.2f),
                    radius = sunR * 3.2f, center = Offset(sunX, sunY),
                )
                val core = lerp(TonoColors.SunCore, Color(0xFFFFC08A), warn)
                val edge = lerp(TonoColors.SunEdge, TonoColors.Ember, warn)
                drawCircle(Brush.verticalGradient(listOf(core, TonoColors.SunMid, edge), startY = sunY - sunR, endY = sunY + sunR), radius = sunR, center = Offset(sunX, sunY))
            }
        }
        // Moon while disconnected (desktop night/login scenes use a crescent).
        val moonAlpha = (1f - t * 6f).coerceIn(0f, 1f)
        if (moonAlpha > 0f) crescent(Offset(size.width * 0.80f, horizonY * 0.66f), size.minDimension * 0.055f, moonAlpha)

        // Sea.
        drawRect(
            Brush.verticalGradient(listOf(lerp(Color(0xFF1A1E3E), Color(0xFF3A1E2E), t), Color(0xFF0B0C1A), TonoColors.NightDeep), startY = horizonY, endY = size.height),
            topLeft = Offset(0f, horizonY), size = Size(size.width, size.height - horizonY),
        )
        drawLine(lerp(Color(0x33B8C4FF), Color(0x66FFD2A0), t), Offset(0f, horizonY), Offset(size.width, horizonY), strokeWidth = 1.2f)

        // Reflection column: horizontal glints whose drift is the only ambient motion.
        val reflectAlpha = if (t > 0.02f) t.coerceAtMost(1f) else moonAlpha * 0.35f
        val reflectX = if (t > 0.02f) sunX else size.width * 0.80f
        val reflectColor = if (t > 0.02f) lerp(TonoColors.SunMid, TonoColors.Ember, warn) else TonoColors.Moon
        reflection(reflectX, horizonY, reflectAlpha, reflectColor, if (reduce) 0f else drift, sunR)
    }
}

private fun DrawScope.crescent(center: Offset, r: Float, alpha: Float) {
    drawCircle(Brush.radialGradient(listOf(TonoColors.Moon.copy(alpha = 0.18f * alpha), Color.Transparent), center, r * 4f), r * 4f, center)
    val path = Path().apply {
        addOval(androidx.compose.ui.geometry.Rect(center, r))
    }
    val cut = Path().apply { addOval(androidx.compose.ui.geometry.Rect(Offset(center.x - r * 0.45f, center.y - r * 0.3f), r * 0.95f)) }
    drawPath(Path.combine(androidx.compose.ui.graphics.PathOperation.Difference, path, cut), TonoColors.Moon.copy(alpha = alpha))
}

private fun DrawScope.reflection(x: Float, horizonY: Float, alpha: Float, color: Color, drift: Float, sunR: Float) {
    if (alpha <= 0f) return
    val depth = size.height - horizonY
    val rows = 46
    for (i in 0 until rows) {
        val p = i / rows.toFloat()
        val y = horizonY + 4f + p * p * depth * 0.95f
        val width = sunR * (0.5f + p * 2.6f) * (0.6f + 0.4f * sin((i * 1.7f + drift * 2 * PI.toFloat() * 3)).let { it * it })
        val offset = sin((i * 2.3f + drift * 2 * PI.toFloat() * 5)) * sunR * 0.25f * p
        val a = alpha * (1f - p) * (0.35f + 0.5f * ((i * 37) % 11) / 11f)
        drawLine(
            color.copy(alpha = a.coerceIn(0f, 1f)),
            Offset(x - width / 2 + offset, y), Offset(x + width / 2 + offset, y),
            strokeWidth = 1.5f + p * 2.5f, blendMode = BlendMode.Screen,
        )
    }
}
