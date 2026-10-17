package com.raydocs.tono.mobile

import android.content.Intent
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

    private fun shot(name: String) {
        device.waitForIdle(2_000)
        assertTrue("screenshot $name", device.takeScreenshot(File(out, "$name.png")))
    }

    private fun text(id: Int) = context.getString(id)

    @Test fun a1_realSignInScreenAndLocalValidation() {
        ActivityScenario.launch(MainActivity::class.java).use {
            assertNotNull("sign-in screen", device.wait(Until.findObject(By.text(text(R.string.signin_title))), 20_000))
            shot("real-01-signin")
            // Client-side validation only: nothing is sent to the Tono API from CI.
            device.findObject(By.clazz("android.widget.EditText")).text = "not-an-email"
            device.findObject(By.text(text(R.string.signin_send))).click()
            assertNotNull(device.wait(Until.findObject(By.text(text(R.string.signin_error_INVALID_EMAIL))), 10_000))
            shot("real-02-signin-invalid-email")
        }
    }

    @Test fun a2_realSystemVpnConsentDialog() {
        val prepare = VpnService.prepare(context)
        assertNotNull("fresh install must need consent", prepare)
        context.startActivity(prepare!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val ok = device.wait(Until.findObject(By.res(Pattern.compile(".*:id/button1")).pkg(Pattern.compile("com\\.android\\.vpndialogs"))), 20_000)
            ?: device.wait(Until.findObject(By.text(Pattern.compile("(?i)ok|确定"))), 5_000)
        assertNotNull("system VPN consent dialog", ok)
        shot("real-03-system-vpn-consent")
        ok.click()
        device.waitForIdle(3_000)
        assertNull("consent recorded by Android", VpnService.prepare(context))
        shot("real-04-after-consent")
    }

    @Test fun a3_realEngineRefusesToConnectWithoutAccount() {
        // With consent granted but no Tono account, the real engine must not pretend to connect.
        context.startForegroundService(Intent(context, TonoVpnService::class.java).setAction(TonoVpnService.ACTION_CONNECT))
        Thread.sleep(3_000)
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val vpnUp = cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
        assertFalse("no tunnel may exist without an account", vpnUp)
        ActivityScenario.launch(MainActivity::class.java).use {
            assertNotNull(device.wait(Until.findObject(By.text(text(R.string.signin_title))), 20_000))
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
                    CompositionLocalProvider(LocalReduceMotion provides false) {
                        TonoTheme {
                            TonoRoot(state.value, object : TonoActions {
                                override fun connect() {}
                                override fun command(op: String, vararg args: Pair<String, Any?>) {}
                                override fun explain(host: String): Map<String, Any?>? = null
                            })
                        }
                    }
                }
            }
            block({ s -> instrumentation.runOnMainSync { state.value = s } }, scenario)
        }
    }

    @Test fun b1_fixtureStatesRenderedOnDevice() = withFixtureHost { set, _ ->
        val states = listOf(
            "fixture-01-idle" to idle,
            "fixture-02-connecting" to idle.copy(phase = Phase.CONNECTING),
            "fixture-03-connected" to connected(),
            "fixture-04-degraded" to connected().copy(phase = Phase.DEGRADED, reasonCode = "HOME_UNREACHABLE", homeProbe = ExitProbe(ProbeState.FAILED)),
            "fixture-05-failed" to idle.copy(phase = Phase.FAILED, reasonCode = "HOME_UNAVAILABLE"),
        )
        for ((name, s) in states) {
            set(s)
            Thread.sleep(2_600) // let the sun/sky settle with real animations
            shot(name)
        }
        set(connected().copy(phase = Phase.DEGRADED, reasonCode = "HOME_UNREACHABLE", homeProbe = ExitProbe(ProbeState.FAILED)))
        Thread.sleep(1_500)
        device.findObject(By.text(text(R.string.details))).click()
        Thread.sleep(1_200)
        shot("fixture-06-details-sheet")
    }

    @Test fun b2_fixtureMotionRecordedOnDevice() = withFixtureHost { set, _ ->
        val video = "/sdcard/Download/tono-fixture-motion.mp4"
        instrumentation.uiAutomation.executeShellCommand("rm -f $video").close()
        val rec = instrumentation.uiAutomation.executeShellCommand("screenrecord --time-limit 16 --bit-rate 8000000 $video")
        Thread.sleep(1_200)
        val steps = listOf(
            900L to idle,
            1_200L to idle.copy(phase = Phase.PREPARING),
            1_400L to idle.copy(phase = Phase.CONNECTING),
            2_600L to connected(),
            700L to idle.copy(phase = Phase.DISCONNECTING),
            2_000L to idle,
            1_000L to idle.copy(phase = Phase.PREPARING),
            2_400L to idle.copy(phase = Phase.FAILED, reasonCode = "HOME_UNAVAILABLE"),
        )
        for ((ms, s) in steps) { set(s); Thread.sleep(ms) }
        Thread.sleep(2_500) // screenrecord finalises the file at its time limit
        rec.close()
    }
}
