package com.raydocs.tono.routing

import java.io.File
import org.junit.Test

/** Writes representative configs for the host-side `sing-box check` (scripts/routing/check-singbox-configs.sh). */
class ConfigSnapshotWriter {
    @Test
    fun writeConfigs() {
        val dir = File(System.getProperty("tono.configOut") ?: "build/singbox-configs").apply { mkdirs() }
        val cases = mapOf(
            "three-tier-socks-home" to Fixtures.config(),
            "three-tier-node-home" to Fixtures.config(routing = CatalogRouting(homeProxy = "Los Angeles · Grove")),
            "three-tier-no-home-no-v6" to Fixtures.config(routing = null, ipv6 = false),
            "stable-socks-home" to Fixtures.config(mode = RoutingMode.STABLE),
        )
        cases.forEach { (name, config) -> File(dir, "$name.json").writeText(Json.write(config)) }
    }
}
