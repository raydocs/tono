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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.graphics.Brush
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
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
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

/**
 * Sign out's red, muted to the night surfaces (6.2:1 on Night, 5.8:1 on Smoke) instead of the system
 * alert red, which was the one saturated colour on the screen.
 */
private val SignOutRed = Color(0xFFE27068)

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
    // The fixed band: status bar plus the 48 dp back circle with its 4 dp above and below.
    val band = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 56.dp
    Box(Modifier.fillMaxSize().background(TonoColors.Night)) {
        // Editorial layout: no cards, rules or dividers. One rhythm: rows carry 10 dp above and
        // below, a label sits 30 dp under the previous row (a 40 dp group gap) and 10 dp over its first.
        // The title opens the page on the content's own left edge and scrolls away with it: one axis
        // for every word on the screen, as in a book.
        Column(
            Modifier.fillMaxSize().verticalScroll(scroll).navigationBarsPadding().padding(horizontal = 20.dp).padding(top = band, bottom = 32.dp),
        ) {
            Text(
                stringResource(R.string.settings_title), style = TonoType.Display, color = TonoColors.TextPrimary,
                modifier = Modifier.padding(top = 4.dp, bottom = 10.dp).semantics { heading() },
            )

            SectionLabel(stringResource(R.string.settings_routing))
            Column(Modifier.selectableGroup()) {
                ModeRow(stringResource(R.string.mode_three_tier), stringResource(R.string.mode_three_tier_desc), s.mode == RoutingMode.THREE_TIER) { onMode(RoutingMode.THREE_TIER) }
                ModeRow(stringResource(R.string.mode_stable), stringResource(R.string.mode_stable_desc), s.mode == RoutingMode.STABLE) { onMode(RoutingMode.STABLE) }
            }
            Expandable(stringResource(R.string.routing_scope_title)) {
                Text(stringResource(R.string.routing_scope), style = TonoType.Meta, color = TonoColors.TextSecondary)
                Text(stringResource(R.string.routing_platform), style = TonoType.Meta, color = TonoColors.TextSecondary)
                Text(stringResource(if (s.underlyingIpv6) R.string.ipv6_on else R.string.ipv6_off), style = TonoType.Fine, color = TonoColors.TextTertiary)
                // The contract the lists come from belongs with the lists, not in the colophon.
                Text(stringResource(R.string.about_contract, DesktopRoutingContract.SOURCE_COMMIT.take(9)), style = TonoType.Fine, color = TonoColors.TextTertiary)
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
                trailing = { GlyphIcon(Glyph.ARROW, TonoColors.TextTertiary, size = it) },
            ) {
                // Settings can change independently while the VPN remains up. No cached flag
                // can promise what Android will do after this tunnel stops.
                Text(stringResource(R.string.system_verify_in_android), style = TonoType.Meta, color = TonoColors.TextSecondary, modifier = Modifier.padding(top = 4.dp))
            }

            SectionLabel(stringResource(R.string.settings_account))
            // The address itself is the value under the label (the device test finds it by exact text).
            Text(s.email ?: "", style = TonoType.Title, color = TonoColors.TextPrimary, modifier = Modifier.padding(vertical = 10.dp))
            TextAction(stringResource(R.string.settings_sign_out), onSignOut, color = SignOutRed)

            // About as a colophon in small print, set apart by the same space as any group.
            SectionLabel(stringResource(R.string.settings_about))
            Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.about_version, BuildConfig.VERSION_NAME), style = TonoType.Fine, color = TonoColors.TextSecondary)
                // Word joiners after each solidus: the source address moves to the next line whole
                // instead of breaking after "github.com/".
                Text(stringResource(R.string.about_core, BuildConfig.SING_BOX_VERSION).replace("/", "/\u2060"), style = TonoType.Fine, color = TonoColors.TextTertiary)
                Text(stringResource(R.string.about_test), style = TonoType.Fine, color = TonoColors.TextTertiary)
            }
            NavRow(stringResource(R.string.about_licenses), onOpenLicenses)
        }
        // Only the back circle stays fixed, on a band of night that fades out over 24 dp, so content
        // scrolls under it without a hard edge through the glyphs.
        Column(Modifier.fillMaxWidth()) {
            Box(Modifier.fillMaxWidth().height(band).background(TonoColors.Night).statusBarsPadding().padding(horizontal = 6.dp, vertical = 4.dp)) { BackCircle(onBack) }
            Box(Modifier.fillMaxWidth().height(24.dp).background(Brush.verticalGradient(listOf(TonoColors.Night, TonoColors.Night.copy(alpha = 0f)))))
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
 * Every row in Settings: a title on the left edge with at most one quiet mark on the right edge,
 * centred on the title's first line so wrapped titles at large text keep it in place; anything
 * under the title (a description, a state line) takes the full width in the smaller grey tone.
 * Rows that *are* something (a mode, the account) set the title at 20 sp; rows that *act* (open,
 * reveal) at 17 sp, so reading and acting are two sizes, not one style told apart by a chevron.
 * The caller's modifier carries the tap (`clickable`, `selectable`), so the whole row is the target
 * and the semantics are one node.
 */
@Composable
private fun SettingsRow(
    title: String,
    modifier: Modifier = Modifier,
    style: TextStyle = TonoType.Action,
    titleColor: Color = TonoColors.TextPrimary,
    trailing: (@Composable (Dp) -> Unit)? = null,
    under: @Composable ColumnScope.() -> Unit = {},
) {
    val titleLine = with(LocalDensity.current) { style.lineHeight.toDp() }
    // Marks grow with the text (up to 1.5x) and share one centre line with the 20 dp radio.
    val mark = 18.dp * minOf(LocalDensity.current.fontScale, 1.5f)
    val slot = maxOf(mark, 24.dp)
    Column(modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Text(title, style = style, color = titleColor, modifier = Modifier.weight(1f))
            if (trailing != null) {
                Box(Modifier.padding(start = 12.dp).width(slot).height(titleLine), contentAlignment = Alignment.Center) { trailing(mark) }
            }
        }
        under()
    }
}

/** A row that opens another screen in Tono: a quiet chevron at the end. */
@Composable
private fun NavRow(text: String, onClick: () -> Unit) {
    SettingsRow(
        text, Modifier.clickable(role = Role.Button, onClick = onClick),
        trailing = { GlyphIcon(Glyph.CHEVRON_RIGHT, TonoColors.TextTertiary, size = it) },
    )
}

/** A text action on the left edge, not a capsule; the whole row is the target and colour marks it as one. */
@Composable
private fun TextAction(text: String, onClick: () -> Unit, color: Color = TonoColors.TextPrimary, fill: Boolean = true) {
    Box(
        // Inline (Check): the padding sits inside the target, which never drops under 48 dp wide.
        Modifier.then(if (fill) Modifier.fillMaxWidth() else Modifier.widthIn(min = 48.dp)).heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = if (fill) 0.dp else 8.dp, vertical = 10.dp),
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
        trailing = { GlyphIcon(Glyph.CHEVRON_DOWN, TonoColors.TextTertiary, size = it, modifier = Modifier.rotate(turn)) },
    )
    AnimatedVisibility(open) { Column(Modifier.padding(top = 4.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() } }
}

/**
 * A mode to choose: both titles in the same ink on the one left edge; the chosen one carries its
 * one-line description and the radio in the trailing slot is filled with the sun. The row's
 * `selectable` semantics (radio role, selected state) tell TalkBack which is on; the radio itself
 * is drawn only.
 */
@Composable
private fun ModeRow(title: String, desc: String, selected: Boolean, onClick: () -> Unit) {
    SettingsRow(
        title,
        Modifier.selectable(selected, role = Role.RadioButton, onClick = onClick),
        style = TonoType.Title,
        trailing = { _ -> RadioButton(selected, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = TonoColors.Accent, unselectedColor = TonoColors.TextTertiary)) },
    ) {
        AnimatedVisibility(selected) { ArrowText(desc, TonoType.Meta, TonoColors.TextSecondary, Modifier.padding(top = 4.dp)) }
    }
}

/**
 * Text whose "→" is Tono's own arrow glyph at the text's size: Roboto has no arrow, and the
 * fallback glyph sat small and under the x-height. TalkBack still reads the arrow (alternate text).
 */
@Composable
private fun ArrowText(text: String, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    val parts = text.split("→")
    if (parts.size == 1) {
        Text(text, style = style, color = color, modifier = modifier)
        return
    }
    val annotated = buildAnnotatedString {
        parts.forEachIndexed { i, part ->
            append(part)
            if (i < parts.lastIndex) appendInlineContent("arrow", "→")
        }
    }
    val glyph = with(LocalDensity.current) { style.fontSize.toDp() }
    val inline = mapOf(
        "arrow" to InlineTextContent(Placeholder(1.em, 1.em, PlaceholderVerticalAlign.TextCenter)) {
            GlyphIcon(Glyph.ARROW, color, size = glyph)
        },
    )
    Text(annotated, style = style, color = color, modifier = modifier, inlineContent = inline)
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
    Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        // A filled field, not a stroked one: the only box on the screen is a soft lift of the night,
        // brighter while it has focus; the accent is kept for the caret.
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
            modifier = Modifier.weight(1f),
        )
        // The accent names the action; white beside the filled field read as a label.
        TextAction(stringResource(R.string.check_go), { run() }, color = TonoColors.Accent, fill = false)
    }
    result?.let {
        ArrowText(it, TonoType.Title, TonoColors.TextPrimary, Modifier.padding(top = 10.dp).animateContentSize().semantics { liveRegion = LiveRegionMode.Polite })
    }
}
