import XCTest

/// Guards the one failure mode the string catalog cannot report on its own: a
/// key that the UI asks for and the catalog does not have. `String(localized:)`
/// and `LocalizedStringKey` both fall back to the key itself, so a missing entry
/// is invisible in English and ships Chinese users an English string.
final class LocalizationCoverageTests: XCTestCase {
    private static let catalogKeys: Set<String> = {
        // Read the source catalog, not the bundle: the built app carries
        // compiled .lproj tables, so a bundle lookup can only ever miss.
        guard let url = sourceCatalogURL(),
              let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let strings = root["strings"] as? [String: Any]
        else { return [] }
        return Set(strings.keys)
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

    func testTheCatalogWasFound() {
        XCTAssertFalse(Self.catalogKeys.isEmpty, "could not read Localizable.xcstrings")
    }

    func testEverySurfaceStringTheseTestsKnowAboutIsTranslated() {
        // Strings that shipped untranslated at some point. Each one rendered in
        // English on a Chinese build until it was added.
        let required = [
            "Direct traffic is blocked. Restore internet from here if you need the network.",
            "Choose another route",
            "Open Tono",
            "Quit Tono",
            "No server selected",
            "No exit selected",
            "Current exit",
            "Not tested",
            "Test current exit",
            "Recovering protected connection…",
            "New server failed verification. Switched back to the previous one.",
            "Copy version for support",
            "WebRTC leak check",
            "Open WebRTC check",
            "Sign in with Apple is not configured.",
            "Google sign-in is not configured.",
            "of %lld",
            "%@ · v%lld · updates automatically",
            "%@ · waiting for the first verified sync",
        ]
        let missing = required.filter { !Self.catalogKeys.contains($0) }
        XCTAssertTrue(missing.isEmpty, "not in Localizable.xcstrings: \(missing)")
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
