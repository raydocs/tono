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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * What glass sees through: the scene behind it, in root coordinates. A glass surface redraws this
 * backdrop clipped to its own shape and blurs it, so the material has a real relationship with the
 * sea/sun behind it instead of being a grey fill.
 */
class Backdrop(val origin: Offset, val size: IntSize, val content: @Composable () -> Unit)

val LocalBackdrop = staticCompositionLocalOf<Backdrop?> { null }

/** Hosts [scene] full-bleed and exposes it to every [Glass] drawn above it. */
@Composable
fun BackdropHost(scene: @Composable () -> Unit, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    var origin by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    Box(modifier.onGloballyPositioned { origin = it.positionInRoot(); size = it.size }) {
        scene()
        CompositionLocalProvider(LocalBackdrop provides Backdrop(origin, size, scene)) { content() }
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
    blur: Dp = 26.dp,
    tint: Color = TonoColors.Smoke,
    tintAlpha: Float = 0.46f,
    rim: Float = 1f,
    rimColor: Color = Color.White,
    content: @Composable BoxScope.() -> Unit,
) {
    val backdrop = LocalBackdrop.current
    val canBlur = Build.VERSION.SDK_INT >= 31 && backdrop != null
    var origin by remember { mutableStateOf(Offset.Zero) }
    Box(modifier.onGloballyPositioned { origin = it.positionInRoot() }.clip(shape)) {
        if (canBlur) {
            Box(
                Modifier
                    .matchParentSize()
                    .layout { measurable, constraints ->
                        val p = measurable.measure(Constraints.fixed(backdrop!!.size.width.coerceAtLeast(1), backdrop.size.height.coerceAtLeast(1)))
                        layout(constraints.maxWidth, constraints.maxHeight) {
                            p.place((backdrop.origin.x - origin.x).roundToInt(), (backdrop.origin.y - origin.y).roundToInt())
                        }
                    }
                    .blur(blur, BlurredEdgeTreatment.Rectangle),
            ) { backdrop!!.content() }
        }
        Box(
            Modifier
                .matchParentSize()
                .background(tint.copy(alpha = if (canBlur) tintAlpha else (tintAlpha + 0.38f).coerceAtMost(0.94f)))
                .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.07f * rim), Color.Transparent, Color.Black.copy(alpha = 0.10f))))
                .border(1.dp, Brush.verticalGradient(listOf(rimColor.copy(alpha = 0.40f * rim), rimColor.copy(alpha = 0.08f * rim), rimColor.copy(alpha = 0.16f * rim))), shape),
        )
        content()
    }
}
