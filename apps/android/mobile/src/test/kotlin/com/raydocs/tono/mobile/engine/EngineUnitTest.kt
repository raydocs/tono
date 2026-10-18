package com.raydocs.tono.mobile.engine

import com.raydocs.tono.routing.RoutingMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.Base64

class EngineUnitTest {
    private fun response(raw: String) = ControlPlane.readResponse(ByteArrayInputStream(raw.toByteArray(Charsets.UTF_8)))

    @Test fun readsChunkedErrorBody() {
        val body = """{"error":{"code":"CATALOG_UNAVAILABLE","message":"x"}}"""
        val split = 17
        val raw = "HTTP/1.1 503 Service Unavailable\r\nTransfer-Encoding: chunked\r\n\r\n" +
            "${split.toString(16)};ext=1\r\n${body.substring(0, split)}\r\n" +
            "${(body.length - split).toString(16)}\r\n${body.substring(split)}\r\n0\r\n\r\n"
        val r = response(raw)
        assertEquals(503, r.status)
        assertEquals("CATALOG_UNAVAILABLE", (r.body!!["error"] as Map<*, *>)["code"])
    }

    @Test fun contentLengthStopsAtDeclaredLength() {
        val r = response("HTTP/1.1 202 Accepted\r\nContent-Length: 20\r\n\r\n{\"challengeId\":\"ab\"}TRAILING-GARBAGE")
        assertEquals(202, r.status)
        assertEquals("ab", r.body!!["challengeId"])
    }

    @Test fun malformedFramingIsAnIoErrorNotACrash() {
        // Every malformed frame must surface as IOException so the next API path is tried.
        assertThrows(IOException::class.java) { response("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n") }
        assertThrows(IOException::class.java) { response("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n7fffffff\r\n") }
        assertThrows(IOException::class.java) { response("HTTP/1.1 200 OK\r\nContent-Length: -5\r\n\r\n") }
        assertThrows(IOException::class.java) { response("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n{}") }
        assertThrows(IOException::class.java) { response("") }
    }

    /** The debug-only local test server: loopback over plain HTTP and nothing else; never relayed. */
    @Test fun plainHttpOnlyForTheLoopbackTestServer() {
        for (url in listOf("http://10.0.2.2:28080/api/v1/", "http://192.168.1.2:28080/api/v1/", "http://127.0.0.1/api/v1/",
            "http://127.0.0.1:28080/other/", "http://localhost:28080/api/v1/", "http://127.0.0.1:28080@evil.example/api/v1/")) {
            assertFalse(url, LocalTestServer.isAllowed(url))
            assertThrows(url, IllegalArgumentException::class.java) { ControlPlane(url, "t") }
        }
        val server = java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
        val seen = StringBuilder()
        val t = Thread {
            server.accept().use { c ->
                val input = c.getInputStream().bufferedReader()
                while (true) { val line = input.readLine() ?: break; if (line.isEmpty()) break; seen.append(line).append('\n') }
                c.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{\"ok\":true}".toByteArray())
            }
        }.apply { start() }
        val url = "http://127.0.0.1:${server.localPort}/api/v1/"
        assertTrue(LocalTestServer.isAllowed(url))
        // Relays given on purpose: the local path must not fall back to them.
        val body = ControlPlane(url, "t", relays = listOf("203.0.113.1" to 1)).get("exit-catalog", "tok")
        t.join(5_000)
        server.close()
        assertEquals(true, body["ok"])
        assertTrue(seen.toString(), seen.startsWith("GET /api/v1/exit-catalog HTTP/1.1\nHost: 127.0.0.1:${server.localPort}\n"))
    }

    @Test fun nonJsonBodyIsNull() {
        assertNull(response("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 5\r\n\r\n<html").body)
    }

    private fun jwt(exp: Long): String {
        val enc = Base64.getUrlEncoder().withoutPadding()
        return enc.encodeToString("{\"alg\":\"HS256\"}".toByteArray()) + "." + enc.encodeToString("{\"sub\":\"u\",\"exp\":$exp}".toByteArray()) + ".sig"
    }

    @Test fun refreshesAccessTokenFiveMinutesEarly() {
        val now = 1_800_000_000L
        assertFalse(TonoVpnService.jwtExpiringSoon(jwt(now + 301), now))
        assertTrue(TonoVpnService.jwtExpiringSoon(jwt(now + 299), now))
        assertTrue(TonoVpnService.jwtExpiringSoon(jwt(now - 10), now))
        assertTrue(TonoVpnService.jwtExpiringSoon("not-a-jwt", now))
    }

    @Test fun homeOutageMapsToItsOwnReason() {
        assertEquals("HOME_UNAVAILABLE", TonoVpnService.errorCode(ApiException(503, "CATALOG_UNAVAILABLE", "")))
        assertEquals("RATE_LIMITED", TonoVpnService.errorCode(ApiException(429, "TOO_MANY", "")))
        assertTrue(TonoVpnService.isSessionEnded(ApiException(401, "INVALID_REFRESH_TOKEN", "")))
        assertFalse(TonoVpnService.isSessionEnded(ApiException(401, "INVALID_OR_EXPIRED_CODE", "")))
    }

    @Test fun snapshotSurvivesTheProcessBoundary() {
        val s = EngineSnapshot(
            phase = Phase.DEGRADED, reasonCode = "HOME_UNREACHABLE", email = "a@b.c",
            login = LoginView("a@b.c", "ch-1", busy = true, errorCode = null),
            nodes = listOf(NodeView("Tokyo · Dawn", "Tokyo", "Dawn", 87), NodeView("LA", "Los Angeles", "", null)),
            selectedNode = "LA", homeKind = HomeKind.CATALOG_NODE, homeLabel = "Home \"π\" x", mode = RoutingMode.STABLE,
            excludedPackages = listOf("com.example.bank"), connectedSinceMs = 1_760_000_000_123,
            cloudProbe = ExitProbe(ProbeState.OK, "JP", 140), homeProbe = ExitProbe(ProbeState.FAILED),
            rxBytesPerSec = 5_000_000_000, txBytesPerSec = 7, usingCachedCatalog = true, alwaysOn = true, lockdown = false,
            underlyingIpv6 = true, coreVersion = "1.15.0-alpha.12", catalogRevision = 42,
        )
        assertEquals(s, EngineSnapshot.fromJson(s.toJson()))
    }
}
