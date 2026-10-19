package com.raydocs.tono.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.HomeKind
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.routing.RoutingMode

@Composable
fun isChinese(): Boolean = uiLocale().language == "zh"

/**
 * The language the strings on screen are in. Read from the same resources as stringResource, because
 * a bottom sheet's window re-provides LocalConfiguration from the activity (device check: Chinese
 * Details showed "Japan").
 */
@Composable
fun uiLocale(): java.util.Locale = LocalResources.current.configuration.locales[0]

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

/** One-line summary of where traffic goes in the current mode (Details). */
@Composable
fun routingSummary(s: EngineSnapshot): String = stringResource(
    when {
        s.homeKind == HomeKind.NONE && s.mode == RoutingMode.STABLE -> R.string.sentence_connected_stable_no_home
        s.homeKind == HomeKind.NONE -> R.string.sentence_connected_no_home
        s.mode == RoutingMode.STABLE -> R.string.sentence_connected_stable
        else -> R.string.sentence_connected_three_tier
    },
)

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

/** Short reason resource for a known code; unknown codes are shown with the code itself. */
fun shortReasonRes(code: String): Int? = when (code) {
    "HOME_UNAVAILABLE" -> R.string.short_HOME_UNAVAILABLE
    "NETWORK" -> R.string.short_NETWORK
    "RATE_LIMITED" -> R.string.short_RATE_LIMITED
    "CORE_START" -> R.string.short_CORE_START
    "CLOUD_UNREACHABLE" -> R.string.short_CLOUD_UNREACHABLE
    "HOME_UNREACHABLE" -> R.string.short_HOME_UNREACHABLE
    "REVOKED" -> R.string.short_REVOKED
    "DENIED" -> R.string.short_DENIED
    "SESSION_ENDED" -> R.string.short_SESSION_ENDED
    "CATALOG_ROLLBACK" -> R.string.short_CATALOG_ROLLBACK
    "CORE_STOPPED" -> R.string.short_CORE_STOPPED
    else -> null
}

@Composable
fun shortReason(code: String): String = shortReasonRes(code)?.let { stringResource(it) } ?: stringResource(R.string.short_generic, code)

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

/** A probe's ISO country code in the UI language, which can differ from the process default (per-app language). */
@Composable
fun countryName(code: String): String = Format.country(code, uiLocale())
