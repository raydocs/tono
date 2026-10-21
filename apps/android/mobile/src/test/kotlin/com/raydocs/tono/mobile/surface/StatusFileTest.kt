package com.raydocs.tono.mobile.surface

import com.raydocs.tono.mobile.engine.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The shared status file and the death log on a real temporary directory: no write replaces a
 * newer record, a failed rename is reported, concurrent writers leave the newest record, and a
 * death recorded for one engine instance (or another boot) does not reach another.
 */
class StatusFileTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun record(session: String, version: Long, elapsedMs: Long, phase: Phase = Phase.CONNECTED, boot: Int = 7) =
        PublicStatus(phase, updatedAtMs = 0, boot = boot, session = session, version = version, attempt = 1, confirmed = phase == Phase.CONNECTED, elapsedMs = elapsedMs)

    @Test fun anOlderWriteFromTheSameEngineNeverReplacesANewerOne() {
        val file = StatusFile(tmp.root)
        assertTrue(file.write(record("engine-a", version = 5, elapsedMs = 100, phase = Phase.IDLE)))
        assertFalse(file.write(record("engine-a", version = 4, elapsedMs = 200)))
        assertEquals(Phase.IDLE, file.read()?.phase)
        assertEquals(5L, file.read()?.version)
    }

    @Test fun aWriteFromAnEarlierMomentOfAnotherEngineIsRefused() {
        // The restarted engine's record is on disk; a write the old instance sampled before it must not land over it.
        val file = StatusFile(tmp.root)
        assertTrue(file.write(record("engine-b", version = 1, elapsedMs = 5_000)))
        assertFalse(file.write(record("engine-a", version = 90, elapsedMs = 4_000)))
        assertEquals("engine-b", file.read()?.session)
    }

    @Test fun aNewBootsEngineReplacesTheLastBootsRecord() {
        val file = StatusFile(tmp.root)
        assertTrue(file.write(record("engine-a", version = 90, elapsedMs = 9_000_000, boot = 6)))
        assertTrue(file.write(record("engine-b", version = 1, elapsedMs = 2_000, boot = 7)))
        assertEquals("engine-b", file.read()?.session)
    }

    @Test fun aFailedRenameIsReportedAndLeavesNoTemporaryFile() {
        // A non-empty directory where the record belongs: rename(2) cannot replace it.
        File(tmp.root, "status.json/blocker").apply { parentFile!!.mkdirs(); writeText("x") }
        val file = StatusFile(tmp.root)
        assertFalse(file.write(record("engine-a", version = 1, elapsedMs = 1)))
        assertEquals(emptyList<String>(), tmp.root.list()!!.filter { it.endsWith(".tmp") })
    }

    @Test fun concurrentWritersLeaveTheNewestVersionOnDisk() {
        val file = StatusFile(tmp.root)
        val pool = Executors.newFixedThreadPool(4)
        val start = CountDownLatch(1)
        // Four writers, interleaved versions 1..400 of one engine instance, in no particular order.
        val jobs = (0 until 4).map { w ->
            pool.submit(
                Runnable {
                    start.await()
                    for (i in 0 until 100) file.write(record("engine-a", version = (i * 4 + w + 1).toLong(), elapsedMs = 1))
                },
            )
        }
        start.countDown()
        jobs.forEach { it.get(30, TimeUnit.SECONDS) }
        pool.shutdown()
        assertEquals(400L, file.read()?.version)
        assertEquals(emptyList<String>(), tmp.root.list()!!.filter { it.endsWith(".tmp") })
    }

    @Test fun aDeathNamesOneEngineInstanceAndOneBoot() {
        val log = DeathLog(tmp.root)
        assertTrue(log.record("engine-a", boot = 7))
        assertEquals(setOf("engine-a"), log.read(boot = 7))
        assertEquals("a death from the last boot is not this boot's", emptySet<String>(), log.read(boot = 8))
        assertFalse("an engine never heard from records nothing", log.record("", boot = 7))
    }

    @Test fun theDeathLogKeepsTheMostRecentInstances() {
        val log = DeathLog(tmp.root)
        for (i in 1..DeathLog.KEEP + 3) log.record("engine-$i", boot = 7)
        val kept = log.read(boot = 7)
        assertEquals(DeathLog.KEEP, kept.size)
        assertTrue("engine-${DeathLog.KEEP + 3}" in kept)
        assertFalse("engine-1" in kept)
    }
}
