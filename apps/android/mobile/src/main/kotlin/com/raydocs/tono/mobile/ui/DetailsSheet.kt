package com.raydocs.tono.mobile.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.ExitProbe
import com.raydocs.tono.mobile.engine.HomeKind
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.ProbeState
import com.raydocs.tono.mobile.engine.TunnelAuthority
import com.raydocs.tono.routing.RoutingMode

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailsSheet(s: EngineSnapshot, onRecheck: () -> Unit, onOpenLines: () -> Unit, onOpenSettings: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(
        dragHandle = null,
        // Stops below the status bar, also when tall content or landscape lifts it to the top: the
        // clock stays readable and the local-test-server and fixture marks stay in sight.
        modifier = Modifier.statusBarsPadding(),
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = androidx.compose.ui.graphics.Color.Transparent,
        scrimColor = TonoColors.NightDeep.copy(alpha = 0.45f),
    ) {
        SheetGlass {
            SheetGrip()
            DetailsContent(s, onRecheck, onOpenLines, onOpenSettings)
        }
    }
}

/** Everything explanatory, on demand: routes with live exit checks, why something failed, mode. */
@Composable
fun DetailsContent(s: EngineSnapshot, onRecheck: () -> Unit, onOpenLines: () -> Unit, onOpenSettings: () -> Unit) {
    Column(
        Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.details), style = MaterialTheme.typography.titleLarge, color = TonoColors.TextPrimary, modifier = Modifier.semantics { heading() })
        s.reasonCode?.takeIf { s.phase in setOf(Phase.FAILED, Phase.DEGRADED, Phase.NEEDS_PERMISSION, Phase.IDLE) }?.let { code ->
            val tone = if (s.phase == Phase.FAILED) TonoColors.Error else TonoColors.Warning
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(tone.copy(alpha = 0.10f)).border(1.dp, tone.copy(alpha = 0.30f), RoundedCornerShape(16.dp)).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(stringResource(R.string.details_why), style = MaterialTheme.typography.labelMedium, color = tone)
                Text(reasonText(code), style = MaterialTheme.typography.bodyMedium, color = TonoColors.TextPrimary)
                when (code) {
                    "HOME_UNREACHABLE" -> QuietButton(stringResource(R.string.action_recheck), onRecheck, color = tone)
                    "CLOUD_UNREACHABLE" -> QuietButton(stringResource(R.string.lines_title), onOpenLines, color = tone)
                }
            }
        }
        if (s.usingCachedCatalog) Text(stringResource(R.string.lines_cached), style = MaterialTheme.typography.bodySmall, color = TonoColors.Warning)

        Text(stringResource(R.string.details_routes), style = MaterialTheme.typography.labelMedium, color = TonoColors.TextTertiary)
        // The lanes are the explanation; a one-line summary above them said the same thing twice.
        Lanes(s)

        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(14.dp)).clickable(role = Role.Button, onClick = onOpenSettings).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.details_mode), style = MaterialTheme.typography.bodyLarge, color = TonoColors.TextPrimary, modifier = Modifier.weight(1f))
            Text(stringResource(if (s.mode == RoutingMode.STABLE) R.string.mode_stable_short else R.string.mode_three_tier_short), style = MaterialTheme.typography.bodyLarge, color = TonoColors.TextSecondary)
            GlyphIcon(Glyph.CHEVRON_RIGHT, TonoColors.TextTertiary, size = 18.dp)
        }
    }
}

@Composable
fun Lanes(s: EngineSnapshot) {
    val homeDest = when (s.homeKind) {
        HomeKind.NONE -> stringResource(R.string.lane_cloud_no_home)
        HomeKind.RESIDENTIAL -> stringResource(R.string.lane_home)
        HomeKind.CATALOG_NODE -> stringResource(R.string.lane_home_node, s.homeLabel ?: "")
    }
    val cloud = stringResource(R.string.lane_cloud)
    // The lanes of the mode the confirmed tunnel runs; with none, of the selected mode, and not live.
    val mode = TunnelAuthority.appliedMode(s) ?: s.mode
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).border(1.dp, TonoColors.Hairline, RoundedCornerShape(18.dp)).padding(vertical = 4.dp)) {
        Lane(Glyph.AI, stringResource(R.string.lane_ai), homeDest, if (s.homeKind == HomeKind.NONE) s.cloudProbe else s.homeProbe, s.tunnelUp)
        LaneDivider()
        Lane(Glyph.VIDEO, stringResource(R.string.lane_video), cloud, s.cloudProbe, s.tunnelUp)
        LaneDivider()
        if (mode == RoutingMode.STABLE) Lane(Glyph.APPS, stringResource(R.string.lane_other), cloud, s.cloudProbe, s.tunnelUp)
        else Lane(Glyph.APPS, stringResource(R.string.lane_other), stringResource(R.string.lane_local), null, s.tunnelUp)
    }
}

@Composable
private fun LaneDivider() = Box(Modifier.fillMaxWidth().padding(start = 50.dp).height(1.dp).background(TonoColors.Hairline))

@Composable
private fun Lane(glyph: Glyph, name: String, dest: String, probe: ExitProbe?, live: Boolean) {
    val probeColor = when {
        !live || probe == null -> null
        probe.state == ProbeState.OK -> TonoColors.Connected
        probe.state == ProbeState.FAILED -> TonoColors.Error
        probe.state == ProbeState.CHECKING -> TonoColors.Warning
        else -> TonoColors.Neutral
    }
    val tint by animateColorAsState(if (live) TonoColors.Accent else TonoColors.TextTertiary, tween(350), label = "lane")
    val status = when {
        probeColor == null -> null
        probe!!.state == ProbeState.OK -> probe.location?.let { countryName(it) } ?: ""
        probe.state == ProbeState.FAILED -> stringResource(R.string.lane_down)
        probe.state == ProbeState.CHECKING -> stringResource(R.string.lane_checking)
        else -> null
    }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 14.dp).semantics(mergeDescendants = true) { },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        GlyphIcon(glyph, tint, size = 22.dp)
        // Two lines, so neither the lane nor its destination is cut off at large font sizes.
        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
            Text(name, style = MaterialTheme.typography.bodyMedium, color = TonoColors.TextPrimary)
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                val firstLine = with(androidx.compose.ui.platform.LocalDensity.current) { MaterialTheme.typography.labelMedium.lineHeight.toDp() }
                androidx.compose.foundation.layout.Box(Modifier.height(firstLine), contentAlignment = Alignment.Center) {
                    GlyphIcon(Glyph.ARROW, TonoColors.TextTertiary, size = 12.dp)
                }
                Text(dest, style = MaterialTheme.typography.labelMedium, color = TonoColors.TextSecondary, modifier = Modifier.weight(1f, fill = false))
                if (probeColor != null) {
                    StatusDot(probeColor, size = 6)
                    if (!status.isNullOrEmpty()) Text(status, style = MaterialTheme.typography.labelMedium, color = TonoColors.TextTertiary)
                }
            }
        }
    }
}
