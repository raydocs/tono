package com.raydocs.tono.mobile.engine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.TrafficStats
import android.net.VpnService
import android.os.Build
import android.os.IBinder
import android.os.Process
import android.os.RemoteCallbackList
import android.os.SystemClock
import android.util.Log
import com.raydocs.tono.mobile.BuildConfig
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.ipc.ITonoEngine
import com.raydocs.tono.mobile.ipc.ITonoEngineListener
import com.raydocs.tono.mobile.surface.NotificationWatchdog
import com.raydocs.tono.mobile.surface.SystemSurfaces
import com.raydocs.tono.routing.CatalogAdmission
import com.raydocs.tono.routing.CatalogRejected
import com.raydocs.tono.routing.ConfigInput
import com.raydocs.tono.routing.ExitCatalog
import com.raydocs.tono.routing.HomeTarget
import com.raydocs.tono.routing.Json
import com.raydocs.tono.routing.RouteExplainer
import com.raydocs.tono.routing.RoutingMode
import com.raydocs.tono.routing.SingBoxConfig
import com.raydocs.tono.routing.asObject
import io.nekohasekai.libbox.CommandServer
import io.nekohasekai.libbox.CommandServerHandler
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.OverrideOptions
import io.nekohasekai.libbox.SetupOptions
import io.nekohasekai.libbox.SystemProxyStatus
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Tono's engine: account session, exit catalog, sing-box configuration and the VPN tunnel.
 * Runs in the private `:vpn` process. All state changes happen on one serial executor; the UI
 * reads JSON snapshots and sends JSON commands over [ITonoEngine].
 */
class TonoVpnService : VpnService() {
    private val engine = Executors.newSingleThreadScheduledExecutor { Thread(it, "tono-engine") }
    private val io = Executors.newCachedThreadPool()
    private val listeners = RemoteCallbackList<ITonoEngineListener>()
    private val snapshot = AtomicReference(EngineSnapshot(coreVersion = BuildConfig.SING_BOX_VERSION))
    /**
     * False until [restore] has read the account and settings. Before that the snapshot is a
     * placeholder (signed out, nothing known), and no client is shown it.
     */
    @Volatile private var restored = false

    /** A signed-out snapshot; keeps the local-test-server mark, which belongs to the process, not the account. */
    private fun signedOut(phase: Phase = Phase.SIGNED_OUT, reasonCode: String? = null, mode: RoutingMode, excluded: List<String> = emptyList()) =
        EngineSnapshot(coreVersion = BuildConfig.SING_BOX_VERSION, phase = phase, reasonCode = reasonCode, mode = mode, excludedPackages = excluded, localTestServer = localTestServer)
    private lateinit var store: EngineStore
    private lateinit var api: ControlPlane
    private lateinit var monitor: NetworkMonitor
    private lateinit var platform: BoxPlatform
    /** Bumped whenever a pending catalog wait must stop (disconnect, revoke, sign-out, teardown). */
    private val catalogWait = java.util.concurrent.atomic.AtomicLong()
    private val propagationWait = PropagationWait()
    private var commandServer: CommandServer? = null
    @Volatile private var catalog: ExitCatalog? = null
    private var accessToken: String? = null
    private val loginRequests = RequestEpoch()
    private val accountWork = AccountWorkQueue({ io.execute(it) }, { engine.execute(it) })
    private var trafficTask: ScheduledFuture<*>? = null
    @Volatile private var foreground = false
    /** Attempts and their confirmation (engine thread only); the single writer of [EngineSnapshot.applied]. */
    private val ledger = TunnelLedger()
    /** This service instance; stamps every snapshot, the shared status and the ongoing notification. */
    private val session = EngineStore.randomHex(8)
    /** Set once [onDestroy] has drained the engine thread: a late task of this instance writes nothing. */
    @Volatile private var retired = false
    /** The phone's own network the exits were last checked over (engine thread only). */
    private var lastUnderlying: Network? = null
    private val probeRequests = ProbeEpoch<Network>()
    private lateinit var apiBase: String
    private var localTestServer = false

    override fun onCreate() {
        super.onCreate()
        // First: a fresh engine has no tunnel, whatever notification Android re-posted for it.
        runCatching { NotificationWatchdog.engineStarting(this, session) }
        store = EngineStore(this)
        val local = LocalTestServer.apiBase(this)
        localTestServer = local != null
        apiBase = local ?: BuildConfig.API_BASE
        api = ControlPlane(apiBase, BuildConfig.VERSION_NAME.substringBefore('-'))
        // Before restore() runs, so every snapshot built from here on carries the mark.
        snapshot.set(snapshot.get().copy(localTestServer = localTestServer, session = session))
        val connectivity = getSystemService(ConnectivityManager::class.java)
        monitor = NetworkMonitor(connectivity)
        monitor.start()
        platform = BoxPlatform(this, connectivity, monitor)
        monitor.addListener { u -> engine.execute { onUnderlyingChanged(u) } }
        createChannel()
        engine.execute { restore() }
    }

    override fun onBind(intent: Intent?): IBinder? =
        if (intent?.action == SERVICE_INTERFACE) super.onBind(intent) else binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> { enterForeground(); engine.execute { connect(userInitiated = true) } }
            ACTION_DISCONNECT -> engine.execute { disconnect(reason = null); clearStopNotice() }
            // Always-on VPN or a restart after the OS reclaimed the process.
            SERVICE_INTERFACE, null -> {
                if (store.settings().wantConnected || intent?.action == SERVICE_INTERFACE) {
                    // A restart request for an engine that already runs the tunnel changes nothing.
                    enterForeground(); engine.execute { if (!snapshot.get().tunnelUp) connect(userInitiated = false) }
                } else if (!foreground) {
                    // Started again with no tunnel wanted (the app reviving a dead engine): bound only.
                    stopSelf(startId)
                }
            }
        }
        return START_STICKY
    }

    override fun onRevoke() {
        // Another VPN took over or the user revoked consent in Settings.
        engine.execute {
            val lockdown = lockdownNow()
            catalogWait.incrementAndGet()
            stopCore()
            store.update { it.copy(wantConnected = false) }
            update { ledger.end(it, Phase.NEEDS_PERMISSION, "REVOKED") }
            leaveForeground()
            postRevoked(lockdown)
        }
    }

    override fun onDestroy() {
        catalogWait.incrementAndGet()
        engine.execute { accountWork.invalidate(); loginRequests.next(); stopCore(); platform.release() }
        engine.shutdown()
        engine.awaitTermination(3, TimeUnit.SECONDS)
        retired = true
        monitor.stop()
        listeners.kill()
        super.onDestroy()
    }

    // ---- state -------------------------------------------------------------------------------

    private fun update(block: (EngineSnapshot) -> EngineSnapshot) {
        if (retired) return
        val before = snapshot.get()
        // Sealed: no tunnel-up phase leaves the engine without a confirmation for its attempt.
        val next = TunnelAuthority.seal(block(before)).copy(session = session, version = before.version + 1)
        snapshot.set(next)
        broadcast(next.toJson())
        if (foreground) notify(next)
        SystemSurfaces.publish(this, next)
        if (next.tunnelUp && !before.tunnelUp) getSystemService(NotificationManager::class.java).cancel(NOTICE_ID)
    }

    private fun broadcast(json: String) {
        val n = listeners.beginBroadcast()
        for (i in 0 until n) runCatching { listeners.getBroadcastItem(i).onSnapshot(json) }
        listeners.finishBroadcast()
    }

    private fun restore() {
        // An account belongs to the control plane it was made on: switching between the Tono API and a
        // local test server signs out instead of sending one server's tokens to the other.
        if (store.refreshToken() != null && (store.settings().accountApi ?: BuildConfig.API_BASE) != apiBase) store.clearAccount()
        val s = store.settings()
        val signedIn = store.refreshToken() != null
        val cached = if (signedIn) store.cachedCatalogBody()?.let { runCatching { CatalogAdmission.admit(Json.parse(it).asObject()) }.getOrNull() } else null
        catalog = cached
        update {
            it.copy(
                phase = if (signedIn) Phase.IDLE else Phase.SIGNED_OUT,
                email = s.email,
                mode = s.mode,
                excludedPackages = s.excludedPackages,
                selectedNode = s.selectedNode,
                underlyingIpv6 = monitor.current?.globalIpv6 == true,
                localTestServer = localTestServer,
            ).withCatalog(cached)
        }
        restored = true
        // The app may have put "Status unknown" over a dead predecessor's notification; a restarted
        // engine that is not running a tunnel has nothing ongoing to show.
        if (!foreground) getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
        // A client that registered while the update above was broadcasting got nothing: send again.
        broadcast(snapshot.get().toJson())
        if (signedIn && cached == null) refreshCatalogQuietly()
    }

    private fun EngineSnapshot.withCatalog(c: ExitCatalog?): EngineSnapshot {
        if (c == null) return this
        val selected = selectedNode?.takeIf { name -> c.cloudNodes.any { it.name == name } }
            ?: c.defaultCloudNode ?: c.cloudNodes.first().name
        val latency = nodes.associate { it.name to it.latencyMs }
        return copy(
            nodes = c.cloudNodes.map { NodeView(it.name, it.city, it.label, latency[it.name]) },
            selectedNode = selected,
            homeKind = when (c.home) {
                is HomeTarget.Socks5 -> HomeKind.RESIDENTIAL
                is HomeTarget.CatalogNode -> HomeKind.CATALOG_NODE
                null -> HomeKind.NONE
            },
            homeLabel = (c.home as? HomeTarget.CatalogNode)?.node?.city,
            catalogRevision = c.revision,
        )
    }

    // ---- account -----------------------------------------------------------------------------

    private fun startEmail(email: String) {
        val normalized = email.trim().lowercase()
        if (!normalized.matches(Regex("^[^@\\s]{1,64}@[^@\\s]+\\.[^@\\s]{2,}$"))) {
            update { it.copy(login = it.login.copy(email = normalized, errorCode = "INVALID_EMAIL")) }
            return
        }
        val request = loginRequests.next()
        val s = store.settings()
        update { it.copy(login = LoginView(email = normalized, busy = true)) }
        io.execute {
            val result = runCatching {
                api.post("auth/email/start", linkedMapOf("email" to normalized, "deviceName" to s.deviceName, "installationId" to s.installationId))
            }
            engine.execute {
                if (!loginRequests.accepts(request)) return@execute
                result.onSuccess { body ->
                    update { it.copy(login = LoginView(email = normalized, challengeId = body["challengeId"] as? String)) }
                }.onFailure { e ->
                    update { it.copy(login = it.login.copy(busy = false, errorCode = errorCode(e))) }
                }
            }
        }
    }

    private fun verifyCode(code: String) {
        val login = snapshot.get().login
        val challenge = login.challengeId ?: return
        if (!code.matches(Regex("^\\d{6}$"))) {
            update { it.copy(login = it.login.copy(errorCode = "INVALID_CODE")) }
            return
        }
        val request = loginRequests.next()
        update { it.copy(login = it.login.copy(busy = true, errorCode = null)) }
        io.execute {
            val result = runCatching { api.post("auth/email/verify", linkedMapOf("challengeId" to challenge, "code" to code)) }
            engine.execute {
                if (!loginRequests.accepts(request)) return@execute
                result.onSuccess { body ->
                    val access = body["accessToken"] as? String
                    val refresh = body["refreshToken"] as? String
                    if (access == null || refresh == null) {
                        update { it.copy(login = it.login.copy(busy = false, errorCode = "SERVER_ERROR")) }
                        return@execute
                    }
                    catalogWait.incrementAndGet()
                    accountWork.invalidate()
                    loginRequests.next()
                    stopCore()
                    leaveForeground()
                    store.clearAccount()
                    catalog = null
                    store.saveTokens(access, refresh)
                    accessToken = access
                    val email = ((body["user"] as? Map<*, *>)?.get("email") as? String) ?: login.email
                    store.update { it.copy(email = email, accountApi = apiBase) }
                    update { ledger.end(signedOut(phase = Phase.IDLE, mode = it.mode, excluded = it.excludedPackages).copy(email = email), Phase.IDLE, null) }
                    refreshCatalogQuietly()
                }.onFailure { e ->
                    update { it.copy(login = it.login.copy(busy = false, errorCode = errorCode(e))) }
                }
            }
        }
    }

    private fun signOut() {
        catalogWait.incrementAndGet()
        accountWork.invalidate()
        loginRequests.next()
        stopCore()
        leaveForeground()
        val access = accessToken ?: store.accessToken()
        val refresh = store.refreshToken()
        if (access != null) io.execute { runCatching { api.post("auth/logout", refresh?.let { linkedMapOf("refreshToken" to it) }, access) } }
        store.clearAccount()
        accessToken = null
        catalog = null
        update { ledger.end(signedOut(mode = it.mode, excluded = it.excludedPackages), Phase.SIGNED_OUT, null) }
    }

    // ---- catalog -----------------------------------------------------------------------------

    /** Captured on the engine thread. Never consult the current account from a delayed IO job. */
    private class CatalogInput(
        var access: String?, var refresh: String?, val settings: EngineSettings, val cachedBody: String?,
        val waitEpoch: Long = 0,
    )
    private class CatalogResponse(val input: CatalogInput, val result: Result<LoadedCatalog>)
    private class LoadedCatalog(
        val catalog: ExitCatalog, val cached: Boolean, val body: String?, val fetchedAt: Long,
    )

    /** IO-only: no token, catalog, settings or snapshot writes here. */
    private fun loadCatalog(input: CatalogInput): LoadedCatalog {
        var access = input.access
        var refresh = input.refresh
        fun bearer(force: Boolean = false): String {
            val previous = access
            if (!force && previous != null && !jwtExpiringSoon(previous)) return previous
            val token = refresh ?: throw ApiException(401, "SIGNED_OUT", "not signed in")
            val response = api.post("auth/refresh", linkedMapOf("refreshToken" to token))
            access = response["accessToken"] as? String ?: throw ApiException(500, "SERVER_ERROR", "no access token")
            refresh = response["refreshToken"] as? String ?: token
            input.access = access
            input.refresh = refresh
            return access!!
        }
        val waitEpoch = input.waitEpoch
        return try {
            // A new device's exit identity is not served until an exit node acknowledges it: wait (bounded),
            // instead of failing the connect. Cancelled by disconnect, revoke, sign-out or teardown.
            val body = propagationWait.run(cancelled = { catalogWait.get() != waitEpoch || retired }) {
                try { api.get("exit-catalog", bearer()) } catch (e: ApiException) {
                    if (e.status != 401 || e.code == "INVALID_REFRESH_TOKEN") throw e
                    api.get("exit-catalog", bearer(force = true))
                }
            }
            val admitted = CatalogAdmission.admit(body)
            if (admitted.revision < input.settings.catalogRevision) throw CatalogRejected("CATALOG_ROLLBACK", "catalog revision went backwards")
            LoadedCatalog(admitted, false, Json.write(body), System.currentTimeMillis())
        } catch (e: ApiException) {
            val fresh = System.currentTimeMillis() - input.settings.catalogFetchedAtMs in 0 until CACHE_MAX_AGE_MS
            if (e.code == "NETWORK" && input.cachedBody != null && fresh) {
                LoadedCatalog(CatalogAdmission.admit(Json.parse(input.cachedBody).asObject()), true, null, input.settings.catalogFetchedAtMs)
            } else throw e
        }
    }

    private fun requestCatalog(commit: (Result<LoadedCatalog>) -> Unit) {
        // Serialized within the account, including refresh rotation. Invalidation happens before
        // clearing/replacing credentials. The queue checks ownership BEFORE any persistent write.
        accountWork.submit(prepare = {
            val input = CatalogInput(accessToken ?: store.accessToken(), store.refreshToken(), store.settings(), store.cachedCatalogBody(), catalogWait.get())
            val work: () -> CatalogResponse = { CatalogResponse(input, runCatching { loadCatalog(input) }) }
            work
        }, commit = { response ->
            val outcome = response.getOrElse { commit(Result.failure(it)); return@submit }
            val input = outcome.input
            val access = input.access
            val refresh = input.refresh
            if (access != null && refresh != null) {
                store.saveTokens(access, refresh)
                accessToken = access
            }
            val result = outcome.result
            result.onSuccess { loaded ->
                loaded.body?.let { body ->
                    store.saveCatalogBody(body)
                    store.update { it.copy(catalogKey = loaded.catalog.key, catalogRevision = loaded.catalog.revision, catalogFetchedAtMs = loaded.fetchedAt) }
                }
            }
            commit(result)
        })
    }

    private fun refreshCatalogQuietly() {
        val gen = ledger.attempt
        requestCatalog { result ->
            if (!ledger.isCurrent(gen)) return@requestCatalog
            result.onSuccess { loaded ->
                val c = loaded.catalog
                val restart = c != catalog && snapshot.get().let { it.tunnelUp || it.phase == Phase.CONNECTING }
                catalog = c
                update {
                    val refreshed = it.withCatalog(c).copy(usingCachedCatalog = loaded.cached)
                    if (restart) ledger.begin(refreshed, Phase.CONNECTING) else refreshed
                }
                if (restart) startCore(ledger.attempt)
            }.onFailure { e -> if (isSessionEnded(e)) endSession() }
        }
    }

    // ---- tunnel ------------------------------------------------------------------------------

    private fun connect(userInitiated: Boolean) {
        val current = snapshot.get()
        if (current.phase == Phase.PREPARING || current.phase == Phase.CONNECTING) return
        if (store.refreshToken() == null) {
            leaveForeground()
            update { it.copy(phase = Phase.SIGNED_OUT) }
            return
        }
        if (prepare(this) != null) {
            leaveForeground()
            update { it.copy(phase = Phase.NEEDS_PERMISSION, reasonCode = null) }
            return
        }
        enterForeground()
        store.update { it.copy(wantConnected = true) }
        update { ledger.begin(it, Phase.PREPARING) }
        val gen = ledger.attempt
        requestCatalog { loaded ->
            if (!ledger.isCurrent(gen)) return@requestCatalog
            loaded.onSuccess { result ->
                catalog = result.catalog
                update { it.withCatalog(result.catalog).copy(usingCachedCatalog = result.cached) }
                startCore(gen)
            }.onFailure { e -> fail(e, userInitiated) }
        }
    }

    private fun startCore(gen: Long) {
        if (!ledger.isCurrent(gen)) return
        val c = catalog ?: return
        val s = store.settings()
        update { it.copy(phase = Phase.CONNECTING) }
        val input = ConfigInput(
            catalog = c,
            selectedCloudNode = s.selectedNode,
            mode = s.mode,
            underlyingIpv6 = monitor.current?.globalIpv6 == true,
            cacheFilePath = File(boxDir(), "cache.db").absolutePath,
            logLevel = if (BuildConfig.DEBUG) "info" else "warn",
        )
        val tunsBefore = platform.tunsEstablished
        try {
            ensureLibbox()
            val config = SingBoxConfig.buildJson(input)
            commandServer!!.startOrReloadService(config, OverrideOptions().apply { excludePackage = StringArray(s.excludedPackages) })
            File(boxDir(), "configuration.json").delete()
        } catch (e: Exception) {
            Log.w(TAG, "core start failed")
            stopCore()
            val revoked = e.message?.contains("VPN_PERMISSION_REVOKED") == true
            // No rollback: the core closed the previous tunnel before trying this one, so nothing is
            // confirmed and the line the user asked for is not shown as current.
            update { ledger.end(it, if (revoked) Phase.NEEDS_PERMISSION else Phase.FAILED, if (revoked) "REVOKED" else "CORE_START") }
            leaveForeground()
            return
        }
        // Confirmed only if Android established a TUN during this start: sing-box returning is not enough.
        val established = platform.tunsEstablished > tunsBefore && platform.tunOpen
        val node = SingBoxConfig.selectedNode(input).name
        update {
            (ledger.started(it, gen, established, node, s.mode, System.currentTimeMillis()) ?: it).copy(
                alwaysOn = isAlwaysOn, lockdown = isLockdownEnabled,
                underlyingIpv6 = monitor.current?.globalIpv6 == true,
            )
        }
        if (!established) {
            Log.w(TAG, "core start returned without a TUN")
            stopCore()
            leaveForeground()
            return
        }
        startTraffic()
        runProbes(gen)
    }

    private fun runProbes(gen: Long) {
        val request = probeRequests.begin(monitor.current?.network)
        io.execute {
            // Give the TUN a moment to become the default network for this process.
            SystemClock.sleep(600)
            val cloud = Probes.trace(Probes.CLOUD_URL)
            val home = Probes.trace(Probes.HOME_URL)
            engine.execute {
                if (!probeRequests.accepts(request, monitor.current?.network)) return@execute
                // Only for the attempt they were asked for, and only once that attempt is confirmed.
                if (ledger.probed(snapshot.get(), gen, cloud, home) == null) return@execute
                update { ledger.probed(it, gen, cloud, home) ?: it }
            }
        }
    }

    private fun reloadIfRunning(change: (EngineSnapshot) -> EngineSnapshot = { it }) {
        val s = snapshot.get()
        val running = s.tunnelUp || s.phase == Phase.CONNECTING
        // Selection and withdrawal of the old confirmation are ONE externally visible commit.
        update { val changed = change(it); if (running) ledger.begin(changed, Phase.CONNECTING) else changed }
        if (running) startCore(ledger.attempt)
    }

    private fun disconnect(reason: String?) {
        catalogWait.incrementAndGet()
        store.update { it.copy(wantConnected = false) }
        if (snapshot.get().phase != Phase.SIGNED_OUT) update { ledger.begin(it, Phase.DISCONNECTING) }
        stopCore()
        leaveForeground()
        val signedIn = store.refreshToken() != null
        update { ledger.end(it, if (signedIn) Phase.IDLE else Phase.SIGNED_OUT, reason) }
    }

    private fun fail(e: Throwable, userInitiated: Boolean) {
        stopCore()
        leaveForeground()
        if (isSessionEnded(e)) { endSession(); return }
        val code = errorCode(e)
        Log.w(TAG, "connect failed: $code")
        update { ledger.end(it, Phase.FAILED, code) }
        // An automatic (always-on/restart) attempt keeps the user's intent; a tapped one asks again.
        if (userInitiated) store.update { it.copy(wantConnected = false) }
        // Nobody may be looking at the app after an automatic attempt: say so, with a Retry.
        else postStopped(code)
    }

    private fun endSession() {
        catalogWait.incrementAndGet()
        accountWork.invalidate()
        loginRequests.next()
        stopCore()
        leaveForeground()
        store.clearAccount()
        accessToken = null
        catalog = null
        update { ledger.end(signedOut(reasonCode = "SESSION_ENDED", mode = it.mode), Phase.SIGNED_OUT, "SESSION_ENDED") }
    }

    private fun stopCore() {
        probeRequests.invalidate()
        trafficTask?.cancel(false)
        trafficTask = null
        runCatching { commandServer?.closeService() }
        platform.closeTun()
        File(boxDir(), "configuration.json").delete()
    }

    private fun onUnderlyingChanged(u: NetworkMonitor.Underlying?) {
        val v6 = u?.globalIpv6 == true
        val before = snapshot.get()
        val changed = u?.network != lastUnderlying
        lastUnderlying = u?.network
        if (changed) probeRequests.invalidate()
        val hasTun = before.applied?.generation == ledger.attempt && platform.tunOpen
        if (before.underlyingIpv6 != v6) update { it.copy(underlyingIpv6 = v6) }
        if (u == null && hasTun) {
            // No underlying network: old successful exit checks cannot stand as current.
            val failed = ExitProbe(ProbeState.FAILED)
            update { ledger.probed(it, ledger.attempt, failed, failed) ?: it }
            return
        }
        if (u != null && hasTun && before.underlyingIpv6 != v6) {
            reloadIfRunning()
            return
        }
        if (changed && hasTun) {
            update { ledger.rechecking(it) ?: it }
            runProbes(ledger.attempt)
        }
    }

    private fun startTraffic() {
        trafficTask?.cancel(false)
        val uid = Process.myUid()
        var lastRx = TrafficStats.getUidRxBytes(uid)
        var lastTx = TrafficStats.getUidTxBytes(uid)
        trafficTask = engine.scheduleWithFixedDelay({
            val rx = TrafficStats.getUidRxBytes(uid)
            val tx = TrafficStats.getUidTxBytes(uid)
            val s = snapshot.get()
            if (s.tunnelUp || s.phase == Phase.CONNECTING) {
                update { it.copy(rxBytesPerSec = (rx - lastRx).coerceAtLeast(0), txBytesPerSec = (tx - lastTx).coerceAtLeast(0)) }
            }
            lastRx = rx; lastTx = tx
        }, 1, 1, TimeUnit.SECONDS)
    }

    private fun measureLatency() {
        val c = catalog ?: return
        val nodes = c.cloudNodes.take(40)
        io.execute {
            val results = nodes.map { node ->
                io.submit<Pair<String, Long?>> {
                    node.name to runCatching {
                        Socket().use { socket ->
                            // Protected: measures the phone → cloud hop, not a path through the tunnel.
                            protect(socket)
                            val start = System.nanoTime()
                            socket.connect(InetSocketAddress(node.server, node.port), 3_000)
                            (System.nanoTime() - start) / 1_000_000
                        }
                    }.getOrNull()
                }
            }.map { it.get() }.toMap()
            engine.execute {
                if (catalog !== c) return@execute
                update { s -> s.copy(nodes = s.nodes.map { it.copy(latencyMs = results[it.name] ?: it.latencyMs) }) }
            }
        }
    }

    // ---- libbox ------------------------------------------------------------------------------

    private fun boxDir(): File = File(noBackupFilesDir, "tono/box").apply { mkdirs() }

    private fun ensureLibbox() {
        if (commandServer != null) return
        val work = boxDir()
        Libbox.setup(SetupOptions().apply {
            basePath = work.absolutePath
            workingPath = work.absolutePath
            tempPath = cacheDir.absolutePath
            fixAndroidStack = false
            logMaxLines = 300
            debug = BuildConfig.DEBUG
            crashReportSource = "tono-android"
            appVersion = BuildConfig.VERSION_NAME
            appMarketingVersion = BuildConfig.VERSION_NAME
            // The command socket lives in app-private storage and still requires this per-process secret.
            commandServerSecret = EngineStore.randomHex(16)
        })
        val server = Libbox.newCommandServer(object : CommandServerHandler {
            override fun serviceStop() { engine.execute { disconnect(reason = "CORE_STOPPED"); postStopped("CORE_STOPPED") } }
            override fun serviceReload() { engine.execute { reloadIfRunning() } }
            override fun getSystemProxyStatus(): SystemProxyStatus = SystemProxyStatus()
            override fun setSystemProxyEnabled(enabled: Boolean) {}
            override fun triggerNativeCrash() {}
            override fun writeDebugMessage(message: String) { if (BuildConfig.DEBUG) Log.d(TAG, message) }
            override fun connectSSHAgent(): Int = throw UnsupportedOperationException("ssh")
        }, platform)
        server.start()
        commandServer = server
    }

    // ---- notifications -----------------------------------------------------------------------

    fun configureIntent(): PendingIntent = PendingIntent.getActivity(
        this, 0, packageManager.getLaunchIntentForPackage(packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun showCoreNotice(title: String?, body: String?) {
        getSystemService(NotificationManager::class.java).notify(
            NOTICE_ID,
            Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_standby).setContentTitle(title ?: "Tono").setContentText(body).build(),
        )
    }

    /** The tunnel ended without the user asking: tell them, with one Retry (the engine re-checks consent). */
    private fun postStopped(code: String) {
        val retry = PendingIntent.getForegroundService(
            this, 2, Intent(this, TonoVpnService::class.java).setAction(ACTION_CONNECT), PendingIntent.FLAG_IMMUTABLE,
        )
        getSystemService(NotificationManager::class.java).notify(NOTICE_ID, TonoNotifications.stopped(this, code, configureIntent(), retry, lockdownNow()))
    }

    private fun postRevoked(lockdown: Boolean) {
        getSystemService(NotificationManager::class.java).notify(NOTICE_ID, TonoNotifications.revoked(this, configureIntent(), lockdown))
    }

    /** The user stopped Tono themselves: an earlier "stopped" notice is no longer news. */
    private fun clearStopNotice() { getSystemService(NotificationManager::class.java).cancel(NOTICE_ID) }

    /**
     * Lockdown as Android reports it now, or as recorded for the last attempt: either one true means the
     * notice must not say traffic is going out directly.
     */
    private fun lockdownNow(): Boolean = snapshot.get().lockdown || runCatching { isLockdownEnabled }.getOrDefault(true)

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
        )
    }

    private fun buildNotification(s: EngineSnapshot): Notification {
        val stop = PendingIntent.getService(
            this, 1, Intent(this, TonoVpnService::class.java).setAction(ACTION_DISCONNECT), PendingIntent.FLAG_IMMUTABLE,
        )
        return TonoNotifications.ongoing(this, s, configureIntent(), stop)
    }

    private fun enterForeground() {
        if (foreground) return
        val n = buildNotification(snapshot.get().copy(phase = Phase.CONNECTING))
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(NOTIFICATION_ID, n)
        foreground = true
    }

    private fun leaveForeground() {
        if (!foreground) return
        stopForeground(STOP_FOREGROUND_REMOVE)
        foreground = false
        stopSelf()
    }

    private fun notify(s: EngineSnapshot) {
        if (s.phase !in setOf(Phase.PREPARING, Phase.CONNECTING, Phase.CONNECTED, Phase.DEGRADED, Phase.DISCONNECTING)) return
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(s))
    }

    // ---- IPC ---------------------------------------------------------------------------------

    private val binder = object : ITonoEngine.Stub() {
        override fun register(listener: ITonoEngineListener) {
            listeners.register(listener)
            if (restored) runCatching { listener.onSnapshot(snapshot.get().toJson()) }
        }

        override fun snapshot(): String? = if (restored) snapshot.get().toJson() else null

        override fun unregister(listener: ITonoEngineListener) { listeners.unregister(listener) }

        override fun command(commandJson: String) {
            val cmd = runCatching { Json.parse(commandJson).asObject() }.getOrNull() ?: return
            engine.execute { handle(cmd) }
        }

        override fun explain(host: String): String {
            val c = catalog ?: return Json.write(linkedMapOf("error" to "NO_CATALOG"))
            val s = store.settings()
            val config = SingBoxConfig.build(ConfigInput(c, s.selectedNode, s.mode, monitor.current?.globalIpv6 == true, null))
            val authority = host.trim().lowercase().removePrefix("https://").removePrefix("http://").substringBefore('/').substringBefore('?').substringBefore('#')
            val clean = authority.substringBefore(':')
            val port = authority.substringAfter(':', "").toIntOrNull()?.takeIf { it in 1..65535 } ?: 443
            if (clean.isEmpty() || clean.length > 253) return Json.write(linkedMapOf("error" to "BAD_HOST"))
            val isIp = clean.all { it.isDigit() || it == '.' }
            val tcp = RouteExplainer.explain(config, RouteExplainer.Connection(domain = clean.takeUnless { isIp }, ip = clean.takeIf { isIp }, port = port))
            val udp = RouteExplainer.explain(config, RouteExplainer.Connection(domain = clean.takeUnless { isIp }, ip = clean.takeIf { isIp }, port = port, network = "udp"))
            fun label(v: RouteExplainer.Verdict) = when (v) {
                is RouteExplainer.Verdict.Route -> when (v.outbound) {
                    SingBoxConfig.DIRECT_TAG -> "DIRECT"
                    SingBoxConfig.EXIT_TAG -> "CLOUD"
                    else -> if (c.home != null && v.outbound == SingBoxConfig.homeTargetTag(c)) "HOME" else "CLOUD"
                }
                is RouteExplainer.Verdict.Reject -> "BLOCKED"
                RouteExplainer.Verdict.HijackDns -> "DNS"
            }
            return Json.write(linkedMapOf("host" to clean, "tcp" to label(tcp), "udp" to label(udp)))
        }
    }

    private fun handle(cmd: Map<String, Any?>) {
        when (cmd["op"]) {
            "connect" -> connect(userInitiated = true)
            "disconnect" -> { disconnect(reason = null); clearStopNotice() }
            "startEmail" -> startEmail(cmd["email"] as? String ?: "")
            "verifyCode" -> verifyCode(cmd["code"] as? String ?: "")
            "cancelLogin" -> { loginRequests.next(); update { it.copy(login = LoginView(email = it.login.email)) } }
            "signOut" -> signOut()
            "selectNode" -> {
                val name = cmd["name"] as? String ?: return
                if (catalog?.cloudNodes?.any { it.name == name } != true) return
                store.update { it.copy(selectedNode = name) }
                reloadIfRunning { it.copy(selectedNode = name) }
            }
            "setMode" -> {
                val mode = runCatching { RoutingMode.valueOf(cmd["mode"] as String) }.getOrNull() ?: return
                store.update { it.copy(mode = mode) }
                reloadIfRunning { it.copy(mode = mode) }
            }
            "setExcluded" -> {
                val packages = (cmd["packages"] as? List<*>)?.mapNotNull { it as? String }?.filter { it != packageName }?.distinct()?.take(256) ?: return
                store.update { it.copy(excludedPackages = packages) }
                reloadIfRunning { it.copy(excludedPackages = packages) }
            }
            "refreshCatalog" -> refreshCatalogQuietly()
            "measureLatency" -> measureLatency()
            "recheck" -> if (snapshot.get().tunnelUp) {
                update { ledger.rechecking(it) ?: it }
                runProbes(ledger.attempt)
            }
            "permissionDenied" -> update { it.copy(phase = Phase.NEEDS_PERMISSION, reasonCode = "DENIED") }
        }
    }

    companion object {
        private const val TAG = "TonoEngine"
        const val ACTION_CONNECT = "com.raydocs.tono.mobile.CONNECT"
        const val ACTION_DISCONNECT = "com.raydocs.tono.mobile.DISCONNECT"
        const val ACTION_BIND_ENGINE = "com.raydocs.tono.mobile.BIND_ENGINE"
        private const val CHANNEL = TonoNotifications.CHANNEL
        private const val NOTIFICATION_ID = TonoNotifications.ONGOING_ID
        private const val NOTICE_ID = TonoNotifications.NOTICE_ID
        private const val CACHE_MAX_AGE_MS = 7L * 24 * 3600 * 1000

        fun errorCode(e: Throwable): String = when (e) {
            is ApiException -> when {
                e.status == 429 -> "RATE_LIMITED"
                else -> e.code
            }
            is CatalogRejected -> e.code
            else -> "UNKNOWN"
        }

        fun isSessionEnded(e: Throwable): Boolean =
            e is ApiException && e.status == 401 && e.code in setOf("INVALID_REFRESH_TOKEN", "SIGNED_OUT", "UNAUTHORIZED", "ACCOUNT_SUSPENDED")

        /** Access tokens are 24 h HS256 JWTs; refresh a little early. Malformed tokens count as expired. */
        fun jwtExpiringSoon(token: String, nowSec: Long = System.currentTimeMillis() / 1000): Boolean = runCatching {
            val payload = String(Base64.getUrlDecoder().decode(token.split('.')[1].padEnd((token.split('.')[1].length + 3) / 4 * 4, '=')))
            val exp = (Json.parse(payload).asObject()["exp"] as Number).toLong()
            exp - nowSec < 300
        }.getOrDefault(true)
    }
}
