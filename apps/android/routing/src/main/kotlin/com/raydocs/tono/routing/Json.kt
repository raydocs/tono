package com.raydocs.tono.routing

/**
 * Deterministic JSON for generated sing-box configuration and small API payloads.
 * Values are String, Number, Boolean, null, Map<String, Any?> (insertion order kept) and List<Any?>.
 */
object Json {
    fun write(value: Any?): String = StringBuilder().also { append(it, value) }.toString()

    private fun append(out: StringBuilder, value: Any?) {
        when (value) {
            null -> out.append("null")
            is String -> quote(out, value)
            is Boolean -> out.append(value)
            is Int, is Long -> out.append(value.toString())
            is Double -> {
                require(value.isFinite()) { "non-finite number" }
                if (value == Math.rint(value) && kotlin.math.abs(value) < 1e15) out.append(value.toLong()) else out.append(value)
            }
            is Map<*, *> -> {
                out.append('{')
                var first = true
                for ((k, v) in value) {
                    if (!first) out.append(',')
                    first = false
                    quote(out, k as String)
                    out.append(':')
                    append(out, v)
                }
                out.append('}')
            }
            is Iterable<*> -> {
                out.append('[')
                var first = true
                for (v in value) {
                    if (!first) out.append(',')
                    first = false
                    append(out, v)
                }
                out.append(']')
            }
            else -> error("unsupported JSON value ${value::class.java.simpleName}")
        }
    }

    private fun quote(out: StringBuilder, s: String) {
        out.append('"')
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                else -> if (c < ' ' || c == '\u2028' || c == '\u2029') out.append("\\u%04x".format(c.code)) else out.append(c)
            }
        }
        out.append('"')
    }

    /** Strict RFC 8259 parser with a depth bound. Numbers become Long when integral, otherwise Double. */
    fun parse(text: String, maxDepth: Int = 64): Any? {
        val parser = Parser(text, maxDepth)
        val value = parser.value(0)
        parser.skipWs()
        require(parser.pos == text.length) { "trailing data at ${parser.pos}" }
        return value
    }

    private class Parser(val s: String, val maxDepth: Int) {
        var pos = 0

        fun skipWs() {
            while (pos < s.length && (s[pos] == ' ' || s[pos] == '\n' || s[pos] == '\r' || s[pos] == '\t')) pos++
        }

        fun value(depth: Int): Any? {
            require(depth <= maxDepth) { "JSON too deep" }
            skipWs()
            require(pos < s.length) { "unexpected end" }
            return when (val c = s[pos]) {
                '{' -> obj(depth)
                '[' -> arr(depth)
                '"' -> str()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c in '0'..'9') num() else error("unexpected '$c' at $pos")
            }
        }

        private fun literal(word: String, v: Any?): Any? {
            require(s.startsWith(word, pos)) { "bad literal at $pos" }
            pos += word.length
            return v
        }

        private fun obj(depth: Int): Map<String, Any?> {
            pos++
            val map = LinkedHashMap<String, Any?>()
            skipWs()
            if (pos < s.length && s[pos] == '}') { pos++; return map }
            while (true) {
                skipWs()
                require(pos < s.length && s[pos] == '"') { "expected key at $pos" }
                val key = str()
                require(!map.containsKey(key)) { "duplicate key $key" }
                skipWs()
                require(pos < s.length && s[pos] == ':') { "expected ':' at $pos" }
                pos++
                map[key] = value(depth + 1)
                skipWs()
                require(pos < s.length) { "unexpected end" }
                when (s[pos++]) {
                    ',' -> continue
                    '}' -> return map
                    else -> error("expected ',' or '}' at ${pos - 1}")
                }
            }
        }

        private fun arr(depth: Int): List<Any?> {
            pos++
            val list = ArrayList<Any?>()
            skipWs()
            if (pos < s.length && s[pos] == ']') { pos++; return list }
            while (true) {
                list += value(depth + 1)
                skipWs()
                require(pos < s.length) { "unexpected end" }
                when (s[pos++]) {
                    ',' -> continue
                    ']' -> return list
                    else -> error("expected ',' or ']' at ${pos - 1}")
                }
            }
        }

        private fun str(): String {
            pos++
            val out = StringBuilder()
            while (true) {
                require(pos < s.length) { "unterminated string" }
                val c = s[pos++]
                when {
                    c == '"' -> return out.toString()
                    c == '\\' -> {
                        require(pos < s.length) { "bad escape" }
                        when (val e = s[pos++]) {
                            '"' -> out.append('"'); '\\' -> out.append('\\'); '/' -> out.append('/')
                            'b' -> out.append('\b'); 'f' -> out.append('\u000c'); 'n' -> out.append('\n')
                            'r' -> out.append('\r'); 't' -> out.append('\t')
                            'u' -> {
                                require(pos + 4 <= s.length) { "bad unicode escape" }
                                out.append(s.substring(pos, pos + 4).toInt(16).toChar())
                                pos += 4
                            }
                            else -> error("bad escape \\$e")
                        }
                    }
                    c < ' ' -> error("control character in string")
                    else -> out.append(c)
                }
            }
        }

        private fun num(): Any {
            val start = pos
            if (s[pos] == '-') pos++
            while (pos < s.length && (s[pos].isDigit() || s[pos] in ".eE+-")) pos++
            val text = s.substring(start, pos)
            require(Regex("-?(0|[1-9]\\d*)(\\.\\d+)?([eE][+-]?\\d+)?").matches(text)) { "bad number $text" }
            return text.toLongOrNull() ?: text.toDouble()
        }
    }
}

@Suppress("UNCHECKED_CAST")
fun Any?.asObject(): Map<String, Any?> = this as? Map<String, Any?> ?: throw IllegalArgumentException("expected object")

@Suppress("UNCHECKED_CAST")
fun Any?.asArray(): List<Any?> = this as? List<Any?> ?: throw IllegalArgumentException("expected array")
