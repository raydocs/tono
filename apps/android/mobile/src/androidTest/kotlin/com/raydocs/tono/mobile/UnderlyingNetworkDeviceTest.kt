package com.raydocs.tono.mobile

import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.os.Process
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.raydocs.tono.mobile.engine.LocalTestServer
import com.raydocs.tono.mobile.engine.NetworkMonitor
import com.raydocs.tono.mobile.engine.TonoVpnService
import com.raydocs.tono.mobile.ipc.ITonoEngine
import com.raydocs.tono.mobile.ui.MainActivity
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket

/** Real service/TUN and local-tunnel stand-ins; requires both emulator Wi-Fi and cellular. */
@RunWith(AndroidJUnit4::class)
class UnderlyingNetworkDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val evidence = File(context.getExternalFilesDir(null), "evidence").apply { mkdirs() }
    @Volatile private var engine: ITonoEngine? = null
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            engine = ITonoEngine.Stub.asInterface(binder)
        }
        override fun onServiceDisconnected(name: ComponentName) { engine = null }
        override fun onBindingDied(name: ComponentName) { engine = null }
    }

    private fun shell(command: String): String = instrumentation.uiAutomation.executeShellCommand(command).let {
        ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().use { reader -> reader.readText() }
    }

    private fun <T : Any> awaitValue(message: String, timeoutMs: Long = 20_000, read: () -> T?): T {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        do {
            read()?.let { return it }
            SystemClock.sleep(100)
        } while (SystemClock.elapsedRealtime() < deadline)
        throw AssertionError(message)
    }

    private fun snapshot(): JSONObject? = engine?.snapshot()?.let(::JSONObject)
    private fun command(op: String) { checkNotNull(engine).command(JSONObject().put("op", op).toString()) }
    private fun phase(expected: String) = awaitValue("engine must reach $expected") {
        snapshot()?.takeIf { it.optString("phase") == expected }
    }
    private fun vpn(): Network? = connectivity.allNetworks.singleOrNull {
        connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
    }
    private fun physical(monitor: NetworkMonitor, transport: Int) = awaitValue("physical transport $transport must become available") {
        monitor.current?.takeIf {
            it.interfaceName != null && connectivity.getNetworkCapabilities(it.network)?.hasTransport(transport) == true
        }
    }

    private fun capture(label: String, monitor: NetworkMonitor) {
        File(evidence, "underlying-$label-connectivity.txt").writeText(shell("dumpsys connectivity"))
        val current = snapshot()
        val safe = JSONObject().put("phase", current?.optString("phase"))
            .put("attempt", current?.optLong("attempt")).put("ipv6", current?.optBoolean("ipv6"))
            .put("applied", current?.optJSONObject("applied"))
        File(evidence, "underlying-$label.txt").writeText(
            "physical=${monitor.current}\nvpn=${vpn()}\n" +
                "vpnCaps=${vpn()?.let(connectivity::getNetworkCapabilities)}\n" +
                "vpnLink=${vpn()?.let(connectivity::getLinkProperties)}\nengine=$safe\n",
        )
    }

    private fun follows(vpn: Network, underlying: NetworkMonitor.Underlying, transport: Int): NetworkCapabilities =
        awaitValue("established VPN must follow physical handoff to ${underlying.network} / transport $transport") {
            assertEquals("fixture reloaded the VPN; this is not a same-TUN handoff", vpn, this.vpn())
            connectivity.getNetworkCapabilities(vpn)?.takeIf {
                it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) && it.hasTransport(transport) &&
                    !it.hasTransport(if (transport == NetworkCapabilities.TRANSPORT_WIFI)
                        NetworkCapabilities.TRANSPORT_CELLULAR else NetworkCapabilities.TRANSPORT_WIFI)
            }
        }

    @Test fun establishedVpnTracksPhysicalHandoffAndMeterednessWithoutReplacingTheTun() {
        assertTrue("debug-only local fixture required", BuildConfig.DEBUG)
        Socket().use { it.connect(InetSocketAddress("127.0.0.1", 28080), 3_000) }
        val override = File(context.noBackupFilesDir, LocalTestServer.FILE)
        val savedOverride = override.takeIf { it.isFile }?.readBytes()
        val wifi = shell("settings get global wifi_on").trim()
        val data = shell("settings get global mobile_data").trim()
        val animation = shell("settings get global animator_duration_scale").trim()
        assertTrue("known original Wi-Fi setting", wifi in setOf("0", "1"))
        assertTrue("known original mobile-data setting", data in setOf("0", "1"))
        assertTrue("known original animation setting", animation == "null" || animation.toFloatOrNull() != null)
        val monitor = NetworkMonitor(connectivity)
        var bound = false
        var activity: ActivityScenario<MainActivity>? = null
        var failure: Throwable? = null
        try {
            override.parentFile?.mkdirs()
            override.writeText("http://127.0.0.1:28080/api/v1/")
            context.getSystemService(ActivityManager::class.java).runningAppProcesses.orEmpty()
                .filter { it.processName == "${context.packageName}:vpn" }.forEach { Process.killProcess(it.pid) }
            shell("svc data enable")
            shell("svc wifi enable")
            shell("settings put global animator_duration_scale 0")
            monitor.start()
            val initialWifi = physical(monitor, NetworkCapabilities.TRANSPORT_WIFI)
            activity = ActivityScenario.launch(MainActivity::class.java)
            bound = context.bindService(Intent(context, TonoVpnService::class.java)
                .setAction(TonoVpnService.ACTION_BIND_ENGINE), connection, Context.BIND_AUTO_CREATE)
            assertTrue("bind real engine", bound)
            awaitValue("engine must be bound to local fixture, never production") {
                snapshot()?.takeIf { it.optBoolean("localTestServer") }
            }
            command("signOut")
            phase("SIGNED_OUT")
            checkNotNull(engine).command("""{"op":"startEmail","email":"handoff@example.test"}""")
            awaitValue("local email challenge") {
                snapshot()?.optJSONObject("login")?.takeIf { !it.isNull("challengeId") && !it.optBoolean("busy") }
            }
            checkNotNull(engine).command("""{"op":"verifyCode","code":"246810"}""")
            awaitValue("local signed-in catalog") {
                snapshot()?.takeIf { it.optString("phase") == "IDLE" && (it.optJSONArray("nodes")?.length() ?: 0) > 0 }
            }
            VpnService.prepare(context)?.let { consent ->
                context.startActivity(consent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                val button = device.wait(Until.findObject(By.pkg("com.android.vpndialogs").res("android:id/button1")), 15_000)
                assertNotNull("normal Android VPN consent", button)
                button!!.click()
                awaitValue("VPN consent accepted") { true.takeIf { VpnService.prepare(context) == null } }
            }
            command("connect")
            awaitValue("local fixture connection established", 90_000) {
                snapshot()?.takeIf { it.optString("phase") == "CONNECTED" && !it.isNull("applied") }
            }
            val established = awaitValue("real Android VPN network") { vpn() }
            val tun = connectivity.getLinkProperties(established)?.interfaceName
            assertNotNull("real TUN interface", tun)
            capture("wifi-before", monitor)
            assertTrue("initial VPN uses Wi-Fi", connectivity.getNetworkCapabilities(established)!!
                .hasTransport(NetworkCapabilities.TRANSPORT_WIFI))

            shell("svc wifi disable")
            val cellular = physical(monitor, NetworkCapabilities.TRANSPORT_CELLULAR)
            assertNotEquals("distinct physical networks", initialWifi.network, cellular.network)
            assertEquals("fixture must not require an IPv6-policy reload", initialWifi.globalIpv6, cellular.globalIpv6)
            capture("cellular-before-assert", monitor)
            val cellularCaps = follows(established, cellular, NetworkCapabilities.TRANSPORT_CELLULAR)
            assertEquals("handoff must not replace the VPN network", established, vpn())
            assertEquals("handoff must not replace the TUN", tun, connectivity.getLinkProperties(established)?.interfaceName)
            val physicalCellCaps = checkNotNull(connectivity.getNetworkCapabilities(cellular.network))
            assertEquals("VPN inherits actual cellular meteredness", physicalCellCaps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
                cellularCaps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
            capture("cellular-after", monitor)

            shell("svc wifi enable")
            val returnedWifi = physical(monitor, NetworkCapabilities.TRANSPORT_WIFI)
            assertEquals("fixture must not require an IPv6-policy reload", cellular.globalIpv6, returnedWifi.globalIpv6)
            follows(established, returnedWifi, NetworkCapabilities.TRANSPORT_WIFI)
            val physicalWifiCaps = checkNotNull(connectivity.getNetworkCapabilities(returnedWifi.network))
            awaitValue("VPN inherits actual Wi-Fi meteredness") {
                connectivity.getNetworkCapabilities(established)?.takeIf {
                    it.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) ==
                        physicalWifiCaps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
                }
            }
            assertEquals("return handoff must preserve the VPN network", established, vpn())
            assertEquals("return handoff must preserve the TUN", tun, connectivity.getLinkProperties(established)?.interfaceName)
            capture("wifi-returned", monitor)

            shell("svc data disable")
            shell("svc wifi disable")
            awaitValue("no physical uplink remains") { true.takeIf { monitor.current == null } }
            awaitValue("VPN must withdraw both physical transports while offline") {
                connectivity.getNetworkCapabilities(established)?.takeIf {
                    it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                        !it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                        !it.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
                }
            }
            capture("offline", monitor)
            shell("svc wifi enable")
            val recovered = physical(monitor, NetworkCapabilities.TRANSPORT_WIFI)
            follows(established, recovered, NetworkCapabilities.TRANSPORT_WIFI)
            assertEquals("recovery preserves the VPN network", established, vpn())
            assertEquals("recovery preserves the TUN", tun, connectivity.getLinkProperties(established)?.interfaceName)
            capture("recovered", monitor)
            command("disconnect")
            phase("IDLE")
            awaitValue("disconnect removes the real VPN") { true.takeIf { vpn() == null } }
        } catch (t: Throwable) {
            failure = t
            runCatching { capture("failure", monitor) }.exceptionOrNull()?.let(t::addSuppressed)
            throw t
        } finally {
            val cleanupErrors = mutableListOf<Throwable>()
            fun cleanup(action: () -> Unit) { runCatching(action).exceptionOrNull()?.let(cleanupErrors::add) }
            cleanup {
                if (engine != null && snapshot()?.optBoolean("localTestServer") == true) {
                    command("signOut")
                    phase("SIGNED_OUT")
                }
            }
            cleanup { monitor.stop() }
            cleanup { if (bound) context.unbindService(connection) }
            cleanup { activity?.close() }
            cleanup { context.stopService(Intent(context, TonoVpnService::class.java)) }
            cleanup { if (savedOverride == null) override.delete() else override.writeBytes(savedOverride) }
            cleanup { shell("svc wifi ${if (wifi == "1") "enable" else "disable"}") }
            cleanup { shell("svc data ${if (data == "1") "enable" else "disable"}") }
            cleanup { shell(if (animation == "null") "settings delete global animator_duration_scale"
                else "settings put global animator_duration_scale $animation") }
            if (failure != null) cleanupErrors.forEach(failure::addSuppressed)
            else if (cleanupErrors.isNotEmpty()) throw AssertionError("local fixture cleanup failed", cleanupErrors.first())
        }
    }
}
