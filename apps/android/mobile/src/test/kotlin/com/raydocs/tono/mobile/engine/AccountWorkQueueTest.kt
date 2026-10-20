package com.raydocs.tono.mobile.engine

import org.junit.Assert.*
import org.junit.Test

class AccountWorkQueueTest {
    private val io = ArrayDeque<() -> Unit>()
    private val engine = ArrayDeque<() -> Unit>()
    private val queue = AccountWorkQueue({ io.addLast(it) }, { engine.addLast(it) })
    private fun finish() { io.removeFirst().invoke(); engine.removeFirst().invoke() }

    @Test fun oldAccountsDelayedCatalogCannotCommitAfterAccountSwitch() {
        var cacheOwner = "account-b"
        queue.submit({ { "account-a" } }) { cacheOwner = it.getOrThrow() }
        queue.invalidate()
        finish()
        assertEquals("account-b", cacheOwner)
    }

    @Test fun queuedRefreshReadsCredentialsOnlyAfterPreviousRotationCommits() {
        var credentialVersion = 0
        val usedVersions = mutableListOf<Int>()
        fun refresh() = queue.submit({
            val captured = credentialVersion
            val work: () -> Int = { usedVersions.add(captured); captured + 1 }
            work
        }) { credentialVersion = it.getOrThrow() }
        refresh(); refresh()
        assertEquals(1, io.size)
        finish(); finish()
        assertEquals(listOf(0, 1), usedVersions)
        assertEquals(2, credentialVersion)
    }

    @Test fun signOutDropsPendingCatalogAndDoesNotEndNewAccountOnOldFailure() {
        var ended = false
        var pendingStarted = false
        queue.submit<String>({ { error("old request failed") } }) { ended = it.isFailure }
        queue.submit({ pendingStarted = true; { Unit } }) { }
        queue.invalidate()
        finish()
        assertFalse(ended)
        assertFalse(pendingStarted)
        var newAccountCommitted = false
        queue.submit({ { Unit } }) { newAccountCommitted = true }
        finish()
        assertTrue(newAccountCommitted)
    }

    @Test fun cancelledVerificationCannotRestoreAnIdentity() {
        val login = RequestEpoch()
        val verify = login.next()
        login.next() // Use another email / cancel / sign out.
        var saved = false
        if (login.accepts(verify)) saved = true
        assertFalse(saved)
    }

    @Test fun olderEmailStartCannotReplaceNewChallenge() {
        val login = RequestEpoch()
        val old = login.next()
        val replacement = login.next()
        assertFalse(login.accepts(old))
        assertTrue(login.accepts(replacement))
    }
}
