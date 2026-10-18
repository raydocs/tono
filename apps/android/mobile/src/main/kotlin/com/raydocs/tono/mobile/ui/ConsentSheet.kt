package com.raydocs.tono.mobile.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.raydocs.tono.mobile.R

/**
 * Shown before Android's own VPN dialog whenever consent is missing (first connect, or after it
 * was revoked): what the dialog is, what Tono routes, and how to stop it. Continue opens the system
 * dialog; nothing is granted or started from here.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConsentSheet(onContinue: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(
        dragHandle = { WideDragHandle() },
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = TonoColors.Smoke,
        scrimColor = TonoColors.NightDeep.copy(alpha = 0.55f),
    ) { ConsentContent(onContinue, onDismiss) }
}

@Composable
fun ConsentContent(onContinue: () -> Unit, onDismiss: () -> Unit) {
    Column(
        Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 20.dp).padding(bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.tono_sun_mark), contentDescription = null, modifier = Modifier.size(28.dp))
            Spacer(Modifier.width(12.dp))
            Text(stringResource(R.string.consent_title), style = MaterialTheme.typography.titleLarge, color = TonoColors.TextPrimary, modifier = Modifier.semantics { heading() })
        }
        Point(Glyph.KEY, stringResource(R.string.consent_ask))
        Point(Glyph.CLOUD, stringResource(R.string.consent_routes))
        Point(Glyph.STOP, stringResource(R.string.consent_stop))
        Spacer(Modifier.height(4.dp))
        PrimaryButton(stringResource(R.string.consent_continue), onContinue)
        QuietButton(stringResource(R.string.consent_later), onDismiss, Modifier.fillMaxWidth())
    }
}

@Composable
private fun Point(glyph: Glyph, text: String) {
    Row(verticalAlignment = Alignment.Top) {
        GlyphIcon(glyph, TonoColors.SunMid, size = 20.dp)
        Spacer(Modifier.width(14.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge, color = TonoColors.TextSecondary)
    }
}
