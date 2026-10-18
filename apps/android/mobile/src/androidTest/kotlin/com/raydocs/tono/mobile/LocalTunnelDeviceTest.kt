package com.raydocs.tono.mobile

import android.app.ActivityManager
import android.app.UiAutomation
import android.content.res.Configuration
import android.graphics.Rect
import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Process
import android.os.SystemClock
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import com.raydocs.tono.mobile.engine.LocalTestServer
import com.raydocs.tono.mobile.surface.PublicStatusStore
import com.raydocs.tono.mobile.surface.SurfaceRules
import com.raydocs.tono.mobile.surface.SurfaceState
import com.raydocs.tono.mobile.ui.MainActivity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.runner.Description
import org.junit.runners.model.Statement
import org.junit.Test
import org.junit.Assert.assertEquals
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
    // Compose semantics of the real MainActivity, for the text-size contract (t4); idle otherwise.
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
        killEngineProcess()
        Thread.sleep(800)
    }

    private fun killEngineProcess(): Int {
        val am = context.getSystemService(ActivityManager::class.java)
        val engines = am.runningAppProcesses.orEmpty().filter { it.processName == "${context.packageName}:vpn" }
        engines.forEach { Process.killProcess(it.pid) }
        return engines.size
    }

    private fun noticeTitles(): List<String> = context.getSystemService(NotificationManager::class.java).activeNotifications
        .mapNotNull { it.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() }

    /**
     * Fault injection: the engine's `:vpn` process dies with the tunnel up and the real MainActivity in
     * front, as when Android reclaims it. The tunnel dies with it. Samples Home, the status the Quick
     * Settings tile and widget read, and the notification, until the restarted engine reconnects.
     * Nothing may say Connected while Android has no VPN network (after a short grace for the screen to
     * redraw), Home must say "Status unknown" rather than keep its last word, and the restarted engine's
     * start-up placeholder (signed out) must never reach the screen.
     */
    private fun engineDeathWhileConnected() {
        val connected = text(R.string.state_connected)
        val unknown = text(R.string.surface_unknown)
        val signIn = text(R.string.signin_title)
        val graceMs = 1_500L
        val watched = Pattern.compile(listOf(connected, unknown, signIn).joinToString("|") { Pattern.quote(it) })
        assertTrue("an engine process to kill", killEngineProcess() > 0)
        val killed = SystemClock.elapsedRealtime()
        var vpnWentDown = -1L
        var connectedGone = -1L
        var unknownAt = -1L
        var reconnectedAt = -1L
        val lies = mutableListOf<String>()
        while (SystemClock.elapsedRealtime() - killed < 90_000) {
            val t = SystemClock.elapsedRealtime() - killed
            val vpn = vpnUp()
            // One query per sample: each UiAutomator lookup can wait for an idle UI, and the sea never idles.
            val seen = device.findObjects(By.text(watched)).mapNotNull { runCatching { it.text }.getOrNull() }.toSet()
            val shown = connected in seen
            val surface = SurfaceRules.view(PublicStatusStore.read(context), System.currentTimeMillis(), PublicStatusStore.boot(context), vpn).state
            val notice = noticeTitles()
            if (!vpn && vpnWentDown < 0) vpnWentDown = t
            if (!shown && connectedGone < 0) connectedGone = t
            if (unknownAt < 0 && unknown in seen) {
                unknownAt = t
                Captures.drawn(File(out, "local-04b-engine-lost.png"), attempts = 2)
            }
            if (signIn in seen) lies += "${t}ms sign-in screen shown"
            if (!vpn && surface == SurfaceState.CONNECTED) lies += "${t}ms tile/widget status CONNECTED without a VPN network"
            if (!vpn && t > graceMs && shown) lies += "${t}ms Home says Connected without a VPN network"
            if (!vpn && t > graceMs && connected in notice) lies += "${t}ms notification says Connected without a VPN network"
            // A fresh Connected: after the tunnel was seen gone and Home had stopped claiming it.
            if (shown && vpn && vpnWentDown >= 0 && connectedGone >= 0) { reconnectedAt = t; break }
            Thread.sleep(150)
        }
        note("engine killed: VPN network gone after ${vpnWentDown}ms, Home stopped saying Connected after ${connectedGone}ms, \"$unknown\" after ${unknownAt}ms, fresh Connected after ${reconnectedAt}ms")
        lies.take(20).forEach { note("engine killed: $it") }
        if (lies.isNotEmpty() || unknownAt < 0 || reconnectedAt < 0) diagnose("local-engine-lost")
        assertTrue("nothing claims a tunnel the engine's death took down: $lies", lies.isEmpty())
        assertTrue("Home said \"$unknown\" while the engine was gone", unknownAt >= 0)
        assertTrue("the restarted engine reconnected (the user still wants the tunnel)", reconnectedAt >= 0)
        Thread.sleep(1_500)
        shot("local-04c-reconnected")
    }

    /**
     * Back from the home screen: the first frame is the engine's current word, read before drawing,
     * so "Status unknown" never flashes and Connected is shown only with a VPN network.
     */
    private fun backFromHomeScreen() {
        device.pressHome()
        Thread.sleep(1_500)
        // As from Recents: the same activity instance comes back to the front (NEW_TASK | REORDER_TO_FRONT).
        val flags = Integer.toHexString(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        shell("am start -n ${context.packageName}/${MainActivity::class.java.name} -f 0x$flags")
        val back = SystemClock.elapsedRealtime()
        var unknownSeen = false
        var shownAt = -1L
        while (SystemClock.elapsedRealtime() - back < 10_000) {
            if (device.hasObject(By.text(text(R.string.surface_unknown)))) unknownSeen = true
            if (device.hasObject(By.text(text(R.string.state_connected)))) { shownAt = SystemClock.elapsedRealtime() - back; break }
            Thread.sleep(100)
        }
        note("back from the home screen: Connected after ${shownAt}ms, \"Status unknown\" ${if (unknownSeen) "SEEN" else "not seen"}")
        if (shownAt < 0 || unknownSeen) diagnose("local-back-from-home")
        assertTrue("Connected again after returning", shownAt >= 0)
        assertTrue("the VPN network is up", vpnUp())
        assertFalse("no \"Status unknown\" on return: the snapshot is read before the first frame", unknownSeen)
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

    private fun shell(command: String): String = instrumentation.uiAutomation.executeShellCommand(command).let {
        android.os.ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().readText()
    }

    private fun pss(process: String): String {
        val text = instrumentation.uiAutomation.executeShellCommand("dumpsys meminfo $process").let {
            android.os.ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().readText()
        }
        return Regex("TOTAL PSS:\\s+(\\d+)").find(text)?.groupValues?.get(1)?.let { "${it.toLong() / 1024} MB" } ?: "n/a"
    }

    /** E-mail step to code step on the shipped sign-in screen. */
    private fun requestCode() {
        device.findObject(By.clazz("android.widget.EditText")).text = "tester@local.test"
        device.findObject(By.text(text(R.string.signin_send))).click()
        assertNotNull("code step", find(text(R.string.signin_code)))
        // The e-mail field fades out over 220 ms; wait until the code field is the only one.
        val deadline = SystemClock.elapsedRealtime() + 5_000
        while (device.findObjects(By.clazz("android.widget.EditText")).size != 1 && SystemClock.elapsedRealtime() < deadline) Thread.sleep(100)
    }

    /** Android's own VPN consent dialog, answered OK. */
    private fun answerSystemConsent() {
        if (device.wait(Until.hasObject(By.pkg("com.android.vpndialogs")), 10_000) != true) ForeignAnr.dismiss(device, out)
        assertTrue("Android's VPN consent dialog", device.wait(Until.hasObject(By.pkg("com.android.vpndialogs")), 10_000) == true)
        ForeignAnr.dismiss(device, out)
        val ok = device.findObject(By.res("android:id/button1")) ?: device.findObject(By.pkg("com.android.vpndialogs").text(Pattern.compile("(?i)ok|确定")))
        assertNotNull("system consent OK", ok)
        ok!!.click()
        note("consent: Android's VPN dialog answered OK")
        answerNotificationPrompt()
    }

    /**
     * Tono asks for notifications right after VPN consent (so the two system dialogs never stack). On a
     * fresh emulator Android's prompt then covers the app; answer Allow, as the status notification
     * is part of what these tests check.
     */
    private fun answerNotificationPrompt() {
        val prompt = By.pkg(Pattern.compile("com\\.(google\\.)?android\\.permissioncontroller"))
        if (device.wait(Until.hasObject(prompt), 5_000) != true) return
        val allow = device.findObject(By.res(Pattern.compile(".*:id/permission_allow_button")))
        assertNotNull("Allow on Android's notification prompt", allow)
        allow!!.click()
        device.wait(Until.gone(prompt), 5_000)
        note("notifications: Android's prompt answered Allow")
    }

    /** Sign out is at the bottom of Settings: scroll to it as a user would. Leaves the next test signed out. */
    private fun signOut() {
        device.findObject(By.desc(text(R.string.settings_title))).click()
        // Settings slides in over 350 ms; until its title shows, the scrollable on screen is Home's.
        assertNotNull("Settings opened", find(text(R.string.settings_title), 10_000))
        Thread.sleep(600)
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

    /** Points the engine at the local fixture control plane and withdraws VPN consent, so the real consent flow runs. */
    private fun useLocalServers() {
        assertTrue("local fixture control plane on 127.0.0.1:28080 (CI starts scripts/local-tunnel/fixture-servers.py and runs adb reverse)", reachable("127.0.0.1", 28080))
        stopEngineProcess()
        override.parentFile?.mkdirs()
        override.writeText("http://127.0.0.1:28080/api/v1/")
        // Android keeps VPN consent as an app op; withdrawing it is what Settings › VPN › forget does.
        shell("appops set ${context.packageName} ACTIVATE_VPN ignore")
    }

    @Test fun t1_realTunnelThroughLocalFixtureServers() {
        useLocalServers()
        stillScene(true)
        try {
            ActivityScenario.launch(MainActivity::class.java).use {
                startSignedOut()
                assertLocalMark("sign-in")
                shot("local-01-signin")

                requestCode()
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
                // Consent was withdrawn above: Tono's explanation first, then Android's own dialog.
                val explained = find(text(R.string.consent_continue), 10_000)
                if (explained == null) diagnose("local-consent-sheet-missing")
                assertNotNull("Tono's explanation before Android's VPN dialog", explained)
                shot("local-02b-consent")
                explained!!.click()
                note("consent: Tono's explanation shown, Continue tapped")
                answerSystemConsent()
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

                device.findObject(By.text(text(R.string.details))).click()
                // The sheet is its own window; on the software-GPU emulator it can take a few
                // seconds to draw, so wait for its content before the screenshot.
                val details = find(text(R.string.lane_video), 15_000)
                if (details == null) diagnose("local-details-missing")
                assertNotNull("Details opened while connected", details)
                shot("local-04-details")
                device.pressBack()
                Thread.sleep(800)

                engineDeathWhileConnected()
                backFromHomeScreen()

                val disconnect = find(text(R.string.action_disconnect), 10_000)
                assertNotNull("Disconnect", disconnect)
                disconnect!!.click()
                assertNotNull("back to Not connected", find(text(R.string.state_idle), 20_000))
                val deadline = SystemClock.elapsedRealtime() + 10_000
                while (vpnUp() && SystemClock.elapsedRealtime() < deadline) Thread.sleep(250)
                assertFalse("the VPN network is gone after Disconnect", vpnUp())
                shot("local-05-disconnected")

                signOut()
            }
        } finally {
            stillScene(false)
            override.delete()
            stopEngineProcess()
        }
        assertFalse("no VPN left behind", vpnUp())
    }

    /**
     * Runs [block] on the main thread with the resumed activity, if any. Not ActivityScenario.onActivity:
     * that first waits for the main thread to go idle, which a slow software-GPU emulator drawing the
     * animated sea never does (run 39153105611: t2 hung there for 600 s).
     */
    private fun onResumed(block: (android.app.Activity) -> Unit) {
        instrumentation.runOnMainSync {
            androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).firstOrNull()?.let(block)
        }
    }

    /** Debug runs share the emulator: a test stopped mid-way can leave an account behind. Start signed out. */
    private fun startSignedOut() {
        val signIn = find(text(R.string.signin_title), 20_000)
        if (signIn != null) return
        if (find(text(R.string.details), 5_000) != null) { note("signed in from an earlier run: signing out first"); signOut() }
        assertNotNull("sign-in screen", find(text(R.string.signin_title), 10_000))
    }

    /**
     * Android's "Remove animations": the sea holds still, so a software-GPU emulator is not drawing a
     * new frame all the time. For checks that are not about motion (t3 keeps animations on).
     */
    private fun stillScene(on: Boolean) {
        shell("settings put global animator_duration_scale ${if (on) 0 else 1}")
        if (on) Thread.sleep(1_000)
    }

    private fun rotate(rotation: Int, landscape: Boolean, scenario: ActivityScenario<MainActivity>): Boolean {
        instrumentation.uiAutomation.setRotation(rotation)
        val deadline = SystemClock.elapsedRealtime() + 15_000
        while (SystemClock.elapsedRealtime() < deadline) {
            var now: Int? = null
            onResumed { now = it.resources.configuration.orientation }
            if ((now == Configuration.ORIENTATION_LANDSCAPE) == landscape && now != null) { Thread.sleep(1_200); return true }
            Thread.sleep(250)
        }
        return false
    }

    private fun insets(scenario: ActivityScenario<MainActivity>): WindowInsetsCompat? {
        var found: WindowInsetsCompat? = null
        onResumed { a -> found = ViewCompat.getRootWindowInsets(a.window.decorView) }
        return found
    }

    /** Text and controls on screen that overlap the display cutout (camera), as found. */
    private fun underCutout(scenario: ActivityScenario<MainActivity>): List<String> {
        val cutouts = mutableListOf<Rect>()
        onResumed { a -> a.window.decorView.rootWindowInsets?.displayCutout?.boundingRects?.let { cutouts += it } }
        val hits = mutableListOf<String>()
        for (o in device.findObjects(By.pkg(context.packageName))) {
            val label = runCatching { o.text ?: o.contentDescription }.getOrNull() ?: continue
            // The local-server mark's screen-reader line spans the window's width on purpose.
            if (label.isBlank() || label == text(R.string.local_test_server)) continue
            val r = runCatching { o.visibleBounds }.getOrNull() ?: continue
            // A sheet's scrim ("Close sheet") is a dismiss area covering the whole window by design.
            if (r.width() >= device.displayWidth && r.height() >= device.displayHeight) continue
            if (cutouts.any { Rect.intersects(it, r) }) hits += "\"$label\" $r"
        }
        return hits
    }

    /**
     * The real app (MainActivity, not a test host) on a phone turned between portrait and landscape,
     * against the local stand-in servers: the code step with the on-screen keyboard up, Home and
     * Details in landscape clear of the camera cutout, and Tono's consent explanation surviving a turn.
     * No tunnel is brought up here; t1 does that.
     */
    @Test fun t2_realAppTurnsWithKeyboardAndConsentOpen() {
        useLocalServers()
        // The CI image has a hardware keyboard configured; show the on-screen one anyway, as on a phone.
        val imeSetting = shell("settings get secure show_ime_with_hard_keyboard").trim()
        shell("settings put secure show_ime_with_hard_keyboard 1")
        stillScene(true)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            startSignedOut()
            requestCode()
            val field = device.findObject(By.clazz("android.widget.EditText"))
            field.click()
            field.text = "246"
            val imeDeadline = SystemClock.elapsedRealtime() + 10_000
            while (insets(scenario)?.isVisible(WindowInsetsCompat.Type.ime()) != true && SystemClock.elapsedRealtime() < imeDeadline) Thread.sleep(250)
            note("landscape: keyboard up in portrait before turning: ${insets(scenario)?.isVisible(WindowInsetsCompat.Type.ime())}")

            val turned = rotate(UiAutomation.ROTATION_FREEZE_90, landscape = true, scenario)
            if (!turned) diagnose("local-landscape-not-turned")
            assertTrue("the real app turned to landscape", turned)
            assertNotNull("still on the code step after turning", find(text(R.string.signin_code), 10_000))
            val code = device.findObject(By.clazz("android.widget.EditText"))
            assertNotNull("code field after turning", code)
            note("landscape: code field after turning holds \"${code.text}\"")
            assertTrue("the digits typed before turning are kept", code.text?.contains("246") == true)
            // With the keyboard up, the field the user is typing in stays above it.
            code.click()
            val deadline = SystemClock.elapsedRealtime() + 10_000
            while (insets(scenario)?.isVisible(WindowInsetsCompat.Type.ime()) != true && SystemClock.elapsedRealtime() < deadline) Thread.sleep(250)
            val ime = insets(scenario)?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0
            val imeUp = insets(scenario)?.isVisible(WindowInsetsCompat.Type.ime()) == true
            Thread.sleep(800)
            val bounds = device.findObject(By.clazz("android.widget.EditText")).visibleBounds
            val keyboardTop = device.displayHeight - ime
            note("landscape: keyboard ${if (imeUp) "up, ${ime}px" else "NOT up"}; code field $bounds, keyboard top at ${keyboardTop}px")
            shot("local-06-landscape-code-keyboard")
            assertTrue("the on-screen keyboard is up in landscape", imeUp)
            assertTrue("the code field is fully above the keyboard: $bounds vs $keyboardTop", bounds.height() > 0 && bounds.bottom <= keyboardTop)

            device.findObject(By.clazz("android.widget.EditText")).text = "246810"
            val connect = find(text(R.string.action_connect), 30_000)
            if (connect == null) diagnose("local-landscape-signin-failed")
            assertNotNull("signed in, Home in landscape", connect)
            assertLocalMark("landscape Home")
            val homeCutout = underCutout(scenario)
            note("landscape Home: under the camera cutout: ${homeCutout.ifEmpty { listOf("nothing") }}")
            shot("local-07-landscape-home")
            assertTrue("nothing on landscape Home is under the cutout: $homeCutout", homeCutout.isEmpty())

            device.findObject(By.text(text(R.string.details))).click()
            assertNotNull("Details in landscape", find(text(R.string.details_routes), 15_000))
            val detailsCutout = underCutout(scenario)
            note("landscape Details: under the camera cutout: ${detailsCutout.ifEmpty { listOf("nothing") }}")
            shot("local-07b-landscape-details")
            assertTrue("nothing on landscape Details is under the cutout: $detailsCutout", detailsCutout.isEmpty())
            device.pressBack()
            Thread.sleep(800)

            // Consent was withdrawn: Connect shows Tono's explanation first. Turning the phone keeps it.
            find(text(R.string.action_connect), 10_000)!!.click()
            assertNotNull("Tono's consent explanation", find(text(R.string.consent_continue), 10_000))
            shot("local-08-landscape-consent")
            val back = rotate(UiAutomation.ROTATION_FREEZE_0, landscape = false, scenario)
            assertTrue("turned back to portrait", back)
            val kept = find(text(R.string.consent_continue), 10_000)
            if (kept == null) diagnose("local-consent-lost-on-turn")
            note("consent explanation after turning back to portrait: ${if (kept != null) "still open" else "LOST"}")
            assertNotNull("the consent explanation survives turning the phone", kept)
            shot("local-09-portrait-consent-kept")
            device.pressBack()
            assertNotNull("dismissed: Home with Connect", find(text(R.string.action_connect), 10_000))
            assertFalse("no tunnel without consent", vpnUp())
            signOut()
        } finally {
            instrumentation.uiAutomation.setRotation(UiAutomation.ROTATION_FREEZE_0)
            instrumentation.uiAutomation.setRotation(UiAutomation.ROTATION_UNFREEZE)
            shell("settings put secure show_ime_with_hard_keyboard ${imeSetting.toIntOrNull() ?: 0}")
            stillScene(false)
            scenario.close()
            override.delete()
            stopEngineProcess()
        }
    }

    /**
     * Switches the stand-in control plane's scenario (scripts/local-tunnel/fixture-servers.py). Over a
     * plain socket, as the debug build's ControlPlane reaches the local test server: the app's network
     * security config allows no cleartext HTTP, and this test runs in the app's process.
     */
    private fun scenario(name: String) {
        val body = "{\"name\":\"$name\"}"
        val status = Socket().use { socket ->
            socket.connect(InetSocketAddress("127.0.0.1", 28080), 5_000)
            socket.soTimeout = 10_000
            socket.getOutputStream().write(
                ("POST /fixture/scenario HTTP/1.1\r\nHost: 127.0.0.1:28080\r\nContent-Type: application/json\r\n" +
                    "Content-Length: ${body.toByteArray().size}\r\nConnection: close\r\n\r\n$body").toByteArray(),
            )
            socket.getInputStream().bufferedReader().readLine().orEmpty()
        }
        assertTrue("stand-in scenario $name: $status", status.startsWith("HTTP/1.") && status.split(' ').getOrNull(1) == "200")
        note("stand-in scenario: $name")
    }

    /** Mean luminance (0–255) of the sky: 8–45 % of the screen height, below the status bar. */
    private fun sky(name: String): Double {
        val b = android.graphics.BitmapFactory.decodeFile(File(out, "$name.png").path)
        var sum = 0.0; var n = 0
        for (y in (b.height * 0.08).toInt() until (b.height * 0.45).toInt() step 6) for (x in 0 until b.width step 6) {
            val p = b.getPixel(x, y)
            sum += 0.2126 * android.graphics.Color.red(p) + 0.7152 * android.graphics.Color.green(p) + 0.0722 * android.graphics.Color.blue(p); n++
        }
        return sum / n
    }

    private fun signInWithCode() {
        startSignedOut()
        requestCode()
        device.findObject(By.clazz("android.widget.EditText")).text = "246810"
        val connect = find(text(R.string.action_connect), 30_000)
        if (connect == null) diagnose("local-signin-failed")
        assertNotNull("signed in: Home with Connect", connect)
    }

    private fun tapConnectAndConsent() {
        find(text(R.string.action_connect), 10_000)!!.click()
        // Tono's explanation and Android's dialog appear while consent is missing; once granted, neither does.
        find(text(R.string.consent_continue), 4_000)?.let { it.click(); answerSystemConsent() }
    }

    private fun disconnectToIdle() {
        val disconnect = find(text(R.string.action_disconnect), 10_000)
        assertNotNull("Disconnect", disconnect)
        disconnect!!.click()
        assertNotNull("back to Not connected", find(text(R.string.state_idle), 20_000))
        val deadline = SystemClock.elapsedRealtime() + 10_000
        while (vpnUp() && SystemClock.elapsedRealtime() < deadline) Thread.sleep(250)
    }

    /**
     * The real app's states on MainActivity, against the stand-ins (counterpart of the fixture-host
     * b1, and with CI's screen recording of the b2 motion): Not connected, connecting, Connected,
     * partly working (the Home stand-in rejects the Home exit's password) and failed (the stand-in
     * control plane answers CATALOG_UNAVAILABLE). Each is asserted from the screen, and the sky must
     * follow the state: day when connected, darker when partly working or failed, night when off.
     */
    @Test fun t3_realAppStatesAndSkyOnMainActivity() {
        useLocalServers()
        scenario("normal")
        // Launched still (waiting for the launch needs an idle main thread), then with motion on.
        stillScene(true)
        val scenarioApp = ActivityScenario.launch(MainActivity::class.java)
        stillScene(false)
        try {
            signInWithCode()
            Thread.sleep(2_600)
            shot("local-10-real-idle")

            tapConnectAndConsent()
            val busy = device.wait(Until.findObject(By.text(Pattern.compile(Pattern.quote(text(R.string.state_preparing)) + "|" + Pattern.quote(text(R.string.state_connecting))))), 10_000)
            if (busy != null) Captures.drawn(File(out, "local-11-real-connecting.png"), attempts = 2)
            note("real states: ${if (busy != null) "\"${busy.text}\" seen while connecting" else "connecting NOT seen"}")
            assertNotNull("a connecting state on screen before Connected", busy)
            assertNotNull("Connected", find(text(R.string.state_connected), 90_000))
            assertTrue("Android shows a VPN network", vpnUp())
            Thread.sleep(2_600)
            shot("local-12-real-connected")
            disconnectToIdle()

            scenario("home-down")
            tapConnectAndConsent()
            val partly = find(text(R.string.state_degraded), 90_000)
            if (partly == null) diagnose("local-partly-working-missing")
            assertNotNull("partly working when the Home exit fails its check", partly)
            assertNotNull("the short reason names the Home check", find(text(R.string.short_HOME_UNREACHABLE), 5_000))
            assertTrue("the tunnel stays up for everything else", vpnUp())
            Thread.sleep(2_600)
            shot("local-13-real-partly-working")
            disconnectToIdle()

            scenario("catalog-unavailable")
            tapConnectAndConsent()
            val failed = find(text(R.string.state_failed), 60_000)
            if (failed == null) diagnose("local-failed-missing")
            assertNotNull("failed when the catalog is unavailable", failed)
            assertFalse("a failed connect leaves the phone's network untouched", vpnUp())
            assertNotNull("Retry is the primary action", find(text(R.string.action_retry), 5_000))
            Thread.sleep(2_600)
            shot("local-14-real-failed")
            scenario("normal")

            val idle = sky("local-10-real-idle"); val connected = sky("local-12-real-connected")
            val partlySky = sky("local-13-real-partly-working"); val failedSky = sky("local-14-real-failed")
            note("sky luminance (0–255): not connected %.1f, connected %.1f, partly working %.1f, failed %.1f".format(idle, connected, partlySky, failedSky))
            assertTrue("day sky when connected: %.1f vs night %.1f".format(connected, idle), connected > idle + 30)
            assertTrue("partly working is lit but below connected: %.1f".format(partlySky), partlySky > idle + 15 && partlySky < connected - 5)
            assertTrue("failed keeps an ember, below connected: %.1f".format(failedSky), failedSky > idle + 8 && failedSky < connected - 10)

            signOut()
        } finally {
            runCatching { scenario("normal") }
            scenarioApp.close()
            override.delete()
            stopEngineProcess()
        }
        assertFalse("no VPN left behind", vpnUp())
    }

    /**
     * The real MainActivity at Android's largest text size (200 %) with animations removed, against
     * the stand-ins (counterpart of the fixture-host b3/l1): sign-in, the code step, Home, Details and
     * Settings keep every text uncut and every control at 48 dp with a label.
     *
     * The Compose test rule is applied only around this test and the test drives the app through it:
     * under the rule, the app's composition advances only when the rule synchronises, so the
     * UiAutomator-driven tests above must not run under it (run 39159687608: the screen stayed on its
     * first frame and the sign-in screen never appeared).
     */
    @Test fun t4_realAppAtLargestSystemText() {
        useLocalServers()
        shell("settings put system font_scale 2.0")
        shell("settings put global animator_duration_scale 0")
        Thread.sleep(1_500)
        val rule = createEmptyComposeRule()
        try {
            rule.apply(object : Statement() {
                override fun evaluate() = largestText(rule)
            }, Description.createTestDescription(javaClass, "t4_realAppAtLargestSystemText")).evaluate()
        } finally {
            shell("settings put system font_scale 1.0")
            shell("settings put global animator_duration_scale 1")
            override.delete()
            stopEngineProcess()
        }
    }

    private fun largestText(compose: ComposeTestRule) {
        val found = mutableListOf<String>()
        fun shown(t: String) = compose.onAllNodes(hasText(t)).fetchSemanticsNodes().isNotEmpty()
        fun await(what: String, t: String, timeoutMs: Long) {
            runCatching { compose.waitUntil(timeoutMs) { shown(t) } }.onFailure { diagnose("local-t4-${what.replace(' ', '-')}-missing") }
            assertTrue(what, shown(t))
        }
        // Brought on screen first where a screen scrolls; not every one does.
        fun tap(node: SemanticsNodeInteraction) { runCatching { node.performScrollTo() }; node.performClick() }
        fun check(screen: String) {
            compose.waitForIdle()
            found += A11yContract.truncatedText(compose, "real 200 % $screen") + A11yContract.violations(compose, "real 200 % $screen")
        }
        fun signOutHere() {
            compose.onNodeWithContentDescription(text(R.string.settings_title)).performClick()
            await("Settings", text(R.string.settings_title), 10_000)
            tap(compose.onNodeWithText(text(R.string.settings_sign_out)))
            await("signed out", text(R.string.signin_title), 20_000)
        }
        ActivityScenario.launch(MainActivity::class.java).use {
            runCatching { compose.waitUntil(20_000) { shown(text(R.string.signin_title)) || shown(text(R.string.details)) } }
            if (!shown(text(R.string.signin_title)) && shown(text(R.string.details))) { note("t4: signed in from an earlier run: signing out first"); signOutHere() }
            await("sign-in screen", text(R.string.signin_title), 10_000)
            check("sign-in"); shot("local-15-real-font-2.0-signin")

            compose.onNode(hasSetTextAction()).performTextReplacement("tester@local.test")
            tap(compose.onNodeWithText(text(R.string.signin_send)))
            await("code step", text(R.string.signin_code), 20_000)
            compose.waitUntil(5_000) { compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size == 1 }
            check("code step")
            compose.onNode(hasSetTextAction()).performTextReplacement("246810")
            await("Home", text(R.string.action_connect), 30_000)
            check("Home"); shot("local-16-real-font-2.0-home")

            tap(compose.onNodeWithText(text(R.string.details)))
            await("Details", text(R.string.details_routes), 15_000)
            check("Details"); shot("local-17-real-font-2.0-details")
            device.pressBack()
            compose.waitUntil(10_000) { !shown(text(R.string.details_routes)) }

            compose.onNodeWithContentDescription(text(R.string.settings_title)).performClick()
            await("Settings", text(R.string.settings_title), 10_000)
            check("Settings"); shot("local-18-real-font-2.0-settings")
            device.pressBack()
            compose.waitForIdle()

            File(out, "real-font-2.0-report.txt").writeText(
                if (found.isEmpty()) "real MainActivity at font scale 2.0: no text cut off, every control ≥ 48 dp and labelled on sign-in, the code step, Home, Details and Settings\n"
                else found.joinToString("\n") + "\n",
            )
            assertEquals(found.joinToString("\n"), 0, found.size)
            signOutHere()
        }
    }
}
