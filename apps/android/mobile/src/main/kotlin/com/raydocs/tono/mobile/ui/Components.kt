package com.raydocs.tono.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Keyboard, D-pad and switch-access users see which control has focus: a 2 dp sun-coloured ring on
 * the control's own shape. Touch does not move focus to these controls, so touch users never see it.
 */
fun Modifier.focusRing(source: InteractionSource, shape: Shape): Modifier = composed {
    val focused by source.collectIsFocusedAsState()
    if (focused) Modifier.border(2.dp, TonoColors.SunCore, shape) else Modifier
}

/** Primary action: the warm sun gradient, dark ink label. Matches the desktop primary capsule. */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, TonoMotion.press, label = "press")
    Box(
        modifier
            .heightIn(min = 52.dp)
            .fillMaxWidth()
            .scale(scale)
            .clip(RoundedCornerShape(26.dp))
            .then(if (enabled) Modifier.background(TonoColors.ActionFill) else Modifier.background(TonoColors.SmokeHigh))
            .focusRing(source, RoundedCornerShape(26.dp))
            .clickable(source, indication = null, enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (enabled) Color(0xFF2A1406) else TonoColors.TextTertiary, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 20.dp))
    }
}

@Composable
fun QuietButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = TonoColors.TextPrimary) {
    val source = remember { MutableInteractionSource() }
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(24.dp))
            .border(1.dp, TonoColors.Hairline, RoundedCornerShape(24.dp))
            .focusRing(source, RoundedCornerShape(24.dp))
            .clickable(source, LocalIndication.current, role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = color, style = MaterialTheme.typography.labelLarge) }
}

@Composable
fun StatusDot(color: Color, modifier: Modifier = Modifier, size: Int = 8) {
    Box(modifier.size(size.dp).clip(CircleShape).background(color))
}

/**
 * A group heading: sentence case, small and in the quietest tone; the rows under it carry the size.
 * Rows carry 10 dp above and below, so 30 dp here makes the group gap 40 and the label-to-row gap 10.
 */
@Composable
fun SectionLabel(text: String) {
    Text(
        text, style = TonoType.Label, color = TonoColors.TextTertiary,
        modifier = Modifier.padding(top = 30.dp).semantics { heading() },
    )
}

/**
 * The sheet's grip, drawn only. Material wraps its own drag handle in a keyboard focus stop whose
 * "Drag handle" tooltip covered the sheet's title; the whole sheet still drags, and Back, Esc or
 * the scrim close it.
 */
@Composable
fun SheetGrip() {
    Box(Modifier.fillMaxWidth().padding(vertical = 22.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(32.dp, 4.dp).background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f), CircleShape))
    }
}

/**
 * A small mark centred in the status-bar band, between the clock and the system icons, so it never
 * covers the app's own content. Fixed size, not font-scaled: it has to fit the band at 200 % text.
 */
@Composable
fun StatusBandMark(text: String, modifier: Modifier = Modifier) {
    val size = with(androidx.compose.ui.platform.LocalDensity.current) { 10.dp.toSp() }
    Box(
        modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = Color(0xFF2A1406),
            fontSize = size,
            lineHeight = size,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            modifier = Modifier.background(Color(0xFFFFB4A0), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}
