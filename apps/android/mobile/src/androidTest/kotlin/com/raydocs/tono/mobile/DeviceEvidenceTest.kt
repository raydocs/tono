package com.raydocs.tono.mobile

import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.VpnService
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.ExitProbe
import com.raydocs.tono.mobile.engine.HomeKind
import com.raydocs.tono.mobile.engine.NodeView
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.ProbeState
import com.raydocs.tono.mobile.engine.TonoVpnService
import com.raydocs.tono.mobile.ui.LocalReduceMotion
import com.raydocs.tono.mobile.ui.MainActivity
import com.raydocs.tono.mobile.ui.TonoActions
import com.raydocs.tono.mobile.ui.TonoRoot
import com.raydocs.tono.mobile.ui.TonoTheme
import com.raydocs.tono.mobile.ui.rememberSystemReduceMotion
import com.raydocs.tono.routing.ConfigInput
import com.raydocs.tono.routing.Fixtures
import com.raydocs.tono.routing.RoutingMode
import com.raydocs.tono.routing.SingBoxConfig
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.SetupOptions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters
import java.io.File
import java.util.regex.Pattern

/**
 * Evidence on a real Android system (emulator in CI). Two kinds, never mixed:
 *  - `aN_real*`: the shipped app and the real OS — sign-in screen, the system VPN consent dialog,
 *    the real engine started without an account, the real sing-box core on this ABI.
 *  - `bN_fixture*`: the real UI composables rendered by the device GPU from fixture snapshots
 *    (no tunnel exists); files are prefixed `fixture-`.
 * Screenshots go to the app's external files dir `evidence/`, pulled by CI.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class DeviceEvidenceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val out = File(context.getExternalFilesDir(null), "evidence").apply { mkdirs() }

    init {
        // The scene animates continuously, so the UI is never "idle"; UiAutomator's default 10 s idle
        // wait before every lookup would otherwise dominate the run.
        Configurator.getInstance().waitForIdleTimeout = 300
    }

    private fun dismissForeignAnr() = ForeignAnr.dismiss(device, out)

    private fun find(selector: androidx.test.uiautomator.BySelector, timeoutMs: Long) =
        device.wait(Until.findObject(selector), timeoutMs) ?: run { dismissForeignAnr(); device.wait(Until.findObject(selector), timeoutMs) }

    private fun shot(name: String) {
        dismissForeignAnr()
        Thread.sleep(400)
        // The emulator's screen capture now and then returns nothing once (logged as
        // "takeScreenshot() returned null"); try again, but a screenshot is still required.
        val saved = (1..5).any { attempt -> device.takeScreenshot(File(out, "$name.png")).also { if (!it && attempt < 5) Thread.sleep(1_000) } }
        assertTrue("screenshot $name", saved)
        if (name.startsWith("fixture-")) assertTrue("$name shows the FIXTURE mark", Captures.fixtureMarked(File(out, "$name.png")))
    }

    private fun text(id: Int) = context.getString(id)

    @Test fun a1_realSignInScreenAndLocalValidation() {
        ActivityScenario.launch(MainActivity::class.java).use {
            assertNotNull("sign-in screen", find(By.text(text(R.string.signin_title)), 20_000))
            shot("real-01-signin")
            // Client-side validation only: nothing is sent to the Tono API from CI.
            device.findObject(By.clazz("android.widget.EditText")).text = "not-an-email"
            device.findObject(By.text(text(R.string.signin_send))).click()
            assertNotNull(find(By.text(text(R.string.signin_error_INVALID_EMAIL)), 10_000))
            shot("real-02-signin-invalid-email")
        }
    }

    /**
     * Runs [block] on the main thread with the resumed activity. Not ActivityScenario.onActivity: that
     * first waits for the main thread to go idle, which never happens under the animated sea on a slow
     * software-GPU emulator (a3 hung there for 600 s in run 39159687608, a2 and a3 in run 39138009249).
     */
    private fun onResumed(block: (android.app.Activity) -> Unit) {
        var ran = false
        instrumentation.runOnMainSync {
            androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).firstOrNull()?.let { block(it); ran = true }
        }
        assertTrue("a resumed activity", ran)
    }

    @Test fun a2_realSystemVpnConsentDialog() {
        val prepare = VpnService.prepare(context)
        assertNotNull("fresh install must need consent", prepare)
        // Started for a result from the app's own foreground activity, exactly as its Connect does:
        // the system dialog needs a calling package and Android blocks background activity starts.
        ActivityScenario.launch(MainActivity::class.java).use {
            assertNotNull(find(By.text(text(R.string.signin_title)), 20_000))
            @Suppress("DEPRECATION") onResumed { it.startActivityForResult(prepare, 1) }
            consentDialog()
        }
    }

    private fun consentDialog() {
        val appeared = device.wait(Until.hasObject(By.pkg("com.android.vpndialogs")), 30_000) == true
        if (!appeared) diagnose("real-03-consent-missing")
        assertTrue("system VPN consent dialog", appeared)
        shot("real-03-system-vpn-consent")
        val ok = device.findObject(By.res("android:id/button1"))
            ?: device.findObject(By.pkg("com.android.vpndialogs").text(Pattern.compile("(?i)ok|确定")))
        if (ok == null) diagnose("real-03-consent-no-ok")
        assertNotNull("consent OK button", ok)
        ok!!.click()
        // The system records consent asynchronously after the dialog closes.
        val deadline = System.currentTimeMillis() + 10_000
        while (VpnService.prepare(context) != null && System.currentTimeMillis() < deadline) Thread.sleep(250)
        assertNull("consent recorded by Android", VpnService.prepare(context))
        shot("real-04-after-consent")
    }

    /** Failure evidence: what was actually on screen and in the window hierarchy. */
    private fun diagnose(name: String) {
        device.takeScreenshot(File(out, "$name.png"))
        File(out, "$name.xml").outputStream().use { device.dumpWindowHierarchy(it) }
    }

    @Test fun a3_realEngineRefusesToConnectWithoutAccount() {
        // With consent granted but no Tono account, the real engine must not pretend to connect.
        // Sent from the foreground activity, so Android's background service-start limits do not apply.
        ActivityScenario.launch(MainActivity::class.java).use {
            assertNotNull(find(By.text(text(R.string.signin_title)), 20_000))
            onResumed { it.startForegroundService(Intent(it, TonoVpnService::class.java).setAction(TonoVpnService.ACTION_CONNECT)) }
            Thread.sleep(4_000)
            val services = instrumentation.uiAutomation.executeShellCommand("dumpsys activity services ${context.packageName}")
            File(out, "real-05-services.txt").writeText(android.os.ParcelFileDescriptor.AutoCloseInputStream(services).bufferedReader().readText())
            val cm = context.getSystemService(ConnectivityManager::class.java)
            val vpnUp = cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
            assertFalse("no tunnel may exist without an account", vpnUp)
            assertNotNull(find(By.text(text(R.string.signin_title)), 10_000))
            shot("real-05-connect-without-account-stays-signed-out")
        }
    }

    @Test fun a4_realCoreOnThisAbiAcceptsTheGeneratedConfig() {
        val work = File(context.cacheDir, "box-check").apply { mkdirs() }
        Libbox.setup(SetupOptions().apply { basePath = work.path; workingPath = work.path; tempPath = work.path })
        assertEquals(BuildConfig.SING_BOX_VERSION, Libbox.version())
        for (mode in RoutingMode.entries) {
            val config = SingBoxConfig.buildJson(ConfigInput(Fixtures.catalog(), null, mode, true, File(work, "cache.db").path))
            Libbox.checkConfig(config) // throws on rejection
        }
        File(out, "real-core.txt").writeText("libbox ${Libbox.version()} go ${Libbox.goVersion()} abi ${android.os.Build.SUPPORTED_ABIS.first()} checkConfig OK for ${RoutingMode.entries}\n")
    }

    /**
     * The shipped app follows Android's "Remove animations" (animator duration scale 0) live, with no
     * restart: the night sky's twinkling stars and drifting reflection move at scale 1 and are
     * pixel-identical frames at scale 0. Compared between the status bar and the sign-in card (no
     * clock, cursor or keyboard).
     */
    @Test fun a5_realAppHonoursRemoveAnimations() {
        val shell = instrumentation.uiAutomation
        fun scale(v: String) { shell.executeShellCommand("settings put global animator_duration_scale $v").close() }
        fun diff(a: Bitmap, b: Bitmap): Double {
            val top = (a.height * 0.08).toInt()
            val h = (a.height * 0.62).toInt() // sky and reflection, above the sign-in card
            val pa = IntArray(a.width * h).also { a.getPixels(it, 0, a.width, 0, top, a.width, h) }
            val pb = IntArray(b.width * h).also { b.getPixels(it, 0, b.width, 0, top, b.width, h) }
            return pa.indices.count { pa[it] != pb[it] }.toDouble() / pa.size
        }
        fun frames(gapMs: Long): Pair<Bitmap, Bitmap> {
            dismissForeignAnr()
            val a = shell.takeScreenshot()
            Thread.sleep(gapMs)
            return a to shell.takeScreenshot()
        }
        // Launched still: waiting for the activity to start needs an idle main thread, which the
        // animated sea on a slow software-GPU emulator does not give (run 39163947970: 9 minutes).
        scale("0")
        try {
            ActivityScenario.launch(MainActivity::class.java).use {
                assertNotNull("sign-in screen", find(By.text(text(R.string.signin_title)), 20_000))
                // Each change shows from the next frame drawn after it; at 750–1200 ms a frame (run
                // 39202302351, first system attempt) 1.5 s was about one frame, and the still pair
                // caught the scene's last moving frame (0.23 % changed). A fixed 4 s, not a retry.
                val settle = 4_000L
                scale("1") // motion on while the app is running
                Thread.sleep(settle)
                val (m1, m2) = frames(1_500)
                val moving = diff(m1, m2)
                scale("0") // while the app is running
                Thread.sleep(settle)
                val (s1, s2) = frames(1_500)
                val still = diff(s1, s2)
                scale("1") // and back, still without a restart
                Thread.sleep(settle)
                val (r1, r2) = frames(1_500)
                val resumed = diff(r1, r2)
                File(out, "real-06-motion.png").outputStream().use { m1.compress(Bitmap.CompressFormat.PNG, 100, it) }
                File(out, "real-07-remove-animations.png").outputStream().use { s2.compress(Bitmap.CompressFormat.PNG, 100, it) }
                File(out, "real-motion.txt").writeText(
                    "scene pixels changed over 1.5 s (animator_duration_scale): 1 → %.4f %%, 0 → %.4f %%, back to 1 → %.4f %%\n"
                        .format(moving * 100, still * 100, resumed * 100),
                )
                assertTrue("ambient motion at scale 1 ($moving)", moving > 0.0001)
                assertEquals("no motion with animations removed", 0.0, still, 0.0)
                assertTrue("motion resumes at scale 1 ($resumed)", resumed > 0.0001)
                holdStillBeforeClose()
            }
        } finally {
            scale("1")
        }
    }

    /**
     * Tono is a night-sky app by design (a fixed dark theme, a decision rather than a missing light
     * one): Android's light theme must not turn it into a half-light one.
     */
    @Test fun a6_realAppUnderSystemLightAndDarkTheme() {
        val shell = instrumentation.uiAutomation
        fun night(v: String) { shell.executeShellCommand("cmd uimode night $v").close(); Thread.sleep(1_500) }
        try {
            for ((mode, name) in listOf("no" to "real-11-system-light-theme", "yes" to "real-12-system-dark-theme")) {
                night(mode)
                ActivityScenario.launch(MainActivity::class.java).use {
                    assertNotNull("sign-in under night=$mode", find(By.text(text(R.string.signin_title)), 20_000))
                    Thread.sleep(1_000)
                    shot(name)
                }
            }
        } finally {
            night("no") // the emulator's default
        }
        // The assertion, not just the pictures: both screens stay night-dark and look alike.
        fun luminance(name: String): Double {
            val b = android.graphics.BitmapFactory.decodeFile(File(out, "$name.png").path)
            var sum = 0.0; var n = 0
            for (y in (b.height * 0.08).toInt() until b.height step 8) for (x in 0 until b.width step 8) {
                val p = b.getPixel(x, y)
                sum += 0.2126 * android.graphics.Color.red(p) + 0.7152 * android.graphics.Color.green(p) + 0.0722 * android.graphics.Color.blue(p); n++
            }
            return sum / n
        }
        val light = luminance("real-11-system-light-theme")
        val dark = luminance("real-12-system-dark-theme")
        File(out, "theme-report.txt").writeText("mean luminance below the status bar (0–255): system light theme %.1f, system dark theme %.1f\n".format(light, dark))
        assertTrue("under Android's light theme Tono stays a night scene: %.1f".format(light), light < 70)
        assertTrue("light and dark system themes give the same Tono: %.1f vs %.1f".format(light, dark), Math.abs(light - dark) < 12)
    }

    // ---- fixture renders: real device rendering, fake state --------------------------------

    private val nodes = listOf(NodeView("Tokyo · Dawn", "Tokyo", "Dawn", 86), NodeView("Los Angeles · Grove", "Los Angeles", "Grove", 162))
    private val idle = EngineSnapshot(phase = Phase.IDLE, email = "tester@example.com", nodes = nodes, selectedNode = "Tokyo · Dawn", homeKind = HomeKind.RESIDENTIAL, mode = RoutingMode.THREE_TIER)
    private fun connected() = idle.copy(
        phase = Phase.CONNECTED, connectedSinceMs = System.currentTimeMillis() - 23 * 60_000,
        cloudProbe = ExitProbe(ProbeState.OK, "JP"), homeProbe = ExitProbe(ProbeState.OK, "US"), rxBytesPerSec = 2_340_000, txBytesPerSec = 81_000,
    )

    private fun withFixtureHost(block: (set: (EngineSnapshot) -> Unit, scenario: ActivityScenario<ComponentActivity>) -> Unit) {
        val state = mutableStateOf(idle)
        ActivityScenario.launch(ComponentActivity::class.java).use { scenario ->
            scenario.onActivity { a ->
                a.setContent {
                    CompositionLocalProvider(LocalReduceMotion provides rememberSystemReduceMotion()) {
                        TonoTheme {
                            FixtureFrame {
                                TonoRoot(state.value, object : TonoActions {
                                    override fun connect() {}
                                    override fun command(op: String, vararg args: Pair<String, Any?>) {}
                                    override fun explain(host: String): Map<String, Any?>? = null
                                })
                            }
                        }
                    }
                }
            }
            try {
                block({ s -> instrumentation.runOnMainSync { state.value = s } }, scenario)
            } finally {
                holdStillBeforeClose()
            }
        }
    }

    /**
     * Closing a scenario waits for an idle main thread, which the animated sea on a software-GPU
     * emulator may never give (runs 39193223160 and 39197246583: b2 done, then stuck in close for
     * 600 s). Motion is turned off for the close only; the next test sets its own.
     */
    private fun holdStillBeforeClose() {
        instrumentation.uiAutomation.executeShellCommand("settings put global animator_duration_scale 0").close()
        Thread.sleep(1_000)
    }

    @Test fun b1_fixtureStatesRenderedOnDevice() = withFixtureHost { set, _ ->
        val states = listOf(
            "fixture-01-idle" to idle,
            "fixture-02-connecting" to idle.copy(phase = Phase.CONNECTING),
            "fixture-03-connected" to connected(),
            "fixture-04-degraded" to connected().copy(phase = Phase.DEGRADED, reasonCode = "HOME_UNREACHABLE", homeProbe = ExitProbe(ProbeState.FAILED)),
            "fixture-05-failed" to idle.copy(phase = Phase.FAILED, reasonCode = "CATALOG_UNAVAILABLE"),
        )
        for ((name, s) in states) {
            set(s)
            Thread.sleep(2_600) // let the sun/sky settle with real animations
            shot(name)
        }
        set(connected().copy(phase = Phase.DEGRADED, reasonCode = "HOME_UNREACHABLE", homeProbe = ExitProbe(ProbeState.FAILED)))
        Thread.sleep(1_500)
        dismissForeignAnr()
        val details = find(By.text(text(R.string.details)), 5_000)
        assertNotNull("details", details)
        details!!.click()
        Thread.sleep(1_200)
        shot("fixture-06-details-sheet")
    }

    @Test fun b3_fixtureAtLargeFontScale() {
        val shell = instrumentation.uiAutomation
        shell.executeShellCommand("settings put system font_scale 1.3").close()
        Thread.sleep(1_500)
        try {
            withFixtureHost { set, _ ->
                set(connected().copy(phase = Phase.DEGRADED, reasonCode = "HOME_UNREACHABLE", homeProbe = ExitProbe(ProbeState.FAILED)))
                Thread.sleep(2_000)
                shot("fixture-07-font-1.3-home")
                val details = find(By.text(text(R.string.details)), 5_000)
                assertNotNull("details", details)
                details!!.click()
                Thread.sleep(1_200)
                shot("fixture-08-font-1.3-details")
            }
        } finally {
            shell.executeShellCommand("settings put system font_scale 1.0").close()
        }
    }

    /** Drives the fixture through a connect/disconnect/fail cycle; CI records the screen from the host. */
    @Test fun b2_fixtureMotionRecordedOnDevice() = withFixtureHost { set, _ ->
        Thread.sleep(1_200)
        val steps = listOf(
            900L to idle,
            1_200L to idle.copy(phase = Phase.PREPARING),
            1_400L to idle.copy(phase = Phase.CONNECTING),
            2_600L to connected(),
            700L to idle.copy(phase = Phase.DISCONNECTING),
            2_000L to idle,
            1_000L to idle.copy(phase = Phase.PREPARING),
            2_400L to idle.copy(phase = Phase.FAILED, reasonCode = "CATALOG_UNAVAILABLE"),
        )
        for ((ms, s) in steps) { set(s); Thread.sleep(ms) }
    }
}
