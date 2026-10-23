import Foundation

/// A JSON value with ordered object keys, so a generated sing-box configuration is byte-stable
/// and reads in rule order. Parsing is strict (RFC 8259, no trailing commas, no comments).
public indirect enum JSON: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object(JSONObject)

    public subscript(key: String) -> JSON? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var string: String? { if case .string(let s) = self { return s }; return nil }
    public var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
    public var array: [JSON]? { if case .array(let a) = self { return a }; return nil }
    public var object: JSONObject? { if case .object(let o) = self { return o }; return nil }
    public var isNull: Bool { self == .null }

    /// Integral numbers only; 7.5 or 1e300 read as nil rather than being truncated.
    public var int: Int? {
        guard case .number(let d) = self, d.rounded() == d, abs(d) <= 9_007_199_254_740_991 else { return nil }
        return Int(d)
    }
}

public struct JSONObject: Equatable, Sendable {
    public private(set) var keys: [String] = []
    private var values: [String: JSON] = [:]

    public init() {}

    public init(_ pairs: [(String, JSON)]) {
        for (k, v) in pairs { self[k] = v }
    }

    public subscript(key: String) -> JSON? {
        get { values[key] }
        set {
            if let newValue {
                if values.updateValue(newValue, forKey: key) == nil { keys.append(key) }
            } else if values.removeValue(forKey: key) != nil {
                keys.removeAll { $0 == key }
            }
        }
    }

    public var pairs: [(String, JSON)] { keys.map { ($0, values[$0]!) } }
    public var isEmpty: Bool { keys.isEmpty }
}

// MARK: - Literals

extension JSON: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral,
    ExpressibleByArrayLiteral, ExpressibleByNilLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(arrayLiteral elements: JSON...) { self = .array(elements) }
    public init(nilLiteral: ()) { self = .null }

    public static func strings(_ values: [String]) -> JSON { .array(values.map(JSON.string)) }
    public static func ints(_ values: [Int]) -> JSON { .array(values.map(JSON.int)) }
    public static func int(_ value: Int) -> JSON { .number(Double(value)) }
    public static func obj(_ pairs: (String, JSON)...) -> JSON { .object(JSONObject(pairs)) }
}

// MARK: - Writing

public enum JSONError: Error, Equatable {
    case syntax(String)
    case tooDeep
}

extension JSON {
    /// Compact, deterministic output (keys in insertion order).
    public func serialized() -> String {
        var out = ""
        write(into: &out)
        return out
    }

    private func write(into out: inout String) {
        switch self {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .number(let d):
            if d.rounded() == d && abs(d) < 1e15 { out += String(Int64(d)) } else { out += "\(d)" }
        case .string(let s): JSON.quote(s, into: &out)
        case .array(let a):
            out += "["
            for (i, v) in a.enumerated() {
                if i > 0 { out += "," }
                v.write(into: &out)
            }
            out += "]"
        case .object(let o):
            out += "{"
            for (i, (k, v)) in o.pairs.enumerated() {
                if i > 0 { out += "," }
                JSON.quote(k, into: &out)
                out += ":"
                v.write(into: &out)
            }
            out += "}"
        }
    }

    static func quote(_ s: String, into out: inout String) {
        out += "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
    }
}

// MARK: - Parsing

extension JSON {
    public static func parse(_ text: String) throws -> JSON {
        var parser = Parser(Array(text.utf8))
        let value = try parser.value(depth: 0)
        parser.skipWhitespace()
        guard parser.pos == parser.bytes.count else { throw JSONError.syntax("trailing content") }
        return value
    }

    public static func parse(_ data: Data) throws -> JSON {
        guard let text = String(data: data, encoding: .utf8) else { throw JSONError.syntax("not UTF-8") }
        return try parse(text)
    }

    private struct Parser {
        let bytes: [UInt8]
        var pos = 0
        static let maxDepth = 64

        init(_ bytes: [UInt8]) { self.bytes = bytes }

        mutating func skipWhitespace() {
            while pos < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[pos]) { pos += 1 }
        }

        mutating func value(depth: Int) throws -> JSON {
            guard depth < Parser.maxDepth else { throw JSONError.tooDeep }
            skipWhitespace()
            guard pos < bytes.count else { throw JSONError.syntax("unexpected end") }
            switch bytes[pos] {
            case UInt8(ascii: "{"): return try object(depth: depth)
            case UInt8(ascii: "["): return try array(depth: depth)
            case UInt8(ascii: "\""): return .string(try string())
            case UInt8(ascii: "t"): try literal("true"); return .bool(true)
            case UInt8(ascii: "f"): try literal("false"); return .bool(false)
            case UInt8(ascii: "n"): try literal("null"); return .null
            default: return .number(try number())
            }
        }

        mutating func literal(_ word: String) throws {
            let w = Array(word.utf8)
            guard pos + w.count <= bytes.count, Array(bytes[pos..<pos + w.count]) == w else {
                throw JSONError.syntax("bad literal")
            }
            pos += w.count
        }

        mutating func object(depth: Int) throws -> JSON {
            pos += 1
            var obj = JSONObject()
            skipWhitespace()
            if pos < bytes.count, bytes[pos] == UInt8(ascii: "}") { pos += 1; return .object(obj) }
            while true {
                skipWhitespace()
                guard pos < bytes.count, bytes[pos] == UInt8(ascii: "\"") else { throw JSONError.syntax("expected key") }
                let key = try string()
                skipWhitespace()
                guard pos < bytes.count, bytes[pos] == UInt8(ascii: ":") else { throw JSONError.syntax("expected ':'") }
                pos += 1
                guard obj[key] == nil else { throw JSONError.syntax("duplicate key \(key)") }
                obj[key] = try value(depth: depth + 1)
                skipWhitespace()
                guard pos < bytes.count else { throw JSONError.syntax("unterminated object") }
                let c = bytes[pos]
                pos += 1
                if c == UInt8(ascii: ",") { continue }
                if c == UInt8(ascii: "}") { return .object(obj) }
                throw JSONError.syntax("expected ',' or '}'")
            }
        }

        mutating func array(depth: Int) throws -> JSON {
            pos += 1
            var items: [JSON] = []
            skipWhitespace()
            if pos < bytes.count, bytes[pos] == UInt8(ascii: "]") { pos += 1; return .array(items) }
            while true {
                items.append(try value(depth: depth + 1))
                skipWhitespace()
                guard pos < bytes.count else { throw JSONError.syntax("unterminated array") }
                let c = bytes[pos]
                pos += 1
                if c == UInt8(ascii: ",") { continue }
                if c == UInt8(ascii: "]") { return .array(items) }
                throw JSONError.syntax("expected ',' or ']'")
            }
        }

        mutating func hex4() throws -> UInt32 {
            guard pos + 4 <= bytes.count, let text = String(bytes: bytes[pos..<pos + 4], encoding: .ascii),
                  let v = UInt32(text, radix: 16) else { throw JSONError.syntax("bad \\u escape") }
            pos += 4
            return v
        }

        mutating func string() throws -> String {
            pos += 1
            var raw: [UInt8] = []
            while true {
                guard pos < bytes.count else { throw JSONError.syntax("unterminated string") }
                let c = bytes[pos]
                pos += 1
                switch c {
                case UInt8(ascii: "\""):
                    guard let s = String(bytes: raw, encoding: .utf8) else { throw JSONError.syntax("bad UTF-8") }
                    return s
                case UInt8(ascii: "\\"):
                    guard pos < bytes.count else { throw JSONError.syntax("bad escape") }
                    let e = bytes[pos]
                    pos += 1
                    switch e {
                    case UInt8(ascii: "\""): raw.append(0x22)
                    case UInt8(ascii: "\\"): raw.append(0x5C)
                    case UInt8(ascii: "/"): raw.append(0x2F)
                    case UInt8(ascii: "b"): raw.append(0x08)
                    case UInt8(ascii: "f"): raw.append(0x0C)
                    case UInt8(ascii: "n"): raw.append(0x0A)
                    case UInt8(ascii: "r"): raw.append(0x0D)
                    case UInt8(ascii: "t"): raw.append(0x09)
                    case UInt8(ascii: "u"):
                        var code = try hex4()
                        if (0xD800...0xDBFF).contains(code) {
                            guard pos + 2 <= bytes.count, bytes[pos] == UInt8(ascii: "\\"), bytes[pos + 1] == UInt8(ascii: "u") else {
                                throw JSONError.syntax("lone surrogate")
                            }
                            pos += 2
                            let low = try hex4()
                            guard (0xDC00...0xDFFF).contains(low) else { throw JSONError.syntax("bad surrogate") }
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
                        } else if (0xDC00...0xDFFF).contains(code) {
                            throw JSONError.syntax("lone surrogate")
                        }
                        guard let scalar = Unicode.Scalar(code) else { throw JSONError.syntax("bad code point") }
                        raw.append(contentsOf: Array(String(Character(scalar)).utf8))
                    default: throw JSONError.syntax("bad escape")
                    }
                default:
                    guard c >= 0x20 else { throw JSONError.syntax("control character in string") }
                    raw.append(c)
                }
            }
        }

        mutating func number() throws -> Double {
            let start = pos
            if pos < bytes.count, bytes[pos] == UInt8(ascii: "-") { pos += 1 }
            func digits() -> Int {
                let s = pos
                while pos < bytes.count, (0x30...0x39).contains(bytes[pos]) { pos += 1 }
                return pos - s
            }
            let intStart = pos
            guard digits() > 0 else { throw JSONError.syntax("bad number") }
            if pos - intStart > 1, bytes[intStart] == 0x30 { throw JSONError.syntax("leading zero") }
            if pos < bytes.count, bytes[pos] == UInt8(ascii: ".") {
                pos += 1
                guard digits() > 0 else { throw JSONError.syntax("bad fraction") }
            }
            if pos < bytes.count, bytes[pos] == UInt8(ascii: "e") || bytes[pos] == UInt8(ascii: "E") {
                pos += 1
                if pos < bytes.count, bytes[pos] == UInt8(ascii: "+") || bytes[pos] == UInt8(ascii: "-") { pos += 1 }
                guard digits() > 0 else { throw JSONError.syntax("bad exponent") }
            }
            guard let text = String(bytes: bytes[start..<pos], encoding: .ascii), let d = Double(text), d.isFinite else {
                throw JSONError.syntax("bad number")
            }
            return d
        }
    }
}
