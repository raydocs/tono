package com.raydocs.tono.mobile.ui

import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
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
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.window.DialogWindowProvider
import com.raydocs.tono.mobile.BuildConfig
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.routing.DesktopRoutingContract
import com.raydocs.tono.routing.RoutingMode
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter

/**
 * Sign out's red, muted to the night surfaces (6.2:1 on Night, 5.8:1 on Smoke) instead of the system
 * alert red. It is the only red on the screen, and the sun accent marks only a chosen state.
 */
private val SignOutRed = Color(0xFFE27068)

/**
 * Settings is what you set and who you are, in Material list groups on Night: Protection (the way
 * out to Android's own switch), Routing (two rows that open screens), Account, then the colophon.
 * The routing mode is chosen in Details, next to the lanes it changes; the rules are explained once,
 * on [RoutingRulesScreen]. Each group is a container, so the structure survives 200 % text.
 */
@Composable
fun SettingsScreen(
    s: EngineSnapshot,
    onBack: () -> Unit,
    onOpenRoutingRules: () -> Unit,
    onOpenApps: () -> Unit,
    onSignOut: () -> Unit,
    onOpenLicenses: () -> Unit = {},
) {
    val context = LocalContext.current
    val view = LocalView.current
    val scroll = rememberScrollState()
    LaunchedEffect(scroll, view) {
        snapshotFlow { scroll.value to scroll.isScrollInProgress }.drop(1).filter { !it.second }.collect {
            // Android can retain pre-scroll bounds for Compose's virtual list children.
            view.parent?.notifySubtreeAccessibilityStateChanged(view, view, AccessibilityEvent.CONTENT_CHANGE_TYPE_SUBTREE)
        }
    }
    var confirmSignOut by rememberSaveable { mutableStateOf(false) }
    // The fixed band: status bar plus the 48 dp back circle with its 4 dp above and below.
    val band = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 56.dp
    Box(Modifier.fillMaxSize().background(TonoColors.Night)) {
        Column(
            Modifier.fillMaxSize().verticalScroll(scroll).navigationBarsPadding().padding(horizontal = 20.dp).padding(top = band, bottom = 32.dp),
        ) {
            // The title opens the page on the content's own edge and scrolls away with it.
            Text(
                stringResource(R.string.settings_title), style = TonoType.Display, color = TonoColors.TextPrimary,
                modifier = Modifier.padding(top = 4.dp, bottom = 4.dp).semantics { heading() },
            )

            // 1. Protection: the one row leaves Tono (an arrow, not a chevron). The footer is the honest
            // state: settings can change while the VPN is up, so no cached flag promises what Android
            // does after this tunnel stops.
            SettingsGroup(stringResource(R.string.settings_system), footer = stringResource(R.string.system_verify_in_android)) {
                GroupRow(
                    stringResource(R.string.system_open),
                    Modifier.clickable(role = Role.Button) { context.startActivity(Intent(Settings.ACTION_VPN_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) },
                    trailing = { GlyphIcon(Glyph.ARROW, TonoColors.TextSecondary, size = it) },
                )
            }

            // 2. Routing: the mode as a value on the rules row; the bypass count as a value on the apps row.
            val modeName = stringResource(if (s.mode == RoutingMode.STABLE) R.string.mode_stable_short else R.string.mode_three_tier_short)
            val bypass = if (s.excludedPackages.isEmpty()) stringResource(R.string.settings_apps_none)
            else pluralStringResource(R.plurals.settings_apps_count, s.excludedPackages.size, s.excludedPackages.size)
            SettingsGroup(stringResource(R.string.settings_routing_group), footer = stringResource(R.string.settings_apps_footer)) {
                GroupRow(stringResource(R.string.settings_routing_rules), Modifier.clickable(role = Role.Button, onClick = onOpenRoutingRules), value = modeName, trailing = chevron)
                GroupDivider()
                GroupRow(stringResource(R.string.settings_apps), Modifier.clickable(role = Role.Button, onClick = onOpenApps), value = bypass, trailing = chevron)
            }

            // 3. Account: the address is a value under its label (the device test finds it by exact text,
            // so the row is not merged into one node). Sign out stands in its own container.
            SettingsGroup(stringResource(R.string.settings_account)) {
                GroupRow(stringResource(R.string.settings_signed_in_as)) {
                    Text(s.email ?: "", style = TonoType.Action, color = TonoColors.TextSecondary)
                }
            }
            SettingsGroup(top = 12.dp) {
                GroupRow(stringResource(R.string.settings_sign_out), Modifier.clickable(role = Role.Button) { confirmSignOut = true }, titleColor = SignOutRed)
            }

            // 4. Colophon: one way to the licences, then two lines of small print. No update row: there
            // is no update channel yet, so nothing here may say "latest" or offer a download.
            SettingsGroup {
                GroupRow(stringResource(R.string.about_licenses), Modifier.clickable(role = Role.Button, onClick = onOpenLicenses), trailing = chevron)
            }
            Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.about_version, BuildConfig.VERSION_NAME), style = TonoType.Fine, color = TonoColors.TextTertiary)
                // Word joiners after each solidus: the source address moves to the next line whole
                // instead of breaking after "github.com/".
                Text(stringResource(R.string.about_core, BuildConfig.SING_BOX_VERSION).replace("/", "/⁠"), style = TonoType.Fine, color = TonoColors.TextTertiary)
            }
        }
        // Only the back circle stays fixed, on a band of night that fades out over 24 dp, so content
        // scrolls under it without a hard edge through the glyphs.
        Column(Modifier.fillMaxWidth()) {
            Box(Modifier.fillMaxWidth().height(band).background(TonoColors.Night).statusBarsPadding().padding(horizontal = 6.dp, vertical = 4.dp)) { BackCircle(onBack) }
            Box(Modifier.fillMaxWidth().height(24.dp).background(Brush.verticalGradient(listOf(TonoColors.Night, TonoColors.Night.copy(alpha = 0f)))))
        }
        BottomScrollFade(Modifier.align(Alignment.BottomCenter))
    }
    if (confirmSignOut) SignOutDialog(onConfirm = { confirmSignOut = false; onSignOut() }, onDismiss = { confirmSignOut = false })
}

/**
 * The one second-level screen: both modes with their full descriptions and which one is chosen
 * (changed in Details), then what Tono can and cannot recognise, the platform rules, IPv6 and the
 * contract the lists come from.
 */
@Composable
fun RoutingRulesScreen(s: EngineSnapshot, onBack: () -> Unit) {
    Box(Modifier.fillMaxSize().background(TonoColors.Night)) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader(stringResource(R.string.settings_routing_rules), onBack)
            Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 32.dp)) {
                SettingsGroup(stringResource(R.string.settings_routing), footer = stringResource(R.string.settings_mode_where), top = 8.dp) {
                    ModeLine(stringResource(R.string.mode_three_tier), stringResource(R.string.mode_three_tier_desc), s.mode == RoutingMode.THREE_TIER)
                    GroupDivider()
                    ModeLine(stringResource(R.string.mode_stable), stringResource(R.string.mode_stable_desc), s.mode == RoutingMode.STABLE)
                }
                Text(
                    stringResource(R.string.routing_scope_title), style = TonoType.Label, color = TonoColors.TextTertiary,
                    modifier = Modifier.padding(start = 16.dp, top = 24.dp, bottom = 8.dp).semantics { heading() },
                )
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    ArrowText(stringResource(R.string.routing_scope), TonoType.Meta, TonoColors.TextSecondary)
                    Text(stringResource(R.string.routing_platform), style = TonoType.Meta, color = TonoColors.TextSecondary)
                    Text(stringResource(if (s.underlyingIpv6) R.string.ipv6_on else R.string.ipv6_off), style = TonoType.Fine, color = TonoColors.TextTertiary)
                    Text(stringResource(R.string.about_contract, DesktopRoutingContract.SOURCE_COMMIT.take(9)), style = TonoType.Fine, color = TonoColors.TextTertiary)
                }
            }
        }
        BottomScrollFade(Modifier.align(Alignment.BottomCenter))
    }
}

/**
 * The scroll edge at the bottom: content fades into night over 24 dp and the navigation-bar band
 * itself is solid, so a row that has not been scrolled up yet never sits half under the gesture
 * handle (at 200 % text the account card ended there). The scrolled content still clears the bar at
 * its end, and the band takes no touches.
 */
@Composable
private fun BottomScrollFade(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().height(24.dp).background(Brush.verticalGradient(listOf(TonoColors.Night.copy(alpha = 0f), TonoColors.Night))))
        Box(Modifier.fillMaxWidth().windowInsetsBottomHeight(WindowInsets.navigationBars).background(TonoColors.Night))
    }
}

/** A mode as it reads on the rules screen: name, where traffic goes, and "Selected" in the sun on the chosen one. */
@Composable
private fun ModeLine(title: String, desc: String, selected: Boolean) {
    GroupRow(title, value = if (selected) stringResource(R.string.mode_selected) else null, valueColor = TonoColors.Accent) {
        ArrowText(desc, TonoType.Meta, TonoColors.TextSecondary)
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
 * A list group: a small label in the quietest tone, rows on one Smoke container with rounded
 * corners, and at most one footer line of explanation under it. Label and footer share the rows'
 * text edge (16 dp inside the container).
 */
@Composable
private fun SettingsGroup(label: String? = null, footer: String? = null, top: Dp = 24.dp, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = top)) {
        if (label != null) {
            Text(label, style = TonoType.Label, color = TonoColors.TextTertiary, modifier = Modifier.padding(start = 16.dp, bottom = 8.dp).semantics { heading() })
        }
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(TonoColors.Smoke)) { content() }
        if (footer != null) {
            Text(footer, style = TonoType.Meta, color = TonoColors.TextSecondary, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp))
        }
    }
}

@Composable
private fun GroupDivider() = HorizontalDivider(Modifier.padding(start = 16.dp), color = TonoColors.Hairline)

/** The chevron of a row that opens another screen in Tono; it grows with the text, up to 2×. */
private val chevron: @Composable (Dp) -> Unit = { GlyphIcon(Glyph.CHEVRON_RIGHT, TonoColors.TextTertiary, size = it) }

/**
 * Every row: a Material list item with the title at 17 sp, an optional value and mark on the trailing
 * edge in the secondary tone, and anything under the title ([supporting]) in the row's own column.
 * The caller's modifier carries the tap, so the whole item is the target and one semantics node.
 */
@Composable
private fun GroupRow(
    title: String,
    modifier: Modifier = Modifier,
    titleColor: Color = TonoColors.TextPrimary,
    value: String? = null,
    valueColor: Color = TonoColors.TextSecondary,
    trailing: (@Composable (Dp) -> Unit)? = null,
    supporting: (@Composable () -> Unit)? = null,
) {
    val mark = 18.dp * minOf(LocalDensity.current.fontScale, 2f)
    ListItem(
        headlineContent = { Text(title, style = TonoType.Action, color = titleColor) },
        modifier = modifier.heightIn(min = 48.dp),
        supportingContent = supporting,
        trailingContent = if (value == null && trailing == null) null else {
            {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (value != null) Text(value, style = TonoType.Action, color = valueColor, textAlign = TextAlign.End, modifier = Modifier.widthIn(max = 180.dp))
                    trailing?.invoke(mark)
                }
            }
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

/** Signing out asks first; the confirming button names the act for screen readers and device tests. */
@Composable
private fun SignOutDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val confirmLabel = stringResource(R.string.a11y_confirm_sign_out)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = TonoColors.SmokeHigh,
        titleContentColor = TonoColors.TextPrimary,
        textContentColor = TonoColors.TextSecondary,
        title = { DimLikeASheet(); Text(stringResource(R.string.sign_out_title)) },
        text = { Text(stringResource(R.string.sign_out_body)) },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                colors = ButtonDefaults.textButtonColors(contentColor = SignOutRed),
                modifier = Modifier.heightIn(min = 48.dp).testTag("signOutConfirm").semantics { contentDescription = confirmLabel },
            ) { Text(stringResource(R.string.settings_sign_out)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, colors = ButtonDefaults.textButtonColors(contentColor = TonoColors.TextPrimary), modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.action_cancel))
            }
        },
    )
}

/**
 * The dialog's window dims what is behind it at Android's 60 %; Tono's sheets scrim at 45 %, so the
 * confirmation sits on the same night as Details does and the screen behind stays readable. Set on
 * the dialog's own window, from inside it.
 */
@Composable
private fun DimLikeASheet() {
    val window = (LocalView.current.parent as? DialogWindowProvider)?.window
    SideEffect { window?.setDimAmount(0.45f) }
}

/**
 * Text whose "→" is Tono's own arrow glyph at the text's size: Roboto has no arrow, and the
 * fallback glyph sat small and under the x-height. TalkBack still reads the arrow (alternate text).
 */
@Composable
internal fun ArrowText(text: String, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
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
