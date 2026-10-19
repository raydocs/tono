package com.raydocs.tono.mobile.engine

import com.raydocs.tono.routing.Json
import com.raydocs.tono.routing.asObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/** Error from the Tono control plane or the paths to it. [code] is stable and shown to users via copy. */
class ApiException(val status: Int, val code: String, message: String) : IOException(message)

/**
 * Minimal HTTPS JSON client for the Tono control plane (raydocs/tono services/control-plane, client contract v1).
 *
 * Paths match the desktop clients (decision 077): the system resolver first, then the Tono API relays,
 * which forward unterminated TLS. Every path verifies the real API certificate for the API hostname;
 * a relay only carries bytes.
 */
class ControlPlane(
    baseUrl: String,
    private val clientVersion: String,
    private val relays: List<Pair<String, Int>> = API_RELAYS,
) {
    private val base = URI(baseUrl)
    private val host = base.host
    private val basePath = base.path.trimEnd('/')

    data class Response(val status: Int, val body: Map<String, Any?>?)

    fun get(path: String, bearer: String?): Map<String, Any?> = call("GET", path, null, bearer)

    fun post(path: String, body: Map<String, Any?>?, bearer: String? = null): Map<String, Any?> =
        call("POST", path, body?.let { Json.write(it) }, bearer)

    private fun call(method: String, path: String, body: String?, bearer: String?): Map<String, Any?> {
        var lastNetwork: IOException? = null
        val paths = listOf<Pair<String, Pair<String, Int>>>("system_dns" to (host to 443)) + relays.map { "relay" to it }
        for ((kind, target) in paths) {
            val response = try {
                exchange(kind, target.first, target.second, method, path, body, bearer)
            } catch (e: ApiException) {
                throw e
            } catch (e: IOException) {
                lastNetwork = e
                continue
            }
            if (response.status in 200..299) return response.body ?: emptyMap()
            val error = response.body?.get("error") as? Map<*, *>
            val code = error?.get("code") as? String ?: "HTTP_${response.status}"
            // A 5xx from the edge on one path is treated like an unreachable path; API errors are final.
            if (response.status >= 500 && error == null) {
                lastNetwork = IOException("HTTP ${response.status} via $kind")
                continue
            }
            throw ApiException(response.status, code, error?.get("message") as? String ?: "request failed")
        }
        throw ApiException(0, "NETWORK", lastNetwork?.message ?: "Tono servers are unreachable")
    }

    private fun exchange(kind: String, dialHost: String, port: Int, method: String, path: String, body: String?, bearer: String?): Response {
        val raw = Socket()
        raw.connect(InetSocketAddress(dialHost, port), CONNECT_TIMEOUT_MS)
        raw.soTimeout = READ_TIMEOUT_MS
        val socket = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(raw, host, port, true) as SSLSocket
        socket.use { tls ->
            tls.sslParameters = tls.sslParameters.apply {
                serverNames = listOf(SNIHostName(host))
                endpointIdentificationAlgorithm = "HTTPS"
            }
            tls.startHandshake()
            if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, tls.session)) {
                throw IOException("certificate does not match $host")
            }
            val payload = body?.toByteArray(Charsets.UTF_8)
            val request = buildString {
                append("$method $basePath/$path HTTP/1.1\r\n")
                append("Host: $host\r\n")
                append("User-Agent: Tono-Android/$clientVersion\r\n")
                append("Accept: application/json\r\n")
                append("X-Tono-Client: android/$clientVersion\r\n")
                append("X-Tono-Path: $kind\r\n")
                append("Connection: close\r\n")
                bearer?.let { append("Authorization: Bearer $it\r\n") }
                if (payload != null) {
                    append("Content-Type: application/json\r\n")
                    append("Content-Length: ${payload.size}\r\n")
                }
                append("\r\n")
            }
            val out = tls.getOutputStream()
            out.write(request.toByteArray(Charsets.US_ASCII))
            payload?.let(out::write)
            out.flush()
            return readResponse(BufferedInputStream(tls.getInputStream()))
        }
    }

    companion object {
        /** Keep in step with raydocs/tono services/control-plane/src/api-relays.ts. */
        val API_RELAYS = listOf("179.253.233.220" to 2053, "179.255.154.17" to 2053, "154.84.56.196" to 2053)
        private const val CONNECT_TIMEOUT_MS = 6_000
        private const val READ_TIMEOUT_MS = 15_000
        private const val MAX_BODY = 2 * 1024 * 1024

        internal fun readResponse(input: InputStream): Response {
            val status = readLine(input).split(' ').getOrNull(1)?.toIntOrNull() ?: throw IOException("bad status line")
            val headers = HashMap<String, String>()
            while (true) {
                val line = readLine(input)
                if (line.isEmpty()) break
                val idx = line.indexOf(':')
                if (idx > 0) headers[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
            }
            val bytes = when {
                headers["transfer-encoding"]?.contains("chunked", ignoreCase = true) == true -> readChunked(input)
                headers["content-length"] != null -> {
                    val length = headers["content-length"]!!.toInt()
                    if (length > MAX_BODY) throw IOException("response too large")
                    readExactly(input, length)
                }
                else -> readToEnd(input)
            }
            val text = bytes.toString(Charsets.UTF_8)
            val json = if (text.isBlank()) null else runCatching { Json.parse(text).asObject() }.getOrNull()
            return Response(status, json)
        }

        private fun readLine(input: InputStream): String {
            val out = ByteArrayOutputStream()
            while (true) {
                val b = input.read()
                if (b < 0) { if (out.size() == 0) throw IOException("connection closed"); break }
                if (b == '\n'.code) break
                if (b != '\r'.code) out.write(b)
                if (out.size() > 16 * 1024) throw IOException("header too long")
            }
            return out.toString(Charsets.ISO_8859_1.name())
        }

        private fun readExactly(input: InputStream, length: Int): ByteArray {
            val buf = ByteArray(length)
            var read = 0
            while (read < length) {
                val n = input.read(buf, read, length - read)
                if (n < 0) throw IOException("truncated body")
                read += n
            }
            return buf
        }

        private fun readChunked(input: InputStream): ByteArray {
            val out = ByteArrayOutputStream()
            while (true) {
                val size = readLine(input).substringBefore(';').trim().toInt(16)
                if (size == 0) { readLine(input); break }
                if (out.size() + size > MAX_BODY) throw IOException("response too large")
                out.write(readExactly(input, size))
                readLine(input)
            }
            return out.toByteArray()
        }

        private fun readToEnd(input: InputStream): ByteArray {
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
                if (out.size() > MAX_BODY) throw IOException("response too large")
            }
            return out.toByteArray()
        }
    }
}
