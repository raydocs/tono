package com.raydocs.tono.mobile.engine

import com.raydocs.tono.routing.Json
import com.raydocs.tono.routing.RoutingMode
import com.raydocs.tono.routing.asArray
import com.raydocs.tono.routing.asObject

/** Engine lifecycle as the user sees it. */
enum class Phase {
    /** No account on this phone. */
    SIGNED_OUT,
    /** Signed in, tunnel off. */
    IDLE,
    /** Android VPN consent missing or revoked; only the UI can ask for it. */
    NEEDS_PERMISSION,
    /** Refreshing the session and fetching the exit catalog. */
    PREPARING,
    /** sing-box starting and the TUN coming up. */
    CONNECTING,
    /** TUN up and the cloud exit answered. */
    CONNECTED,
    /** TUN up; one exit check failed. Matched traffic fails closed, ordinary traffic still works. */
    DEGRADED,
    DISCONNECTING,
    /** Could not connect; the phone's network is untouched. */
    FAILED,
}

enum class ProbeState { UNKNOWN, CHECKING, OK, FAILED }

data class ExitProbe(val state: ProbeState = ProbeState.UNKNOWN, val location: String? = null, val latencyMs: Long? = null)

data class NodeView(val name: String, val city: String, val label: String, val latencyMs: Long? = null)

enum class HomeKind { NONE, RESIDENTIAL, CATALOG_NODE }

data class LoginView(
    val email: String = "",
    val challengeId: String? = null,
    val busy: Boolean = false,
    val errorCode: String? = null,
)

data class EngineSnapshot(
    val phase: Phase = Phase.SIGNED_OUT,
    val reasonCode: String? = null,
    val email: String? = null,
    val login: LoginView = LoginView(),
    val nodes: List<NodeView> = emptyList(),
    val selectedNode: String? = null,
    val homeKind: HomeKind = HomeKind.NONE,
    val homeLabel: String? = null,
    val mode: RoutingMode = RoutingMode.THREE_TIER,
    val excludedPackages: List<String> = emptyList(),
    val connectedSinceMs: Long = 0,
    val cloudProbe: ExitProbe = ExitProbe(),
    val homeProbe: ExitProbe = ExitProbe(),
    val rxBytesPerSec: Long = 0,
    val txBytesPerSec: Long = 0,
    val usingCachedCatalog: Boolean = false,
    val alwaysOn: Boolean = false,
    val lockdown: Boolean = false,
    val underlyingIpv6: Boolean = false,
    val coreVersion: String = "",
    val catalogRevision: Long = 0,
    /** Debug builds only: the engine talks to a local fixture control plane, not the Tono API ([LocalTestServer]). */
    val localTestServer: Boolean = false,
    /** The engine instance that wrote this snapshot (random per service instance; not an account identifier). */
    val session: String = "",
    /** Write counter within [session]; only ever grows. */
    val version: Long = 0,
    /** The tunnel attempt [phase] belongs to ([TunnelLedger]). */
    val attempt: Long = 0,
    /** What the engine confirmed for [attempt], or null. Selections ([selectedNode], [mode]) are not confirmations. */
    val applied: AppliedTunnel? = null,
) {
    /** A tunnel-up phase backed by a confirmation for this attempt ([TunnelAuthority.confirmed]). */
    val tunnelUp: Boolean get() = TunnelAuthority.confirmed(this)

    fun toJson(): String = Json.write(
        linkedMapOf(
            "phase" to phase.name,
            "reasonCode" to reasonCode,
            "email" to email,
            "login" to linkedMapOf("email" to login.email, "challengeId" to login.challengeId, "busy" to login.busy, "errorCode" to login.errorCode),
            "nodes" to nodes.map { linkedMapOf("name" to it.name, "city" to it.city, "label" to it.label, "latencyMs" to it.latencyMs) },
            "selectedNode" to selectedNode,
            "homeKind" to homeKind.name,
            "homeLabel" to homeLabel,
            "mode" to mode.name,
            "excludedPackages" to excludedPackages,
            "connectedSinceMs" to connectedSinceMs,
            "cloudProbe" to probeJson(cloudProbe),
            "homeProbe" to probeJson(homeProbe),
            "rx" to rxBytesPerSec,
            "tx" to txBytesPerSec,
            "cached" to usingCachedCatalog,
            "alwaysOn" to alwaysOn,
            "lockdown" to lockdown,
            "ipv6" to underlyingIpv6,
            "core" to coreVersion,
            "revision" to catalogRevision,
            "localTestServer" to localTestServer,
            "session" to session,
            "version" to version,
            "attempt" to attempt,
            "applied" to applied?.let { linkedMapOf("generation" to it.generation, "node" to it.node, "mode" to it.mode.name) },
        ),
    )

    companion object {
        private fun probeJson(p: ExitProbe) = linkedMapOf("state" to p.state.name, "location" to p.location, "latencyMs" to p.latencyMs)

        private fun probe(o: Any?): ExitProbe {
            val m = o.asObject()
            return ExitProbe(ProbeState.valueOf(m["state"] as String), m["location"] as String?, (m["latencyMs"] as Number?)?.toLong())
        }

        /** Missing or malformed confirmation fields (an older engine) decode as unconfirmed; the result is sealed. */
        private fun applied(o: Any?): AppliedTunnel? = runCatching {
            val a = o as? Map<*, *> ?: return null
            AppliedTunnel((a["generation"] as Number).toLong(), a["node"] as String?, RoutingMode.valueOf(a["mode"] as String))
        }.getOrNull()

        fun fromJson(text: String): EngineSnapshot {
            val m = Json.parse(text).asObject()
            val login = m["login"].asObject()
            return TunnelAuthority.seal(EngineSnapshot(
                phase = Phase.valueOf(m["phase"] as String),
                reasonCode = m["reasonCode"] as String?,
                email = m["email"] as String?,
                login = LoginView(login["email"] as String, login["challengeId"] as String?, login["busy"] as Boolean, login["errorCode"] as String?),
                nodes = m["nodes"].asArray().map { n ->
                    val o = n.asObject()
                    NodeView(o["name"] as String, o["city"] as String, o["label"] as String, (o["latencyMs"] as Number?)?.toLong())
                },
                selectedNode = m["selectedNode"] as String?,
                homeKind = HomeKind.valueOf(m["homeKind"] as String),
                homeLabel = m["homeLabel"] as String?,
                mode = RoutingMode.valueOf(m["mode"] as String),
                excludedPackages = m["excludedPackages"].asArray().map { it as String },
                connectedSinceMs = (m["connectedSinceMs"] as Number).toLong(),
                cloudProbe = probe(m["cloudProbe"]),
                homeProbe = probe(m["homeProbe"]),
                rxBytesPerSec = (m["rx"] as Number).toLong(),
                txBytesPerSec = (m["tx"] as Number).toLong(),
                usingCachedCatalog = m["cached"] as Boolean,
                alwaysOn = m["alwaysOn"] as Boolean,
                lockdown = m["lockdown"] as Boolean,
                underlyingIpv6 = m["ipv6"] as Boolean,
                coreVersion = m["core"] as String,
                catalogRevision = (m["revision"] as Number).toLong(),
                localTestServer = m["localTestServer"] as? Boolean ?: false,
                session = m["session"] as? String ?: "",
                version = (m["version"] as? Number)?.toLong() ?: 0,
                attempt = (m["attempt"] as? Number)?.toLong() ?: 0,
                applied = applied(m["applied"]),
            ))
        }
    }
}
