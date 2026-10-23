package com.raydocs.tono.mobile.engine

/**
 * Why the tunnel ended, and what the notification may honestly say about it.
 *
 * - [USER]: the user tapped Disconnect/Cancel. They know; no notice, and any earlier notice goes.
 * - [REVOKED]: Android took the VPN away (another VPN app, or consent withdrawn in Settings).
 *   Retry cannot help until consent is given again, so the action opens Tono.
 * - [RECOVERABLE]: the core stopped or an automatic attempt failed; Retry may work.
 *
 * Under Always-on Lockdown Android blocks traffic outside the VPN, so a notice must never tell
 * the user their traffic is now going out directly: it says the network stays blocked instead.
 * Without Lockdown the honest statement is that apps are now on the phone's own network.
 */
enum class StopKind { USER, REVOKED, RECOVERABLE }

enum class StopAction { NONE, OPEN, RETRY }

enum class StopTitle { REVOKED, STOPPED }

enum class StopBody { REVOKED_LOCKDOWN, REVOKED_OPEN, FAILED_LOCKDOWN, FAILED_OPEN }

data class StopNotice(val title: StopTitle, val body: StopBody, val action: StopAction, val reasonCode: String?)

object StopNotices {
    /** Null means post nothing (and cancel any earlier notice). */
    fun of(kind: StopKind, lockdown: Boolean, code: String?): StopNotice? = when (kind) {
        StopKind.USER -> null
        StopKind.REVOKED -> StopNotice(
            StopTitle.REVOKED,
            if (lockdown) StopBody.REVOKED_LOCKDOWN else StopBody.REVOKED_OPEN,
            StopAction.OPEN,
            null,
        )
        StopKind.RECOVERABLE -> StopNotice(
            StopTitle.STOPPED,
            if (lockdown) StopBody.FAILED_LOCKDOWN else StopBody.FAILED_OPEN,
            StopAction.RETRY,
            code,
        )
    }
}
