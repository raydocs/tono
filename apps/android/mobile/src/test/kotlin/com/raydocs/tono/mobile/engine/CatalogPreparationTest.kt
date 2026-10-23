package com.raydocs.tono.mobile.engine

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.Socket

class CatalogPreparationTest {
    @Test fun catalogPropagationWaitIsBoundedOwnedAndNeverReplaysRefreshPost() {
        // Real HTTP framing/parser and AccountWorkQueue; no network, sleeps or Android service.
        val ready = Harness(error(503, PENDING), error(503, PENDING), http(200, """{"ready":true}"""))
        ready.start()
        ready.finishRead()
        assertTrue("explicit catalog propagation must wait, not finish on the first 503", ready.results.isEmpty())
        assertEquals(1, ready.waiting)
        assertEquals(1, ready.requests.size)
        ready.clock.advanceBy(14_999)
        assertTrue(ready.io.isEmpty())
        ready.clock.advanceBy(1)
        ready.finishRead()
        assertTrue(ready.results.isEmpty())
        assertEquals(1, ready.waiting)
        ready.clock.advanceBy(15_000)
        ready.finishRead()
        assertEquals(true, ready.results.single().getOrThrow()["ready"])
        assertEquals(3, ready.requests.size)
        assertTrue(ready.requests.all { it.startsWith("GET /api/v1/exit-catalog HTTP/1.1\r\n") })
        assertEquals(0, ready.clock.pending)

        val cancelled = Harness(error(503, PENDING))
        val cancelledAttempt = cancelled.start()
        cancelled.finishRead()
        cancelledAttempt.cancel()
        cancelled.clock.advanceBy(600_000)
        assertTrue(cancelled.io.isEmpty())
        assertTrue(cancelled.results.isEmpty())
        assertEquals(1, cancelled.requests.size)
        assertEquals(0, cancelled.clock.pending)

        val replaced = Harness(http(200, """{"old":true}"""), http(200, """{"new":true}"""))
        val old = replaced.start()
        old.cancel()
        replaced.start() // Queued behind the old IO: its late reply must not complete the successor.
        replaced.finishRead()
        assertTrue(replaced.results.isEmpty())
        replaced.finishRead()
        assertEquals(true, replaced.results.single().getOrThrow()["new"])

        val retired = Harness(error(503, PENDING), http(200, """{"old":true}"""))
        retired.start()
        retired.finishRead()
        retired.clock.advanceBy(15_000)
        retired.current = false
        retired.queue.invalidate() // Sign-out/replacement retires both credential work and the attempt.
        retired.finishRead()
        retired.clock.advanceBy(600_000)
        assertTrue(retired.results.isEmpty())
        assertEquals(0, retired.clock.pending)

        val deadline = Harness(error(503, PENDING), error(503, PENDING), http(200, """{"late":true}"""))
        deadline.start()
        deadline.finishRead()
        deadline.clock.advanceBy(15_000)
        deadline.finishRead()
        deadline.clock.advanceBy(15_000) // Next request is in flight; its completion is held.
        deadline.clock.advanceBy(269_999)
        assertTrue(deadline.results.isEmpty())
        deadline.clock.advanceBy(1) // The original deadline, not one reset by the second 503.
        assertTrue(deadline.results.single().exceptionOrNull() is CatalogIdentityTimeout)
        deadline.finishRead()
        assertEquals(1, deadline.results.size)
        assertEquals(0, deadline.clock.pending)

        val clockJump = Harness(error(503, PENDING), http(200, """{"late":true}"""))
        clockJump.start()
        clockJump.finishRead()
        clockJump.clock.advanceBy(15_000)
        // Simulate elapsedRealtime advancing during sleep while timer delivery is delayed.
        clockJump.clock.now = 300_000
        clockJump.finishRead()
        assertTrue(clockJump.results.single().exceptionOrNull() is CatalogIdentityTimeout)
        assertEquals(0, clockJump.clock.pending)

        val asleep = Harness(error(503, PENDING), http(200, """{"late":true}"""))
        asleep.start()
        asleep.finishRead()
        asleep.clock.advanceBy(15_000) // A second read is admitted, but its IO does not finish.
        val requestsBeforeSleep = asleep.requests.size
        asleep.clock.sleepBy(300_000) // elapsedRealtime advances; scheduled-executor time does not.
        assertTrue(asleep.results.isEmpty())
        asleep.clock.advanceBy(1_000) // Resume: no finishRead() to accidentally drive expiry.
        assertTrue("sleep-expired preparation must time out promptly without an IO completion",
            asleep.results.singleOrNull()?.exceptionOrNull() is CatalogIdentityTimeout)
        assertEquals(requestsBeforeSleep, asleep.requests.size)
        assertEquals(0, asleep.clock.pending)
        asleep.finishRead()
        assertEquals(1, asleep.results.size)

        val queued = Harness(error(503, PENDING))
        val queuedAttempt = queued.start()
        queued.finishRead()
        queued.queue.submit({ { Unit } }) {} // Unrelated current-account work owns the IO slot.
        queued.clock.advanceBy(15_000)
        queuedAttempt.cancel()
        queued.finishRead() // The queued read only now reaches its sending guard.
        queued.finishRead()
        assertEquals(1, queued.requests.size)
        assertTrue(queued.results.isEmpty())

        val unavailable = Harness(error(503, "SERVER_UNAVAILABLE"))
        unavailable.start()
        unavailable.finishRead()
        assertEquals("SERVER_UNAVAILABLE", (unavailable.results.single().exceptionOrNull() as ApiException).code)
        assertEquals(0, unavailable.waiting)
        assertEquals(0, unavailable.clock.pending)

        val wrongStatus = Harness(error(429, PENDING))
        wrongStatus.start()
        wrongStatus.finishRead()
        assertEquals(429, (wrongStatus.results.single().exceptionOrNull() as ApiException).status)
        assertEquals(0, wrongStatus.waiting)

        val auth = Harness(error(401, "UNAUTHORIZED"), error(503, PENDING), http(200, """{"ready":true}"""))
        val bearerCalls = mutableListOf<Boolean>()
        auth.read = {
            readExitCatalog(auth.api) { force -> bearerCalls.add(force); "fixture-access" }
        }
        auth.start()
        auth.finishRead()
        assertTrue(auth.results.isEmpty())
        auth.clock.advanceBy(15_000)
        auth.finishRead()
        assertEquals(listOf(false, true, false), bearerCalls)
        assertEquals(true, auth.results.single().getOrThrow()["ready"])

        val post = Harness(error(503, PENDING))
        post.read = {
            readExitCatalog(post.api) {
                post.api.post("auth/refresh", mapOf("refreshToken" to "fixture-refresh"))
                "fixture-access"
            }
        }
        post.start()
        post.finishRead()
        assertTrue(post.results.single().exceptionOrNull() is ApiException)
        post.clock.advanceBy(600_000)
        assertEquals(1, post.requests.size)
        assertTrue(post.requests.single().startsWith("POST /api/v1/auth/refresh HTTP/1.1\r\n"))
        assertEquals(0, post.waiting)
        assertEquals(0, post.clock.pending)

        val forcedPost = Harness(error(401, "UNAUTHORIZED"), error(503, PENDING))
        forcedPost.read = {
            readExitCatalog(forcedPost.api) { force ->
                if (force) forcedPost.api.post("auth/refresh", mapOf("refreshToken" to "fixture-refresh"))
                "fixture-access"
            }
        }
        forcedPost.start()
        forcedPost.finishRead()
        assertTrue(forcedPost.results.single().exceptionOrNull() is ApiException)
        forcedPost.clock.advanceBy(600_000)
        assertEquals(2, forcedPost.requests.size)
        assertTrue(forcedPost.requests.last().startsWith("POST /api/v1/auth/refresh HTTP/1.1\r\n"))
        assertEquals(0, forcedPost.waiting)
        assertEquals(0, forcedPost.clock.pending)
    }

    private class Harness(vararg responses: String) {
        val clock = Clock()
        val io = ArrayDeque<() -> Unit>()
        private val engine = ArrayDeque<() -> Unit>()
        val queue = AccountWorkQueue({ io.addLast(it) }, { engine.addLast(it) })
        var current = true
        var waiting = 0
        val results = mutableListOf<Result<Map<String, Any?>>>()
        private val sockets = responses.map(::WireSocket)
        private var nextSocket = 0
        val requests: List<String> get() = sockets.take(nextSocket).map { it.request }
        val api = ControlPlane("https://api.example.invalid/api/v1/", "fixture", emptyList()) { _, _, _ ->
            check(nextSocket < sockets.size) { "unexpected extra HTTP request" }
            sockets[nextSocket++]
        }
        var read: () -> Map<String, Any?> = { readExitCatalog(api) { "fixture-access" } }

        fun start(): CatalogPreparation<Map<String, Any?>> = CatalogPreparation<Map<String, Any?>>(
            nowMs = { clock.now }, schedule = clock::schedule,
            request = { mayRead, done ->
                queue.submit<Result<Map<String, Any?>>?>(prepare = {
                    if (mayRead()) { { runCatching(read) } } else { { null } }
                }, commit = { response -> response.getOrThrow()?.let(done) })
            },
            current = { current }, waiting = { waiting++ }, complete = { results.add(it) },
        ).also { it.start() }

        fun finishRead() { io.removeFirst().invoke(); engine.removeFirst().invoke() }
    }

    private class Clock {
        var now = 0L
        private var awake = 0L
        private class Task(val due: Long, val run: () -> Unit, var cancelled: Boolean = false)
        private val tasks = mutableListOf<Task>()
        val pending: Int get() = tasks.count { !it.cancelled }
        fun schedule(delay: Long, run: () -> Unit): CatalogPreparation.Cancel {
            require(delay >= 0)
            val task = Task(awake + delay, run)
            tasks.add(task)
            return CatalogPreparation.Cancel { task.cancelled = true }
        }
        fun sleepBy(ms: Long) { now += ms }
        fun advanceBy(ms: Long) {
            val end = awake + ms
            while (true) {
                val next = tasks.filter { !it.cancelled && it.due <= end }.minByOrNull { it.due } ?: break
                tasks.remove(next)
                now += next.due - awake
                awake = next.due
                next.run()
            }
            now += end - awake
            awake = end
        }
    }

    private class WireSocket(response: String) : Socket() {
        private val input = ByteArrayInputStream(response.toByteArray(Charsets.UTF_8))
        private val output = ByteArrayOutputStream()
        val request: String get() = output.toString(Charsets.UTF_8.name())
        override fun getInputStream(): InputStream = input
        override fun getOutputStream(): OutputStream = output
        override fun close() {}
    }

    companion object {
        private const val PENDING = "EXIT_IDENTITY_PROPAGATING"
        private fun error(status: Int, code: String) = http(status, """{"error":{"code":"$code","message":"fixture refusal"}}""")
        private fun http(status: Int, body: String) =
            "HTTP/1.1 $status Fixture\r\nContent-Length: ${body.toByteArray(Charsets.UTF_8).size}\r\n\r\n$body"
    }
}
