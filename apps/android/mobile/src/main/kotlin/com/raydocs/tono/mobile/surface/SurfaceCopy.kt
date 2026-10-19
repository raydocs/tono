package com.raydocs.tono.mobile.surface

import android.content.Context
import android.text.format.DateFormat
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.ui.Format
import com.raydocs.tono.mobile.ui.shortReasonRes

/** Words for the tile and widget, from the same strings as the app. */
object SurfaceCopy {
    fun title(c: Context, v: SurfaceView): String = c.getString(
        when (v.state) {
            SurfaceState.SIGNED_OUT -> R.string.state_signed_out
            SurfaceState.OFF -> R.string.state_idle
            SurfaceState.NEEDS_PERMISSION -> R.string.state_permission
            SurfaceState.BUSY -> if (v.status?.phase == Phase.DISCONNECTING) R.string.state_disconnecting else R.string.state_connecting
            SurfaceState.CONNECTED -> R.string.state_connected
            SurfaceState.DEGRADED -> R.string.state_degraded
            SurfaceState.FAILED -> R.string.state_failed
            SurfaceState.UNKNOWN -> R.string.surface_unknown
        },
    )

    fun detail(c: Context, v: SurfaceView): String {
        val s = v.status
        fun reason() = s?.reasonCode?.let { code -> shortReasonRes(code)?.let(c::getString) ?: c.getString(R.string.short_generic, code) }
        return when (v.state) {
            SurfaceState.SIGNED_OUT -> c.getString(R.string.surface_open_to_sign_in)
            SurfaceState.NEEDS_PERMISSION -> c.getString(R.string.surface_open_to_allow)
            SurfaceState.CONNECTED -> when {
                s?.cloud != null && s.home != null -> c.getString(R.string.status_exit_both, Format.country(s.cloud), Format.country(s.home))
                s?.cloud != null -> c.getString(R.string.status_exit_cloud, Format.country(s.cloud))
                // The line the confirmed tunnel uses; the selected one is not current.
                else -> s?.appliedLine ?: ""
            }
            SurfaceState.DEGRADED -> reason() ?: s?.appliedLine ?: ""
            SurfaceState.FAILED -> reason() ?: s?.line ?: ""
            SurfaceState.OFF, SurfaceState.BUSY -> s?.line ?: c.getString(R.string.surface_open_to_pick)
            // Says what was last known and when, so a stale record is never mistaken for the present.
            SurfaceState.UNKNOWN -> if (s == null) c.getString(R.string.surface_open_to_check) else c.getString(
                R.string.surface_last_known,
                title(c, SurfaceView(SurfaceRules.claimed(s), s)),
                DateFormat.getTimeFormat(c).format(s.updatedAtMs),
            )
        }
    }
}
