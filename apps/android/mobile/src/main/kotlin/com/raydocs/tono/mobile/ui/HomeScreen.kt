package com.raydocs.tono.mobile.ui

import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.HomeKind
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.ProbeState
import com.raydocs.tono.mobile.engine.TunnelAuthority
import kotlinx.coroutines.delay
import java.util.Locale

fun skyFor(p: Phase): SkyState = when (p) {
    // The sun climbs with the capsule's sunrise fill: preparing → connecting → connected.
    Phase.PREPARING, Phase.DISCONNECTING -> SkyState.DAWN
    Phase.CONNECTING -> SkyState.RISING
    Phase.CONNECTED -> SkyState.DAY
    Phase.DEGRADED -> SkyState.DUSK_WARNING
    Phase.FAILED -> SkyState.EMBER
    else -> SkyState.NIGHT
}

/** What the one primary control does right now. Exactly one action per phase. */
enum class PrimaryAction { CONNECT, RETRY, ALLOW, CANCEL, DISCONNECT, WAIT }

fun primaryActionFor(p: Phase): PrimaryAction = when (p) {
    Phase.IDLE, Phase.SIGNED_OUT -> PrimaryAction.CONNECT
    Phase.FAILED -> PrimaryAction.RETRY
    Phase.NEEDS_PERMISSION -> PrimaryAction.ALLOW
    Phase.PREPARING, Phase.CONNECTING -> PrimaryAction.CANCEL
    Phase.CONNECTED, Phase.DEGRADED -> PrimaryAction.DISCONNECT
    Phase.DISCONNECTING -> PrimaryAction.WAIT
}

/** The phases in which the engine may hold, or be bringing up or down, a tunnel. */
private val TUNNEL_PHASES = setOf(Phase.PREPARING, Phase.CONNECTING, Phase.CONNECTED, Phase.DEGRADED, Phase.DISCONNECTING)

/**
 * What the primary does while the engine's word is not current: stop, if the last word was a
 * tunnel (the stop request reaches the engine without its binder), otherwise connect.
 */
fun unconfirmedActionFor(last: Phase): PrimaryAction = if (last in TUNNEL_PHASES) PrimaryAction.DISCONNECT else PrimaryAction.CONNECT

/**
 * Home. The sea scene carries the state at a glance; the thumb zone holds only the state word, one
 * status line, the primary capsule and the exit. Everything explanatory lives in Details.
 *
 * When [link] is not [EngineLink.LIVE], [s] is the engine's last word, not its current one: Home says
 * "Status unknown" and drops everything that would claim a tunnel (sun, fill, timer, speed).
 */
@Composable
fun HomeScreen(
    s: EngineSnapshot,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onOpenLines: () -> Unit,
    onOpenDetails: () -> Unit,
    onOpenSettings: () -> Unit,
    link: EngineLink = EngineLink.LIVE,
) {
    val unconfirmed = link != EngineLink.LIVE
    val sky = if (unconfirmed) SkyState.NIGHT else skyFor(s.phase)
    Box(Modifier.fillMaxSize().background(TonoColors.Night)) {
        BackdropHost(scene = { SeaScene(sky, Modifier.fillMaxSize(), horizon = 0.46f) }, modifier = Modifier.fillMaxSize()) {
            // Top bar at the top, dock at the bottom; when large text makes them taller than the
            // screen, Home scrolls instead of squeezing the exit and Details rows to nothing.
            val scroll = rememberScrollState()
            BoxWithConstraints(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxWidth().verticalScroll(scroll).heightIn(min = maxHeight), verticalArrangement = Arrangement.SpaceBetween) {
                    TopBar()
                    // A thumb-width column: on a landscape phone or a tablet the capsules do not stretch across the sea.
                    Column(Modifier.widthIn(max = 560.dp).fillMaxWidth().swipeUpTo(onOpenDetails, enabled = scroll.maxValue == 0).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom)).padding(horizontal = 20.dp).padding(bottom = 8.dp)) {
                        StateHeader(s, link)
                        Spacer(Modifier.height(18.dp))
                        PrimaryCapsule(s, onConnect, onDisconnect, link)
                        Spacer(Modifier.height(10.dp))
                        ExitPill(s, onOpenLines, live = !unconfirmed)
                        Footer(s, onOpenDetails, onOpenSettings, link)
                    }
                }
            }
        }
    }
    PhaseHaptics(s.phase)
}

/** Brand only; Settings lives in the thumb zone next to Details, and screen readers reach it after the state. */
@Composable
private fun TopBar() {
    // safeDrawing, not just the status bar: on a phone turned to landscape the camera cutout sits at a side.
    Row(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top)).heightIn(min = 54.dp).padding(start = 20.dp, end = 12.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.tono_sun_mark), contentDescription = null, modifier = Modifier.size(26.dp))
        Spacer(Modifier.width(8.dp))
        Text("Tono", style = MaterialTheme.typography.titleMedium, color = TonoColors.TextPrimary)
    }
}

@Composable
private fun StateHeader(s: EngineSnapshot, link: EngineLink) {
    val unconfirmed = link != EngineLink.LIVE
    val title = if (unconfirmed) stringResource(R.string.surface_unknown) else phaseTitle(s.phase)
    val line = when (link) {
        EngineLink.LIVE -> statusLine(s)
        EngineLink.WAITING -> stringResource(R.string.engine_waiting)
        EngineLink.LOST -> stringResource(R.string.engine_lost)
    }
    val tone = when {
        link == EngineLink.LOST -> TonoColors.Warning
        unconfirmed -> null
        s.phase == Phase.FAILED -> TonoColors.Error
        s.phase == Phase.DEGRADED || s.phase == Phase.NEEDS_PERMISSION -> TonoColors.Warning
        else -> null
    }
    Column(Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }) {
        AnimatedContent(title, transitionSpec = { crossRise() }, label = "title") { t ->
            Text(t, style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.Light), color = TonoColors.TextPrimary, modifier = Modifier.semantics { heading() })
        }
        Spacer(Modifier.height(4.dp))
        AnimatedContent(line to tone, transitionSpec = { crossRise() }, label = "line") { (text, c) ->
            Row(verticalAlignment = Alignment.Top, modifier = Modifier.heightIn(min = 22.dp)) {
                // The dot sits on the first line, also when large text wraps the reason to two.
                if (c != null) {
                    val line = with(LocalDensity.current) { MaterialTheme.typography.bodyLarge.lineHeight.toDp() }
                    Box(Modifier.height(line), contentAlignment = Alignment.Center) { StatusDot(c, size = 7) }
                    Spacer(Modifier.width(8.dp))
                }
                // Up to two lines: at large font sizes the exit or reason wraps instead of being cut off.
                Text(text ?: "", style = MaterialTheme.typography.bodyLarge, color = if (c != null) TonoColors.TextPrimary else TonoColors.TextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

private fun <T> androidx.compose.animation.AnimatedContentTransitionScope<T>.crossRise() =
    // The incoming words start as the outgoing ones are nearly gone, rising from below while those
    // leave upwards. Frame-by-frame review found two half-transparent labels on top of each other
    // when the fades fully overlapped, and 64–100 ms with no words at all when they ran back to back.
    // No clipping while the size changes: a shorter word cut the old one off ("Not connectec").
    ((fadeIn(tween(200, delayMillis = 70)) + slideInVertically(tween(260)) { it / 3 }) togetherWith
        (fadeOut(tween(120)) + slideOutVertically(tween(160)) { -it / 4 })) using SizeTransform(clip = false)

/** One short line under the state word: the exit when connected, the short reason otherwise. */
@Composable
fun statusLine(s: EngineSnapshot): String? {
    s.reasonCode?.let { if (s.phase in setOf(Phase.FAILED, Phase.DEGRADED, Phase.NEEDS_PERMISSION, Phase.IDLE)) return shortReason(it) }
    return when (s.phase) {
        Phase.IDLE -> stringResource(R.string.sentence_idle)
        Phase.NEEDS_PERMISSION -> stringResource(R.string.sentence_permission_short)
        Phase.PREPARING -> stringResource(R.string.sentence_preparing)
        Phase.CONNECTING -> stringResource(R.string.sentence_connecting)
        Phase.CONNECTED -> {
            // Rechecking (Details, or a new Wi-Fi or mobile network): the last verdict is not repeated as current.
            if (s.cloudProbe.state == ProbeState.CHECKING || s.homeProbe.state == ProbeState.CHECKING) return stringResource(R.string.status_rechecking)
            val cloud = s.cloudProbe.location?.let { countryName(it) }
            val home = s.homeProbe.location.takeIf { s.homeKind != HomeKind.NONE }?.let { countryName(it) }
            when {
                cloud != null && home != null -> stringResource(R.string.status_exit_both, cloud, home)
                cloud != null -> stringResource(R.string.status_exit_cloud, cloud)
                else -> stringResource(R.string.status_protected)
            }
        }
        else -> null
    }
}

@Composable
private fun PrimaryCapsule(s: EngineSnapshot, onConnect: () -> Unit, onDisconnect: () -> Unit, link: EngineLink) {
    val unconfirmed = link != EngineLink.LIVE
    val action = if (unconfirmed) unconfirmedActionFor(s.phase) else primaryActionFor(s.phase)
    // Only the engine's current word may show a tunnel or its progress.
    val phase = if (unconfirmed) null else s.phase
    val tunnelUp = !unconfirmed && s.tunnelUp
    val reduce = LocalReduceMotion.current
    val view = LocalView.current
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.975f else 1f, TonoMotion.press, label = "press")

    val warm = action == PrimaryAction.CONNECT || action == PrimaryAction.RETRY || action == PrimaryAction.ALLOW
    val warmAlpha by animateFloatAsState(if (warm) 1f else 0f, TonoMotion.state, label = "warm")
    // The sunrise fill is the connection's progress: it advances with the engine phase, completes on
    // arrival, then fades so the connected capsule is quiet. It moves on the same phases as the sun.
    val fillTarget = when (phase) {
        Phase.PREPARING -> 0.36f
        Phase.CONNECTING -> 0.78f
        Phase.CONNECTED, Phase.DEGRADED -> 1f
        else -> 0f
    }
    val fill by animateFloatAsState(fillTarget, if (reduce) tween(0) else TonoMotion.surface, label = "fill")
    val fillAlpha by animateFloatAsState(
        if (phase == Phase.PREPARING || phase == Phase.CONNECTING) 1f else 0f,
        if (reduce) tween(0) else tween(if (tunnelUp) 700 else 220, delayMillis = if (tunnelUp) 250 else 0),
        label = "fillAlpha",
    )
    val nudge = remember { Animatable(0f) }
    LaunchedEffect(phase) {
        if (phase == Phase.FAILED && !reduce) {
            nudge.animateTo(0f, keyframes { durationMillis = 380; -7f at 60; 6f at 140; -3f at 230; 0f at 380 })
        }
    }

    val label = when (action) {
        PrimaryAction.CONNECT -> stringResource(R.string.action_connect)
        PrimaryAction.RETRY -> stringResource(R.string.action_retry)
        PrimaryAction.ALLOW -> stringResource(R.string.action_allow_vpn)
        PrimaryAction.CANCEL -> stringResource(R.string.action_cancel)
        PrimaryAction.DISCONNECT -> stringResource(R.string.action_disconnect)
        PrimaryAction.WAIT -> stringResource(R.string.action_disconnecting)
    }
    val clickLabel = if (action == PrimaryAction.CANCEL) stringResource(R.string.a11y_cancel_connect) else label
    val stateText = if (unconfirmed) stringResource(R.string.surface_unknown) else phaseTitle(s.phase)
    val labelColor by animateColorAsState(if (warm) Color(0xFF2A1406) else TonoColors.TextPrimary, tween(220), label = "labelColor")
    val shape = RoundedCornerShape(28.dp)
    // While the tunnel is up the primary keeps a warm rim, so it outranks the exit pill without shouting.
    val rimColor by animateColorAsState(if (tunnelUp) TonoColors.SunMid else Color.White, tween(350), label = "rim")

    Glass(
        shape,
        Modifier
            .fillMaxWidth()
            .heightIn(min = 58.dp)
            .offset(x = nudge.value.dp)
            .scale(scale)
            .testTag("primary"),
        tintAlpha = 0.32f,
        rimColor = rimColor,
    ) {
        // Warm sun capsule (idle/retry/allow) fades over the glass instead of swapping widgets.
        // matchParentSize, not fillMaxSize: Home scrolls at large text, so the height is unbounded here.
        Box(Modifier.matchParentSize().graphicsLayer { alpha = warmAlpha }.background(TonoColors.ActionFill))
        // Sunrise progress: a soft band whose leading edge glows like the sun's rim, rounded to the capsule.
        Box(Modifier.matchParentSize()) {
            Box(
                Modifier.fillMaxHeight().fillMaxWidth(fill.coerceIn(0.001f, 1f)).graphicsLayer { alpha = fillAlpha }
                    .clip(shape)
                    // A thin wash with a narrow bright edge: wide warm stops read as a muddy brown bar on device.
                    .background(
                        Brush.horizontalGradient(
                            0f to Color.Transparent,
                            0.55f to TonoColors.SunMid.copy(alpha = 0.16f),
                            0.9f to TonoColors.SunMid.copy(alpha = 0.42f),
                            1f to TonoColors.SunCore.copy(alpha = 0.85f),
                        ),
                    ),
            )
        }
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 58.dp)
                .focusRing(source, shape)
                .clickable(source, indication = null, enabled = action != PrimaryAction.WAIT, role = Role.Button, onClickLabel = clickLabel) {
                    view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                    when (action) {
                        PrimaryAction.CONNECT, PrimaryAction.RETRY, PrimaryAction.ALLOW -> onConnect()
                        PrimaryAction.CANCEL, PrimaryAction.DISCONNECT -> onDisconnect()
                        PrimaryAction.WAIT -> Unit
                    }
                }
                .semantics { stateDescription = stateText }
                .padding(horizontal = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Label and arrow change together, so "Cancel" never shows the connect arrow mid-transition.
            AnimatedContent(label to warm, transitionSpec = { crossRise() }, label = "capsuleLabel", modifier = Modifier.weight(1f)) { (t, arrow) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(t, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = labelColor, modifier = Modifier.weight(1f))
                    if (arrow) GlyphIcon(Glyph.ARROW, labelColor, size = 20.dp)
                }
            }
            // The timer arrives after the label has become “Disconnect”, never beside “Cancel”.
            // Disconnecting clears connectedSinceMs in the same snapshot that hides the timer; the fading
            // timer keeps the last start time (frame-by-frame capture showed "497860:50:23" otherwise).
            val since = remember { LongArray(1) }
            if (s.connectedSinceMs > 0) since[0] = s.connectedSinceMs
            AnimatedVisibility(tunnelUp && s.connectedSinceMs > 0, enter = fadeIn(tween(220, delayMillis = 240)), exit = fadeOut(tween(120))) {
                ConnectedTimer(since[0])
            }
        }
    }
}

@Composable
private fun ConnectedTimer(since: Long) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(since) { while (true) { now = System.currentTimeMillis(); delay(1000) } }
    val sec = ((now - since) / 1000).coerceAtLeast(0)
    val text = if (sec >= 3600) String.format(Locale.ROOT, "%d:%02d:%02d", sec / 3600, sec / 60 % 60, sec % 60) else String.format(Locale.ROOT, "%02d:%02d", sec / 60, sec % 60)
    val a11y = stringResource(R.string.a11y_connected_for, text)
    // Replaces the digits for screen readers; the device check heard the time twice.
    Text(text, style = MaterialTheme.typography.titleSmall, color = TonoColors.TextSecondary, modifier = Modifier.clearAndSetSemantics { contentDescription = a11y })
}

@Composable
private fun ExitPill(s: EngineSnapshot, onOpenLines: () -> Unit, live: Boolean) {
    val zh = isChinese()
    val node = s.nodes.firstOrNull { it.name == s.selectedNode } ?: s.nodes.firstOrNull()
    // Until "Test" measures it, the connected line's dot follows the cloud exit check: it answered.
    // No number: that check is a whole HTTPS request, not the round trip "Test" reports.
    val answered = live && s.tunnelUp && s.cloudProbe.state == ProbeState.OK && node != null && node.name == TunnelAuthority.appliedNode(s)
    // The line's own name only when another line shares the city; otherwise the city says it all.
    val shared = node != null && s.nodes.count { it.city.equals(node.city, ignoreCase = true) } > 1
    val name = node?.let { Format.city(it.city, zh) + (if (shared && it.label.isNotBlank()) " · ${it.label}" else "") } ?: stringResource(R.string.line_pick)
    val latency = node?.latencyMs?.let { stringResource(R.string.latency_ms, it.toInt()) }
    val pick = stringResource(R.string.lines_title)
    val source = remember { MutableInteractionSource() }
    Glass(RoundedCornerShape(24.dp), Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("exit"), tintAlpha = 0.26f) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).focusRing(source, RoundedCornerShape(24.dp))
                .clickable(source, LocalIndication.current, role = Role.Button, onClickLabel = pick, onClick = onOpenLines).padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StatusDot(if (node?.latencyMs == null && answered) TonoColors.Connected else Format.latencyColor(node?.latencyMs))
            Text(name, style = MaterialTheme.typography.bodyLarge, color = TonoColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (latency != null) Text(latency, style = MaterialTheme.typography.labelLarge, color = TonoColors.TextSecondary)
            GlyphIcon(Glyph.CHEVRON_DOWN, TonoColors.TextTertiary, size = 16.dp)
        }
    }
}

@Composable
private fun Footer(s: EngineSnapshot, onOpenDetails: () -> Unit, onOpenSettings: () -> Unit, link: EngineLink) {
    val tunnelUp = link == EngineLink.LIVE && s.tunnelUp
    val attention = link == EngineLink.LIVE && (s.usingCachedCatalog || s.phase == Phase.DEGRADED ||
        (tunnelUp && (s.homeProbe.state == ProbeState.FAILED || s.cloudProbe.state == ProbeState.FAILED)))
    val settings = stringResource(R.string.settings_title)
    val gearSource = remember { MutableInteractionSource() }
    val detailsSource = remember { MutableInteractionSource() }
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        AnimatedVisibility(tunnelUp, enter = fadeIn(tween(350)), exit = fadeOut(tween(220)), modifier = Modifier.weight(1f)) {
            Text(
                stringResource(R.string.speed_line, Format.rate(s.rxBytesPerSec), Format.rate(s.txBytesPerSec)),
                style = MaterialTheme.typography.labelMedium, color = TonoColors.TextTertiary, maxLines = 2,
            )
        }
        if (!tunnelUp) Spacer(Modifier.weight(1f))
        // One quiet glass segment for both secondary entries: Settings within thumb reach, then Details.
        Glass(RoundedCornerShape(24.dp), tintAlpha = 0.24f) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(48.dp).focusRing(gearSource, CircleShape).clickable(gearSource, LocalIndication.current, role = Role.Button, onClick = onOpenSettings).semantics { contentDescription = settings }.testTag("settings"),
                    contentAlignment = Alignment.Center,
                ) { GlyphIcon(Glyph.GEAR, TonoColors.TextPrimary, size = 20.dp) }
                Box(Modifier.width(1.dp).height(20.dp).background(TonoColors.Hairline))
                Row(
                    Modifier.focusRing(detailsSource, RoundedCornerShape(24.dp)).clickable(detailsSource, LocalIndication.current, role = Role.Button, onClick = onOpenDetails).heightIn(min = 48.dp).padding(start = 14.dp, end = 14.dp).testTag("details"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (attention) { StatusDot(TonoColors.Warning, size = 6); Spacer(Modifier.width(7.dp)) }
                    Text(stringResource(R.string.details), style = MaterialTheme.typography.labelLarge, color = TonoColors.TextPrimary)
                    Spacer(Modifier.width(6.dp))
                    GlyphIcon(Glyph.CHEVRON_UP, TonoColors.TextSecondary, size = 14.dp)
                }
            }
        }
    }
}

/**
 * A deliberate upward flick on the dock opens Details; taps on the controls inside are unaffected.
 * Off while Home scrolls (large text), so the flick never steals the scroll.
 */
private fun Modifier.swipeUpTo(onOpen: () -> Unit, enabled: Boolean): Modifier = if (!enabled) this else pointerInput(onOpen) {
    val threshold = 56.dp.toPx()
    var travelled = 0f
    detectVerticalDragGestures(
        onDragStart = { travelled = 0f },
        onDragEnd = { if (travelled < -threshold) onOpen() },
        onVerticalDrag = { _, dy -> travelled += dy },
    )
}

/** Confirm on arrival, reject on failure — the system's own haptic vocabulary, once per transition. */
@Composable
private fun PhaseHaptics(phase: Phase) {
    val view = LocalView.current
    val last = remember { arrayOf(phase) }
    val current by rememberUpdatedState(phase)
    LaunchedEffect(current) {
        val previous = last[0]
        last[0] = current
        if (previous == current || Build.VERSION.SDK_INT < 30) return@LaunchedEffect
        when (current) {
            Phase.CONNECTED -> if (previous == Phase.CONNECTING || previous == Phase.PREPARING) view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
            Phase.FAILED -> view.performHapticFeedback(HapticFeedbackConstants.REJECT)
            else -> Unit
        }
    }
}

