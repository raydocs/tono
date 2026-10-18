package com.raydocs.tono.mobile.ui

import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.graphics.drawable.toBitmap
import com.raydocs.tono.mobile.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private data class AppEntry(val pkg: String, val label: String, val icon: ImageBitmap?)

/** Per-app bypass (Android only). Bypassed apps skip Tono entirely, including any AI inside them. */
@Composable
fun AppsScreen(excluded: List<String>, onBack: () -> Unit, onSave: (List<String>) -> Unit) {
    val context = LocalContext.current
    var apps by remember { mutableStateOf<List<AppEntry>?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var chosen by remember { mutableStateOf(excluded.toSet()) }
    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.IO) {
            val pm = context.packageManager
            val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            @Suppress("DEPRECATION") pm.queryIntentActivities(launcher, 0)
                .map { it.activityInfo.applicationInfo }
                .distinctBy { it.packageName }
                .filter { it.packageName != context.packageName }
                .map { ai ->
                    val icon = runCatching { pm.getApplicationIcon(ai).toBitmap(96, 96).asImageBitmap() }.getOrNull()
                    AppEntry(ai.packageName, pm.getApplicationLabel(ai).toString(), icon)
                }
                .sortedWith(compareByDescending<AppEntry> { it.pkg in excluded }.thenBy { it.label.lowercase() })
        }
    }
    val save = { onSave(chosen.toList().sorted()); onBack() }
    Column(Modifier.fillMaxSize().background(TonoColors.Night)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { ScreenHeader(stringResource(R.string.settings_apps), save) }
        }
        OutlinedTextField(
            value = query, onValueChange = { query = it.take(64) },
            placeholder = { Text(stringResource(R.string.apps_search)) }, singleLine = true, colors = fieldColors(),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        )
        val list = apps
        if (list == null) {
            // Takes the list's place, so Done stays at the bottom while apps load.
            Box(Modifier.weight(1f).fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = TonoColors.Accent) }
        } else {
            val q = query.trim().lowercase()
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                items(list.filter { q.isEmpty() || it.label.lowercase().contains(q) || it.pkg.contains(q) }, key = { it.pkg }) { app ->
                    val on = app.pkg in chosen
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("app-row")
                            .toggleable(on, role = Role.Checkbox) { chosen = if (it) chosen + app.pkg else chosen - app.pkg }
                            .padding(horizontal = 20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        if (app.icon != null) Image(app.icon, contentDescription = null, modifier = Modifier.size(36.dp)) else Box(Modifier.size(36.dp))
                        Column(Modifier.weight(1f)) {
                            Text(app.label, style = MaterialTheme.typography.bodyLarge, color = TonoColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(app.pkg, style = MaterialTheme.typography.labelSmall, color = TonoColors.TextTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Checkbox(on, onCheckedChange = null, colors = CheckboxDefaults.colors(checkedColor = TonoColors.Accent))
                    }
                }
            }
        }
        Box(Modifier.navigationBarsPadding().padding(16.dp)) { PrimaryButton(stringResource(R.string.apps_done), save) }
    }
}
