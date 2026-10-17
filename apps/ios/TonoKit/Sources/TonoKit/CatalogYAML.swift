import Foundation

/// Value read by `CatalogYAML`. Scalars stay strings; callers convert types explicitly.
public indirect enum YAML: Equatable, Sendable {
    case null
    case scalar(String)
    case sequence([YAML])
    case mapping([String: YAML], keys: [String])

    public subscript(key: String) -> YAML? {
        if case .mapping(let m, _) = self { return m[key] }
        return nil
    }

    public var scalar: String? { if case .scalar(let s) = self { return s }; return nil }
}

/// Restricted YAML reader for the Tono managed catalog (a `proxies:` list of Clash-style mappings).
///
/// Supports block mappings/sequences, flow mappings/sequences, plain/single/double-quoted scalars
/// and comments. Anchors, aliases, tags, block scalars, multi-documents, tab indentation and
/// duplicate keys are rejected, so an unexpected document fails closed instead of being guessed.
/// Port of the Android reader (`android/routing/.../CatalogYaml.kt`) with the same grammar.
public enum CatalogYAML {
    public struct Failure: Error, Equatable, CustomStringConvertible {
        public let message: String
        public var description: String { message }
    }

    static let maxBytes = 1024 * 1024
    static let maxDepth = 16

    public static func parse(_ text: String) throws -> YAML {
        guard text.utf8.count <= maxBytes else { throw Failure(message: "catalog too large") }
        guard !text.unicodeScalars.contains("\u{0}") else { throw Failure(message: "NUL in catalog") }
        var lines: [Line] = []
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        for (index, rawLine) in normalized.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let raw = Array(String(rawLine).unicodeScalars)
            var content = stripComment(raw)
            while let last = content.last, last == " " || last == "\t" { content.removeLast() }
            let indent = content.prefix { $0 == " " }.count
            let body = Array(content.dropFirst(indent))
            if body.isEmpty { continue }
            if body.first == "\t" { throw Failure(message: "tab indentation at line \(index + 1)") }
            lines.append(Line(number: index + 1, indent: indent, text: body))
        }
        if let marker = lines.first(where: { String($0.textString) == "---" || $0.textString == "..." }) {
            throw Failure(message: "multi-document at line \(marker.number)")
        }
        guard !lines.isEmpty else { return .null }
        var reader = BlockReader(lines: lines)
        let value = try reader.block(indent: lines[0].indent, depth: 0)
        if reader.pos != lines.count { throw Failure(message: "unexpected content at line \(lines[reader.pos].number)") }
        return value
    }

    struct Line {
        let number: Int
        let indent: Int
        let text: [Unicode.Scalar]
        var textString: String { String(String.UnicodeScalarView(text)) }
        var isSequenceItem: Bool { text == ["-"] || (text.count >= 2 && text[0] == "-" && text[1] == " ") }
    }

    static func stripComment(_ line: [Unicode.Scalar]) -> [Unicode.Scalar] {
        var quote: Unicode.Scalar?
        var i = 0
        while i < line.count {
            let c = line[i]
            if quote == "'" && c == "'" {
                if i + 1 < line.count && line[i + 1] == "'" { i += 1 } else { quote = nil }
            } else if quote == "\"" && c == "\\" {
                i += 1
            } else if quote == "\"" && c == "\"" {
                quote = nil
            } else if quote == nil && (c == "'" || c == "\"") && (i == 0 || " \t[{,:-".unicodeScalars.contains(line[i - 1])) {
                quote = c
            } else if quote == nil && c == "#" && (i == 0 || line[i - 1] == " " || line[i - 1] == "\t") {
                return Array(line[0..<i])
            }
            i += 1
        }
        return line
    }

    struct BlockReader {
        let lines: [Line]
        var pos = 0

        mutating func block(indent: Int, depth: Int) throws -> YAML {
            guard depth <= CatalogYAML.maxDepth else { throw Failure(message: "catalog nesting too deep") }
            return lines[pos].isSequenceItem ? try sequence(indent: indent, depth: depth) : try mapping(from: lines[pos], indent: indent, depth: depth)
        }

        mutating func sequence(indent: Int, depth: Int) throws -> YAML {
            var items: [YAML] = []
            while pos < lines.count && lines[pos].indent == indent && lines[pos].isSequenceItem {
                let line = lines[pos]
                var rest = Array(line.text.dropFirst())
                while rest.first == " " { rest.removeFirst() }
                if rest.isEmpty {
                    pos += 1
                    if pos < lines.count && lines[pos].indent > indent {
                        items.append(try block(indent: lines[pos].indent, depth: depth + 1))
                    } else {
                        items.append(.null)
                    }
                    continue
                }
                // "- key: value" opens an inline mapping whose further keys align with `key`.
                let childIndent = indent + (line.text.count - rest.count)
                let first = rest[0]
                if first != "{" && first != "[" && first != "\"" && first != "'" && CatalogYAML.keySplit(rest) != nil {
                    items.append(try mapping(from: Line(number: line.number, indent: childIndent, text: rest), indent: childIndent, depth: depth + 1))
                } else {
                    pos += 1
                    var flow = Flow(s: rest, line: line.number)
                    items.append(try flow.value(depth: depth + 1))
                }
            }
            if pos < lines.count && lines[pos].indent > indent { throw Failure(message: "bad indentation at line \(lines[pos].number)") }
            return .sequence(items)
        }

        /// Reads a mapping whose first entry is `first` (synthetic for "- key:" items).
        mutating func mapping(from first: Line, indent: Int, depth: Int) throws -> YAML {
            guard depth <= CatalogYAML.maxDepth else { throw Failure(message: "catalog nesting too deep") }
            var map: [String: YAML] = [:]
            var keys: [String] = []
            var current: Line? = first
            while let line = current {
                guard let (rawKey, rawValue) = CatalogYAML.keySplit(line.text) else {
                    throw Failure(message: "expected 'key: value' at line \(line.number)")
                }
                let key = try CatalogYAML.scalarKey(rawKey, line: line.number)
                if map[key] != nil { throw Failure(message: "duplicate key '\(key)' at line \(line.number)") }
                pos += 1
                let value: YAML
                if rawValue.isEmpty {
                    if pos < lines.count && lines[pos].indent > indent {
                        value = try block(indent: lines[pos].indent, depth: depth + 1)
                    } else if pos < lines.count && lines[pos].indent == indent && lines[pos].isSequenceItem && lines[pos].text != ["-"] {
                        // Clash style: a sequence may sit at the parent key's indentation.
                        value = try block(indent: indent, depth: depth + 1)
                    } else {
                        value = .null
                    }
                } else {
                    var flow = Flow(s: rawValue, line: line.number)
                    value = try flow.value(depth: depth + 1)
                }
                map[key] = value
                keys.append(key)
                if pos < lines.count && lines[pos].indent == indent && !lines[pos].isSequenceItem {
                    current = lines[pos]
                } else {
                    current = nil
                }
            }
            if pos < lines.count && lines[pos].indent > indent { throw Failure(message: "bad indentation at line \(lines[pos].number)") }
            return .mapping(map, keys: keys)
        }
    }

    /// Splits "key: value" at the first unquoted ": " (or a trailing ':').
    static func keySplit(_ text: [Unicode.Scalar]) -> ([Unicode.Scalar], [Unicode.Scalar])? {
        var quote: Unicode.Scalar?
        var i = 0
        while i < text.count {
            let c = text[i]
            if let q = quote {
                if c == q { quote = nil }
            } else if c == "\"" || c == "'" {
                if i == 0 { quote = c }
            } else if c == "{" || c == "[" {
                return nil
            } else if c == ":" && (i + 1 == text.count || text[i + 1] == " ") {
                return (trim(Array(text[0..<i])), trim(Array(text[(i + 1)...])))
            }
            i += 1
        }
        return nil
    }

    static func trim(_ s: [Unicode.Scalar]) -> [Unicode.Scalar] {
        var a = s[...]
        while let f = a.first, f == " " || f == "\t" { a.removeFirst() }
        while let l = a.last, l == " " || l == "\t" { a.removeLast() }
        return Array(a)
    }

    static func scalarKey(_ raw: [Unicode.Scalar], line: Int) throws -> String {
        var flow = Flow(s: raw, line: line)
        guard case .scalar(let key) = try flow.value(depth: 0) else { throw Failure(message: "non-scalar key at line \(line)") }
        return key
    }

    struct Flow {
        let s: [Unicode.Scalar]
        let line: Int
        var pos = 0
        var flowDepth = 0

        init(s: [Unicode.Scalar], line: Int) {
            self.s = s
            self.line = line
        }

        mutating func value(depth: Int) throws -> YAML {
            let v = try node(depth: depth)
            skipWs()
            if pos != s.count { throw Failure(message: "unexpected '\(String(String.UnicodeScalarView(s[pos...])))' at line \(line)") }
            return v
        }

        mutating func skipWs() { while pos < s.count && s[pos] == " " { pos += 1 } }

        mutating func node(depth: Int) throws -> YAML {
            guard depth <= CatalogYAML.maxDepth else { throw Failure(message: "catalog nesting too deep") }
            skipWs()
            guard pos < s.count else { return .null }
            switch s[pos] {
            case "{": return try map(depth: depth)
            case "[": return try seq(depth: depth)
            case "\"": return .scalar(try doubleQuoted())
            case "'": return .scalar(try singleQuoted())
            case "&", "*", "!", "|", ">", "%", "@", "`":
                throw Failure(message: "unsupported YAML feature '\(s[pos])' at line \(line)")
            default: return .scalar(try plain(inFlow: depth > 0 && flowDepth > 0))
            }
        }

        mutating func map(depth: Int) throws -> YAML {
            pos += 1
            flowDepth += 1
            var map: [String: YAML] = [:]
            var keys: [String] = []
            skipWs()
            if pos < s.count && s[pos] == "}" { pos += 1; flowDepth -= 1; return .mapping(map, keys: keys) }
            while true {
                skipWs()
                let key: String
                if pos < s.count && s[pos] == "\"" { key = try doubleQuoted() }
                else if pos < s.count && s[pos] == "'" { key = try singleQuoted() }
                else { key = try plain(inFlow: true, key: true) }
                skipWs()
                guard pos < s.count && s[pos] == ":" else { throw Failure(message: "expected ':' in flow mapping at line \(line)") }
                pos += 1
                if map[key] != nil { throw Failure(message: "duplicate key '\(key)' at line \(line)") }
                map[key] = try node(depth: depth + 1)
                keys.append(key)
                skipWs()
                guard pos < s.count else { throw Failure(message: "unterminated flow mapping at line \(line)") }
                let c = s[pos]
                pos += 1
                if c == "," { continue }
                if c == "}" { flowDepth -= 1; return .mapping(map, keys: keys) }
                throw Failure(message: "expected ',' or '}' at line \(line)")
            }
        }

        mutating func seq(depth: Int) throws -> YAML {
            pos += 1
            flowDepth += 1
            var list: [YAML] = []
            skipWs()
            if pos < s.count && s[pos] == "]" { pos += 1; flowDepth -= 1; return .sequence(list) }
            while true {
                list.append(try node(depth: depth + 1))
                skipWs()
                guard pos < s.count else { throw Failure(message: "unterminated flow sequence at line \(line)") }
                let c = s[pos]
                pos += 1
                if c == "," { continue }
                if c == "]" { flowDepth -= 1; return .sequence(list) }
                throw Failure(message: "expected ',' or ']' at line \(line)")
            }
        }

        mutating func plain(inFlow: Bool, key: Bool = false) throws -> String {
            let start = pos
            while pos < s.count {
                let c = s[pos]
                if inFlow && (c == "," || c == "}" || c == "]") { break }
                if key && c == ":" { break }
                if inFlow && c == ":" && (pos + 1 == s.count || s[pos + 1] == " " || s[pos + 1] == "," || s[pos + 1] == "}") { break }
                pos += 1
            }
            let text = String(String.UnicodeScalarView(CatalogYAML.trim(Array(s[start..<pos]))))
            if text.isEmpty { throw Failure(message: "empty scalar at line \(line)") }
            if ["~", "null", "Null", "NULL"].contains(text) { return "" }
            return text
        }

        mutating func singleQuoted() throws -> String {
            pos += 1
            var out = String.UnicodeScalarView()
            while true {
                guard pos < s.count else { throw Failure(message: "unterminated quote at line \(line)") }
                let c = s[pos]
                pos += 1
                if c == "'" {
                    if pos < s.count && s[pos] == "'" { out.append("'"); pos += 1 } else { return String(out) }
                } else {
                    out.append(c)
                }
            }
        }

        mutating func doubleQuoted() throws -> String {
            pos += 1
            var out = String.UnicodeScalarView()
            while true {
                guard pos < s.count else { throw Failure(message: "unterminated quote at line \(line)") }
                let c = s[pos]
                pos += 1
                if c == "\"" { return String(out) }
                if c != "\\" { out.append(c); continue }
                guard pos < s.count else { throw Failure(message: "bad escape at line \(line)") }
                let e = s[pos]
                pos += 1
                switch e {
                case "\"": out.append("\"")
                case "\\": out.append("\\")
                case "/": out.append("/")
                case "n": out.append("\n")
                case "t": out.append("\t")
                case "r": out.append("\r")
                case "u":
                    guard pos + 4 <= s.count,
                          let v = UInt32(String(String.UnicodeScalarView(s[pos..<pos + 4])), radix: 16),
                          let scalar = Unicode.Scalar(v) else { throw Failure(message: "bad escape at line \(line)") }
                    out.append(scalar)
                    pos += 4
                default: throw Failure(message: "unsupported escape \\\(e) at line \(line)")
                }
            }
        }
    }
}
