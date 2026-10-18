package com.raydocs.tono.mobile.ui

import android.content.Intent
import android.provider.Settings
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
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
    Column(Modifier.fillMaxSize().background(TonoColors.Night)) {
        ScreenHeader(stringResource(R.string.settings_title), onBack)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 24.dp),
        ) {
            SectionLabel(stringResource(R.string.settings_routing))
            SmokeCard {
                Column(Modifier.selectableGroup()) {
                    ModeRow(stringResource(R.string.mode_three_tier), stringResource(R.string.mode_three_tier_desc), s.mode == RoutingMode.THREE_TIER) { onMode(RoutingMode.THREE_TIER) }
                    Spacer(Modifier.height(6.dp))
                    ModeRow(stringResource(R.string.mode_stable), stringResource(R.string.mode_stable_desc), s.mode == RoutingMode.STABLE) { onMode(RoutingMode.STABLE) }
                }
            }

            Spacer(Modifier.height(10.dp))
            SmokeCard { Expandable(stringResource(R.string.routing_scope_title)) {
                Text(stringResource(R.string.routing_scope), style = MaterialTheme.typography.bodyMedium, color = TonoColors.TextSecondary)
                Text(stringResource(R.string.routing_platform), style = MaterialTheme.typography.bodyMedium, color = TonoColors.TextSecondary)
                Text(stringResource(if (s.underlyingIpv6) R.string.ipv6_on else R.string.ipv6_off), style = MaterialTheme.typography.labelMedium, color = TonoColors.TextTertiary)
            } }

            SectionLabel(stringResource(R.string.settings_check))
            SmokeCard { RouteCheck(onExplain) }

            SectionLabel(stringResource(R.string.settings_apps))
            SmokeCard {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onOpenApps),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        if (s.excludedPackages.isEmpty()) stringResource(R.string.settings_apps_none) else pluralStringResource(R.plurals.settings_apps_count, s.excludedPackages.size, s.excludedPackages.size),
                        style = MaterialTheme.typography.bodyLarge, color = TonoColors.TextPrimary, modifier = Modifier.weight(1f),
                    )
                    GlyphIcon(Glyph.CHEVRON_RIGHT, TonoColors.TextTertiary, size = 18.dp)
                }
            }

            SectionLabel(stringResource(R.string.settings_system))
            SmokeCard {
                Text(
                    if (s.alwaysOn) stringResource(R.string.system_on, if (s.lockdown) stringResource(R.string.system_lockdown) else "") else stringResource(R.string.system_off),
                    style = MaterialTheme.typography.bodyMedium, color = if (s.alwaysOn) TonoColors.TextSecondary else TonoColors.Warning,
                )
                QuietButton(stringResource(R.string.system_open), { context.startActivity(Intent(Settings.ACTION_VPN_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) })
            }

            SectionLabel(stringResource(R.string.settings_account))
            SmokeCard {
                Text(s.email ?: "", style = MaterialTheme.typography.bodyLarge, color = TonoColors.TextPrimary)
                QuietButton(stringResource(R.string.settings_sign_out), onSignOut, color = TonoColors.Error)
            }

            SectionLabel(stringResource(R.string.settings_about))
            SmokeCard {
                Text(stringResource(R.string.about_version, BuildConfig.VERSION_NAME), style = MaterialTheme.typography.bodyMedium, color = TonoColors.TextPrimary)
                Text(stringResource(R.string.about_core, BuildConfig.SING_BOX_VERSION), style = MaterialTheme.typography.bodySmall, color = TonoColors.TextSecondary)
                Text(stringResource(R.string.about_contract, DesktopRoutingContract.SOURCE_COMMIT.take(9)), style = MaterialTheme.typography.bodySmall, color = TonoColors.TextSecondary)
                Text(stringResource(R.string.about_test), style = MaterialTheme.typography.bodySmall, color = TonoColors.TextTertiary)
                QuietButton(stringResource(R.string.about_licenses), onOpenLicenses)
            }
        }
    }
}

@Composable
fun ScreenHeader(title: String, onBack: () -> Unit) {
    val back = stringResource(R.string.settings_back)
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(48.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onBack).semantics { contentDescription = back },
            contentAlignment = Alignment.Center,
        ) { GlyphIcon(Glyph.BACK, TonoColors.TextPrimary) }
        Text(title, style = MaterialTheme.typography.titleLarge, color = TonoColors.TextPrimary, modifier = Modifier.semantics { heading() })
    }
}

@Composable
private fun Expandable(title: String, content: @Composable () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    val turn by animateFloatAsState(if (open) 180f else 0f, TonoMotion.state, label = "chevron")
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(MaterialTheme.shapes.small)
            .clickable(role = Role.Button, onClickLabel = title) { open = !open }
            .semantics { stateDescription = if (open) "expanded" else "collapsed" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.bodyLarge, color = TonoColors.TextPrimary, modifier = Modifier.weight(1f))
        GlyphIcon(Glyph.CHEVRON_DOWN, TonoColors.TextTertiary, size = 18.dp, modifier = Modifier.rotate(turn))
    }
    AnimatedVisibility(open) { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { content() } }
}

@Composable
private fun ModeRow(title: String, desc: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium).selectable(selected, role = Role.RadioButton, onClick = onClick).padding(vertical = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        RadioButton(selected, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = TonoColors.Accent), modifier = Modifier.padding(top = 2.dp, end = 10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = TonoColors.TextPrimary)
            AnimatedVisibility(selected) { Text(desc, style = MaterialTheme.typography.bodySmall, color = TonoColors.TextSecondary) }
        }
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
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            value = host,
            onValueChange = { host = it.take(253) },
            placeholder = { Text(stringResource(R.string.check_hint)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Search, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onSearch = { run() }),
            colors = fieldColors(),
            modifier = Modifier.weight(1f),
        )
        QuietButton(stringResource(R.string.check_go), { run() })
    }
    result?.let {
        Text(it, style = MaterialTheme.typography.titleMedium, color = TonoColors.TextPrimary, modifier = Modifier.animateContentSize().semantics { liveRegion = LiveRegionMode.Polite })
    }
}
