package com.raydocs.tono.mobile.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AbnormalStopTest {
    @Test fun aWantedTunnelThatDiesWithoutAUserStopIsAnnounced() {
        assertTrue(AbnormalStop.shouldNotify(wantConnected = true, userOrRevokeStop = false))
    }

    @Test fun aUserStopOrRevokeOrAnIdleProcessIsSilent() {
        assertFalse(AbnormalStop.shouldNotify(wantConnected = true, userOrRevokeStop = true))
        assertFalse(AbnormalStop.shouldNotify(wantConnected = false, userOrRevokeStop = false))
        assertFalse(AbnormalStop.shouldNotify(wantConnected = false, userOrRevokeStop = true))
    }
}
