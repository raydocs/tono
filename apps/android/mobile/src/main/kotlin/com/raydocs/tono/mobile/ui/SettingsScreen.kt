package com.raydocs.tono.mobile.ui

import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.raydocs.tono.mobile.BuildConfig
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.routing.DesktopRoutingContract
import com.raydocs.tono.routing.RoutingMode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(
    s: EngineSnapshot,
    onBack: () -> Unit,
    onMode: (RoutingMode) -> Unit,
    onOpenApps: () -> Unit,
    onExplain: (String) -> Map<String, Any?>?,
    onSignOut: () -> Unit,
    onOpenLicenses: () -> Unit = {},
) {
    val context = LocalContext.current
    val view = LocalView.current
    val scroll = rememberScrollState()
    LaunchedEffect(scroll, view) {
        snapshotFlow { scroll.value to scroll.isScrollInProgress }.drop(1).filter { !it.second }.collect {
            // Android can retain pre-scroll bounds for Compose's virtual card children.
            view.parent?.notifySubtreeAccessibilityStateChanged(view, view, AccessibilityEvent.CONTENT_CHANGE_TYPE_SUBTREE)
        }
    }
    Column(Modifier.fillMaxSize().background(TonoColors.Night)) {
        // Only the back circle stays fixed. The title opens the page on the content's own left edge
        // and scrolls away with it: one axis for every word on the screen, as in a book.
        Box(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 6.dp, vertical = 4.dp)) { BackCircle(onBack) }
        // Editorial layout: no cards or dividers; groups are set apart by space, controls on one right edge.
        Column(
            Modifier.fillMaxSize().verticalScroll(scroll).navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 32.dp),
        ) {
            Text(
                stringResource(R.string.settings_title), style = TonoType.Display, color = TonoColors.TextPrimary,
                modifier = Modifier.padding(top = 4.dp).semantics { heading() },
            )

            SectionLabel(stringResource(R.string.settings_routing))
            Column(Modifier.selectableGroup()) {
                ModeRow(stringResource(R.string.mode_three_tier), stringResource(R.string.mode_three_tier_desc), s.mode == RoutingMode.THREE_TIER) { onMode(RoutingMode.THREE_TIER) }
                ModeRow(stringResource(R.string.mode_stable), stringResource(R.string.mode_stable_desc), s.mode == RoutingMode.STABLE) { onMode(RoutingMode.STABLE) }
            }
            // The chosen mode is the white one; this line says the grey one is a tap away.
            Text(stringResource(R.string.settings_mode_hint), style = TonoType.Fine, color = TonoColors.TextTertiary)
            Expandable(stringResource(R.string.routing_scope_title)) {
                Text(stringResource(R.string.routing_scope), style = TonoType.Meta, color = TonoColors.TextSecondary)
                Text(stringResource(R.string.routing_platform), style = TonoType.Meta, color = TonoColors.TextSecondary)
                Text(stringResource(if (s.underlyingIpv6) R.string.ipv6_on else R.string.ipv6_off), style = TonoType.Fine, color = TonoColors.TextTertiary)
            }

            SectionLabel(stringResource(R.string.settings_check))
            RouteCheck(onExplain)

            SectionLabel(stringResource(R.string.settings_apps))
            NavRow(
                if (s.excludedPackages.isEmpty()) stringResource(R.string.settings_apps_none) else pluralStringResource(R.plurals.settings_apps_count, s.excludedPackages.size, s.excludedPackages.size),
                onOpenApps,
            )

            SectionLabel(stringResource(R.string.settings_system))
            // One row: the way out to Android's own switch as the title, the state under it. An arrow,
            // not a chevron: this leaves Tono.
            SettingsRow(
                stringResource(R.string.system_open),
                Modifier.clickable(role = Role.Button) { context.startActivity(Intent(Settings.ACTION_VPN_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) },
                trailing = { GlyphIcon(Glyph.ARROW, TonoColors.TextTertiary, size = 18.dp) },
            ) {
                // Settings can change independently while the VPN remains up. No cached flag
                // can promise what Android will do after this tunnel stops.
                Text(stringResource(R.string.system_verify_in_android), style = TonoType.Meta, color = TonoColors.TextSecondary, modifier = Modifier.padding(top = 4.dp))
            }

            SectionLabel(stringResource(R.string.settings_account))
            // The address itself is the value under the label (the device test finds it by exact text).
            Text(s.email ?: "", style = TonoType.Title, color = TonoColors.TextPrimary, modifier = Modifier.padding(top = 12.dp))
            TextAction(stringResource(R.string.settings_sign_out), onSignOut, color = TonoColors.Error)

            // About as a colophon: the one line on the screen, then small print.
            Box(Modifier.padding(top = 40.dp).fillMaxWidth().height(1.dp).background(TonoColors.Hairline))
            SectionLabel(stringResource(R.string.settings_about), first = true)
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.about_version, BuildConfig.VERSION_NAME), style = TonoType.Fine, color = TonoColors.TextSecondary)
                Text(stringResource(R.string.about_core, BuildConfig.SING_BOX_VERSION), style = TonoType.Fine, color = TonoColors.TextTertiary)
                Text(stringResource(R.string.about_contract, DesktopRoutingContract.SOURCE_COMMIT.take(9)), style = TonoType.Fine, color = TonoColors.TextTertiary)
                Text(stringResource(R.string.about_test), style = TonoType.Fine, color = TonoColors.TextTertiary)
            }
            NavRow(stringResource(R.string.about_licenses), onOpenLicenses)
        }
    }
}

@Composable
fun ScreenHeader(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        BackCircle(onBack)
        Text(title, style = MaterialTheme.typography.titleLarge, color = TonoColors.TextPrimary, modifier = Modifier.semantics { heading() })
    }
}

@Composable
private fun BackCircle(onBack: () -> Unit) {
    val back = stringResource(R.string.settings_back)
    Box(
        Modifier.size(48.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onBack).semantics { contentDescription = back },
        contentAlignment = Alignment.Center,
    ) { GlyphIcon(Glyph.BACK, TonoColors.TextPrimary) }
}

/**
 * Every row in Settings: a title on the left edge, anything under it (a description, a state line)
 * in the smaller grey tone, and at most one quiet mark on the right edge, centred on the title's
 * first line so wrapped titles at large text keep it in place. The caller's modifier carries the
 * tap (`clickable`, `selectable`), so the whole row is the target and the semantics are one node.
 */
@Composable
private fun SettingsRow(
    title: String,
    modifier: Modifier = Modifier,
    titleColor: Color = TonoColors.TextPrimary,
    trailing: (@Composable () -> Unit)? = null,
    under: @Composable ColumnScope.() -> Unit = {},
) {
    val titleLine = with(LocalDensity.current) { TonoType.Title.lineHeight.toDp() }
    // ≥ 48 dp even when collapsed to its title (the device accessibility check found 38 dp).
    Row(modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 12.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f)) {
            Text(title, style = TonoType.Title, color = titleColor)
            under()
        }
        if (trailing != null) {
            Box(Modifier.padding(start = 12.dp).width(18.dp).height(titleLine), contentAlignment = Alignment.Center) { trailing() }
        }
    }
}

/** A row that opens another screen: the value in title size, a quiet chevron at the end. */
@Composable
private fun NavRow(text: String, onClick: () -> Unit) {
    SettingsRow(
        text, Modifier.clickable(role = Role.Button, onClick = onClick),
        trailing = { GlyphIcon(Glyph.CHEVRON_RIGHT, TonoColors.TextTertiary, size = 18.dp) },
    )
}

/** A text action on the left edge, not a capsule; the whole row is the target and colour marks it as one. */
@Composable
private fun TextAction(text: String, onClick: () -> Unit, color: Color = TonoColors.TextPrimary, fill: Boolean = true) {
    Box(
        Modifier.then(if (fill) Modifier.fillMaxWidth() else Modifier.padding(horizontal = 8.dp)).heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick).padding(vertical = 10.dp),
        contentAlignment = Alignment.CenterStart,
    ) { Text(text, style = TonoType.Action, color = color) }
}

@Composable
private fun Expandable(title: String, content: @Composable () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    val turn by animateFloatAsState(if (open) 180f else 0f, TonoMotion.state, label = "chevron")
    val state = stringResource(if (open) R.string.a11y_expanded else R.string.a11y_collapsed)
    SettingsRow(
        title,
        Modifier.clickable(role = Role.Button, onClickLabel = title) { open = !open }.semantics { stateDescription = state },
        trailing = { GlyphIcon(Glyph.CHEVRON_DOWN, TonoColors.TextTertiary, size = 18.dp, modifier = Modifier.rotate(turn)) },
    )
    AnimatedVisibility(open) { Column(Modifier.padding(top = 8.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() } }
}

/**
 * A mode to choose, set like Kura's filters: the chosen one is white, carries its one-line
 * description and a sun dot where other rows keep their chevron; the other is grey. The row's
 * `selectable` semantics (radio role, selected state) tell TalkBack which is on, so the dot is
 * never the only cue.
 */
@Composable
private fun ModeRow(title: String, desc: String, selected: Boolean, onClick: () -> Unit) {
    SettingsRow(
        title,
        Modifier.selectable(selected, role = Role.RadioButton, onClick = onClick),
        titleColor = if (selected) TonoColors.TextPrimary else TonoColors.TextSecondary,
        trailing = { if (selected) StatusDot(TonoColors.Accent) },
    ) {
        AnimatedVisibility(selected) { Text(desc, style = TonoType.Meta, color = TonoColors.TextSecondary, modifier = Modifier.padding(top = 4.dp)) }
    }
}

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
    Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            value = host,
            onValueChange = { host = it.take(253) },
            placeholder = { Text(stringResource(R.string.check_hint)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Search, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onSearch = { run() }),
            colors = fieldColors(),
            // The same soft corner as the iOS field; the one outline on the screen is the field's.
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.weight(1f),
        )
        TextAction(stringResource(R.string.check_go), { run() }, color = TonoColors.Accent, fill = false)
    }
    result?.let {
        Text(it, style = TonoType.Title, color = TonoColors.TextPrimary, modifier = Modifier.padding(top = 12.dp).animateContentSize().semantics { liveRegion = LiveRegionMode.Polite })
    }
}
