package com.raydocs.tono.mobile

import android.app.ActivityManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Process
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import com.raydocs.tono.mobile.engine.LocalTestServer
import com.raydocs.tono.mobile.ui.MainActivity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.regex.Pattern

/**
 * A real tunnel on a real Android system, against local stand-in servers (scripts/local-tunnel), not
 * Tono's: the shipped sign-in screen, catalog admission, sing-box config, libbox core, Android
 * VpnService/TUN, exit probes and Home UI, end to end. The debug build is pointed at a local fixture
 * control plane ([LocalTestServer]) and says "Local test server" on every screen; the cloud and Home
 * exits are the pinned sing-box CLI on the CI host. CI checks afterwards, from the exits' own logs,
 * that each request this test made left through the hop its routing class promises.
 *
 * No Tono account, no Tono server, and nothing here shows that the real service works.
 */
@RunWith(AndroidJUnit4::class)
class LocalTunnelDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val out = File(context.getExternalFilesDir(null), "evidence").apply { mkdirs() }
    private val override = File(context.noBackupFilesDir, LocalTestServer.FILE)
    private val report = mutableListOf<String>()

    init {
        Configurator.getInstance().waitForIdleTimeout = 300
    }

    private fun text(id: Int) = context.getString(id)

    private fun find(text: String, timeoutMs: Long = 20_000): UiObject2? = device.wait(Until.findObject(By.text(text)), timeoutMs)

    private fun shot(name: String) {
        Thread.sleep(600)
        assertTrue("screenshot $name drawn", Captures.drawn(File(out, "$name.png")))
    }

    private fun diagnose(name: String) {
        device.takeScreenshot(File(out, "$name.png"))
        File(out, "$name.xml").outputStream().use { device.dumpWindowHierarchy(it) }
    }

    private fun note(line: String) { report += line; File(out, "local-tunnel.txt").writeText(report.joinToString("\n") + "\n") }

    private fun vpnUp(): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        return cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
    }

    /** The engine reads the server choice when its `:vpn` process starts; same uid, so this test may end it. */
    private fun stopEngineProcess() {
        val am = context.getSystemService(ActivityManager::class.java)
        am.runningAppProcesses.orEmpty().filter { it.processName == "${context.packageName}:vpn" }.forEach { Process.killProcess(it.pid) }
        Thread.sleep(800)
    }

    /**
     * "Local test server · not Tono" reaches a screen reader: UiAutomator, like TalkBack, only sees
     * nodes Android reports as visible to the user (not hidden under the status bar). The pill drawn
     * in the status-bar band shows in the screenshot that follows.
     */
    private fun assertLocalMark(screen: String) {
        val mark = text(R.string.local_test_server)
        val found = device.wait(Until.hasObject(By.desc(mark)), 10_000) == true
        if (!found) diagnose("local-mark-missing-$screen")
        note("mark on $screen: ${if (found) "present" else "MISSING"}")
        assertTrue("$screen says it is a local test server", found)
    }

    private fun reachable(host: String, port: Int) = runCatching { Socket().use { it.connect(InetSocketAddress(host, port), 3_000) } }.isSuccess

    /** One request from this process, which shares the app's uid and is therefore inside the tunnel. */
    private fun fetch(url: String): String = runCatching {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        conn.instanceFollowRedirects = false
        try { "HTTP ${conn.responseCode}" } finally { conn.disconnect() }
    }.getOrElse { "ERROR ${it.javaClass.simpleName}" }

    private fun pss(process: String): String {
        val text = instrumentation.uiAutomation.executeShellCommand("dumpsys meminfo $process").let {
            android.os.ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().readText()
        }
        return Regex("TOTAL PSS:\\s+(\\d+)").find(text)?.groupValues?.get(1)?.let { "${it.toLong() / 1024} MB" } ?: "n/a"
    }

    @Test fun t1_realTunnelThroughLocalFixtureServers() {
        assertTrue("local fixture control plane on 127.0.0.1:28080 (CI starts scripts/local-tunnel/fixture-servers.py and runs adb reverse)", reachable("127.0.0.1", 28080))
        stopEngineProcess()
        override.parentFile?.mkdirs()
        override.writeText("http://127.0.0.1:28080/api/v1/")
        try {
            ActivityScenario.launch(MainActivity::class.java).use {
                assertNotNull("sign-in screen", find(text(R.string.signin_title)))
                assertLocalMark("sign-in")
                shot("local-01-signin")

                device.findObject(By.clazz("android.widget.EditText")).text = "tester@local.test"
                device.findObject(By.text(text(R.string.signin_send))).click()
                assertNotNull("code step", find(text(R.string.signin_code)))
                // The e-mail field fades out over 220 ms; wait until the code field is the only one.
                val deadline0 = SystemClock.elapsedRealtime() + 5_000
                while (device.findObjects(By.clazz("android.widget.EditText")).size != 1 && SystemClock.elapsedRealtime() < deadline0) Thread.sleep(100)
                // Six digits verify on their own, as when a user types the code from their email.
                device.findObject(By.clazz("android.widget.EditText")).text = "246810"
                val connect = find(text(R.string.action_connect), 30_000)
                if (connect == null) diagnose("local-signin-failed")
                assertNotNull("signed in: Home with Connect", connect)
                assertNotNull("the local catalog's line", find("Local test", 10_000))
                assertLocalMark("Home")
                shot("local-02-home")

                val tapped = SystemClock.elapsedRealtime()
                connect!!.click()
                // Consent: Tono's explanation, then Android's own dialog (granted already if a2 ran first).
                find(text(R.string.consent_continue), 5_000)?.let { it.click(); note("consent: Tono's explanation shown, Continue tapped") }
                if (device.wait(Until.hasObject(By.pkg("com.android.vpndialogs")), 5_000) == true) {
                    val ok = device.findObject(By.res("android:id/button1")) ?: device.findObject(By.pkg("com.android.vpndialogs").text(Pattern.compile("(?i)ok|确定")))
                    assertNotNull("system consent OK", ok)
                    ok!!.click()
                    note("consent: Android's VPN dialog answered OK")
                }
                val connected = find(text(R.string.state_connected), 90_000)
                val connectMs = SystemClock.elapsedRealtime() - tapped
                if (connected == null) diagnose("local-connect-failed")
                assertNotNull("Connected: both exit checks answered through the tunnel", connected)
                assertTrue("Android shows a VPN network", vpnUp())
                note("connect: tap → Connected in $connectMs ms (includes consent taps; emulator, software GPU)")
                Thread.sleep(2_000)
                shot("local-03-connected")

                // Routing classes, from inside the tunnel. CI matches these against the exits' logs.
                val requests = listOf(
                    "cloud" to "www.youtube.com",      // cloud video
                    "home" to "api.anthropic.com",     // AI → Home, through the cloud exit
                    "direct" to "example.com",         // everything else → the phone's own network
                )
                // The engine's own exit checks ran before Connected: the cloud probe and the Home probe.
                val lines = listOf("cloud www.cloudflare.com engine-probe", "home claude.ai engine-probe") +
                    requests.map { (kind, host) -> "$kind $host ${fetch("https://$host/")}" }
                File(out, "local-tunnel-requests.txt").writeText(lines.joinToString("\n") + "\n")
                lines.forEach { note("request: $it") }
                lines.forEach { assertFalse("request failed: $it", it.contains("ERROR")) }

                note("memory while connected (PSS): app ${pss(context.packageName)}, engine :vpn ${pss("${context.packageName}:vpn")}")

                device.findObject(By.text(text(R.string.details)))?.click()
                Thread.sleep(1_500)
                shot("local-04-details")
                device.pressBack()
                Thread.sleep(800)

                val disconnect = find(text(R.string.action_disconnect), 10_000)
                assertNotNull("Disconnect", disconnect)
                disconnect!!.click()
                assertNotNull("back to Not connected", find(text(R.string.state_idle), 20_000))
                val deadline = SystemClock.elapsedRealtime() + 10_000
                while (vpnUp() && SystemClock.elapsedRealtime() < deadline) Thread.sleep(250)
                assertFalse("the VPN network is gone after Disconnect", vpnUp())
                shot("local-05-disconnected")

                device.findObject(By.desc(text(R.string.settings_title))).click()
                // Settings slides in over 350 ms; until its title shows, the scrollable on screen is Home's.
                assertNotNull("Settings opened", find(text(R.string.settings_title), 10_000))
                Thread.sleep(600)
                // Sign out is at the bottom of Settings: scroll to it as a user would.
                val signOutText = By.text(text(R.string.settings_sign_out))
                var signOut = device.findObject(signOutText)
                repeat(6) {
                    if (signOut != null) return@repeat
                    device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4, device.displayWidth / 2, device.displayHeight / 4, 30)
                    signOut = device.wait(Until.findObject(signOutText), 1_500)
                }
                if (signOut == null) diagnose("local-sign-out-missing")
                assertNotNull("Sign out in Settings", signOut)
                signOut!!.click()
                assertNotNull("signed out", find(text(R.string.signin_title)))
                note("sign-out: back to the sign-in screen")
            }
        } finally {
            override.delete()
            stopEngineProcess()
        }
        assertFalse("no VPN left behind", vpnUp())
    }
}
