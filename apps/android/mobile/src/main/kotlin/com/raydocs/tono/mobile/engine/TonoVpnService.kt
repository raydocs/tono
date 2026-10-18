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
    private var commandServer: CommandServer? = null
    @Volatile private var catalog: ExitCatalog? = null
    private var accessToken: String? = null
    private var trafficTask: ScheduledFuture<*>? = null
    private var foreground = false
    private var generation = 0L
    /** The phone's own network the exits were last checked over (engine thread only). */
    private var lastUnderlying: Network? = null
    private lateinit var apiBase: String
    private var localTestServer = false

    override fun onCreate() {
        super.onCreate()
        store = EngineStore(this)
        val local = LocalTestServer.apiBase(this)
        localTestServer = local != null
        apiBase = local ?: BuildConfig.API_BASE
        api = ControlPlane(apiBase, BuildConfig.VERSION_NAME.substringBefore('-'))
        // Before restore() runs, so every snapshot built from here on carries the mark.
        snapshot.set(snapshot.get().copy(localTestServer = localTestServer))
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
            ACTION_DISCONNECT -> engine.execute { disconnect(reason = null) }
            // Always-on VPN or a restart after the OS reclaimed the process.
            SERVICE_INTERFACE, null -> {
                if (store.settings().wantConnected || intent?.action == SERVICE_INTERFACE) {
                    enterForeground(); engine.execute { connect(userInitiated = false) }
                }
            }
        }
        return START_STICKY
    }

    override fun onRevoke() {
        // Another VPN took over or the user revoked consent in Settings.
        engine.execute {
            stopCore()
            store.update { it.copy(wantConnected = false) }
            update { it.copy(phase = Phase.NEEDS_PERMISSION, reasonCode = "REVOKED", connectedSinceMs = 0) }
            leaveForeground()
        }
    }

    override fun onDestroy() {
        engine.execute { stopCore() }
        engine.shutdown()
        engine.awaitTermination(3, TimeUnit.SECONDS)
        monitor.stop()
        listeners.kill()
        super.onDestroy()
    }

    // ---- state -------------------------------------------------------------------------------

    private fun update(block: (EngineSnapshot) -> EngineSnapshot) {
        val before = snapshot.get()
        val next = block(before)
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
        update { it.copy(login = LoginView(email = normalized, busy = true)) }
        io.execute {
            val s = store.settings()
            val result = runCatching {
                api.post("auth/email/start", linkedMapOf("email" to normalized, "deviceName" to s.deviceName, "installationId" to s.installationId))
            }
            engine.execute {
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
        update { it.copy(login = it.login.copy(busy = true, errorCode = null)) }
        io.execute {
            val result = runCatching { api.post("auth/email/verify", linkedMapOf("challengeId" to challenge, "code" to code)) }
            engine.execute {
                result.onSuccess { body ->
                    val access = body["accessToken"] as? String
                    val refresh = body["refreshToken"] as? String
                    if (access == null || refresh == null) {
                        update { it.copy(login = it.login.copy(busy = false, errorCode = "SERVER_ERROR")) }
                        return@execute
                    }
                    store.saveTokens(access, refresh)
                    accessToken = access
                    val email = ((body["user"] as? Map<*, *>)?.get("email") as? String) ?: login.email
                    store.update { it.copy(email = email, accountApi = apiBase) }
                    update { it.copy(phase = Phase.IDLE, email = email, login = LoginView(), reasonCode = null) }
                    refreshCatalogQuietly()
                }.onFailure { e ->
                    update { it.copy(login = it.login.copy(busy = false, errorCode = errorCode(e))) }
                }
            }
        }
    }

    private fun signOut() {
        stopCore()
        leaveForeground()
        val access = accessToken ?: store.accessToken()
        val refresh = store.refreshToken()
        if (access != null) io.execute { runCatching { api.post("auth/logout", refresh?.let { linkedMapOf("refreshToken" to it) }, access) } }
        store.clearAccount()
        accessToken = null
        catalog = null
        update { signedOut(mode = it.mode, excluded = it.excludedPackages) }
    }

    private fun bearer(forceRefresh: Boolean = false): String {
        val cached = accessToken ?: store.accessToken()
        if (!forceRefresh && cached != null && !jwtExpiringSoon(cached)) return cached.also { accessToken = it }
        val refresh = store.refreshToken() ?: throw ApiException(401, "SIGNED_OUT", "not signed in")
        val body = api.post("auth/refresh", linkedMapOf("refreshToken" to refresh))
        val access = body["accessToken"] as? String ?: throw ApiException(500, "SERVER_ERROR", "no access token")
        val rotated = body["refreshToken"] as? String ?: refresh
        store.saveTokens(access, rotated)
        accessToken = access
        return access
    }

    private fun <T> authorized(block: (String) -> T): T = try {
        block(bearer())
    } catch (e: ApiException) {
        if (e.status != 401 || e.code == "INVALID_REFRESH_TOKEN") throw e
        block(bearer(forceRefresh = true))
    }

    // ---- catalog -----------------------------------------------------------------------------

    /** Fetches and admits the catalog. Falls back to the last admitted copy only for network failures. */
    private fun loadCatalog(): ExitCatalog {
        val settings = store.settings()
        return try {
            val body = authorized { token -> api.get("exit-catalog", token) }
            val admitted = CatalogAdmission.admit(body)
            if (admitted.revision < settings.catalogRevision) throw CatalogRejected("CATALOG_ROLLBACK", "catalog revision went backwards")
            store.saveCatalogBody(Json.write(body))
            store.update { it.copy(catalogKey = admitted.key, catalogRevision = admitted.revision, catalogFetchedAtMs = System.currentTimeMillis()) }
            update { it.copy(usingCachedCatalog = false) }
            admitted
        } catch (e: ApiException) {
            val cachedBody = store.cachedCatalogBody()
            val fresh = System.currentTimeMillis() - settings.catalogFetchedAtMs < CACHE_MAX_AGE_MS
            if (e.code == "NETWORK" && cachedBody != null && fresh) {
                update { it.copy(usingCachedCatalog = true) }
                CatalogAdmission.admit(Json.parse(cachedBody).asObject())
            } else throw e
        }
    }

    private fun refreshCatalogQuietly() {
        io.execute {
            val result = runCatching { loadCatalog() }
            engine.execute {
                result.onSuccess { c -> catalog = c; update { it.withCatalog(c) } }
                    .onFailure { e -> if (isSessionEnded(e)) endSession() }
            }
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
        val gen = ++generation
        update {
            it.copy(
                phase = Phase.PREPARING, reasonCode = null,
                cloudProbe = ExitProbe(), homeProbe = ExitProbe(),
            )
        }
        io.execute {
            val loaded = runCatching { loadCatalog() }
            engine.execute {
                if (gen != generation) return@execute
                loaded.onSuccess { c ->
                    catalog = c
                    update { it.withCatalog(c) }
                    startCore(gen)
                }.onFailure { e -> fail(e, userInitiated) }
            }
        }
    }

    private fun startCore(gen: Long) {
        val c = catalog ?: return
        val s = store.settings()
        update { it.copy(phase = Phase.CONNECTING) }
        try {
            ensureLibbox()
            val config = SingBoxConfig.buildJson(
                ConfigInput(
                    catalog = c,
                    selectedCloudNode = s.selectedNode,
                    mode = s.mode,
                    underlyingIpv6 = monitor.current?.globalIpv6 == true,
                    cacheFilePath = File(boxDir(), "cache.db").absolutePath,
                    logLevel = if (BuildConfig.DEBUG) "info" else "warn",
                ),
            )
            commandServer!!.startOrReloadService(config, OverrideOptions().apply { excludePackage = StringArray(s.excludedPackages) })
            File(boxDir(), "configuration.json").delete()
        } catch (e: Exception) {
            Log.w(TAG, "core start failed: ${e.message}")
            stopCore()
            val revoked = e.message?.contains("VPN_PERMISSION_REVOKED") == true
            update { it.copy(phase = if (revoked) Phase.NEEDS_PERMISSION else Phase.FAILED, reasonCode = if (revoked) "REVOKED" else "CORE_START") }
            leaveForeground()
            return
        }
        val since = System.currentTimeMillis()
        update {
            it.copy(
                phase = Phase.CONNECTING, connectedSinceMs = since,
                alwaysOn = isAlwaysOn, lockdown = isLockdownEnabled,
                underlyingIpv6 = monitor.current?.globalIpv6 == true,
                cloudProbe = ExitProbe(ProbeState.CHECKING), homeProbe = ExitProbe(ProbeState.CHECKING),
            )
        }
        startTraffic()
        runProbes(gen)
    }

    private fun runProbes(gen: Long) {
        io.execute {
            // Give the TUN a moment to become the default network for this process.
            SystemClock.sleep(600)
            val cloud = Probes.trace(Probes.CLOUD_URL)
            val home = Probes.trace(Probes.HOME_URL)
            engine.execute {
                if (gen != generation || !snapshot.get().let { it.phase == Phase.CONNECTING || it.tunnelUp }) return@execute
                val reason = when {
                    cloud.state != ProbeState.OK -> "CLOUD_UNREACHABLE"
                    home.state != ProbeState.OK -> "HOME_UNREACHABLE"
                    else -> null
                }
                update {
                    it.copy(
                        phase = if (reason == null) Phase.CONNECTED else Phase.DEGRADED,
                        reasonCode = reason, cloudProbe = cloud, homeProbe = home,
                    )
                }
            }
        }
    }

    private fun reloadIfRunning() {
        if (!snapshot.get().tunnelUp && snapshot.get().phase != Phase.CONNECTING) return
        startCore(++generation)
    }

    private fun disconnect(reason: String?) {
        generation++
        store.update { it.copy(wantConnected = false) }
        if (snapshot.get().phase != Phase.SIGNED_OUT) update { it.copy(phase = Phase.DISCONNECTING) }
        stopCore()
        leaveForeground()
        val signedIn = store.refreshToken() != null
        update {
            it.copy(
                phase = if (signedIn) Phase.IDLE else Phase.SIGNED_OUT, reasonCode = reason, connectedSinceMs = 0,
                cloudProbe = ExitProbe(), homeProbe = ExitProbe(), rxBytesPerSec = 0, txBytesPerSec = 0,
            )
        }
    }

    private fun fail(e: Throwable, userInitiated: Boolean) {
        stopCore()
        leaveForeground()
        if (isSessionEnded(e)) { endSession(); return }
        val code = errorCode(e)
        Log.w(TAG, "connect failed: $code")
        update { it.copy(phase = Phase.FAILED, reasonCode = code, connectedSinceMs = 0) }
        // An automatic (always-on/restart) attempt keeps the user's intent; a tapped one asks again.
        if (userInitiated) store.update { it.copy(wantConnected = false) }
        // Nobody may be looking at the app after an automatic attempt: say so, with a Retry.
        else postStopped(code)
    }

    private fun endSession() {
        stopCore()
        leaveForeground()
        store.clearAccount()
        accessToken = null
        catalog = null
        update { signedOut(reasonCode = "SESSION_ENDED", mode = it.mode) }
    }

    private fun stopCore() {
        trafficTask?.cancel(false)
        trafficTask = null
        runCatching { commandServer?.closeService() }
        platform.closeTun()
        File(boxDir(), "configuration.json").delete()
    }

    private fun onUnderlyingChanged(u: NetworkMonitor.Underlying?) {
        val v6 = u?.globalIpv6 == true
        val before = snapshot.get()
        val switched = u != null && lastUnderlying != null && u.network != lastUnderlying
        if (u != null) lastUnderlying = u.network
        if (before.underlyingIpv6 != v6) {
            update { it.copy(underlyingIpv6 = v6) }
            // DIRECT AAAA answers depend on the phone's IPv6; regenerate only when that changes (the
            // restart checks both exits again).
            if (before.tunnelUp) { reloadIfRunning(); return }
        }
        // Wi-Fi ↔ mobile: the exits' last answers came over the old network, so ask them again
        // instead of keeping a verdict the new network has not earned.
        if (switched && before.tunnelUp) {
            update { it.copy(cloudProbe = ExitProbe(ProbeState.CHECKING), homeProbe = ExitProbe(ProbeState.CHECKING)) }
            runProbes(generation)
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
            engine.execute { update { s -> s.copy(nodes = s.nodes.map { it.copy(latencyMs = results[it.name] ?: it.latencyMs) }) } }
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
        getSystemService(NotificationManager::class.java).notify(NOTICE_ID, TonoNotifications.stopped(this, code, configureIntent(), retry))
    }

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
            val clean = host.trim().lowercase().removePrefix("https://").removePrefix("http://").substringBefore('/').substringBefore(':')
            if (clean.isEmpty() || clean.length > 253) return Json.write(linkedMapOf("error" to "BAD_HOST"))
            val isIp = clean.all { it.isDigit() || it == '.' }
            val tcp = RouteExplainer.explain(config, RouteExplainer.Connection(domain = clean.takeUnless { isIp }, ip = clean.takeIf { isIp }))
            val udp = RouteExplainer.explain(config, RouteExplainer.Connection(domain = clean.takeUnless { isIp }, ip = clean.takeIf { isIp }, network = "udp"))
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
            "disconnect" -> disconnect(reason = null)
            "startEmail" -> startEmail(cmd["email"] as? String ?: "")
            "verifyCode" -> verifyCode(cmd["code"] as? String ?: "")
            "cancelLogin" -> update { it.copy(login = LoginView(email = it.login.email)) }
            "signOut" -> signOut()
            "selectNode" -> {
                val name = cmd["name"] as? String ?: return
                if (catalog?.cloudNodes?.any { it.name == name } != true) return
                store.update { it.copy(selectedNode = name) }
                update { it.copy(selectedNode = name) }
                reloadIfRunning()
            }
            "setMode" -> {
                val mode = runCatching { RoutingMode.valueOf(cmd["mode"] as String) }.getOrNull() ?: return
                store.update { it.copy(mode = mode) }
                update { it.copy(mode = mode) }
                reloadIfRunning()
            }
            "setExcluded" -> {
                val packages = (cmd["packages"] as? List<*>)?.mapNotNull { it as? String }?.filter { it != packageName }?.distinct()?.take(256) ?: return
                store.update { it.copy(excludedPackages = packages) }
                update { it.copy(excludedPackages = packages) }
                reloadIfRunning()
            }
            "refreshCatalog" -> refreshCatalogQuietly()
            "measureLatency" -> measureLatency()
            "recheck" -> if (snapshot.get().tunnelUp) {
                update { it.copy(cloudProbe = ExitProbe(ProbeState.CHECKING), homeProbe = ExitProbe(ProbeState.CHECKING)) }
                runProbes(generation)
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
        private const val NOTIFICATION_ID = 7
        private const val NOTICE_ID = 8
        private const val CACHE_MAX_AGE_MS = 7L * 24 * 3600 * 1000

        fun errorCode(e: Throwable): String = when (e) {
            is ApiException -> when {
                e.code == "CATALOG_UNAVAILABLE" -> "HOME_UNAVAILABLE"
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
