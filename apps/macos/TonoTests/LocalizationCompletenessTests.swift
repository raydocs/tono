import Foundation
import XCTest

final class LocalizationCompletenessTests: XCTestCase {
    private struct StringCatalog: Decodable {
        let sourceLanguage: String
        let version: String?
        let strings: [String: Entry]

        struct Entry: Decodable {
            let shouldTranslate: Bool?
            let localizations: [String: Localization]?
        }

        struct Localization: Decodable {
            let stringUnit: StringUnit?
        }

        struct StringUnit: Decodable {
            let state: String?
            let value: String?
        }
    }

    func testLocalizableCatalogParsesAndHasNoEmptySimplifiedChineseEntries() throws {
        let catalog = try loadCatalog()
        XCTAssertEqual(catalog.sourceLanguage, "en")
        XCTAssertFalse(catalog.strings.isEmpty)

        var missing: [String] = []
        for (key, entry) in catalog.strings where entry.shouldTranslate != false {
            let value = entry.localizations?["zh-Hans"]?.stringUnit?.value?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if value == nil || value?.isEmpty == true {
                missing.append(key)
            }
        }

        XCTAssertTrue(
            missing.isEmpty,
            "Translatable keys missing zh-Hans stringUnit.value: \(missing.sorted().joined(separator: ", "))"
        )
    }

    func testCriticalUIUpdaterStrictAndSupportKeysHaveChineseTranslations() throws {
        let catalog = try loadCatalog()
        let requiredKeys = [
            // Login & Account Gate
            "Verify email code",
            "Sign in with Google",
            "Send a new code",
            "Continue",
            "Your %lld-device allowance is full. Sign in and revoke another device if needed.",
            // Dashboard & Protection
            "Connect",
            "Disconnect",
            "Restore internet",
            "Restore normal internet",
            "View data usage summary",
            "Direct internet is available. Support code TONO_CONNECT_RELEASED.",
            "Reading traffic…",
            "Ready to connect",
            // Updater (UpdatePanelView & AppUpdater)
            "Update %@",
            "Update available",
            "Downloading %@",
            "Downloading update…",
            "Verifying & preparing…",
            "Installing & restarting…",
            "Checking for updates…",
            "Tono is up to date",
            "Update needs attention",
            "Update & Restart",
            "Retry Download",
            "View Update",
            "Signed update verified by Tono Helper. Your network protection stays active until restart.",
            "Current version %@",
            "Download",
            "Verify",
            "Restart",
            "Release notes",
            "Hide details",
            "Show details",
            "Disconnect and Retry",
            "Keep Protection",
            "Check for Updates",
            "Later",
            "Cancel",
            "Updates",
            "Close",
            "Refresh",
            // Strict Mode & Menu Bar
            "Disconnect before switching servers in Strict mode.",
            "Disconnect before switching cloud servers in Strict mode.",
            "Click Restore internet before switching cloud servers in Strict mode.",
            "Strict mode is still blocking traffic. Click Restore internet to resume normal internet access.",
            "Strict mode locked the previous network route (for example, your network interface or server changed). Click Restore internet before reconnecting.",
            "The cloud server you were switching to was removed from the catalog. Keeping your current connection.",
            "The selected cloud server was removed. Strict mode is still blocking traffic. Click Restore internet before choosing another cloud server.",
            "Switch to %@",
            "Connect using %@",
            // Settings, Logs, Activity, Proxies, Rules, Commands, Support
            "All",
            "Auto-scroll",
            "Automatically scroll to newest logs",
            "Copy line",
            "Copy message",
            "Filter this level",
            "Show all levels",
            "Filter connections",
            "Close connection",
            "Copy destination",
            "Copy domain",
            "Copy server name",
            "Select server",
            "Switch to server",
            "Settings…",
            "Support",
            "Connection",
            "Cancel connection",
            "Test current exit",
            "Refresh servers",
            "Show the runtime logs tab in the sidebar.",
            "Learn more about %@",
            "Value is required",
            "VLESS + TLS",
            "VLESS UUID",
            "Check this Mac",
            "Copy for support",
            "Upload diagnostics",
            "Connection snapshot: %@",
        ]

        var missing: [String] = []
        for key in requiredKeys {
            let value = catalog.strings[key]?.localizations?["zh-Hans"]?.stringUnit?.value?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if value == nil || value?.isEmpty == true {
                missing.append(key)
            }
        }

        XCTAssertTrue(
            missing.isEmpty,
            "Required keys missing zh-Hans translations: \(missing.joined(separator: ", "))"
        )
    }

    private func loadCatalog() throws -> StringCatalog {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Tono/Localizable.xcstrings")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(StringCatalog.self, from: data)
    }
}
