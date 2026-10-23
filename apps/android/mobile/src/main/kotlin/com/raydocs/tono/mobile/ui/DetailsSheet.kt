package com.raydocs.tono.mobile.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailsSheet(
    s: EngineSnapshot,
    onRecheck: () -> Unit,
    onOpenLines: () -> Unit,
    onMode: (RoutingMode) -> Unit,
    onExplain: (String) -> Map<String, Any?>?,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        dragHandle = null,
        // Stops below the status bar, also when tall content or landscape lifts it to the top: the
        // clock stays readable and the local-test-server and fixture marks stay in sight.
        modifier = Modifier.statusBarsPadding(),
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Color.Transparent,
        scrimColor = TonoColors.NightDeep.copy(alpha = 0.45f),
    ) {
        SheetGlass {
            SheetGrip()
            DetailsContent(s, onRecheck, onOpenLines, onMode, onExplain)
        }
    }
}

/**
 * Everything explanatory, on demand: routes with live exit checks, why something failed, the mode
 * picker next to the lanes it changes, and the route check for one site.
 */
@Composable
fun DetailsContent(
    s: EngineSnapshot,
    onRecheck: () -> Unit,
    onOpenLines: () -> Unit,
    onMode: (RoutingMode) -> Unit,
    onExplain: (String) -> Map<String, Any?>?,
) {
    Column(
        // The keyboard for the route-check field lifts the sheet's content instead of covering it.
        Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().imePadding().padding(horizontal = 20.dp).padding(bottom = 20.dp),
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

        // The mode is chosen here, under the lanes it changes; the rules behind it are explained once,
        // in Settings → Routing rules.
        Text(stringResource(R.string.details_mode), style = MaterialTheme.typography.labelMedium, color = TonoColors.TextTertiary, modifier = Modifier.padding(top = 8.dp))
        ModePicker(s.mode, onMode)

        Text(stringResource(R.string.settings_check), style = MaterialTheme.typography.labelMedium, color = TonoColors.TextTertiary, modifier = Modifier.padding(top = 8.dp))
        RouteCheck(onExplain)
    }
}

/**
 * The two modes as one segmented control: the chosen segment is filled with the sun, the other is
 * ink on the glass. Each segment is a radio for TalkBack and at least 48 dp tall.
 */
@Composable
private fun ModePicker(mode: RoutingMode, onMode: (RoutingMode) -> Unit) {
    val options = listOf(RoutingMode.THREE_TIER to R.string.mode_three_tier_short, RoutingMode.STABLE to R.string.mode_stable_short)
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        options.forEachIndexed { i, (m, label) ->
            SegmentedButton(
                selected = mode == m,
                onClick = { onMode(m) },
                shape = SegmentedButtonDefaults.itemShape(i, options.size),
                modifier = Modifier.heightIn(min = 48.dp),
                colors = SegmentedButtonDefaults.colors(
                    activeContainerColor = TonoColors.Accent,
                    activeContentColor = Color(0xFF2A1406),
                    activeBorderColor = TonoColors.Accent,
                    inactiveContainerColor = Color.Transparent,
                    inactiveContentColor = TonoColors.TextPrimary,
                    inactiveBorderColor = TonoColors.TextTertiary,
                ),
                label = { Text(stringResource(label), textAlign = TextAlign.Center) },
            )
        }
    }
}

/** One site, where it goes: a filled field, the accent on the action, the verdict as a live line under it. */
@Composable
private fun RouteCheck(onExplain: (String) -> Map<String, Any?>?) {
    var host by rememberSaveable { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val labels = mapOf(
        "HOME" to stringResource(R.string.verdict_HOME), "CLOUD" to stringResource(R.string.verdict_CLOUD),
        "DIRECT" to stringResource(R.string.verdict_DIRECT), "BLOCKED" to stringResource(R.string.verdict_BLOCKED),
        "DNS" to stringResource(R.string.verdict_DNS),
    )
    val template = stringResource(R.string.check_result)
    fun run() {
        val h = host
        scope.launch {
            val r = withContext(Dispatchers.IO) { onExplain(h) }
            result = when {
                r == null -> null
                r["error"] != null -> r["error"] as String
                else -> String.format(template, labels[r["tcp"]] ?: r["tcp"], labels[r["udp"]] ?: r["udp"])
            }
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        // A filled field, not a stroked one: a soft lift of the glass, brighter while it has focus;
        // the accent is kept for the caret and the action.
        TextField(
            value = host,
            onValueChange = { host = it.take(253) },
            placeholder = { Text(stringResource(R.string.check_hint)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Search, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onSearch = { run() }),
            shape = RoundedCornerShape(14.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color.White.copy(alpha = 0.10f),
                unfocusedContainerColor = Color.White.copy(alpha = 0.06f),
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                disabledIndicatorColor = Color.Transparent,
                cursorColor = TonoColors.Accent,
                focusedTextColor = TonoColors.TextPrimary,
                unfocusedTextColor = TonoColors.TextPrimary,
                focusedPlaceholderColor = TonoColors.TextTertiary,
                unfocusedPlaceholderColor = TonoColors.TextTertiary,
            ),
            modifier = Modifier.weight(1f).testTag("routeCheckHost"),
        )
        TextButton(onClick = { run() }, colors = ButtonDefaults.textButtonColors(contentColor = TonoColors.Accent), modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.check_go), style = MaterialTheme.typography.bodyLarge)
        }
    }
    result?.let {
        ArrowText(it, MaterialTheme.typography.bodyLarge, TonoColors.TextPrimary, Modifier.animateContentSize().semantics { liveRegion = LiveRegionMode.Polite })
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
            val density = androidx.compose.ui.platform.LocalDensity.current
            val firstLine = with(density) { MaterialTheme.typography.labelMedium.lineHeight.toDp() }
            // At large font sizes the destination keeps its own line and the dot + status follow on the
            // next, each dot centred on its text's first line, instead of splitting "Home ● … broadband".
            val stacked = density.fontScale > 1.3f
            @Composable fun Probe() {
                if (probeColor != null) {
                    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(Modifier.height(firstLine), contentAlignment = Alignment.Center) { StatusDot(probeColor, size = 6) }
                        if (!status.isNullOrEmpty()) Text(status, style = MaterialTheme.typography.labelMedium, color = TonoColors.TextTertiary)
                    }
                }
            }
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.height(firstLine), contentAlignment = Alignment.Center) {
                    GlyphIcon(Glyph.ARROW, TonoColors.TextTertiary, size = 12.dp)
                }
                Text(dest, style = MaterialTheme.typography.labelMedium, color = TonoColors.TextSecondary, modifier = Modifier.weight(1f, fill = stacked))
                if (!stacked) Probe()
            }
            if (stacked && probeColor != null) Box(Modifier.padding(start = 18.dp)) { Probe() }
        }
    }
}
