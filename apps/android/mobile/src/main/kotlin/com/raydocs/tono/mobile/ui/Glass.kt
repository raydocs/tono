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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.dp

/**
 * What glass sees through: the scene behind it, recorded once per frame by [BackdropHost] together
 * with one blurred copy. Every glass surface draws its slice of that copy, so five surfaces cost one
 * scene draw and one blur instead of five of each.
 */
class Backdrop(val origin: Offset, val blurred: GraphicsLayer)

val LocalBackdrop = staticCompositionLocalOf<Backdrop?> { null }

/** Glass blur radius; one radius for the whole screen, so the blurred copy can be shared. */
val GlassBlur = 26.dp

/** Hosts [scene] full-bleed and exposes it (blurred, API 31+) to every [Glass] drawn above it. */
@Composable
fun BackdropHost(scene: @Composable () -> Unit, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    var origin by remember { mutableStateOf(Offset.Zero) }
    val sharp = rememberGraphicsLayer()
    val blurred = rememberGraphicsLayer()
    val canBlur = Build.VERSION.SDK_INT >= 31
    Box(modifier.onGloballyPositioned { origin = it.positionInRoot() }) {
        Box(
            Modifier.matchParentSize().drawWithContent {
                if (!canBlur) return@drawWithContent drawContent()
                sharp.record { this@drawWithContent.drawContent() }
                drawLayer(sharp)
                // Recorded, not drawn here: glass surfaces draw slices of it later in this frame.
                val r = GlassBlur.toPx()
                blurred.renderEffect = BlurEffect(r, r, TileMode.Clamp)
                blurred.record { drawLayer(sharp) }
            },
        ) { scene() }
        CompositionLocalProvider(LocalBackdrop provides if (canBlur) Backdrop(origin, blurred) else null) { content() }
    }
}

/**
 * Tono glass: blurred backdrop (API 31+, RenderEffect), a smoked tint that keeps text at AA
 * contrast, a top-lit specular rim and a faint inner sheen. Below API 31 there is no blur, so the
 * tint is denser rather than faking frosted glass.
 */
@Composable
fun Glass(
    shape: Shape,
    modifier: Modifier = Modifier,
    tint: Color = TonoColors.Smoke,
    tintAlpha: Float = 0.46f,
    rim: Float = 1f,
    rimColor: Color = Color.White,
    content: @Composable BoxScope.() -> Unit,
) {
    val backdrop = LocalBackdrop.current
    var origin by remember { mutableStateOf(Offset.Zero) }
    Box(
        modifier
            .onGloballyPositioned { origin = it.positionInRoot() }
            .clip(shape)
            .drawBehind {
                if (backdrop != null) translate(backdrop.origin.x - origin.x, backdrop.origin.y - origin.y) { drawLayer(backdrop.blurred) }
            },
    ) {
        Box(
            Modifier
                .matchParentSize()
                .background(tint.copy(alpha = if (backdrop != null) tintAlpha else (tintAlpha + 0.38f).coerceAtMost(0.94f)))
                .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.07f * rim), Color.Transparent, Color.Black.copy(alpha = 0.10f))))
                .border(1.dp, Brush.verticalGradient(listOf(rimColor.copy(alpha = 0.40f * rim), rimColor.copy(alpha = 0.08f * rim), rimColor.copy(alpha = 0.16f * rim))), shape),
        )
        content()
    }
}
