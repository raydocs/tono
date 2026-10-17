package com.raydocs.tono.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot

/** Cloud line picker. Lines come only from the admitted exit catalog; nothing is invented here. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LinesSheet(s: EngineSnapshot, onSelect: (String) -> Unit, onTest: () -> Unit, onDismiss: () -> Unit) {
    val zh = isChinese()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = TonoColors.Smoke,
        scrimColor = TonoColors.NightDeep.copy(alpha = 0.55f),
    ) { LinesContent(s, zh, onSelect, onTest) }
}

@Composable
fun LinesContent(s: EngineSnapshot, zh: Boolean, onSelect: (String) -> Unit, onTest: () -> Unit) {
    Column(Modifier.navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.lines_title), style = MaterialTheme.typography.titleLarge, color = TonoColors.TextPrimary, modifier = Modifier.weight(1f))
            QuietButton(stringResource(R.string.lines_test), onTest)
        }
        if (s.usingCachedCatalog) Text(stringResource(R.string.lines_cached), style = MaterialTheme.typography.bodySmall, color = TonoColors.Warning)
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp).selectableGroup(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(s.nodes, key = { it.name }) { n ->
                val selected = n.name == s.selectedNode
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (selected) TonoColors.Accent.copy(alpha = 0.14f) else TonoColors.SmokeHigh.copy(alpha = 0.6f))
                        .selectable(selected, role = Role.RadioButton) { onSelect(n.name) }
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    StatusDot(Format.latencyColor(n.latencyMs))
                    Column(Modifier.weight(1f)) {
                        Text(Format.city(n.city, zh), style = MaterialTheme.typography.titleMedium, color = TonoColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (n.label.isNotBlank()) Text(n.label, style = MaterialTheme.typography.bodySmall, color = TonoColors.TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text(
                        n.latencyMs?.let { stringResource(R.string.latency_ms, it.toInt()) } ?: stringResource(R.string.line_untested),
                        style = MaterialTheme.typography.labelLarge,
                        color = TonoColors.TextSecondary,
                    )
                    if (selected) Text(stringResource(R.string.lines_in_use), style = MaterialTheme.typography.labelMedium, color = TonoColors.Accent)
                }
            }
        }
    }
}
