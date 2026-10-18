package com.raydocs.tono.mobile.ui

import android.Manifest
import android.app.Activity
import android.app.Application
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Single activity. Owns only what must run in the UI: Android's VPN consent dialog (explained
 * first) and the notification permission request. Everything else goes to the engine in the `:vpn` process.
 */
class MainActivity : ComponentActivity(), TonoActions {
    private val model: EngineModel by viewModels()
    private val client get() = model.client

    private val consent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) { client.startConnect(); askNotifications() } else client.command("permissionDenied")
    }

    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* status text only; tunnel works either way */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(0), navigationBarStyle = SystemBarStyle.dark(0))
        super.onCreate(savedInstanceState)
        setContent {
            val snapshot by client.snapshot.collectAsStateWithLifecycle()
            val link by client.link.collectAsStateWithLifecycle()
            val pendingConsent by model.pendingConsent.collectAsStateWithLifecycle()
            CompositionLocalProvider(LocalReduceMotion provides rememberSystemReduceMotion()) {
                TonoTheme {
                    TonoRoot(snapshot, this, link)
                    pendingConsent?.let { prepare ->
                        ConsentSheet(
                            onContinue = { model.setPendingConsent(null); consent.launch(prepare) },
                            onDismiss = { model.setPendingConsent(null) },
                        )
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        client.resume()
    }

    override fun onStop() {
        client.pause()
        super.onStop()
    }

    override fun connect() {
        val prepare = VpnService.prepare(this)
        if (prepare != null) model.setPendingConsent(prepare) else { client.startConnect(); askNotifications() }
    }

    /** Asked after VPN consent so the two system dialogs never stack. */
    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun command(op: String, vararg args: Pair<String, Any?>) = client.command(op, *args)

    override fun explain(host: String): Map<String, Any?>? = client.explain(host)
}

/**
 * Outlives rotation: the engine binding (so a turned phone does not redraw from nothing) and
 * Android's consent intent while Tono explains it first ([ConsentSheet]), which is also kept if
 * Android recreates the process.
 */
class EngineModel(app: Application, private val saved: SavedStateHandle) : AndroidViewModel(app) {
    val client = EngineClient(app).also { it.bind() }
    val pendingConsent = saved.getStateFlow<Intent?>(PENDING_CONSENT, null)

    fun setPendingConsent(intent: Intent?) { saved[PENDING_CONSENT] = intent }

    override fun onCleared() = client.unbind()

    private companion object { const val PENDING_CONSENT = "pendingConsent" }
}
