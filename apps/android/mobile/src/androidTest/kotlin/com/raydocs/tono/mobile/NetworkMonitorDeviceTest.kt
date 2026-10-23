package com.raydocs.tono.mobile

import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.raydocs.tono.mobile.engine.NetworkMonitor
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Exercises the actual platform registration, including requestNetwork on Android 10/11. */
@RunWith(AndroidJUnit4::class)
class NetworkMonitorDeviceTest {
    @Test fun registersAndObservesThePhysicalUplink() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        val monitor = NetworkMonitor(connectivity)
        val observed = CountDownLatch(1)
        monitor.addListener { underlying ->
            val capabilities = underlying?.network?.let(connectivity::getNetworkCapabilities)
            if (underlying?.interfaceName != null &&
                capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)) {
                observed.countDown()
            }
        }
        try {
            monitor.start()
            assertTrue("the emulator's physical uplink must reach the registered monitor",
                observed.await(15, TimeUnit.SECONDS))
        } finally {
            monitor.stop()
        }
    }
}
