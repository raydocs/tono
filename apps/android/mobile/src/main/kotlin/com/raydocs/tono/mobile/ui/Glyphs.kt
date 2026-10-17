package com.raydocs.tono.mobile.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

/** Line glyphs drawn in code (1.5 dp strokes, 24 dp grid) so the app carries no icon font. Decorative only. */
enum class Glyph { AI, VIDEO, APPS, GEAR, CHEVRON_RIGHT, CHEVRON_DOWN, CHEVRON_UP, BACK, HOME, CLOUD, ARROW }

@Composable
fun GlyphIcon(glyph: Glyph, tint: Color, modifier: Modifier = Modifier, size: Dp = 22.dp) {
    Canvas(modifier.size(size).clearAndSetSemantics { }) {
        val s = this.size.minDimension / 24f
        val stroke = Stroke(1.6f * s, cap = StrokeCap.Round, join = StrokeJoin.Round)
        fun p(x: Float, y: Float) = Offset(x * s, y * s)
        when (glyph) {
            Glyph.AI -> {
                drawRoundRect(tint, p(5f, 5f), Size(14f * s, 14f * s), CornerRadius(3f * s), style = stroke)
                for (i in 0..2) {
                    val c = 8f + i * 4f
                    drawLine(tint, p(c, 2f), p(c, 5f), stroke.width, StrokeCap.Round)
                    drawLine(tint, p(c, 19f), p(c, 22f), stroke.width, StrokeCap.Round)
                    drawLine(tint, p(2f, c), p(5f, c), stroke.width, StrokeCap.Round)
                    drawLine(tint, p(19f, c), p(22f, c), stroke.width, StrokeCap.Round)
                }
                drawCircle(tint, 2.2f * s, p(12f, 12f))
            }
            Glyph.VIDEO -> {
                drawRoundRect(tint, p(3f, 5f), Size(18f * s, 14f * s), CornerRadius(3.5f * s), style = stroke)
                drawPath(Path().apply { moveTo(10f * s, 9f * s); lineTo(15.5f * s, 12f * s); lineTo(10f * s, 15f * s); close() }, tint)
            }
            Glyph.APPS -> for (x in listOf(4f, 13f)) for (y in listOf(4f, 13f)) {
                drawRoundRect(tint, p(x, y), Size(7f * s, 7f * s), CornerRadius(2f * s), style = stroke)
            }
            Glyph.GEAR -> {
                for (i in 0 until 8) {
                    val a = Math.toRadians(i * 45.0)
                    drawLine(tint, p(12f + 7f * cos(a).toFloat(), 12f + 7f * sin(a).toFloat()), p(12f + 9.5f * cos(a).toFloat(), 12f + 9.5f * sin(a).toFloat()), 2.6f * s, StrokeCap.Round)
                }
                drawCircle(tint, 6.5f * s, p(12f, 12f), style = stroke)
                drawCircle(tint, 2.6f * s, p(12f, 12f), style = stroke)
            }
            Glyph.CHEVRON_RIGHT -> drawPath(Path().apply { moveTo(9f * s, 6f * s); lineTo(15f * s, 12f * s); lineTo(9f * s, 18f * s) }, tint, style = stroke)
            Glyph.CHEVRON_DOWN -> drawPath(Path().apply { moveTo(6f * s, 9f * s); lineTo(12f * s, 15f * s); lineTo(18f * s, 9f * s) }, tint, style = stroke)
            Glyph.CHEVRON_UP -> drawPath(Path().apply { moveTo(6f * s, 15f * s); lineTo(12f * s, 9f * s); lineTo(18f * s, 15f * s) }, tint, style = stroke)
            Glyph.BACK -> drawPath(Path().apply { moveTo(15f * s, 5f * s); lineTo(8f * s, 12f * s); lineTo(15f * s, 19f * s) }, tint, style = stroke)
            Glyph.HOME -> drawPath(Path().apply {
                moveTo(4f * s, 11f * s); lineTo(12f * s, 4f * s); lineTo(20f * s, 11f * s)
                moveTo(6.5f * s, 9.5f * s); lineTo(6.5f * s, 20f * s); lineTo(17.5f * s, 20f * s); lineTo(17.5f * s, 9.5f * s)
            }, tint, style = stroke)
            Glyph.CLOUD -> drawPath(Path().apply {
                moveTo(7f * s, 18f * s)
                cubicTo(3f * s, 18f * s, 3f * s, 12f * s, 7.5f * s, 12f * s)
                cubicTo(8f * s, 7f * s, 15f * s, 6f * s, 16.5f * s, 10.5f * s)
                cubicTo(21f * s, 10.5f * s, 21.5f * s, 18f * s, 17f * s, 18f * s)
                close()
            }, tint, style = stroke)
            Glyph.ARROW -> {
                drawLine(tint, p(4f, 12f), p(19f, 12f), stroke.width, StrokeCap.Round)
                drawPath(Path().apply { moveTo(14f * s, 7f * s); lineTo(19f * s, 12f * s); lineTo(14f * s, 17f * s) }, tint, style = stroke)
            }
        }
    }
}
