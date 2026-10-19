package com.raydocs.tono.mobile.ui

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RadialGradientShader
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * What glass sees through: the scene behind it, recorded once per frame by [BackdropHost]. Each
 * glass surface blurs only its own slice of that recording, so the scene is composed and drawn once
 * instead of once per surface.
 */
class Backdrop(val origin: Offset, val scene: GraphicsLayer)

val LocalBackdrop = staticCompositionLocalOf<Backdrop?> { null }

/** Hosts [scene] full-bleed and exposes its recording to every [Glass] drawn above it (API 31+). */
@Composable
fun BackdropHost(scene: @Composable () -> Unit, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    var origin by remember { mutableStateOf(Offset.Zero) }
    val recording = rememberGraphicsLayer()
    val canBlur = Build.VERSION.SDK_INT >= 31
    Box(modifier.onGloballyPositioned { origin = it.positionInRoot() }) {
        Box(
            Modifier.matchParentSize().drawWithContent {
                if (!canBlur) return@drawWithContent drawContent()
                recording.record { this@drawWithContent.drawContent() }
                drawLayer(recording)
            },
        ) { scene() }
        CompositionLocalProvider(LocalBackdrop provides if (canBlur) Backdrop(origin, recording) else null) { content() }
    }
}

/**
 * Tono glass: blurred backdrop (API 31+, RenderEffect), a smoked tint that keeps text at AA
 * contrast, a rim lit from above that fades along the sides, a faint inner sheen and a warm caustic
 * along the bottom edge. Below API 31 there is no blur, so the
 * tint is denser rather than faking frosted glass.
 */
@Composable
fun Glass(
    shape: Shape,
    modifier: Modifier = Modifier,
    blur: Dp = 26.dp,
    tint: Color = TonoColors.Smoke,
    tintAlpha: Float = 0.46f,
    rim: Float = 1f,
    rimColor: Color = Color.White,
    content: @Composable BoxScope.() -> Unit,
) {
    val backdrop = LocalBackdrop.current
    var origin by remember { mutableStateOf(Offset.Zero) }
    Box(modifier.onGloballyPositioned { origin = it.positionInRoot() }.clip(shape)) {
        if (backdrop != null) {
            // The platform blur (RenderEffect) over this surface's slice of the shared scene recording.
            Box(
                Modifier
                    .matchParentSize()
                    .blur(blur, BlurredEdgeTreatment.Rectangle)
                    .drawBehind { translate(backdrop.origin.x - origin.x, backdrop.origin.y - origin.y) { drawLayer(backdrop.scene) } },
            )
        }
        Box(
            Modifier
                .matchParentSize()
                .background(tint.copy(alpha = if (backdrop != null) tintAlpha else (tintAlpha + 0.38f).coerceAtMost(0.94f)))
                // Top sheen and a soft lower shade give the surface a lit volume over the blurred sea;
                // with only the tint, reviewers saw dark rimmed pills rather than glass.
                .background(Brush.verticalGradient(0f to Color.White.copy(alpha = 0.13f * rim), 0.45f to Color.White.copy(alpha = 0.02f * rim), 1f to Color.Black.copy(alpha = 0.12f)))
                // Light enters through the bottom edge, warmed by the sun behind the glass (a refracted
                // caustic rather than a second fixed rim).
                .background(Brush.verticalGradient(0.78f to Color.Transparent, 1f to TonoColors.SunMid.copy(alpha = 0.10f * rim)))
                .border(1.dp, rimBrush(rimColor, rim), shape),
        )
        content()
    }
}

/**
 * The rim catches light where the glass faces up and towards the middle and fades along the sides,
 * so a row of small pills does not repeat one uniform outline.
 */
private fun rimBrush(color: Color, rim: Float) = object : ShaderBrush() {
    override fun createShader(size: Size): Shader = RadialGradientShader(
        center = Offset(size.width / 2, 0f),
        radius = maxOf(size.width * 0.72f, 1f),
        colors = listOf(color.copy(alpha = 0.46f * rim), color.copy(alpha = 0.16f * rim), color.copy(alpha = 0.07f * rim)),
        colorStops = listOf(0f, 0.6f, 1f),
    )
}
