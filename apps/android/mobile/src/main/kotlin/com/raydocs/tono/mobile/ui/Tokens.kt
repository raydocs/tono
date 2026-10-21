package com.raydocs.tono.mobile.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Tono design tokens for Android, taken from the desktop design system (docs/ui-design-system.md
 * and the 0.0.75+ sea scene): ink-blue night, warm amber/coral sun, smoked surfaces, and the
 * shared status colours. Status meaning never changes between platforms.
 */
object TonoColors {
    val Night = Color(0xFF0B0D1A)
    val NightDeep = Color(0xFF06070F)
    val Ink = Color(0xFF14162A)
    val Smoke = Color(0xFF17151F)
    val SmokeHigh = Color(0xFF221F2B)
    val Hairline = Color(0x1FFFFFFF)
    val TextPrimary = Color(0xFFF7F3EE)
    val TextSecondary = Color(0xA8F7F3EE)
    /** 55% white: ≥ 4.5:1 on Night for small text (the previous 44% measured ~4.1:1). */
    val TextTertiary = Color(0x8CF7F3EE)

    val SunCore = Color(0xFFFFE2A8)
    val SunMid = Color(0xFFFFB46A)
    val SunEdge = Color(0xFFFF7A59)
    val Ember = Color(0xFFB8442E)
    val Moon = Color(0xFFF4EEDC)

    /** Desktop status tokens: connected ≠ latency-good green on purpose. */
    val Connected = Color(0xFF2ED573)
    val LatencyGood = Color(0xFF30D158)
    val Warning = Color(0xFFFF9F0A)
    val Error = Color(0xFFFF453A)
    val Neutral = Color(0xFF98989D)
    val Accent = Color(0xFFFFB46A)

    val ActionFill = Brush.linearGradient(listOf(Color(0xFFFFD6A3), Color(0xFFFF9E6B)))
}

object TonoMotion {
    /** Desktop control-motion contract: press 100 ms, state 220 ms, surface 350 ms, arrival spring with the only overshoot. */
    val press = tween<Float>(100)
    val state = tween<Float>(220, easing = CubicBezierEasing(0.2f, 0f, 0f, 1f))
    val surface = spring<Float>(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = 400f)
    val arrival = spring<Float>(dampingRatio = 0.85f, stiffness = 120f)
    val ambient = tween<Float>(1800, easing = CubicBezierEasing(0.25f, 0f, 0.25f, 1f))
    /** Sky going down after a disconnect or failure: quick enough to follow the state word. */
    val settle = tween<Float>(650, easing = CubicBezierEasing(0.3f, 0f, 0.2f, 1f))
}

val LocalReduceMotion = compositionLocalOf { false }

/**
 * Settings' editorial type: one weight, no tracking; the hierarchy is size and tone alone. The
 * group label is a clear step under the row title (13 against 20) so the two never read as one
 * grey line at large font scales.
 */
object TonoType {
    val Display = TextStyle(fontSize = 32.sp, lineHeight = 40.sp, fontWeight = FontWeight.Normal)
    val Title = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Normal)
    val Label = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal)
    val Meta = TextStyle(fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Normal)
    val Fine = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal)
    val Action = TextStyle(fontSize = 17.sp, lineHeight = 24.sp, fontWeight = FontWeight.Normal)
}

@Composable
fun TonoTheme(content: @Composable () -> Unit) {
    val base = Typography()
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = TonoColors.Accent,
            onPrimary = Color(0xFF2A1406),
            background = TonoColors.Night,
            onBackground = TonoColors.TextPrimary,
            surface = TonoColors.Smoke,
            onSurface = TonoColors.TextPrimary,
            surfaceVariant = TonoColors.SmokeHigh,
            onSurfaceVariant = TonoColors.TextSecondary,
            outline = TonoColors.Hairline,
            error = TonoColors.Error,
        ),
        typography = base.copy(
            displayMedium = TextStyle(fontSize = 44.sp, lineHeight = 50.sp, fontWeight = FontWeight.Light, letterSpacing = 0.5.sp),
            titleLarge = base.titleLarge.copy(fontWeight = FontWeight.Medium),
            bodyLarge = base.bodyLarge.copy(lineHeight = 24.sp),
        ),
        content = content,
    )
}

/**
 * Android's "Remove animations" (animator duration scale 0) is the system reduce-motion switch.
 * Observed live, so turning it on while Tono is open stops the scene's ambient motion at once.
 */
@Composable
fun rememberSystemReduceMotion(): Boolean {
    val context = LocalContext.current
    val resolver = context.contentResolver
    fun read() = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    var reduce by remember { mutableStateOf(read()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { reduce = read() }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return reduce
}
