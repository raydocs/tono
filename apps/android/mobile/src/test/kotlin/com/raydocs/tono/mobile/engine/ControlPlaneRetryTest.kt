package com.raydocs.tono.mobile.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ConnectException
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

class ControlPlaneRetryTest {
    @Test fun postOnlyFallsBackBeforeAnyHttpWriteWhileGetStillFallsBack() {
        // All IO is in-memory. The .invalid host and documentation relays are never dialled.
        val preSendReply = WireSocket(http(200, """{"ok":true}"""))
        val preSend = ScriptedSockets(
            { throw UnknownHostException("fixture DNS failure") },
            { throw ConnectException("fixture connect failure") },
            { throw SSLHandshakeException("fixture TLS handshake failure") },
            { preSendReply },
        )
        assertEquals(true, preSend.client.post("auth/refresh", REFRESH_BODY, "fixture-bearer")["ok"])
        assertEquals(listOf(
            Triple("system_dns", "api.example.invalid", 443),
            Triple("relay", "192.0.2.1", 2053),
            Triple("relay", "192.0.2.2", 2053),
            Triple("relay", "192.0.2.3", 2053),
        ), preSend.attempts)
        assertEquals(2, preSendReply.writeCalls)
        assertEquals(1, preSendReply.closeCalls)
        assertTrue(preSendReply.request.startsWith("POST /api/v1/auth/refresh HTTP/1.1\r\nHost: api.example.invalid\r\n"))
        assertTrue(preSendReply.request.contains("Authorization: Bearer fixture-bearer\r\n"))
        assertTrue(preSendReply.request.contains("X-Tono-Path: relay\r\n"))
        assertTrue(preSendReply.request.endsWith("Content-Length: ${REFRESH_JSON.toByteArray().size}\r\n\r\n$REFRESH_JSON"))

        val noOutputStream = WireSocket("", outputOpenError = IOException("fixture stream unavailable"))
        val streamReadyReply = WireSocket(http(200, """{"ok":true}"""))
        val streamReady = ScriptedSockets({ noOutputStream }, { streamReadyReply })
        assertEquals(true, streamReady.client.post("auth/refresh", REFRESH_BODY)["ok"])
        assertEquals(2, streamReady.attempts.size)
        assertEquals(0, noOutputStream.writeCalls)
        assertEquals(1, noOutputStream.closeCalls)
        assertEquals(2, streamReadyReply.writeCalls)

        val getEof = WireSocket("")
        val getEdge = WireSocket(http(503, "edge unavailable"))
        val getReply = WireSocket(http(200, """{"ok":true}"""))
        val get = ScriptedSockets({ getEof }, { getEdge }, { getReply })
        assertEquals(true, get.client.get("exit-catalog", "fixture-bearer")["ok"])
        assertEquals(3, get.attempts.size)
        assertEquals(1, getEof.writeCalls)
        assertEquals(1, getEdge.writeCalls)
        assertEquals(1, getReply.writeCalls)
        assertEquals(1, getEof.closeCalls)
        assertEquals(1, getEdge.closeCalls)
        assertEquals(1, getReply.closeCalls)
        assertTrue(getEof.request.contains("X-Tono-Path: system_dns\r\n"))
        assertTrue(getReply.request.contains("X-Tono-Path: relay\r\n"))
        assertTrue(getReply.request.startsWith("GET /api/v1/exit-catalog HTTP/1.1\r\n"))
        assertTrue(getReply.request.contains("Authorization: Bearer fixture-bearer\r\n"))

        // A failed first write can already have delivered a prefix: marking after write is too late.
        val partialWrite = WireSocket("", firstWriteError = IOException("fixture partial write"))
        assertNetworkWithoutReplay(partialWrite, "auth/email/verify", mapOf("code" to "123456"))
        assertEquals("POST /a", partialWrite.request)
        assertEquals(1, partialWrite.writeCalls)
        assertEquals(0, partialWrite.inputOpens)

        val writeTimeout = WireSocket("", firstWriteError = SocketTimeoutException("fixture write timeout"))
        assertNetworkWithoutReplay(writeTimeout, "auth/refresh", REFRESH_BODY)
        assertEquals(1, writeTimeout.writeCalls)

        val lostReply = WireSocket("")
        assertNetworkWithoutReplay(lostReply, "auth/email/verify", mapOf("code" to "123456"))
        assertTrue(lostReply.request.endsWith("\r\n\r\n{\"code\":\"123456\"}"))
        assertEquals(2, lostReply.writeCalls)
        assertEquals(1, lostReply.inputOpens)

        val truncatedReply = WireSocket("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{\"refreshToken\":")
        assertNetworkWithoutReplay(truncatedReply, "auth/refresh", REFRESH_BODY)
        assertEquals(2, truncatedReply.writeCalls)
        assertTrue(truncatedReply.request.endsWith(REFRESH_JSON))

        val readTimeout = WireSocket("", readError = SocketTimeoutException("fixture read timeout"))
        assertNetworkWithoutReplay(readTimeout, "auth/refresh", REFRESH_BODY)
        assertEquals(2, readTimeout.writeCalls)
        assertEquals(1, readTimeout.inputOpens)

        val unstructured5xx = WireSocket(http(503, "edge unavailable"))
        assertNetworkWithoutReplay(unstructured5xx, "auth/refresh", REFRESH_BODY)
        assertEquals(2, unstructured5xx.writeCalls)
        assertEquals(1, unstructured5xx.inputOpens)

        val structuredReply = WireSocket(http(503, """{"error":{"code":"AUTH_UNAVAILABLE","message":"fixture refusal"}}"""))
        val structuredFallback = WireSocket(http(200, """{"ok":true}"""))
        val structured = ScriptedSockets({ structuredReply }, { structuredFallback })
        val apiError = assertThrows(ApiException::class.java) { structured.client.post("auth/refresh", REFRESH_BODY) }
        assertEquals(503, apiError.status)
        assertEquals("AUTH_UNAVAILABLE", apiError.code)
        assertEquals("fixture refusal", apiError.message)
        assertEquals(1, structured.attempts.size)
        assertEquals(1, structuredReply.closeCalls)
        assertEquals(0, structuredFallback.writeCalls)
    }

    private fun assertNetworkWithoutReplay(first: WireSocket, path: String, body: Map<String, Any?>) {
        val fallback = WireSocket(http(200, """{"ok":true}"""))
        val sockets = ScriptedSockets({ first }, { fallback })
        val failure = assertThrows("possibly-delivered POST must not succeed via a second path", ApiException::class.java) {
            sockets.client.post(path, body, "fixture-bearer")
        }
        assertEquals(0, failure.status)
        assertEquals("NETWORK", failure.code)
        assertEquals(1, sockets.attempts.size)
        assertEquals(1, first.closeCalls)
        assertEquals(0, fallback.writeCalls)
        assertEquals(0, fallback.closeCalls)
    }

    private class ScriptedSockets(vararg steps: () -> Socket) {
        val attempts = mutableListOf<Triple<String, String, Int>>()
        val client = ControlPlane(
            "https://api.example.invalid/api/v1/", "fixture",
            listOf("192.0.2.1" to 2053, "192.0.2.2" to 2053, "192.0.2.3" to 2053),
            { kind, host, port ->
                attempts.add(Triple(kind, host, port))
                check(attempts.size <= steps.size) { "unexpected extra socket attempt" }
                steps[attempts.size - 1]()
            },
        )
    }

    private class WireSocket(
        response: String,
        private val firstWriteError: IOException? = null,
        private val outputOpenError: IOException? = null,
        private val readError: IOException? = null,
    ) : Socket() {
        private val written = ByteArrayOutputStream()
        private val input = ByteArrayInputStream(response.toByteArray(Charsets.UTF_8))
        var writeCalls = 0
            private set
        var inputOpens = 0
            private set
        var closeCalls = 0
            private set
        val request: String get() = written.toString(Charsets.UTF_8.name())

        override fun getOutputStream(): OutputStream {
            outputOpenError?.let { throw it }
            return object : OutputStream() {
                override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
                override fun write(b: ByteArray, off: Int, len: Int) {
                    writeCalls++
                    if (writeCalls == 1 && firstWriteError != null) {
                        written.write(b, off, minOf(7, len))
                        throw firstWriteError
                    }
                    written.write(b, off, len)
                }
            }
        }

        override fun getInputStream(): InputStream {
            inputOpens++
            return if (readError == null) input else object : InputStream() {
                override fun read(): Int = throw readError
            }
        }

        override fun close() { closeCalls++ }
    }

    companion object {
        private val REFRESH_BODY = mapOf("refreshToken" to "fixture-refresh")
        private const val REFRESH_JSON = "{\"refreshToken\":\"fixture-refresh\"}"
        private fun http(status: Int, body: String): String =
            "HTTP/1.1 $status Fixture\r\nContent-Length: ${body.toByteArray(Charsets.UTF_8).size}\r\n\r\n$body"
    }
}
