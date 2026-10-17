package com.raydocs.tono.mobile.ui

import java.util.Locale

object Format {
    private val CITY_ZH = mapOf(
        "los angeles" to "洛杉矶", "salt lake city" to "盐湖城", "buffalo" to "布法罗", "new york" to "纽约",
        "san jose" to "圣何塞", "seattle" to "西雅图", "chicago" to "芝加哥", "dallas" to "达拉斯", "miami" to "迈阿密",
        "tokyo" to "东京", "osaka" to "大阪", "singapore" to "新加坡", "hong kong" to "香港", "seoul" to "首尔",
        "taipei" to "台北", "london" to "伦敦", "frankfurt" to "法兰克福",
    )

    fun city(city: String, chinese: Boolean): String =
        if (chinese) CITY_ZH[city.lowercase(Locale.ROOT)] ?: city else city

    /** Probe exits report ISO country codes; show the country in the UI language ("JP" → 日本 / Japan). */
    fun country(code: String, locale: Locale = Locale.getDefault()): String {
        val short = if (locale.language == "zh") COUNTRY_ZH_SHORT[code] else null
        return short ?: Locale("", code).getDisplayCountry(locale).takeIf { it.isNotBlank() && it != code } ?: code
    }

    // ICU's long forms do not fit the one status line.
    private val COUNTRY_ZH_SHORT = mapOf("HK" to "香港", "MO" to "澳门")

    fun rate(bytesPerSec: Long): String = when {
        bytesPerSec >= 1_000_000 -> String.format(Locale.ROOT, "%.2f MB/s", bytesPerSec / 1_000_000.0)
        bytesPerSec >= 1_000 -> String.format(Locale.ROOT, "%d KB/s", bytesPerSec / 1_000)
        else -> "$bytesPerSec B/s"
    }

    /** Desktop LatencyLevel thresholds: <200 good, <400 slow, ≥400 very slow. */
    fun latencyColor(ms: Long?) = when {
        ms == null -> TonoColors.Neutral
        ms < 200 -> TonoColors.LatencyGood
        ms < 400 -> TonoColors.Warning
        else -> TonoColors.Error
    }
}
