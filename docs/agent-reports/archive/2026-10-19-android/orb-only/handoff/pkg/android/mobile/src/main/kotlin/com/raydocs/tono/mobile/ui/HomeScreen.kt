package com.raydocs.tono.mobile.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.ExitProbe
import com.raydocs.tono.mobile.engine.HomeKind
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.ProbeState
import com.raydocs.tono.routing.RoutingMode
import kotlinx.coroutines.delay

fun skyFor(p: Phase): SkyState = when (p) {
    Phase.PREPARING, Phase.CONNECTING -> SkyState.DAWN
    Phase.CONNECTED -> SkyState.DAY
    Phase.DEGRADED -> SkyState.DUSK_WARNING
    Phase.FAILED -> SkyState.EMBER
    Phase.DISCONNECTING -> SkyState.DAWN
    else -> SkyState.NIGHT
}

private val ON_PHASES = setOf(Phase.PREPARING, Phase.CONNECTING, Phase.CONNECTED, Phase.DEGRADED)
private val BUSY_PHASES = setOf(Phase.PREPARING, Phase.CONNECTING, Phase.DISCONNECTING)

/**
 * Home: the sea scene carries the state at a glance (night → dawn → day, dusk when a route is
 * down, ember on failure); everything the thumb needs lives in the smoked sheet at the bottom.
 */
@Composable
fun HomeScreen(
    s: EngineSnapshot,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onRecheck: () -> Unit,
    onOpenLines: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(TonoColors.Night)) {
        SeaScene(skyFor(s.phase), Modifier.fillMaxSize(), horizon = 0.40f)
        Column(Modifier.fillMaxSize()) {
            TopBar(onOpenSettings)
            Hero(s, Modifier.padding(horizontal = 28.dp, vertical = 8.dp))
            Spacer(Modifier.weight(1f))
            ControlSheet(s, onConnect, onDisconnect, onRecheck, onOpenLines)
        }
    }
}

@Composable
private fun TopBar(onOpenSettings: () -> Unit) {
    val settings = stringResource(R.string.settings_title)
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(start = 22.dp, end = 10.dp, top = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(painterResource(R.drawable.tono_mark), contentDescription = null, modifier = Modifier.size(28.dp))
        Spacer(Modifier.width(10.dp))
        Text("Tono", style = MaterialTheme.typography.titleMedium, color = TonoColors.TextPrimary)
        Spacer(Modifier.weight(1f))
        Box(
            Modifier.size(48.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onOpenSettings).semantics { contentDescription = settings },
            contentAlignment = Alignment.Center,
        ) { GlyphIcon(Glyph.GEAR, TonoColors.TextSecondary) }
    }
}

@Composable
private fun Hero(s: EngineSnapshot, modifier: Modifier) {
    val title = phaseTitle(s.phase)
    val sentence = phaseSentence(s)
    Column(modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }) {
        AnimatedContent(title, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(220)) }, label = "title") { t ->
            Text(t, style = MaterialTheme.typography.displayMedium, color = TonoColors.TextPrimary, modifier = Modifier.semantics { heading() })
        }
        if (sentence != null) {
            Spacer(Modifier.height(6.dp))
            AnimatedContent(sentence, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(220)) }, label = "sentence") { t ->
                Text(t, style = MaterialTheme.typography.bodyLarge, color = TonoColors.TextSecondary)
            }
        }
        if (s.tunnelUp && s.connectedSinceMs > 0) {
            Spacer(Modifier.height(4.dp))
            Text(durationText(s.connectedSinceMs), style = MaterialTheme.typography.bodyMedium, color = TonoColors.TextTertiary)
        }
    }
}

@Composable
private fun durationText(since: Long): String {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(since) { while (true) { now = System.currentTimeMillis(); delay(30_000) } }
    val minutes = ((now - since) / 60_000).coerceAtLeast(0)
    return when {
        minutes < 1 -> stringResource(R.string.duration_just)
        minutes < 60 -> stringResource(R.string.duration_minutes, minutes.toInt())
        else -> stringResource(R.string.duration_hours, (minutes / 60).toInt(), (minutes % 60).toInt())
    }
}

@Composable
private fun ControlSheet(
    s: EngineSnapshot,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onRecheck: () -> Unit,
    onOpenLines: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 30.dp, topEnd = 30.dp))
            .background(Brush.verticalGradient(listOf(TonoColors.Smoke.copy(alpha = 0.90f), TonoColors.NightDeep.copy(alpha = 0.97f))))
            .border(1.dp, TonoColors.Hairline, RoundedCornerShape(topStart = 30.dp, topEnd = 30.dp))
            .navigationBarsPadding()
            .padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        ReasonBanner(s, onConnect, onRecheck, onOpenLines)
        val on = s.phase in ON_PHASES
        val busy = s.phase in BUSY_PHASES
        SunSwitch(
            checked = on,
            busy = busy,
            label = stringResource(if (busy) R.string.switch_hint_busy else if (on) R.string.switch_hint_on else R.string.switch_hint_off),
            a11yLabel = stringResource(R.string.switch_a11y),
            stateLabel = phaseTitle(s.phase),
            onToggle = { want -> if (want) onConnect() else onDisconnect() },
            modifier = Modifier.fillMaxWidth(),
        )
        LinePill(s, onOpenLines)
        Lanes(s)
        AnimatedVisibility(s.tunnelUp, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Text(
                stringResource(R.string.speed_line, Format.rate(s.rxBytesPerSec), Format.rate(s.txBytesPerSec)),
                style = MaterialTheme.typography.labelMedium,
                color = TonoColors.TextTertiary,
                modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
            )
        }
    }
}

@Composable
private fun ReasonBanner(s: EngineSnapshot, onConnect: () -> Unit, onRecheck: () -> Unit, onOpenLines: () -> Unit) {
    val code = s.reasonCode
    val show = code != null && s.phase in setOf(Phase.FAILED, Phase.DEGRADED, Phase.NEEDS_PERMISSION, Phase.IDLE)
    AnimatedVisibility(show, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        if (code == null) return@AnimatedVisibility
        val (action, onAction) = when {
            s.phase == Phase.NEEDS_PERMISSION -> stringResource(R.string.action_allow) to onConnect
            code == "CLOUD_UNREACHABLE" -> stringResource(R.string.action_other_line) to onOpenLines
            code == "HOME_UNREACHABLE" -> stringResource(R.string.action_recheck) to onRecheck
            s.phase == Phase.FAILED -> stringResource(R.string.action_retry) to onConnect
            else -> null to {}
        }
        val tone = if (s.phase == Phase.FAILED) TonoColors.Error else TonoColors.Warning
        Banner(reasonText(code), tone, action, onAction)
    }
}

@Composable
private fun LinePill(s: EngineSnapshot, onOpenLines: () -> Unit) {
    val zh = isChinese()
    val node = s.nodes.firstOrNull { it.name == s.selectedNode } ?: s.nodes.firstOrNull()
    val name = node?.let { Format.city(it.city, zh) + (if (it.label.isNotBlank()) " · ${it.label}" else "") } ?: stringResource(R.string.line_pick)
    val latency = node?.latencyMs?.let { stringResource(R.string.latency_ms, it.toInt()) } ?: stringResource(R.string.line_untested)
    val pick = stringResource(R.string.lines_title)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(TonoColors.SmokeHigh.copy(alpha = 0.8f))
            .clickable(role = Role.Button, onClickLabel = pick, onClick = onOpenLines)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StatusDot(Format.latencyColor(node?.latencyMs))
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.titleMedium, color = TonoColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (s.usingCachedCatalog) Text(stringResource(R.string.lines_cached), style = MaterialTheme.typography.labelSmall, color = TonoColors.Warning, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(latency, style = MaterialTheme.typography.labelLarge, color = TonoColors.TextSecondary)
        GlyphIcon(Glyph.CHEVRON_RIGHT, TonoColors.TextTertiary, size = 18.dp)
    }
}

@Composable
private fun Lanes(s: EngineSnapshot) {
    val homeDest = when (s.homeKind) {
        HomeKind.NONE -> stringResource(R.string.lane_cloud_no_home)
        HomeKind.RESIDENTIAL -> stringResource(R.string.lane_home)
        HomeKind.CATALOG_NODE -> stringResource(R.string.lane_home_node, s.homeLabel ?: "")
    }
    val cloud = stringResource(R.string.lane_cloud)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).border(1.dp, TonoColors.Hairline, RoundedCornerShape(18.dp)).padding(vertical = 4.dp),
    ) {
        Lane(Glyph.AI, stringResource(R.string.lane_ai), homeDest, if (s.homeKind == HomeKind.NONE) s.cloudProbe else s.homeProbe, s.tunnelUp)
        LaneDivider()
        Lane(Glyph.VIDEO, stringResource(R.string.lane_video), cloud, s.cloudProbe, s.tunnelUp)
        LaneDivider()
        if (s.mode == RoutingMode.STABLE) Lane(Glyph.APPS, stringResource(R.string.lane_other), cloud, s.cloudProbe, s.tunnelUp)
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
        probe!!.state == ProbeState.OK -> probe.location ?: ""
        probe.state == ProbeState.FAILED -> stringResource(R.string.lane_down)
        probe.state == ProbeState.CHECKING -> stringResource(R.string.lane_checking)
        else -> null
    }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 14.dp).semantics(mergeDescendants = true) { },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        GlyphIcon(glyph, tint, size = 22.dp)
        Text(name, style = MaterialTheme.typography.bodyMedium, color = TonoColors.TextPrimary, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        GlyphIcon(Glyph.ARROW, TonoColors.TextTertiary, size = 14.dp)
        Text(dest, style = MaterialTheme.typography.bodyMedium, color = TonoColors.TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (probeColor != null) {
            StatusDot(probeColor, size = 7)
            if (!status.isNullOrEmpty()) Text(status, style = MaterialTheme.typography.labelSmall, color = TonoColors.TextTertiary)
        }
    }
}

