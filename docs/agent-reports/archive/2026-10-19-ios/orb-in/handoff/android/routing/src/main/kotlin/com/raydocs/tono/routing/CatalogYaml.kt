package com.raydocs.tono.routing

/**
 * Restricted YAML reader for the Tono managed catalog (`proxies:` list of Clash-style mappings).
 *
 * Supports block mappings/sequences, flow mappings/sequences, plain/single/double-quoted
 * scalars and comments. Anchors, aliases, tags, block scalars, multi-documents and
 * duplicate keys are rejected so an unexpected document fails closed instead of being guessed.
 * Scalars stay strings; callers convert types explicitly.
 */
object CatalogYaml {
    class YamlException(message: String) : IllegalArgumentException(message)

    private const val MAX_BYTES = 1024 * 1024
    private const val MAX_DEPTH = 16

    fun parse(text: String): Any? {
        if (text.length > MAX_BYTES) throw YamlException("catalog too large")
        if (text.contains('\u0000')) throw YamlException("NUL in catalog")
        val lines = text.replace("\r\n", "\n").split('\n').mapIndexedNotNull { index, raw ->
            if (raw.contains('\t') && raw.trimStart().startsWith("\t")) throw YamlException("tab indentation at line ${index + 1}")
            val content = stripComment(raw).trimEnd()
            if (content.isBlank()) null else Line(index + 1, raw.length - raw.trimStart(' ').length, content.trimStart(' '))
        }
        lines.firstOrNull { it.text == "---" || it.text == "..." }?.let { throw YamlException("multi-document at line ${it.number}") }
        if (lines.isEmpty()) return null
        val reader = BlockReader(lines)
        val value = reader.block(lines[0].indent, 0)
        if (reader.pos != lines.size) throw YamlException("unexpected content at line ${lines[reader.pos].number}")
        return value
    }

    private data class Line(val number: Int, val indent: Int, val text: String)

    private fun stripComment(line: String): String {
        var quote: Char? = null
        var i = 0
        while (i < line.length) {
            val c = line[i]
            when {
                quote == '\'' && c == '\'' -> {
                    if (i + 1 < line.length && line[i + 1] == '\'') i++ else quote = null
                }
                quote == '"' && c == '\\' -> i++
                quote == '"' && c == '"' -> quote = null
                quote == null && (c == '\'' || c == '"') && (i == 0 || line[i - 1] in " \t[{,:-") -> quote = c
                quote == null && c == '#' && (i == 0 || line[i - 1] == ' ' || line[i - 1] == '\t') -> return line.substring(0, i)
            }
            i++
        }
        return line
    }

    private class BlockReader(val lines: List<Line>) {
        var pos = 0

        fun block(indent: Int, depth: Int): Any? {
            if (depth > MAX_DEPTH) throw YamlException("catalog nesting too deep")
            val line = lines[pos]
            return if (line.text == "-" || line.text.startsWith("- ")) sequence(indent, depth) else mapping(indent, depth)
        }

        private fun sequence(indent: Int, depth: Int): List<Any?> {
            val items = ArrayList<Any?>()
            while (pos < lines.size && lines[pos].indent == indent && (lines[pos].text == "-" || lines[pos].text.startsWith("- "))) {
                val line = lines[pos]
                val rest = line.text.removePrefix("-").trimStart(' ')
                if (rest.isEmpty()) {
                    pos++
                    if (pos < lines.size && lines[pos].indent > indent) items += block(lines[pos].indent, depth + 1) else items += null
                    continue
                }
                // "- key: value" opens an inline mapping whose further keys align with `key`.
                val childIndent = indent + (line.text.length - rest.length)
                if (!rest.startsWith("{") && !rest.startsWith("[") && !rest.startsWith("\"") && !rest.startsWith("'") && keySplit(rest) != null) {
                    items += mappingFrom(Line(line.number, childIndent, rest), childIndent, depth + 1)
                } else {
                    pos++
                    items += Flow(rest, line.number).value(depth + 1)
                }
            }
            if (pos < lines.size && lines[pos].indent > indent) throw YamlException("bad indentation at line ${lines[pos].number}")
            return items
        }

        private fun mapping(indent: Int, depth: Int): Map<String, Any?> = mappingFrom(lines[pos], indent, depth)

        /** Reads a mapping whose first entry is [first] (which may be synthetic for "- key:" items). */
        private fun mappingFrom(first: Line, indent: Int, depth: Int): Map<String, Any?> {
            if (depth > MAX_DEPTH) throw YamlException("catalog nesting too deep")
            val map = LinkedHashMap<String, Any?>()
            var current: Line? = first
            while (current != null) {
                val split = keySplit(current.text) ?: throw YamlException("expected 'key: value' at line ${current.number}")
                val (rawKey, rawValue) = split
                val key = scalarKey(rawKey, current.number)
                if (map.containsKey(key)) throw YamlException("duplicate key '$key' at line ${current.number}")
                pos++
                map[key] = if (rawValue.isEmpty()) {
                    if (pos < lines.size && lines[pos].indent > indent) {
                        block(lines[pos].indent, depth + 1)
                    } else if (pos < lines.size && lines[pos].indent == indent && lines[pos].text.startsWith("- ")) {
                        // Clash style: a sequence may sit at the parent key's indentation.
                        block(indent, depth + 1)
                    } else null
                } else {
                    Flow(rawValue, current.number).value(depth + 1)
                }
                current = if (pos < lines.size && lines[pos].indent == indent && !lines[pos].text.startsWith("- ") && lines[pos].text != "-") lines[pos] else null
            }
            if (pos < lines.size && lines[pos].indent > indent) throw YamlException("bad indentation at line ${lines[pos].number}")
            return map
        }
    }

    /** Splits "key: value" at the first unquoted ": " (or trailing ':'). */
    private fun keySplit(text: String): Pair<String, String>? {
        var quote: Char? = null
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (quote != null) {
                if (c == quote) quote = null
            } else if (c == '"' || c == '\'') {
                if (i == 0) quote = c
            } else if (c == '{' || c == '[') {
                return null
            } else if (c == ':' && (i + 1 == text.length || text[i + 1] == ' ')) {
                return text.substring(0, i).trim() to text.substring(i + 1).trim()
            }
            i++
        }
        return null
    }

    private fun scalarKey(raw: String, line: Int): String {
        val value = Flow(raw, line).value(0)
        return value as? String ?: throw YamlException("non-scalar key at line $line")
    }

    private class Flow(val s: String, val line: Int) {
        var pos = 0

        fun value(depth: Int): Any? {
            val v = node(depth)
            skipWs()
            if (pos != s.length) throw YamlException("unexpected '${s.substring(pos)}' at line $line")
            return v
        }

        private fun skipWs() { while (pos < s.length && s[pos] == ' ') pos++ }

        private fun node(depth: Int): Any? {
            if (depth > MAX_DEPTH) throw YamlException("catalog nesting too deep")
            skipWs()
            if (pos >= s.length) return null
            return when (s[pos]) {
                '{' -> map(depth)
                '[' -> seq(depth)
                '"' -> doubleQuoted()
                '\'' -> singleQuoted()
                '&', '*', '!', '|', '>', '%', '@', '`' -> throw YamlException("unsupported YAML feature '${s[pos]}' at line $line")
                else -> plain(inFlow = depth > 0 && flowDepth > 0)
            }
        }

        private var flowDepth = 0

        private fun map(depth: Int): Map<String, Any?> {
            pos++
            flowDepth++
            val map = LinkedHashMap<String, Any?>()
            skipWs()
            if (pos < s.length && s[pos] == '}') { pos++; flowDepth--; return map }
            while (true) {
                skipWs()
                val key = when {
                    pos < s.length && s[pos] == '"' -> doubleQuoted()
                    pos < s.length && s[pos] == '\'' -> singleQuoted()
                    else -> plain(inFlow = true, key = true)
                }
                skipWs()
                if (pos >= s.length || s[pos] != ':') throw YamlException("expected ':' in flow mapping at line $line")
                pos++
                if (map.containsKey(key)) throw YamlException("duplicate key '$key' at line $line")
                map[key] = node(depth + 1)
                skipWs()
                if (pos >= s.length) throw YamlException("unterminated flow mapping at line $line")
                when (s[pos++]) {
                    ',' -> continue
                    '}' -> { flowDepth--; return map }
                    else -> throw YamlException("expected ',' or '}' at line $line")
                }
            }
        }

        private fun seq(depth: Int): List<Any?> {
            pos++
            flowDepth++
            val list = ArrayList<Any?>()
            skipWs()
            if (pos < s.length && s[pos] == ']') { pos++; flowDepth--; return list }
            while (true) {
                list += node(depth + 1)
                skipWs()
                if (pos >= s.length) throw YamlException("unterminated flow sequence at line $line")
                when (s[pos++]) {
                    ',' -> continue
                    ']' -> { flowDepth--; return list }
                    else -> throw YamlException("expected ',' or ']' at line $line")
                }
            }
        }

        private fun plain(inFlow: Boolean, key: Boolean = false): String {
            val start = pos
            while (pos < s.length) {
                val c = s[pos]
                if (inFlow && (c == ',' || c == '}' || c == ']')) break
                if (key && c == ':') break
                if (inFlow && c == ':' && (pos + 1 == s.length || s[pos + 1] == ' ' || s[pos + 1] == ',' || s[pos + 1] == '}')) break
                pos++
            }
            val text = s.substring(start, pos).trim()
            if (text.isEmpty()) throw YamlException("empty scalar at line $line")
            if (text == "~" || text == "null" || text == "Null" || text == "NULL") return ""
            return text
        }

        private fun singleQuoted(): String {
            pos++
            val out = StringBuilder()
            while (true) {
                if (pos >= s.length) throw YamlException("unterminated quote at line $line")
                val c = s[pos++]
                if (c == '\'') {
                    if (pos < s.length && s[pos] == '\'') { out.append('\''); pos++ } else return out.toString()
                } else out.append(c)
            }
        }

        private fun doubleQuoted(): String {
            pos++
            val out = StringBuilder()
            while (true) {
                if (pos >= s.length) throw YamlException("unterminated quote at line $line")
                val c = s[pos++]
                when (c) {
                    '"' -> return out.toString()
                    '\\' -> {
                        if (pos >= s.length) throw YamlException("bad escape at line $line")
                        when (val e = s[pos++]) {
                            '"' -> out.append('"'); '\\' -> out.append('\\'); '/' -> out.append('/')
                            'n' -> out.append('\n'); 't' -> out.append('\t'); 'r' -> out.append('\r')
                            'u' -> {
                                if (pos + 4 > s.length) throw YamlException("bad escape at line $line")
                                out.append(s.substring(pos, pos + 4).toInt(16).toChar()); pos += 4
                            }
                            else -> throw YamlException("unsupported escape \\$e at line $line")
                        }
                    }
                    else -> out.append(c)
                }
            }
        }
    }
}
