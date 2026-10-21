package com.raydocs.tono.mobile.engine

import android.content.Context
import android.os.Build
import com.raydocs.tono.routing.Json
import com.raydocs.tono.routing.RoutingMode
import com.raydocs.tono.routing.asArray
import com.raydocs.tono.routing.asObject
import java.io.File
import java.security.SecureRandom

/** Non-secret engine preferences. Written only by the :vpn process. */
data class EngineSettings(
    val installationId: String,
    val deviceName: String,
    val email: String? = null,
    val mode: RoutingMode = RoutingMode.THREE_TIER,
    val selectedNode: String? = null,
    val excludedPackages: List<String> = emptyList(),
    /** User asked for the tunnel; used to resume after an OS restart of the service. */
    val wantConnected: Boolean = false,
    val catalogKey: String? = null,
    val catalogRevision: Long = -1,
    val catalogFetchedAtMs: Long = 0,
    /** The control plane the stored account belongs to; null means the Tono API (accounts made before this field). */
    val accountApi: String? = null,
)

/**
 * Persistence for the engine. Tokens and the last admitted catalog (it carries the per-device
 * VLESS identity and Home credentials) are AES-GCM encrypted with an Android Keystore key
 * ([SecretStore], private preferences excluded from backup and device transfer). Settings are plain
 * JSON in no-backup storage. Sessions stored by 0.3.0 (legacy vault) are not migrated: the user
 * signs in again.
 */
class EngineStore(context: Context) {
    private val dir = File(context.noBackupFilesDir, "tono").apply { mkdirs() }
    private val settingsFile = File(dir, "engine.json")
    private val vault = SecretStore(context)

    @Synchronized
    fun settings(): EngineSettings {
        val parsed = runCatching { Json.parse(settingsFile.readText()).asObject() }.getOrNull()
        if (parsed == null) {
            val fresh = EngineSettings(installationId = randomHex(16), deviceName = deviceName())
            save(fresh)
            return fresh
        }
        return EngineSettings(
            installationId = parsed["installationId"] as String,
            deviceName = parsed["deviceName"] as? String ?: deviceName(),
            email = parsed["email"] as String?,
            mode = runCatching { RoutingMode.valueOf(parsed["mode"] as String) }.getOrDefault(RoutingMode.THREE_TIER),
            selectedNode = parsed["selectedNode"] as String?,
            excludedPackages = (parsed["excludedPackages"] as? List<*>)?.map { it as String } ?: emptyList(),
            wantConnected = parsed["wantConnected"] as? Boolean ?: false,
            catalogKey = parsed["catalogKey"] as String?,
            catalogRevision = (parsed["catalogRevision"] as? Number)?.toLong() ?: -1,
            catalogFetchedAtMs = (parsed["catalogFetchedAtMs"] as? Number)?.toLong() ?: 0,
            accountApi = parsed["accountApi"] as String?,
        )
    }

    @Synchronized
    fun save(s: EngineSettings) {
        val tmp = File(dir, "engine.json.tmp")
        tmp.writeText(
            Json.write(
                linkedMapOf(
                    "installationId" to s.installationId, "deviceName" to s.deviceName, "email" to s.email,
                    "mode" to s.mode.name, "selectedNode" to s.selectedNode, "excludedPackages" to s.excludedPackages,
                    "wantConnected" to s.wantConnected, "catalogKey" to s.catalogKey,
                    "catalogRevision" to s.catalogRevision, "catalogFetchedAtMs" to s.catalogFetchedAtMs,
                    "accountApi" to s.accountApi,
                ),
            ),
        )
        check(tmp.renameTo(settingsFile)) { "settings write failed" }
    }

    @Synchronized
    fun update(block: (EngineSettings) -> EngineSettings): EngineSettings = block(settings()).also(::save)

    fun refreshToken(): String? = vault.get(REFRESH)?.let { bytes -> bytes.decodeToString().also { bytes.fill(0) } }
    fun accessToken(): String? = vault.get(ACCESS)?.let { bytes -> bytes.decodeToString().also { bytes.fill(0) } }

    fun saveTokens(access: String, refresh: String) {
        vault.put(ACCESS, access.encodeToByteArray())
        vault.put(REFRESH, refresh.encodeToByteArray())
    }

    fun cachedCatalogBody(): String? = vault.get(CATALOG)?.let { bytes -> bytes.decodeToString().also { bytes.fill(0) } }
    fun saveCatalogBody(json: String) = vault.put(CATALOG, json.encodeToByteArray())

    fun clearAccount() {
        vault.delete(setOf(ACCESS, REFRESH, CATALOG))
        update { it.copy(email = null, selectedNode = null, wantConnected = false, catalogKey = null, catalogRevision = -1, catalogFetchedAtMs = 0, accountApi = null) }
    }

    companion object {
        private const val ACCESS = "mobile.access_token"
        private const val REFRESH = "mobile.refresh_token"
        private const val CATALOG = "mobile.catalog_body"

        fun randomHex(bytes: Int): String = ByteArray(bytes).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }

        private fun deviceName(): String = listOf(Build.MANUFACTURER, Build.MODEL).filter { !it.isNullOrBlank() }
            .joinToString(" ").ifBlank { "Android" }.take(100)
    }
}
