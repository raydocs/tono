package com.raydocs.tono.mobile.ui

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Single activity. Owns only what must run in the UI: Android's VPN consent dialog and the
 * notification permission request. Everything else goes to the engine in the `:vpn` process.
 */
class MainActivity : ComponentActivity(), TonoActions {
    private lateinit var client: EngineClient

    private val consent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) { client.startConnect(); askNotifications() } else client.command("permissionDenied")
    }

    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* status text only; tunnel works either way */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(0), navigationBarStyle = SystemBarStyle.dark(0))
        super.onCreate(savedInstanceState)
        client = EngineClient(applicationContext)
        val reduceMotion = Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        setContent {
            val snapshot by client.snapshot.collectAsStateWithLifecycle()
            CompositionLocalProvider(LocalReduceMotion provides reduceMotion) {
                TonoTheme { TonoRoot(snapshot, this) }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        client.bind()
    }

    override fun onStop() {
        client.unbind()
        super.onStop()
    }

    override fun connect() {
        val prepare = VpnService.prepare(this)
        if (prepare != null) consent.launch(prepare) else { client.startConnect(); askNotifications() }
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
