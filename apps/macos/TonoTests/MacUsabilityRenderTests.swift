import AppKit
import ImageIO
import ScreenCaptureKit
import SwiftUI
import Vision
import XCTest
@testable import Tono

private struct NativeRenderPixel {
    let red: CGFloat
    let green: CGFloat
    let blue: CGFloat
    let alpha: CGFloat

    var isValid: Bool {
        [red, green, blue, alpha].allSatisfy { $0.isFinite && (0...1).contains($0) }
    }
}

private enum NativeRenderOpacityPolicy: Equatable {
    case opaque, isolatedSubpixelEdges

    /// Independent-window captures can preserve isolated raster-edge alpha.
    /// Bound the maximum possible matte contribution to five 8-bit levels, not
    /// a blanket alpha threshold: border pixels, neighboring gaps and color
    /// discontinuities are rejected. No captured pixel is modified.
    static func acceptsIsolatedEdge(
        x: Int, y: Int, width: Int, height: Int,
        pixel: (Int, Int) -> NativeRenderPixel?
    ) -> Bool {
        guard x > 0, y > 0, x < width - 1, y < height - 1,
              let center = pixel(x, y), center.isValid,
              center.alpha < 1, center.alpha >= CGFloat(250) / 255 else { return false }
        var sameFill = false
        for ny in (y - 1)...(y + 1) {
            for nx in (x - 1)...(x + 1) where nx != x || ny != y {
                guard let neighbor = pixel(nx, ny), neighbor.isValid, neighbor.alpha == 1 else { return false }
                if abs(neighbor.red - center.red) <= CGFloat(2) / 255,
                   abs(neighbor.green - center.green) <= CGFloat(2) / 255,
                   abs(neighbor.blue - center.blue) <= CGFloat(2) / 255 {
                    sameFill = true
                }
            }
        }
        return sameFill
    }
}

private final class NativeWindowRequestCompletion<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?

    init(_ continuation: CheckedContinuation<Value, Error>) {
        self.continuation = continuation
    }

    @discardableResult
    func complete(_ result: Result<Value, Error>) -> Bool {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        guard let pending else { return false }
        pending.resume(with: result)
        return true
    }
}

@MainActor
private func nativeWindowRequest<Value>(
    _ name: String, timeout: TimeInterval,
    start: (@escaping (Result<Value, Error>) -> Void) -> Void
) async throws -> Value {
    try await withCheckedThrowingContinuation { continuation in
        let completion = NativeWindowRequestCompletion(continuation)
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout) {
            completion.complete(.failure(NSError(domain: "TonoNativeWindowDiagnostic.Timeout", code: 3,
                userInfo: [NSLocalizedDescriptionKey: "\(name) callback did not arrive within \(timeout) seconds"])))
        }
        start { result in _ = completion.complete(result) }
    }
}

/// Native AppKit/SwiftUI captures on the existing hosted macOS test host.
/// Synthetic state only: no sign-in, helper calls, browser scans or uploads.
@MainActor
final class MacUsabilityRenderTests: XCTestCase {
    func testIsolatedRasterEdgesCannotHideMissingNativeContent() {
        let opaque = NativeRenderPixel(red: 0.8, green: 0.4, blue: 0.2, alpha: 1)
        let edge = NativeRenderPixel(red: 0.8, green: 0.4, blue: 0.2, alpha: CGFloat(253) / 255)
        func accepts(_ center: NativeRenderPixel, x: Int = 2, y: Int = 2,
                     neighbor: NativeRenderPixel? = nil, absentNeighbor: Bool = false) -> Bool {
            NativeRenderOpacityPolicy.acceptsIsolatedEdge(x: x, y: y, width: 5, height: 5) { px, py in
                if px == x && py == y { return center }
                if px == x + 1 && py == y { return absentNeighbor ? nil : neighbor ?? opaque }
                return opaque
            }
        }
        XCTAssertTrue(accepts(edge))
        XCTAssertFalse(accepts(NativeRenderPixel(red: 0.8, green: 0.4, blue: 0.2, alpha: 0)))
        XCTAssertFalse(accepts(NativeRenderPixel(red: 0.8, green: 0.4, blue: 0.2, alpha: CGFloat(240) / 255)))
        XCTAssertFalse(accepts(edge, neighbor: edge), "connected fractional gaps must fail")
        XCTAssertFalse(accepts(edge, absentNeighbor: true))
        XCTAssertFalse(accepts(edge, x: 0), "image borders must be opaque")
        XCTAssertFalse(accepts(NativeRenderPixel(red: 0.1, green: 0.8, blue: 0.9, alpha: CGFloat(253) / 255)),
                       "a fractional pixel needs an opaque same-fill neighbor")
        XCTAssertFalse(accepts(NativeRenderPixel(red: .nan, green: 0.4, blue: 0.2, alpha: CGFloat(253) / 255)))
    }

    func testNativeWindowRequestTimeoutIgnoresLateCallback() async throws {
        var lateCallback: ((Result<Int, Error>) -> Void)?
        do {
            _ = try await nativeWindowRequest("synthetic callback", timeout: 0.01) { callback in
                lateCallback = callback
            }
            XCTFail("missing callback must time out")
        } catch {
            let failure = error as NSError
            XCTAssertEqual(failure.domain, "TonoNativeWindowDiagnostic.Timeout")
            XCTAssertEqual(failure.code, 3)
            XCTAssertTrue(failure.localizedDescription.contains("synthetic callback"))
        }
        let callback = try XCTUnwrap(lateCallback)
        callback(.success(42)) // Must not resume the already timed-out continuation.
        callback(.failure(NSError(domain: "late", code: 1)))
    }

    func testNativeUsabilityStatesProduceReviewableAttachments() async throws {
        try await capture("sea-night", width: 600, height: 400) {
            SeaScene(phase: .night, motionEnabled: false).frame(width: 600, height: 375)
                .environment(\.seaDecorationsOverride, true)
        }
        try await capture("sea-confirmed", width: 600, height: 400) {
            SeaScene(phase: .day, motionEnabled: false).frame(width: 600, height: 375)
                .environment(\.seaDecorationsOverride, true)
        }
        try await capture("sea-blocked", width: 600, height: 400) {
            SeaScene(phase: .blocked, motionEnabled: false).frame(width: 600, height: 375)
                .environment(\.seaDecorationsOverride, true)
        }
        try await capture("sea-night-reduced", width: 600, height: 400) {
            SeaScene(phase: .night, motionEnabled: false).frame(width: 600, height: 375)
                .environment(\.seaDecorationsOverride, false)
        }
        try await capture("sea-confirmed-reduced", width: 600, height: 400) {
            SeaScene(phase: .day, motionEnabled: false).frame(width: 600, height: 375)
                .environment(\.seaDecorationsOverride, false)
        }
        try await capture("sea-blocked-reduced", width: 600, height: 400) {
            SeaScene(phase: .blocked, motionEnabled: false).frame(width: 600, height: 375)
                .environment(\.seaDecorationsOverride, false)
        }
        let suite = "tono-render-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); ManagedExitCatalogOwnership.purge() }
        let app = AppState()
        app.routePreferences = LocalRoutePreferences(defaults: defaults)
        let account = AccountSession(sidecar: TonoSidecarService(), descriptorConsumer: { _ in }, killSwitchDisarmConsumer: {})
        account.user = try JSONDecoder().decode(TonoUser.self, from: Data(#"{"id":"synthetic-native-review","email":"fixture@example.test"}"#.utf8))
        account.state = .ready
        let owner = try XCTUnwrap(account.user?.id)
        ManagedExitCatalogOwnership.adopt(owner)
        let node = Fixture.realityNode()
        let other = Fixture.realityNode(name: "Tokyo · Dawn", id: "tokyo", flag: "🇯🇵")
        app.proxyRegions = [.init(id: AppState.managedCatalogRegionID, name: "Tono", nodes: [node, other])]
        app.managedCatalogRevision = 73
        app.managedCatalogDigest = String(repeating: "a", count: 64)
        app.selectedNodeId = node.id
        app.activeNode = node
        app.proxyService.activeNodeName = node.name
        let appearanceBefore = AppProfile.defaults.object(forKey: SeaAppearance.enabledKey) as? Bool
        try await captureDashboard("dashboard-sea-night-normal", app: app, account: account,
                             sea: true, width: 920, height: 600)
        try await captureDashboard("dashboard-sea-night-minimum", app: app, account: account,
                             sea: true, width: 660, height: 540)
        try await captureDashboard("dashboard-off-normal", app: app, account: account,
                             sea: false, width: 920, height: 600)
        app.isConnected = true
        try await captureDashboard("dashboard-sea-confirmed-normal", app: app, account: account,
                             sea: true, width: 920, height: 600)
        try await captureDashboard("dashboard-sea-confirmed-decorated-normal", app: app, account: account,
                             sea: true, width: 920, height: 600, decorations: true)
        app.isConnected = false
        app.isProtectionBlocked = true
        try await captureDashboard("dashboard-sea-blocked-minimum", app: app, account: account,
                             sea: true, width: 660, height: 540)
        app.recoveryCause = .wake
        app.protectedReconnectPausedForUserAction = true
        let pausedFeedback = try XCTUnwrap(app.recoveryFeedback)
        try await captureDashboard("dashboard-sea-blocked-paused-recovery-minimum", app: app, account: account,
                                   sea: true, width: 660, height: 540, recoveryFeedback: pausedFeedback)
        app.recoveryCause = nil
        app.protectedReconnectPausedForUserAction = false
        try await capture("settings-sea-normal", width: 920, height: 600, annotate: false, darkAppearance: true) {
            ZStack {
                MeshGradientBackground()
                SettingsView()
            }
            .modifier(SeaPageAppearance())
            .environment(\.seaAppearanceOverride, true)
            .environment(app)
            .environment(account)
            .environmentObject(AppUpdater(enabled: false))
        }
        XCTAssertEqual(AppProfile.defaults.object(forKey: SeaAppearance.enabledKey) as? Bool,
                       appearanceBefore, "render fixtures must not change device appearance")
        let observation = await app.collectLocalHealth(account: account, probe: { .init(helperInstalled: true, helperRejectsApp: true) })
        let check = try XCTUnwrap(observation)
        try await capture("health-unknown-helper", width: 660, height: 780) {
            SupportCard(icon: "stethoscope", title: String(localized: "Local health check")) {
                LocalHealthResults(check: check)
            }.padding(20)
        }
        try await capture("build-unverified", width: 700, height: 480) {
            BuildIdentityDetails(check: check).padding(24)
        }
        account.previewSupportReport(check)
        let draft = try XCTUnwrap(account.supportReportDraft)
        try await capture("report-preview", width: 660, height: 540) {
            SupportReportConfirmationView(draft: draft, receipt: nil, sending: false, error: nil, canSend: true, confirm: {}, close: {})
        }
        let receipt = SupportReportReceipt(draftID: draft.id, server: .init(referenceCode: "SYNTHETIC-NOT-A-SERVER-RECEIPT", receivedAt: 1_790_000_000), localIdentity: check.localIdentity)
        try await capture("report-receipt", width: 660, height: 600) {
            SupportReportConfirmationView(draft: draft, receipt: receipt, sending: false, error: nil, canSend: true, confirm: {}, close: {})
        }
        try await capture("report-no-receipt", width: 660, height: 610) {
            SupportReportConfirmationView(draft: draft, receipt: nil, sending: false,
                error: String(localized: "No support receipt was received. The server may have stored the report. Try again only if you want to send this same preview again."),
                canSend: true, confirm: {}, close: {})
        }
        app.isProtectionBlocked = false
        app.toggleRouteFavorite(node.name, owner: owner)
        app.isConnected = true
        app.recordVerifiedRouteSuccess(node.name, owner: owner, generation: app.connectionCoordinator.protectionOperationGeneration,
                                       catalogDigest: app.managedCatalogDigest)
        app.isConnected = false
        app.setPreferredRouteRegion("US", owner: owner)
        // AppKit cacheDisplay omits compositor-backed Liquid Glass content:
        // the full Nodes page captured partially and Dashboard was alpha=0.
        // Render the exact production components, not substitute page mocks.
        try await capture("nodes-route-choices-favorite-component", width: 600, height: 340) {
            RouteChoicesView().environment(app).environment(account).padding(24)
        }
        app.setPreferredRouteRegion("JP", owner: owner)
        app.proxyRegions[0].nodes = [node]
        try await capture("nodes-region-unavailable-component", width: 600, height: 300) {
            RouteChoicesView().environment(app).environment(account).padding(24)
        }
        app.proxyRegions[0].nodes = [node, other]
        app.setPreferredRouteRegion(nil, owner: owner)
        app.isProtectionBlocked = true
        app.recoveryCause = .wake
        app.protectedReconnectPausedForUserAction = true
        try await capture("dashboard-wake-notice-component", width: 560, height: 220) {
            RecoveryNotice(appState: app).padding(24)
        }
        try await capture("menubar-wake-paused", width: 300, height: 480) {
            MenuBarView().environment(app).environment(account)
        }
        app.protectedReconnectPausedForUserAction = false
        app.isProtectedReconnectScheduled = true
        app.recoveryCause = .networkChange
        try await capture("network-recovery-running", width: 560, height: 220) {
            RecoveryNotice(appState: app).padding(24)
        }
        let cloud = APIConnection(id: "synthetic-cloud", metadata: .init(network: "tcp", type: "HTTPS", process: "Example App", processPath: nil, sourceIP: nil, destinationIP: nil, sourcePort: nil, destinationPort: "443", host: "cloud.example.test"), upload: 10, download: 30, start: "0", chains: [node.name, "Tono-Exit"], rule: "DOMAIN-SUFFIX", rulePayload: "example.test")
        let unknown = APIConnection(id: "synthetic-unknown", metadata: .init(network: "tcp", type: "HTTPS", process: "Example App", processPath: nil, sourceIP: nil, destinationIP: nil, sourcePort: nil, destinationPort: nil, host: "unknown.example.test"), upload: 0, download: 0, start: "0", chains: ["Tono-Exit"], rule: "MATCH", rulePayload: nil)
        app.updateConnections(from: .init(downloadTotal: 30, uploadTotal: 10, connections: [cloud, unknown]))
        try await capture("activity-cloud-and-unknown", width: 540, height: 500) {
            ActivityRoutingDetails(entries: app.connections)
        }
        XCTAssertNil(app.connectionCoordinator.connectTask)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertNil(account.uploadingSupportReportID)
    }

    func testSeaSecondaryPagesProduceReviewableAttachments() async throws {
        let suite = "tono-sea-pages-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); ManagedExitCatalogOwnership.purge() }
        let app = AppState()
        app.routePreferences = LocalRoutePreferences(defaults: defaults)
        let account = AccountSession(sidecar: TonoSidecarService(), descriptorConsumer: { _ in }, killSwitchDisarmConsumer: {})
        account.user = try JSONDecoder().decode(TonoUser.self, from: Data(#"{"id":"synthetic-sea-pages","email":"fixture@example.test","plan":"Fixture plan","quotaBytes":1000000000,"usageBytes":250000000}"#.utf8))
        account.state = .ready
        account.devices = try JSONDecoder().decode([TonoDevice].self, from: Data(#"[{"id":"current","name":"Fixture Mac","current":true},{"id":"other","name":"Fixture laptop","current":false}]"#.utf8))
        let owner = try XCTUnwrap(account.user?.id)
        ManagedExitCatalogOwnership.adopt(owner)
        let node = Fixture.realityNode(name: "Osaka", id: "osaka", flag: "🇯🇵")
        let other = Fixture.realityNode(name: "Paris", id: "paris", flag: "🇫🇷")
        app.proxyRegions = [.init(id: AppState.managedCatalogRegionID, name: "Tono", nodes: [node, other])]
        app.managedCatalogRevision = 73
        app.managedCatalogDigest = String(repeating: "a", count: 64)
        app.selectedNodeId = node.id
        app.activeNode = node
        app.proxyService.activeNodeName = node.name
        app.toggleRouteFavorite(other.name, owner: owner)
        let preferenceBefore = AppProfile.defaults.object(forKey: SeaAppearance.enabledKey) as? Bool
        let introBefore = AppProfile.defaults.object(forKey: SettingsKey.introSeen) as? Bool
        try await capture("servers-sea-normal", width: 760, height: 720, annotate: false, darkAppearance: true,
                          nativeOpacity: .isolatedSubpixelEdges, nativeLabels: ["Servers", "Favorites", "Cloud Servers", "Paris"],
                          nativeAXLabels: ["Remove favorite"]) {
            ZStack { MeshGradientBackground(); ProxiesView() }
                .modifier(SeaPageAppearance()).environment(\.seaAppearanceOverride, true)
                .environment(app).environment(account)
        }
        try await capture("account-sea-normal", width: 660, height: 540, annotate: false, darkAppearance: true,
                          nativeOpacity: .isolatedSubpixelEdges, nativeLabels: ["Account", "fixture@example.test", "Sign Out"]) {
            ZStack { MeshGradientBackground(); AccountSettingsCard(session: account).padding(32) }
                .modifier(SeaPageAppearance()).environment(\.seaAppearanceOverride, true)
        }
        let cloud = APIConnection(id: "fixture-cloud", metadata: .init(network: "tcp", type: "HTTPS", process: "Fixture App", processPath: nil, sourceIP: nil, destinationIP: nil, sourcePort: nil, destinationPort: "443", host: "fixture.example.test"), upload: 10, download: 30, start: "0", chains: [node.name, "Tono-Exit"], rule: "DOMAIN-SUFFIX", rulePayload: "example.test")
        let direct = APIConnection(id: "fixture-direct", metadata: .init(network: "tcp", type: "HTTPS", process: "Fixture App", processPath: nil, sourceIP: nil, destinationIP: nil, sourcePort: nil, destinationPort: "443", host: "direct.example.test"), upload: 5, download: 20, start: "0", chains: ["DIRECT"], rule: "MATCH", rulePayload: nil)
        app.isConnected = true
        app.updateConnections(from: .init(downloadTotal: 50, uploadTotal: 15, connections: [cloud, direct]))
        try await capture("activity-sea-normal", width: 760, height: 640, annotate: false, darkAppearance: true,
                          nativeOpacity: .isolatedSubpixelEdges, nativeLabels: ["Activity", "Routes now", "Session bytes include closed connections; they are not current traffic."]) {
            ZStack { MeshGradientBackground(); ActivityView() }
                .modifier(SeaPageAppearance()).environment(\.seaAppearanceOverride, true).environment(app)
        }
        try await capture("settings-sea-grouped", width: 760, height: 820, annotate: false, darkAppearance: true,
                          nativeOpacity: .isolatedSubpixelEdges, nativeLabels: ["Settings", "Account", "General"]) {
            ZStack { MeshGradientBackground(); SettingsView() }
                .modifier(SeaPageAppearance()).environment(\.seaAppearanceOverride, true)
                .environment(app).environment(account).environmentObject(AppUpdater(enabled: false))
        }
        try await capture("support-sea-actions", width: 760, height: 420, annotate: false, darkAppearance: true,
                          nativeOpacity: .isolatedSubpixelEdges, nativeLabels: ["Local health check", "Check this Mac", "Upload diagnostics"]) {
            ZStack {
                MeshGradientBackground()
                SupportHealthSection(check: .constant(nil), copyReport: {}, reportCopied: false).padding(32)
            }
            .modifier(SeaPageAppearance()).environment(\.seaAppearanceOverride, true)
            .environment(app).environment(account)
        }
        let login = AccountSession(sidecar: TonoSidecarService(), descriptorConsumer: { _ in }, killSwitchDisarmConsumer: {})
        login.state = .signedOut
        login.authMethods = .init(email: .init(enabled: true, clientId: nil),
            apple: .init(enabled: false, clientId: nil), google: .init(enabled: false, clientId: nil))
        try await capture("login-sea-email", width: 760, height: 720, annotate: false, darkAppearance: true,
                          nativeOpacity: .isolatedSubpixelEdges, nativeLabels: ["Sign in to Tono", "Send a sign-in code"]) {
            LoginView(session: login).modifier(SeaPageAppearance())
                .environment(\.seaAppearanceOverride, true).environment(app)
        }
        try await capture("intro-sea-first", width: 760, height: 680, annotate: false, darkAppearance: true,
                          nativeOpacity: .isolatedSubpixelEdges, nativeLabels: ["Connected means protected.", "Illustration only · not your current connection status", "Next"]) {
            WelcomeIntroView().modifier(SeaPageAppearance()).environment(\.seaAppearanceOverride, true)
        }
        app.isConnected = false
        try await capture("menubar-sea-normal", width: 280, height: 480, annotate: false, darkAppearance: true,
                          nativeOpacity: .isolatedSubpixelEdges, nativeLabels: ["Open Tono", "Quit Tono", "Connect"]) {
            MenuBarView().modifier(SeaPageAppearance()).environment(\.seaAppearanceOverride, true)
                .environment(app).environment(account)
        }
        XCTAssertEqual(AppProfile.defaults.object(forKey: SeaAppearance.enabledKey) as? Bool, preferenceBefore)
        XCTAssertEqual(AppProfile.defaults.object(forKey: SettingsKey.introSeen) as? Bool, introBefore)
        XCTAssertNil(app.connectionCoordinator.connectTask)
        XCTAssertNil(account.uploadingSupportReportID)
        XCTAssertNil(login.emailChallenge)
    }

    func testProductionSeaAppearanceIgnoresStoredOptOutWithoutOverwritingIt() async throws {
        let app = AppState()
        let account = AccountSession(sidecar: TonoSidecarService(), descriptorConsumer: { _ in }, killSwitchDisarmConsumer: {})
        let defaults = AppProfile.defaults
        let previous = defaults.object(forKey: SeaAppearance.enabledKey)
        defer {
            if let previous { defaults.set(previous, forKey: SeaAppearance.enabledKey) }
            else { defaults.removeObject(forKey: SeaAppearance.enabledKey) }
        }
        defaults.set(false, forKey: SeaAppearance.enabledKey)
        try await capture("dashboard-sea-production-stored-off", width: 660, height: 540,
                          annotate: false, darkAppearance: true,
                          nativeLabels: ["Not connected", "Connect", "Details"]) {
            ZStack { MeshGradientBackground(); DashboardView() }
                .modifier(SeaPageAppearance()).environment(app).environment(account)
        }
        XCTAssertFalse(try XCTUnwrap(defaults.object(forKey: SeaAppearance.enabledKey) as? Bool),
                       "ignoring the obsolete preference must not rewrite it")
        XCTAssertNil(app.connectionCoordinator.connectTask)
    }

    func testUnconfirmedProtectionWithAFailureKeepsNativeRestoreActionVisible() async throws {
        let app = AppState()
        app.isProtectionUnconfirmed = true
        app.lastConnectionFailure = ConnectionFailure(stage: .verifyingTraffic,
            message: "Synthetic previous connection failure", occurredAt: Date())
        let account = AccountSession(sidecar: TonoSidecarService(), descriptorConsumer: { _ in }, killSwitchDisarmConsumer: {})
        try await capture("dashboard-sea-unconfirmed-failure-minimum", width: 660, height: 540,
                          annotate: false, darkAppearance: true,
                          nativeLabels: ["Protection status unconfirmed", "Restore internet"]) {
            ZStack { MeshGradientBackground(); DashboardView() }
                .modifier(SeaPageAppearance()).environment(app).environment(account)
        }
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertTrue(app.isProtectionUnconfirmed)
        XCTAssertNil(app.connectionCoordinator.connectTask)
    }

    func testSeaMenuKeepsTheDegradedExitAdvisoryVisible() async throws {
        let app = AppState()
        app.isConnected = true
        app.isProxyDegraded = true
        let account = AccountSession(sidecar: TonoSidecarService(), descriptorConsumer: { _ in }, killSwitchDisarmConsumer: {})
        try await capture("menubar-sea-degraded", width: 280, height: 480,
                          annotate: false, darkAppearance: true, nativeOpacity: .isolatedSubpixelEdges,
                          nativeLabels: ["Connected", "Exit not responding — checking", "Open Tono"]) {
            MenuBarView().modifier(SeaPageAppearance()).environment(app).environment(account)
        }
        XCTAssertEqual(MenuBarProtectionStatus(app).kind, .degraded)
        XCTAssertNil(app.connectionCoordinator.connectTask)
    }

    private func captureDashboard(
        _ name: String, app: AppState, account: AccountSession,
        sea: Bool, width: CGFloat, height: CGFloat, recoveryFeedback: String? = nil, decorations: Bool? = nil
    ) async throws {
        try await capture(name, width: width, height: height, annotate: false, darkAppearance: sea,
                          requiredRecoveryFeedback: recoveryFeedback) {
            ZStack {
                MeshGradientBackground()
                DashboardView()
            }
            .modifier(SeaPageAppearance())
            .environment(\.seaAppearanceOverride, sea)
            .environment(\.seaDecorationsOverride, decorations)
            .environment(app)
            .environment(account)
        }
    }

    private func capture<Content: View>(
        _ name: String, width: CGFloat, height: CGFloat,
        annotate: Bool = true,
        darkAppearance: Bool = false,
        nativeOpacity: NativeRenderOpacityPolicy = .opaque,
        nativeLabels: [String]? = nil,
        nativeIdentifiers: [String] = [],
        nativeAXLabels: [String]? = nil,
        requiredRecoveryFeedback: String? = nil,
        @ViewBuilder content: () -> Content
    ) async throws {
        let root = Group {
            if annotate {
                VStack(alignment: .leading, spacing: 0) {
                    Text("SYNTHETIC NATIVE XCTEST · \(name)")
                        .font(.system(size: 10, design: .monospaced)).padding(8)
                    content()
                }
            } else {
                content()
            }
        }
        .frame(width: width, height: height, alignment: .topLeading)
        .background(Color(nsColor: .windowBackgroundColor))
        .environment(\.colorScheme, darkAppearance ? .dark : .light)
        .environment(\.locale, Locale(identifier: "en"))
        .transaction { transaction in
            transaction.animation = nil
            transaction.disablesAnimations = true
        }
        let host = NSHostingView(rootView: root)
        let rect = NSRect(x: 0, y: 0, width: width, height: height)
        let window = NSWindow(contentRect: rect, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: darkAppearance ? .darkAqua : .aqua)
        // The screenshot is of this fixture window, not a desktop composite.
        // Give its backing surface an opaque base under the SwiftUI content.
        window.backgroundColor = .windowBackgroundColor
        window.isOpaque = true
        window.contentView = host
        defer {
            window.orderOut(nil)
            window.contentView = nil
            window.close()
        }
        host.frame = rect
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        // A bounded presentation turn lets AppKit-backed controls finish
        // layout. It does not capture the screen or request recording access.
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        // The root intentionally has an opaque background. PNG byte count
        // alone previously accepted a fully transparent Dashboard image.
        // This catches missing compositor pixels, not semantic/layout errors;
        // those still require actual image inspection.
        // The blocked minimum-height Dashboard adds a ScrollView over recovery
        // controls. Give its AppKit-backed content bounded presentation turns
        // before accepting the offscreen cache; never fill missing pixels.
        var bitmap: NSBitmapImageRep?
        var minimumAlpha: CGFloat = 1
        for attempt in 0..<5 {
            if attempt > 0 {
                RunLoop.main.run(until: Date().addingTimeInterval(0.1))
            }
            host.layoutSubtreeIfNeeded()
            host.needsDisplay = true
            window.displayIfNeeded()
            let candidate = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.cacheDisplay(in: host.bounds, to: candidate)
            bitmap = candidate
            minimumAlpha = 1
            for y in stride(from: 0, to: candidate.pixelsHigh, by: 8) {
                for x in stride(from: 0, to: candidate.pixelsWide, by: 8) {
                    minimumAlpha = min(minimumAlpha, candidate.colorAt(x: x, y: y)?.alphaComponent ?? 0)
                }
            }
            if minimumAlpha == 1 { break }
        }
        let png = try XCTUnwrap(bitmap?.representation(using: .png, properties: [:]))
        let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("test-results/renders", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let nativeOnly = name == "dashboard-sea-blocked-minimum"
            || name == "dashboard-sea-blocked-paused-recovery-minimum" || nativeLabels != nil
        let offscreenName = nativeOnly ? name + "-offscreen" : name
        try png.write(to: folder.appendingPathComponent(offscreenName + ".png"), options: .atomic)
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = offscreenName
        attachment.lifetime = .keepAlways
        add(attachment)
        if nativeOnly {
            let diagnostic = "\(name): offscreen cacheDisplay alphaMinimum=\(minimumAlpha) bytes=\(png.count); diagnostic only, not acceptance"
            NSLog("%@", diagnostic)
            let data = Data((diagnostic + "\n").utf8)
            try data.write(to: folder.appendingPathComponent(name + "-offscreen.txt"), options: .atomic)
            let receipt = XCTAttachment(data: data, uniformTypeIdentifier: "public.plain-text")
            receipt.name = name + "-offscreen-receipt"
            receipt.lifetime = .keepAlways
            add(receipt)
            let environment = ProcessInfo.processInfo.environment
            let hostedDiagnostic = environment["TEST_RUNNER_TONO_HOSTED_WINDOW_DIAGNOSTIC"]
                ?? environment["TONO_HOSTED_WINDOW_DIAGNOSTIC"]
            if hostedDiagnostic == "1" {
                let paused = name == "dashboard-sea-blocked-paused-recovery-minimum"
                let labels = nativeLabels ?? ["Protected, not connected",
                    paused ? "Repair and reconnect" : "Retry now", "Restore internet"]
                await captureNativeWindowAcceptance(name, window: window, host: host, folder: folder,
                    width: Int(width), height: Int(height), requiredLabels: labels,
                    requiredIdentifiers: nativeIdentifiers.isEmpty && paused ? ["protectedRecoveryFeedback"] : nativeIdentifiers, requiredRecoveryFeedback: requiredRecoveryFeedback,
                    requiredAXLabels: nativeAXLabels, opacityPolicy: nativeOpacity)
            } else {
                XCTFail("\(name): exact-window native acceptance unavailable; TEST_RUNNER_TONO_HOSTED_WINDOW_DIAGNOSTIC=1 required")
            }
        } else {
            XCTAssertEqual(minimumAlpha, 1, "\(name): incomplete offscreen capture")
            XCTAssertGreaterThan(png.count, 5_000, "capture must contain rendered content, not an empty canvas")
            XCTAssertLessThan(png.count, 4 * 1_024 * 1_024)
        }
    }

    /// Preselected fixtures accept only this same-process window image.
    /// Offscreen cacheDisplay output remains separate failed diagnostic evidence.
    private func captureNativeWindowAcceptance(
        _ name: String, window: NSWindow, host: NSView, folder: URL,
        width: Int, height: Int, requiredLabels: [String], requiredIdentifiers: [String],
        requiredRecoveryFeedback: String?, requiredAXLabels: [String]?, opacityPolicy: NativeRenderOpacityPolicy
    ) async {
        var receipt = ["name=\(name)", "api=ScreenCaptureKit independent window"]
        defer {
            let data = Data((receipt.joined(separator: "\n") + "\n").utf8)
            let url = folder.appendingPathComponent(name + "-native-window.txt")
            do {
                try data.write(to: url, options: .atomic)
            } catch {
                NSLog("native-window receipt write failed: %@", String(reflecting: error))
                XCTFail("\(name): native-window acceptance receipt could not be saved")
            }
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.plain-text")
            attachment.name = name + "-native-window-receipt"
            attachment.lifetime = .keepAlways
            add(attachment)
            NSLog("native-window acceptance: %@", receipt.joined(separator: " | "))
        }

        let expectedPID = ProcessInfo.processInfo.processIdentifier
        receipt.append("windowNumber=\(window.windowNumber) processID=\(expectedPID) visible=\(window.isVisible) frame=\(window.frame)")
        receipt.append("preCaptureWindow opaque=\(window.isOpaque) opacity=\(window.alphaValue) background=\(window.backgroundColor) hostBackground=\(host.layer?.backgroundColor.debugDescription ?? "nil")")
        let processLanguage = Locale.preferredLanguages.first ?? "missing"
        let bundleLanguage = Bundle.main.preferredLocalizations.first ?? "missing"
        let testBundleLanguage = Bundle(for: type(of: self)).preferredLocalizations.first ?? "missing"
        receipt.append("language source=English fixture strings processPreferred=\(processLanguage) bundlePreferred=\(bundleLanguage) testBundlePreferred=\(testBundleLanguage) AppleLanguages=\(ProcessInfo.processInfo.environment["AppleLanguages"] ?? "unset") SwiftUILocale=en")
        guard processLanguage.lowercased().hasPrefix("en"), bundleLanguage.lowercased().hasPrefix("en") else {
            receipt.append("acceptance=failed: process or app bundle preferred language is not English")
            XCTFail("\(name): English native-text source not established before capture")
            return
        }
        guard window.windowNumber > 0, window.isVisible,
              window.frame.width == CGFloat(width), window.frame.height == CGFloat(height),
              !requiredLabels.isEmpty else {
            receipt.append("capture=failed: synthetic window not visible at required dimensions or content contract missing")
            XCTFail("\(name): synthetic window not visible at required dimensions or content contract missing")
            return
        }
        let expectedID = CGWindowID(window.windowNumber)
        // Query only the supplied window, never a desktop or other-app scan.
        guard let windowInfo = CGWindowListCopyWindowInfo([.optionIncludingWindow], expectedID) as? [[String: Any]],
              let info = windowInfo.first(where: { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == expectedID }),
              (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == expectedPID,
              (info[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true,
              let rawBounds = info[kCGWindowBounds as String] as? [String: Any],
              let windowServerFrame = CGRect(dictionaryRepresentation: rawBounds as CFDictionary) else {
            receipt.append("capture=failed: exact own-PID on-screen WindowServer frame unavailable")
            XCTFail("\(name): exact own-PID on-screen WindowServer frame unavailable")
            return
        }
        receipt.append("windowServerFrame=\(windowServerFrame)")

        do {
            receipt.append("shareableContentDeadline=10s")
            let content: SCShareableContent = try await nativeWindowRequest("SCShareableContent.getCurrentProcessShareableContent", timeout: 10) { complete in
                SCShareableContent.getCurrentProcessShareableContent { content, error in
                    if let error {
                        complete(.failure(error))
                    } else if let content {
                        complete(.success(content))
                    } else {
                        complete(.failure(NSError(domain: "TonoNativeWindowDiagnostic", code: 1,
                            userInfo: [NSLocalizedDescriptionKey: "current-process shareable content was nil without an error"])))
                    }
                }
            }
            guard let target = content.windows.first(where: {
                $0.windowID == expectedID && $0.owningApplication?.processID == expectedPID
            }) else {
                receipt.append("capture=failed: exact windowID/processID not present in current-process shareable content")
                XCTFail("\(name): exact own-process shareable window unavailable")
                return
            }
            receipt.append("shareableWindowID=\(target.windowID) ownerPID=\(target.owningApplication?.processID ?? -1) onScreen=\(target.isOnScreen) frame=\(target.frame)")
            guard target.isOnScreen, target.frame == windowServerFrame,
                  target.frame.width == CGFloat(width), target.frame.height == CGFloat(height) else {
                receipt.append("capture=failed: shareable window on-screen/frame mismatch")
                XCTFail("\(name): shareable window on-screen/frame mismatch")
                return
            }
            let filter = SCContentFilter(desktopIndependentWindow: target)
            let configuration = SCStreamConfiguration()
            configuration.width = width
            configuration.height = height
            configuration.showsCursor = false
            receipt.append("captureTimeWindow opaque=\(window.isOpaque) opacity=\(window.alphaValue) background=\(window.backgroundColor) backgroundAlpha=\(window.backgroundColor.alphaComponent) appearance=\(window.effectiveAppearance.name.rawValue) frame=\(window.frame)")
            receipt.append("captureImageDeadline=10s")
            let image: CGImage = try await nativeWindowRequest("SCScreenshotManager.captureImage", timeout: 10) { complete in
                SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, error in
                    if let error {
                        complete(.failure(error))
                    } else if let image {
                        complete(.success(image))
                    } else {
                        complete(.failure(NSError(domain: "TonoNativeWindowDiagnostic", code: 2,
                            userInfo: [NSLocalizedDescriptionKey: "independent-window capture returned nil without an error"])))
                    }
                }
            }
            guard image.width == width, image.height == height else {
                receipt.append("capture=failed: image dimensions \(image.width)x\(image.height)")
                XCTFail("\(name): native image dimensions mismatch")
                return
            }
            let bitmap = NSBitmapImageRep(cgImage: image)
            guard let png = bitmap.representation(using: .png, properties: [:]) else {
                receipt.append("capture=failed: CGImage could not be encoded as PNG")
                XCTFail("\(name): native image PNG encoding unavailable")
                return
            }
            let url = folder.appendingPathComponent(name + "-native-window.png")
            try png.write(to: url, options: .atomic)
            let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
            attachment.name = name + "-native-window"
            attachment.lifetime = .keepAlways
            add(attachment)
            receipt.append("capture=saved path=\(url.path) pixels=\(image.width)x\(image.height) bytes=\(png.count)")
            guard png.count > 5_000, png.count < 4 * 1_024 * 1_024 else {
                receipt.append("acceptance=failed: PNG byte bounds")
                XCTFail("\(name): native PNG outside original 5KB..4MiB bounds")
                return
            }
            var fractional: [(Int, Int, CGFloat)] = []
            for y in 0..<bitmap.pixelsHigh {
                for x in 0..<bitmap.pixelsWide {
                    let alpha = bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0
                    if alpha != 1 {
                        fractional.append((x, y, alpha))
                    }
                }
            }
            nativeAXDiagnostic(host: host, window: window, required: requiredAXLabels ?? requiredLabels,
                               requiredIdentifiers: requiredIdentifiers, receipt: &receipt)
            let visualContentVisible = nativeVisionContentIsVisible(
                image: image, bitmap: bitmap, required: requiredLabels,
                recoveryFeedback: requiredRecoveryFeedback, receipt: &receipt)
            var rejectedFractional = 0
            receipt.append("opacityContract=\(opacityPolicy) originalFractionalCount=\(fractional.count) borders=opaque; first source unmodified")
            for (x, y, _) in fractional {
                let allowed = opacityPolicy == .isolatedSubpixelEdges && NativeRenderOpacityPolicy.acceptsIsolatedEdge(
                    x: x, y: y, width: bitmap.pixelsWide, height: bitmap.pixelsHigh
                ) { px, py in
                    guard let color = bitmap.colorAt(x: px, y: py)?.usingColorSpace(.deviceRGB) else { return nil }
                    return NativeRenderPixel(red: color.redComponent, green: color.greenComponent,
                                             blue: color.blueComponent, alpha: color.alphaComponent)
                }
                if !allowed { rejectedFractional += 1 }
                receipt.append("fractionalCompletenessPixel=(\(x),\(y)) acceptedIsolatedEdge=\(allowed)")
            }
            if !fractional.isEmpty {
                await nativeAlphaDiagnostic(name, window: window, expectedID: expectedID, expectedPID: expectedPID,
                                            expectedFrame: windowServerFrame, original: image,
                                            bitmap: bitmap, png: png, fractional: fractional, folder: folder,
                                            receipt: &receipt)
            }
            guard rejectedFractional == 0 else {
                receipt.append("acceptance=failed: \(rejectedFractional) original pixels violate completeness; original image remains sole acceptance source")
                XCTFail("\(name): native image contains a transparent pixel outside its completeness contract")
                return
            }
            guard visualContentVisible else {
                receipt.append("acceptance=failed: fixture content/layout evidence")
                XCTFail("\(name): native image lacks bounded fixture content/layout evidence")
                return
            }
            receipt.append("acceptance=passed: exact window, original native PNG completeness and Vision glyph/layout evidence; AX/action/hardware unverified")
        } catch {
            let failure = error as NSError
            receipt.append("capture=failed: domain=\(failure.domain) code=\(failure.code) reason=\(failure.localizedDescription) userInfo=\(failure.userInfo)")
            XCTFail("\(name): native-window capture unavailable: \(failure.domain) code \(failure.code)")
        }
    }

    /// AX is a bounded diagnostic only; SwiftUI may not vend fixture children here.
    private func nativeAXDiagnostic(
        host: NSView, window: NSWindow,
        required: [String], requiredIdentifiers: [String], receipt: inout [String]
    ) {
        guard host.window === window else {
            receipt.append("AX=unavailable: host/window mismatch; AX/action semantics unverified")
            return
        }
        receipt.append("AX children source=untyped accessibilityChildren; typed navigation-order bridge not queried after hosted NSAccessibilitySegment crash; semantics unverified")
        var queue: [AnyObject] = [window, host]
        var visited = Set<ObjectIdentifier>()
        var matches: [String: NSRect] = [:]
        var unsupportedChildren = 0
        while !queue.isEmpty && visited.count < 512 {
            let element = queue.removeFirst()
            guard visited.insert(ObjectIdentifier(element)).inserted else { continue }
            let full = element as? any NSAccessibilityProtocol
            let object = element as? NSObject
            // SwiftUI can vend role-based accessibility elements that implement
            // only NSAccessibilityElementProtocol, not the full AppKit protocol.
            let frame = full?.accessibilityFrame()
                ?? (element as? any NSAccessibilityElementProtocol)?.accessibilityFrame()
            let label = full?.accessibilityLabel()
                ?? (object?.accessibilityAttributeValue(.description) as? String)
                ?? (object?.accessibilityAttributeValue(.title) as? String)
                ?? ""
            let stringValue = full?.accessibilityValue() as? String
                ?? (object?.accessibilityAttributeValue(.value) as? String)
            let identifier = full?.accessibilityIdentifier()
                ?? (element as? any NSAccessibilityElementProtocol)?.accessibilityIdentifier?()
                ?? (object?.accessibilityAttributeValue(.identifier) as? String)
                ?? ""
            if let frame {
                for expected in required where label == expected || stringValue == expected {
                    matches[expected] = frame
                }
                if requiredIdentifiers.contains(identifier) {
                    matches[identifier] = frame
                }
            }
            var children = full?.accessibilityChildren() ?? []
            if children.isEmpty, let object {
                children = object.accessibilityAttributeValue(.children) as? [Any] ?? []
            }
            if visited.count <= 16 {
                receipt.append("AX[\(visited.count)] label=\(label) value=\(stringValue ?? "") identifier=\(identifier) frame=\(String(describing: frame)) children=\(children.count)")
            }
            for child in children {
                if let child = child as? NSObject {
                    queue.append(child)
                } else {
                    unsupportedChildren += 1
                }
            }
        }
        receipt.append("accessibilityNodes=\(visited.count) unsupportedChildren=\(unsupportedChildren) matched=\(matches.keys.sorted()) AX/action/identifier semantics=unverified")
    }

    /// Recognition is performed on the original accepted-source CGImage, never on
    /// an AX string, a cacheDisplay image, or a recaptured replacement image.
    private func nativeVisionContentIsVisible(
        image: CGImage, bitmap: NSBitmapImageRep, required: [String],
        recoveryFeedback: String?, receipt: inout [String]
    ) -> Bool {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = true
        do {
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        } catch {
            receipt.append("Vision=failed: \(error)")
            return false
        }
        let lines = (request.results ?? []).compactMap { observation -> (String, Float, CGRect)? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            return (candidate.string, candidate.confidence, observation.boundingBox)
        }.sorted { left, right in
            if abs(left.2.midY - right.2.midY) > 0.015 { return left.2.midY > right.2.midY }
            return left.2.minX < right.2.minX
        }
        receipt.append("Vision lines=\(lines.count) recognition=accurate language=en-US correction=true")
        for (index, line) in lines.prefix(80).enumerated() {
            receipt.append("OCR[\(index)] text=\(line.0.debugDescription) confidence=\(line.1) box=\(line.2)")
        }
        if lines.count > 80 { receipt.append("OCR omittedLines=\(lines.count - 80)") }
        guard !lines.isEmpty, lines.count <= 200 else { return false }
        var expectations = required
        if let recoveryFeedback {
            guard !recoveryFeedback.isEmpty else { return false }
            expectations.append(recoveryFeedback)
            receipt.append("recoveryFeedbackWitness=complete visible app.recoveryFeedback; protectedRecoveryFeedback AX identifier unverified")
        }
        for (index, expected) in expectations.enumerated() {
            let expectedTokens = nativeNormalizedTokens(expected)
            guard !expectedTokens.isEmpty else { return false }
            var matched = false
            for length in 1...min(8, lines.count) {
                for start in 0...(lines.count - length) {
                    let end = start + length - 1
                    let group = Array(lines[start...end])
                    guard group.allSatisfy({ $0.1 >= 0.35 }) else { continue }
                    let tokens = nativeNormalizedTokens(group.map { $0.0 }.joined(separator: " "))
                    guard tokens.count >= expectedTokens.count else { continue }
                    let containsExactTokens = (0...(tokens.count - expectedTokens.count)).contains {
                        Array(tokens[$0..<($0 + expectedTokens.count)]) == expectedTokens
                    }
                    guard containsExactTokens else { continue }
                    let bounds = group.map { $0.2 }.reduce(CGRect.null) { $0.union($1) }
                    let pixelRect = NSRect(x: bounds.minX * CGFloat(image.width),
                                           y: bounds.minY * CGFloat(image.height),
                                           width: bounds.width * CGFloat(image.width),
                                           height: bounds.height * CGFloat(image.height))
                    let imageRect = NSRect(x: 0, y: 0, width: CGFloat(image.width), height: CGFloat(image.height))
                    guard pixelRect.width >= 10, pixelRect.height >= 8,
                          imageRect.contains(pixelRect),
                          let lightness = nativePixelLightness(in: pixelRect, windowFrame: imageRect, bitmap: bitmap),
                          lightness.high - lightness.low >= 0.08,
                          index != 0 || lightness.high >= 0.75 else { continue }
                    receipt.append("contentVisible=\(expected.debugDescription) OCRLines=\(start)...\(end) confidenceMin=\(group.map { $0.1 }.min() ?? 0) imageBox=\(pixelRect) lightnessLow=\(lightness.low) lightnessHigh=\(lightness.high)")
                    matched = true
                    break
                }
                if matched { break }
            }
            if !matched {
                receipt.append("contentMissingOrBlank=\(expected.debugDescription) requiredExactNormalizedTokens=\(expectedTokens)")
                return false
            }
        }
        return true
    }

    private func nativeNormalizedTokens(_ text: String) -> [String] {
        let folded = text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US"))
        let normalized = folded.unicodeScalars.map {
            CharacterSet.alphanumerics.contains($0) ? String($0) : " "
        }.joined()
        return normalized.split(whereSeparator: \.isWhitespace).map(String.init)
    }

    /// Diagnostic only. A repeat never replaces the first image completeness check.
    private func nativeAlphaDiagnostic(
        _ name: String, window: NSWindow, expectedID: CGWindowID, expectedPID: pid_t,
        expectedFrame: CGRect, original: CGImage,
        bitmap: NSBitmapImageRep, png: Data, fractional: [(Int, Int, CGFloat)],
        folder: URL, receipt: inout [String]
    ) async {
        receipt.append("alphaDiagnostic originalCG alphaInfo=\(original.alphaInfo.rawValue) bitmapInfo=\(original.bitmapInfo.rawValue) bitsPerPixel=\(original.bitsPerPixel) bitsPerComponent=\(original.bitsPerComponent) bytesPerRow=\(original.bytesPerRow) colorSpace=\(String(describing: original.colorSpace))")
        receipt.append("alphaDiagnostic NSBitmap alpha=\(bitmap.hasAlpha) samplesPerPixel=\(bitmap.samplesPerPixel) bitsPerSample=\(bitmap.bitsPerSample) PNGBytes=\(png.count)")
        let raw = original.dataProvider?.data as Data?
        let pngBitmap = NSBitmapImageRep(data: png)
        let minX = fractional.map { $0.0 }.min() ?? 0
        let maxX = fractional.map { $0.0 }.max() ?? 0
        let minY = fractional.map { $0.1 }.min() ?? 0
        let maxY = fractional.map { $0.1 }.max() ?? 0
        receipt.append("alphaDiagnostic fractionalCount=\(fractional.count) bbox=(\(minX),\(minY))...(\(maxX),\(maxY)) rawProviderBytes=\(raw?.count ?? 0) decodedPNG=\(pngBitmap != nil)")
        for (x, y, alpha) in fractional.prefix(64) {
            let adjacentFractional = fractional.filter {
                abs($0.0 - x) <= 1 && abs($0.1 - y) <= 1 && ($0.0 != x || $0.1 != y)
            }.count
            let edgeDistance = [x, y, bitmap.pixelsWide - 1 - x, bitmap.pixelsHigh - 1 - y].min() ?? 0
            let neighbors = (max(0, y - 1)...min(bitmap.pixelsHigh - 1, y + 1)).map { ny in
                (max(0, x - 1)...min(bitmap.pixelsWide - 1, x + 1)).map { nx in
                    let color = bitmap.colorAt(x: nx, y: ny)?.usingColorSpace(.deviceRGB)
                    return "(\(nx),\(ny):\(color?.redComponent ?? -1),\(color?.greenComponent ?? -1),\(color?.blueComponent ?? -1),\(color?.alphaComponent ?? -1))"
                }.joined(separator: " ")
            }.joined(separator: " / ")
            var rawRGBA = "unavailable"
            if let raw, original.bitsPerPixel == 32, original.bitsPerComponent == 8 {
                let offset = y * original.bytesPerRow + x * 4
                if offset + 4 <= raw.count { rawRGBA = Array(raw[offset..<(offset + 4)]).description }
            }
            receipt.append("alphaPixel=(\(x),\(y)) NSAlpha=\(alpha) PNGAlpha=\(pngBitmap?.colorAt(x: x, y: y)?.alphaComponent ?? -1) raw4=\(rawRGBA) adjacentFractional=\(adjacentFractional) edgeDistance=\(edgeDistance) neighbors=\(neighbors)")
        }
        if fractional.count > 64 { receipt.append("alphaDiagnostic omittedPixelNeighborhoods=\(fractional.count - 64); original fractionalCount/bbox retained") }
        let directURL = folder.appendingPathComponent(name + "-native-window-direct-imageio-diagnostic.png")
        if let destination = CGImageDestinationCreateWithURL(directURL as CFURL, "public.png" as CFString, 1, nil) {
            CGImageDestinationAddImage(destination, original, nil)
            receipt.append("alphaDiagnostic directImageIOPNG=\(CGImageDestinationFinalize(destination) ? directURL.path : "encode failed") diagnosticOnly=true")
        } else {
            receipt.append("alphaDiagnostic directImageIOPNG=destination unavailable")
        }
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        do {
            receipt.append("alphaRepeat shareableContentDeadline=10s captureImageDeadline=10s diagnosticOnly=true")
            guard window.windowNumber == Int(expectedID), window.isVisible,
                  let info = (CGWindowListCopyWindowInfo([.optionIncludingWindow], expectedID) as? [[String: Any]])?.first(where: {
                      ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == expectedID
                  }),
                  (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == expectedPID,
                  (info[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true,
                  let bounds = info[kCGWindowBounds as String] as? [String: Any],
                  let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary), frame == expectedFrame else {
                receipt.append("alphaRepeat=failed exact own WindowServer source changed")
                return
            }
            let content: SCShareableContent = try await nativeWindowRequest("alpha repeat shareable content", timeout: 10) { complete in
                SCShareableContent.getCurrentProcessShareableContent { value, error in
                    if let error { complete(.failure(error)) }
                    else if let value { complete(.success(value)) }
                    else { complete(.failure(NSError(domain: "TonoNativeWindowDiagnostic", code: 4))) }
                }
            }
            guard let target = content.windows.first(where: {
                $0.windowID == expectedID && $0.owningApplication?.processID == expectedPID
            }), target.isOnScreen, target.frame == expectedFrame else {
                receipt.append("alphaRepeat=failed exact own shareable source changed")
                return
            }
            let configuration = SCStreamConfiguration()
            configuration.width = original.width
            configuration.height = original.height
            configuration.showsCursor = false
            let repeatFilter = SCContentFilter(desktopIndependentWindow: target)
            let repeated: CGImage = try await nativeWindowRequest("alpha repeat exact-window image", timeout: 10) { complete in
                SCScreenshotManager.captureImage(contentFilter: repeatFilter, configuration: configuration) { image, error in
                    if let error { complete(.failure(error)) }
                    else if let image { complete(.success(image)) }
                    else { complete(.failure(NSError(domain: "TonoNativeWindowDiagnostic", code: 5))) }
                }
            }
            guard repeated.width == original.width, repeated.height == original.height else {
                receipt.append("alphaRepeat=failed image dimensions changed")
                return
            }
            let repeatBitmap = NSBitmapImageRep(cgImage: repeated)
            var count = 0
            var first: String?
            for y in 0..<repeatBitmap.pixelsHigh {
                for x in 0..<repeatBitmap.pixelsWide {
                    if repeatBitmap.colorAt(x: x, y: y)?.alphaComponent != 1 {
                        count += 1
                        if first == nil { first = "\(x),\(y)" }
                    }
                }
            }
            if let data = repeatBitmap.representation(using: .png, properties: [:]) {
                let url = folder.appendingPathComponent(name + "-native-window-repeat-diagnostic.png")
                try data.write(to: url, options: .atomic)
                receipt.append("alphaRepeat=saved diagnosticOnly path=\(url.path) fractionalCount=\(count) first=\(first ?? "none")")
            } else {
                receipt.append("alphaRepeat=PNG encoding failed fractionalCount=\(count) first=\(first ?? "none")")
            }
        } catch {
            receipt.append("alphaRepeat=failed \(error)")
        }
    }

    private func nativePixelLightness(in screenFrame: NSRect, windowFrame: NSRect, bitmap: NSBitmapImageRep) -> (low: CGFloat, high: CGFloat)? {
        let minX = max(0, Int(screenFrame.minX - windowFrame.minX))
        let maxX = min(bitmap.pixelsWide - 1, Int(screenFrame.maxX - windowFrame.minX))
        let minY = max(0, Int(windowFrame.maxY - screenFrame.maxY))
        let maxY = min(bitmap.pixelsHigh - 1, Int(windowFrame.maxY - screenFrame.minY))
        guard maxX > minX, maxY > minY else { return nil }
        var low: CGFloat = 1
        var high: CGFloat = 0
        for y in stride(from: minY, through: maxY, by: 2) {
            for x in stride(from: minX, through: maxX, by: 2) {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { return nil }
                let luminance = 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
                low = min(low, luminance)
                high = max(high, luminance)
            }
        }
        return (low, high)
    }
}
