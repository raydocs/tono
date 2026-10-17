package com.raydocs.tono.mobile.engine

import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * Exit checks through the live tunnel. Tono's own process is not excluded from the VPN, so these
 * requests take the same rules as every app:
 *  - www.cloudflare.com is on the explicit cloud list → proves the cloud exit;
 *  - claude.ai is a Home suffix → proves cloud → Home (or cloud alone when no Home is assigned).
 * Cloudflare's /cdn-cgi/trace reports the exit's country, which the UI shows next to each route.
 */
object Probes {
    const val CLOUD_URL = "https://www.cloudflare.com/cdn-cgi/trace"
    const val HOME_URL = "https://claude.ai/cdn-cgi/trace"

    fun trace(url: String, timeoutMs: Int = 8_000): ExitProbe {
        val started = System.nanoTime()
        return try {
            val conn = URL(url).openConnection() as HttpsURLConnection
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("User-Agent", "Tono-Android-probe")
            conn.useCaches = false
            try {
                val code = conn.responseCode
                val latency = (System.nanoTime() - started) / 1_000_000
                val body = if (code == HttpURLConnection.HTTP_OK) conn.inputStream.bufferedReader().use { it.readText().take(4096) } else ""
                val loc = body.lineSequence().firstOrNull { it.startsWith("loc=") }?.substringAfter('=')?.takeIf { it.matches(Regex("[A-Z]{2}")) }
                // Any HTTP answer proves the path; a challenge page simply has no location.
                ExitProbe(ProbeState.OK, loc, latency)
            } finally {
                conn.disconnect()
            }
        } catch (_: Exception) {
            ExitProbe(ProbeState.FAILED)
        }
    }
}
