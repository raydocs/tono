package com.raydocs.tono.mobile.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The one primary control: a recessed track whose thumb is the sun. Tap anywhere to toggle, or drag
 * the sun across (a detent tick at the threshold, a toggle haptic on commit). The track glows behind
 * the sun when on. It is a plain Switch to accessibility services.
 */
@Composable
fun SunSwitch(
    checked: Boolean,
    busy: Boolean,
    label: String,
    a11yLabel: String,
    stateLabel: String,
    onToggle: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val reduce = LocalReduceMotion.current
    val scope = rememberCoroutineScope()
    val position = remember { Animatable(if (checked) 1f else 0f) }
    var dragging by remember { mutableStateOf(false) }
    val latestChecked by rememberUpdatedState(checked)
    LaunchedEffect(checked) {
        if (!dragging) {
            if (reduce) position.snapTo(if (checked) 1f else 0f)
            else position.animateTo(if (checked) 1f else 0f, if (checked) TonoMotion.arrival else TonoMotion.surface)
        }
    }
    val pulse by rememberInfiniteTransition(label = "busy").animateFloat(0.55f, 1f, infiniteRepeatable(tween(1200), RepeatMode.Reverse), label = "pulse")
    val glow = if (busy && !reduce) pulse else 1f

    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(72.dp)
            .semantics {
                role = Role.Switch
                contentDescription = a11yLabel
                stateDescription = stateLabel
                toggleableState = ToggleableState(checked)
                onClick { onToggle(!checked); true }
            },
    ) {
        val density = LocalDensity.current
        val thumb = 60.dp
        val inset = 6.dp
        val travelPx = with(density) { (maxWidth - thumb - inset * 2).toPx() }
        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(checked) {
                    detectTapGestures {
                        haptics.performHapticFeedback(if (checked) HapticFeedbackType.ToggleOff else HapticFeedbackType.ToggleOn)
                        onToggle(!checked)
                    }
                }
                .pointerInput(checked, travelPx) {
                    var crossed = checked
                    detectHorizontalDragGestures(
                        onDragStart = { dragging = true; crossed = checked },
                        onDragEnd = {
                            dragging = false
                            val on = position.value > 0.55f
                            haptics.performHapticFeedback(if (on) HapticFeedbackType.ToggleOn else HapticFeedbackType.ToggleOff)
                            scope.launch {
                                position.animateTo(if (on) 1f else 0f, TonoMotion.surface)
                                // The engine owns the state: if it did not follow (e.g. consent declined), settle back.
                                delay(1500)
                                if (!dragging) position.animateTo(if (latestChecked) 1f else 0f, TonoMotion.surface)
                            }
                            if (on != checked) onToggle(on)
                        },
                        onDragCancel = {
                            dragging = false
                            scope.launch { position.animateTo(if (checked) 1f else 0f, TonoMotion.surface) }
                        },
                    ) { change, delta ->
                        change.consume()
                        val next = (position.value + delta / travelPx).coerceIn(0f, 1f)
                        val nowOn = next > 0.55f
                        if (nowOn != crossed) {
                            crossed = nowOn
                            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                        }
                        scope.launch { position.snapTo(next) }
                    }
                },
        ) {
            val p = position.value
            val r = size.height / 2
            // Recessed track.
            drawRoundRect(Brush.verticalGradient(listOf(Color(0xFF07060B), Color(0xFF1A1722))), cornerRadius = CornerRadius(r))
            drawRoundRect(Color(0x14FFFFFF), cornerRadius = CornerRadius(r), style = Stroke(1.dp.toPx()))
            drawRoundRect(
                Brush.verticalGradient(listOf(Color(0x66000000), Color.Transparent), endY = size.height * 0.35f),
                cornerRadius = CornerRadius(r),
            )
            val thumbR = thumb.toPx() / 2
            val cx = inset.toPx() + thumbR + p * travelPx
            val cy = size.height / 2
            // Warm trail behind the sun.
            if (p > 0.01f) {
                drawRoundRect(
                    Brush.horizontalGradient(listOf(TonoColors.SunEdge.copy(alpha = 0.0f), TonoColors.SunMid.copy(alpha = 0.32f * p * glow)), startX = 0f, endX = cx),
                    size = Size(cx + thumbR, size.height), cornerRadius = CornerRadius(r),
                )
            }
            // Engraved detent ticks.
            val ticks = 28
            for (i in 0..ticks) {
                val x = inset.toPx() + thumbR + travelPx * i / ticks
                val major = i == 0 || i == ticks || i == (ticks * 0.55f).toInt()
                drawLine(
                    Color.White.copy(alpha = if (major) 0.16f else 0.06f),
                    Offset(x, cy + (if (major) 14f else 18f).dp.toPx() * 0.5f + r * 0.35f),
                    Offset(x, cy + r * 0.62f),
                    strokeWidth = 1.dp.toPx(),
                )
            }
            // Thumb: cool moon disc when off, sun when on.
            val warm = p
            drawCircle(
                Brush.radialGradient(listOf(TonoColors.SunMid.copy(alpha = 0.55f * warm * glow), Color.Transparent), Offset(cx, cy), thumbR * 2.1f),
                radius = thumbR * 2.1f, center = Offset(cx, cy),
            )
            drawCircle(Color(0x99000000), radius = thumbR + 1.5f, center = Offset(cx, cy + 3.dp.toPx()))
            drawCircle(
                Brush.verticalGradient(
                    listOf(lerp(Color(0xFFE9E4D8), TonoColors.SunCore, warm), lerp(Color(0xFF8E897F), TonoColors.SunEdge, warm)),
                    startY = cy - thumbR, endY = cy + thumbR,
                ),
                radius = thumbR, center = Offset(cx, cy),
            )
            drawCircle(Color.White.copy(alpha = 0.35f), radius = thumbR - 1.dp.toPx(), center = Offset(cx, cy), style = Stroke(1.dp.toPx()))
            drawCircle(
                Brush.radialGradient(listOf(Color.White.copy(alpha = 0.5f), Color.Transparent), Offset(cx - thumbR * 0.35f, cy - thumbR * 0.45f), thumbR * 0.7f),
                radius = thumbR * 0.7f, center = Offset(cx - thumbR * 0.35f, cy - thumbR * 0.45f),
            )
        }
        val labelOnLeft = position.value > 0.5f
        Text(
            label,
            color = TonoColors.TextSecondary,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .align(Alignment.Center)
                .padding(start = if (labelOnLeft) 0.dp else thumb + inset * 2, end = if (labelOnLeft) thumb + inset * 2 else 0.dp)
                .fillMaxWidth(),
        )
    }
}
