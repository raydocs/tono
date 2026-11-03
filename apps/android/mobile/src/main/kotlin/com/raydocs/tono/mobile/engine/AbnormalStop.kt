package com.raydocs.tono.mobile.engine

/**
 * The VPN process is going away while the user still wanted the tunnel, and neither a disconnect
 * nor a consent revoke already explained that stop.
 */
object AbnormalStop {
    fun shouldNotify(wantConnected: Boolean, userOrRevokeStop: Boolean): Boolean =
        wantConnected && !userOrRevokeStop
}
