import XCTest

/// Guards the one failure mode the string catalog cannot report on its own: a
/// key that the UI asks for and the catalog does not have. `String(localized:)`
/// and `LocalizedStringKey` both fall back to the key itself, so a missing entry
/// is invisible in English and ships Chinese users an English string.
///
/// Xcode only extracts literals it recognises inside SwiftUI's own initialisers.
/// A literal handed to one of the app's own helpers — which is what finally
/// builds the `Text` — or assigned to `errorMessage` as a plain Swift string is
/// never extracted, so these tests re-derive the surface strings from the
/// sources rather than listing them by hand.
final class LocalizationCoverageTests: XCTestCase {
    // MARK: - Catalog

    private struct Catalog {
        var keys: Set<String> = []
        /// Keys that carry a zh-Hans unit in the translated state.
        var translated: Set<String> = []
    }

    private static let catalog: Catalog = {
        // Read the source catalog, not the bundle: the built app carries
        // compiled .lproj tables, so a bundle lookup can only ever miss.
        guard let url = sourceCatalogURL(),
              let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let strings = root["strings"] as? [String: Any]
        else { return Catalog() }
        var loaded = Catalog()
        for (key, value) in strings {
            loaded.keys.insert(key)
            guard let entry = value as? [String: Any],
                  let localizations = entry["localizations"] as? [String: Any],
                  let chinese = localizations["zh-Hans"] as? [String: Any],
                  let unit = chinese["stringUnit"] as? [String: Any],
                  let state = unit["state"] as? String,
                  let text = unit["value"] as? String,
                  state == "translated", !text.isEmpty
            else { continue }
            loaded.translated.insert(key)
        }
        return loaded
    }()

    /// The test bundle does not carry the catalog source, so fall back to the
    /// checked-in file relative to this file's location.
    private static func sourceCatalogURL() -> URL? {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        for _ in 0..<4 {
            let candidate = dir
                .appendingPathComponent("Tono")
                .appendingPathComponent("Localizable.xcstrings")
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            dir = dir.deletingLastPathComponent()
        }
        return nil
    }

    // MARK: - Source scan

    /// One string literal as written in the source, with every interpolation
    /// collapsed to `\()` so the literal's shape survives without the
    /// expression inside it.
    private struct SourceLiteral {
        let text: String
        /// Offset of the opening quote in the file's character array.
        let start: Int
    }

    private struct ScannedSource {
        /// The file with every literal body, comment and raw string blanked
        /// out, so a search for call syntax can never match inside a string.
        let masked: [Character]
        let literals: [SourceLiteral]
    }

    private struct SurfaceStrings {
        /// Literals assigned straight to `errorMessage`, which the banner
        /// renders without ever asking the catalog.
        var bareErrorAssignments: [String] = []
        /// Literals that must appear in the catalog verbatim.
        var plain: [String] = []
        /// Literals carrying interpolations, kept in their `\()` form.
        var interpolated: [String] = []
    }

    private static let maskCharacter: Character = "\u{1}"

    private static let surfaces: SurfaceStrings = {
        guard let root = sourceCatalogURL()?.deletingLastPathComponent() else {
            return SurfaceStrings()
        }
        var found = SurfaceStrings()
        var paths: [String] = []
        if let enumerator = FileManager.default.enumerator(atPath: root.path) {
            for case let path as String in enumerator {
                paths.append(path)
            }
        }
        for path in paths where path.hasSuffix(".swift") {
            let url = root.appendingPathComponent(path)
            guard let source = try? String(contentsOf: url, encoding: .utf8) else { continue }
            let strings = surfaceStrings(in: source)
            found.bareErrorAssignments.append(contentsOf: strings.bareErrorAssignments)
            found.plain.append(contentsOf: strings.plain)
            found.interpolated.append(contentsOf: strings.interpolated)
        }
        return found
    }()

    /// Every literal that reaches a person's screen through a path Xcode's
    /// extractor cannot see, plus the localized calls, collected from one file.
    private static func surfaceStrings(in source: String) -> SurfaceStrings {
        // The app's own helpers take the label and build the `Text`
        // themselves, so the literal at the call site is never extracted.
        let helperNames = [
            "actionButton", "SettingRow", "SupportRow", "SupportCard", "formField",
            "ActivityCard", "DashboardStatCard", "infoItem",
        ]
        let argumentLabels = ["title:", "label:", "subtitle:"]

        let scanned = scan(source)
        var found = SurfaceStrings()

        let assignment = Array("errorMessage")
        for index in indexes(of: assignment, in: scanned.masked) {
            var cursor = skipWhitespace(scanned.masked, index + assignment.count)
            guard cursor < scanned.masked.count, scanned.masked[cursor] == "=" else { continue }
            if cursor + 1 < scanned.masked.count, scanned.masked[cursor + 1] == "=" { continue }
            cursor = skipWhitespace(scanned.masked, cursor + 1)
            guard let assigned = literalStarting(at: cursor, in: scanned.literals) else { continue }
            found.bareErrorAssignments.append(assigned.text)
        }

        let call = Array("String(")
        let label = Array("localized:")
        for index in indexes(of: call, in: scanned.masked) {
            let labelStart = skipWhitespace(scanned.masked, index + call.count)
            guard matches(scanned.masked, labelStart, label) else { continue }
            let cursor = skipWhitespace(scanned.masked, labelStart + label.count)
            guard let value = literalStarting(at: cursor, in: scanned.literals) else { continue }
            record(value.text, in: &found)
        }

        for name in helperNames {
            let helper = Array(name)
            for index in indexes(of: helper, in: scanned.masked) {
                guard isWordStart(scanned.masked, index) else { continue }
                let open = skipWhitespace(scanned.masked, index + helper.count)
                guard open < scanned.masked.count, scanned.masked[open] == "(" else { continue }
                guard let close = closingParenthesis(scanned.masked, open) else { continue }
                for argument in argumentLabels {
                    let argumentLabel = Array(argument)
                    var position = open
                    while position < close {
                        guard matches(scanned.masked, position, argumentLabel),
                              isWordStart(scanned.masked, position)
                        else {
                            position += 1
                            continue
                        }
                        // A ternary puts two literals in one argument, so take
                        // the whole value up to the next labelled argument.
                        let valueStart = position + argumentLabel.count
                        let valueEnd = nextArgumentLabel(
                            scanned.masked,
                            from: valueStart,
                            before: close
                        )
                        for literal in scanned.literals
                        where literal.start >= valueStart && literal.start < valueEnd {
                            // An interpolation here composes an already
                            // localized value; only the plain ones are keys.
                            if !literal.text.contains("\\()") {
                                record(literal.text, in: &found)
                            }
                        }
                        position = valueStart
                    }
                }
            }
        }
        return found
    }

    private static func record(_ text: String, in found: inout SurfaceStrings) {
        if text.contains("\\()") {
            found.interpolated.append(text)
            return
        }
        let value = unescaped(text)
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        found.plain.append(value)
    }

    /// Splits a file into its string literals and a masked copy of itself.
    private static func scan(_ source: String) -> ScannedSource {
        let chars = Array(source)
        var masked = chars
        var literals: [SourceLiteral] = []
        let lineComment = Array("//")
        let blockOpen = Array("/*")
        let blockClose = Array("*/")
        let tripleQuote = Array("\"\"\"")
        var i = 0
        while i < chars.count {
            if matches(chars, i, lineComment) {
                while i < chars.count, chars[i] != "\n" {
                    masked[i] = " "
                    i += 1
                }
                continue
            }
            if matches(chars, i, blockOpen) {
                var depth = 0
                while i < chars.count {
                    if matches(chars, i, blockOpen) {
                        depth += 1
                        masked[i] = " "
                        masked[i + 1] = " "
                        i += 2
                        continue
                    }
                    if matches(chars, i, blockClose) {
                        depth -= 1
                        masked[i] = " "
                        masked[i + 1] = " "
                        i += 2
                        if depth == 0 { break }
                        continue
                    }
                    masked[i] = " "
                    i += 1
                }
                continue
            }
            if chars[i] == "#" {
                var j = i
                while j < chars.count, chars[j] == "#" { j += 1 }
                let hashes = j - i
                if j < chars.count, chars[j] == "\"" {
                    var closing: [Character] = []
                    if matches(chars, j, tripleQuote) {
                        closing = tripleQuote
                        j += 3
                    } else {
                        closing = ["\""]
                        j += 1
                    }
                    var appended = 0
                    while appended < hashes {
                        closing.append("#")
                        appended += 1
                    }
                    while j < chars.count, !matches(chars, j, closing) {
                        masked[j] = maskCharacter
                        j += 1
                    }
                    i = j + closing.count
                    continue
                }
            }
            if matches(chars, i, tripleQuote) {
                var j = i + tripleQuote.count
                while j < chars.count, !matches(chars, j, tripleQuote) {
                    masked[j] = maskCharacter
                    j += 1
                }
                i = j + tripleQuote.count
                continue
            }
            if chars[i] == "\"" {
                let start = i
                var body = ""
                var j = i + 1
                while j < chars.count {
                    let character = chars[j]
                    if character == "\n" || character == "\"" { break }
                    if character == "\\", j + 1 < chars.count, chars[j + 1] == "(" {
                        body += "\\()"
                        masked[j] = maskCharacter
                        masked[j + 1] = maskCharacter
                        var depth = 1
                        var k = j + 2
                        while k < chars.count, depth > 0 {
                            if chars[k] == "\"" {
                                masked[k] = maskCharacter
                                k += 1
                                while k < chars.count, chars[k] != "\"" {
                                    masked[k] = maskCharacter
                                    if chars[k] == "\\" {
                                        k += 1
                                        if k < chars.count { masked[k] = maskCharacter }
                                    }
                                    k += 1
                                }
                                if k < chars.count { masked[k] = maskCharacter }
                                k += 1
                                continue
                            }
                            if chars[k] == "(" { depth += 1 }
                            if chars[k] == ")" { depth -= 1 }
                            masked[k] = maskCharacter
                            k += 1
                        }
                        j = k
                        continue
                    }
                    if character == "\\", j + 1 < chars.count {
                        body.append(character)
                        body.append(chars[j + 1])
                        masked[j] = maskCharacter
                        masked[j + 1] = maskCharacter
                        j += 2
                        continue
                    }
                    body.append(character)
                    masked[j] = maskCharacter
                    j += 1
                }
                literals.append(SourceLiteral(text: body, start: start))
                i = j + 1
                continue
            }
            i += 1
        }
        return ScannedSource(masked: masked, literals: literals)
    }

    // MARK: - Scan helpers

    private static func matches(_ chars: [Character], _ index: Int, _ needle: [Character]) -> Bool {
        guard index >= 0, index + needle.count <= chars.count else { return false }
        var offset = 0
        while offset < needle.count {
            if chars[index + offset] != needle[offset] { return false }
            offset += 1
        }
        return true
    }

    private static func indexes(of needle: [Character], in chars: [Character]) -> [Int] {
        guard !needle.isEmpty, chars.count >= needle.count else { return [] }
        var found: [Int] = []
        var index = 0
        while index <= chars.count - needle.count {
            if matches(chars, index, needle) { found.append(index) }
            index += 1
        }
        return found
    }

    private static func skipWhitespace(_ chars: [Character], _ index: Int) -> Int {
        var cursor = index
        while cursor < chars.count, chars[cursor].isWhitespace { cursor += 1 }
        return cursor
    }

    /// False when the match is only the tail of a longer identifier or a member
    /// access, so `formField` does not match inside `hiddenFormField`.
    private static func isWordStart(_ chars: [Character], _ index: Int) -> Bool {
        guard index > 0 else { return true }
        let previous = chars[index - 1]
        return !(previous.isLetter || previous.isNumber || previous == "_" || previous == ".")
    }

    private static func literalStarting(
        at index: Int,
        in literals: [SourceLiteral]
    ) -> SourceLiteral? {
        for literal in literals where literal.start == index { return literal }
        return nil
    }

    private static func closingParenthesis(_ chars: [Character], _ open: Int) -> Int? {
        var depth = 0
        var index = open
        while index < chars.count {
            if chars[index] == "(" { depth += 1 }
            if chars[index] == ")" {
                depth -= 1
                if depth == 0 { return index }
            }
            index += 1
        }
        return nil
    }

    /// Where one labelled argument's value ends: at the next `label:` of the
    /// same call, or at the closing parenthesis.
    private static func nextArgumentLabel(_ chars: [Character], from: Int, before end: Int) -> Int {
        var index = from
        while index < end {
            if chars[index] == ":", index + 1 < chars.count, chars[index + 1].isWhitespace {
                var start = index - 1
                while start >= 0,
                      chars[start].isLetter || chars[start].isNumber || chars[start] == "_" {
                    start -= 1
                }
                if start < index - 1 { return start + 1 }
            }
            index += 1
        }
        return end
    }

    private static func unescaped(_ text: String) -> String {
        var result = ""
        var escaped = false
        for character in text {
            if escaped {
                switch character {
                case "n": result.append("\n")
                case "t": result.append("\t")
                case "r": result.append("\r")
                default: result.append(character)
                }
                escaped = false
                continue
            }
            if character == "\\" {
                escaped = true
                continue
            }
            result.append(character)
        }
        return result
    }

    private static func interpolationSegments(_ literal: String) -> [String] {
        return literal.components(separatedBy: "\\()").map { unescaped($0) }
    }

    /// True when `key` is `segments` joined by printf placeholders — the shape
    /// the compiler builds a key from when the string interpolates.
    private static func catalogKey(_ key: String, fits segments: [String]) -> Bool {
        let chars = Array(key)
        var cursor = 0
        var index = 0
        while index < segments.count {
            if index > 0 {
                guard let next = placeholderEnd(chars, cursor) else { return false }
                cursor = next
            }
            let segment = Array(segments[index])
            guard matches(chars, cursor, segment) else { return false }
            cursor += segment.count
            index += 1
        }
        return cursor == chars.count
    }

    private static func placeholderEnd(_ chars: [Character], _ start: Int) -> Int? {
        guard start < chars.count, chars[start] == "%" else { return nil }
        var index = start + 1
        while index < chars.count, chars[index].isNumber { index += 1 }
        if index < chars.count, chars[index] == "$", index > start + 1 { index += 1 }
        for conversion in ["lld", "lf", "ld", "@", "d", "f"] {
            let expected = Array(conversion)
            if matches(chars, index, expected) { return index + expected.count }
        }
        return nil
    }

    // MARK: - Tests

    func testTheCatalogWasFound() {
        XCTAssertFalse(Self.catalog.keys.isEmpty, "could not read Localizable.xcstrings")
    }

    func testTheScanReadTheAppSources() {
        // A scan that finds nothing — a moved source root, an unreadable file —
        // would let every check below pass on an empty set.
        XCTAssertGreaterThan(
            Self.surfaces.plain.count,
            100,
            "the source scan found almost no localized strings; check the source path"
        )
    }

    func testNoUserFacingErrorIsAssignedAsAPlainLiteral() {
        // `errorMessage` is a `String`. A literal assigned to it is neither
        // extracted into the catalog nor looked up when the banner renders it.
        let bare = Set(Self.surfaces.bareErrorAssignments).sorted()
        XCTAssertTrue(
            bare.isEmpty,
            "assigned to errorMessage without String(localized:): \(bare)"
        )
    }

    func testEverySurfaceStringHasATranslatedChineseUnit() {
        let missing = Set(Self.surfaces.plain)
            .filter { !Self.catalog.translated.contains($0) }
            .sorted()
        XCTAssertTrue(
            missing.isEmpty,
            "not in Localizable.xcstrings with a translated zh-Hans unit: \(missing)"
        )
    }

    func testEveryInterpolatedSurfaceStringHasACatalogKey() {
        // An interpolated string's key is built from the literal parts and a
        // placeholder for each value, so the lookup misses unless the catalog
        // carries that exact shape.
        var missing: [String] = []
        for literal in Set(Self.surfaces.interpolated) {
            let segments = Self.interpolationSegments(literal)
            let covered = Self.catalog.translated.contains {
                Self.catalogKey($0, fits: segments)
            }
            if !covered { missing.append(literal) }
        }
        XCTAssertTrue(
            missing.isEmpty,
            "no translated catalog key matches this interpolation: \(missing.sorted())"
        )
    }

    /// Asserting a key exists is not enough: an interpolated string's key is
    /// built from the *types* of what is interpolated, so `\(anInt)` produces
    /// `%lld` and a catalog entry written as `%@` never matches. The lookup
    /// then falls back to the key — English — and only a Chinese build shows
    /// it. That is exactly how "17 个云端节点 · v40 · updates automatically"
    /// shipped after the string had supposedly been localized.
    func testInterpolatedKeysUseThePlaceholderTheTypesActuallyProduce() throws {
        // Force the Chinese table so the result does not depend on the locale
        // this test happens to run in.
        let path = try XCTUnwrap(
            Bundle.main.path(forResource: "zh-Hans", ofType: "lproj"),
            "the app bundle carries no zh-Hans table"
        )
        let zh = try XCTUnwrap(Bundle(path: path))

        let count = String.localizedStringWithFormat(
            String(localized: "%lld cloud servers", bundle: zh),
            Int64(17)
        )
        let revision = 40

        let synced = String(
            localized: "\(count) · v\(revision) · updates automatically",
            bundle: zh
        )
        XCTAssertTrue(
            synced.contains("自动更新"),
            "catalog miss — this interpolation's key is not in the catalog: \(synced)"
        )

        let waiting = String(
            localized: "\(count) · waiting for the first verified sync",
            bundle: zh
        )
        XCTAssertFalse(
            waiting.contains("waiting for the first verified sync"),
            "catalog miss — this interpolation's key is not in the catalog: \(waiting)"
        )
    }
}
