package com.raydocs.tono.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.HomeKind
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.routing.RoutingMode

@Composable
fun isChinese(): Boolean = LocalConfiguration.current.locales[0].language == "zh"

@Composable
fun phaseTitle(p: Phase): String = stringResource(
    when (p) {
        Phase.SIGNED_OUT -> R.string.state_signed_out
        Phase.IDLE -> R.string.state_idle
        Phase.NEEDS_PERMISSION -> R.string.state_permission
        Phase.PREPARING -> R.string.state_preparing
        Phase.CONNECTING -> R.string.state_connecting
        Phase.CONNECTED -> R.string.state_connected
        Phase.DEGRADED -> R.string.state_degraded
        Phase.DISCONNECTING -> R.string.state_disconnecting
        Phase.FAILED -> R.string.state_failed
    },
)

@Composable
fun phaseSentence(s: EngineSnapshot): String? = when (s.phase) {
    Phase.IDLE -> stringResource(R.string.sentence_idle)
    Phase.NEEDS_PERMISSION -> stringResource(R.string.sentence_permission)
    Phase.PREPARING -> stringResource(R.string.sentence_preparing)
    Phase.CONNECTING -> stringResource(R.string.sentence_connecting)
    Phase.CONNECTED -> stringResource(
        when {
            s.homeKind == HomeKind.NONE -> R.string.sentence_connected_no_home
            s.mode == RoutingMode.STABLE -> R.string.sentence_connected_stable
            else -> R.string.sentence_connected_three_tier
        },
    )
    else -> null
}

@Composable
fun reasonText(code: String): String = when (code) {
    "HOME_UNAVAILABLE" -> stringResource(R.string.reason_HOME_UNAVAILABLE)
    "NETWORK" -> stringResource(R.string.reason_NETWORK)
    "RATE_LIMITED" -> stringResource(R.string.reason_RATE_LIMITED)
    "CORE_START" -> stringResource(R.string.reason_CORE_START)
    "CLOUD_UNREACHABLE" -> stringResource(R.string.reason_CLOUD_UNREACHABLE)
    "HOME_UNREACHABLE" -> stringResource(R.string.reason_HOME_UNREACHABLE)
    "REVOKED" -> stringResource(R.string.reason_REVOKED)
    "DENIED" -> stringResource(R.string.reason_DENIED)
    "SESSION_ENDED" -> stringResource(R.string.reason_SESSION_ENDED)
    "CATALOG_ROLLBACK" -> stringResource(R.string.reason_CATALOG_ROLLBACK)
    "CORE_STOPPED" -> stringResource(R.string.reason_CORE_STOPPED)
    else -> stringResource(R.string.reason_generic, code)
}

@Composable
fun signInError(code: String): String = when (code) {
    "INVALID_EMAIL" -> stringResource(R.string.signin_error_INVALID_EMAIL)
    "INVALID_CODE" -> stringResource(R.string.signin_error_INVALID_CODE)
    "INVALID_OR_EXPIRED_CODE" -> stringResource(R.string.signin_error_INVALID_OR_EXPIRED_CODE)
    "NETWORK" -> stringResource(R.string.signin_error_NETWORK)
    "RATE_LIMITED" -> stringResource(R.string.signin_error_RATE_LIMITED)
    "DEVICE_LIMIT" -> stringResource(R.string.signin_error_DEVICE_LIMIT)
    else -> stringResource(R.string.signin_error_generic, code)
}
