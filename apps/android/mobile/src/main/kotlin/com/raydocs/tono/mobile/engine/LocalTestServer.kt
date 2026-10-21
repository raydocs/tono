package com.raydocs.tono.mobile.engine

import android.content.Context
import com.raydocs.tono.mobile.BuildConfig
import java.io.File

/**
 * Debug (test) builds only: points the engine at a local fixture control plane instead of the Tono
 * API, so the on-device tunnel test can drive the real sign-in, catalog, sing-box core and TUN
 * without a Tono account.
 *
 * Constraints:
 *  - ignored unless [BuildConfig.DEBUG];
 *  - read from app-private no-backup storage, which only this app's uid can write (its own
 *    instrumentation, or `run-as` on a debuggable build);
 *  - only plain HTTP to the device's own loopback (the test reaches the host through `adb reverse`),
 *    on an explicit port, path `/api/v1/`, so nothing on a network is ever addressed;
 *  - the account is bound to the server it was made on ([EngineSettings.accountApi]), so tokens and
 *    catalogs never cross between a local server and the Tono API;
 *  - every screen says "Local test server" while it is active.
 * Catalog admission is unchanged: exits must still be public IPv4 VLESS Reality nodes.
 */
object LocalTestServer {
    const val FILE = "tono/local-test-server"
    private val ALLOWED = Regex("^http://127\\.0\\.0\\.1:([1-9][0-9]{1,4})/api/v1/$")

    fun isAllowed(url: String): Boolean = ALLOWED.matches(url)

    fun apiBase(context: Context): String? {
        if (!BuildConfig.DEBUG) return null
        val file = File(context.noBackupFilesDir, FILE)
        if (!file.isFile) return null
        return file.readText().trim().takeIf(::isAllowed)
    }
}
