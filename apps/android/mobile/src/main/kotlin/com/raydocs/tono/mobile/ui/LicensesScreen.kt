package com.raydocs.tono.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.raydocs.tono.mobile.R

/** Bundled licence texts and the corresponding-source record for the GPL core. */
@Composable
fun LicensesScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val text = remember {
        listOf("SOURCE.txt", "sing-box-LICENSE.txt", "sing-box-provenance.json", "GPL-3.0.txt").joinToString("\n\n──────────\n\n") { name ->
            runCatching { context.assets.open("licenses/$name").bufferedReader().use { it.readText() } }.getOrDefault("")
        }
    }
    Column(Modifier.fillMaxSize().background(TonoColors.Night)) {
        ScreenHeader(stringResource(R.string.about_licenses), onBack)
        Text(
            text,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            color = TonoColors.TextSecondary,
            modifier = Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(16.dp),
        )
    }
}
