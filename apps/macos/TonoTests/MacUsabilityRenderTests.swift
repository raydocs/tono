import AppKit
import SwiftUI
import XCTest
@testable import Tono

/// Native AppKit/SwiftUI captures on the existing hosted macOS test host.
/// Synthetic state only: no sign-in, helper calls, browser scans or uploads.
@MainActor
final class MacUsabilityRenderTests: XCTestCase {
    func testNativeUsabilityStatesProduceReviewableAttachments() async throws {
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
        let other = Fixture.realityNode(name: "Tokyo · Dawn", id: "tokyo")
        app.proxyRegions = [.init(id: AppState.managedCatalogRegionID, name: "Tono", nodes: [node, other])]
        app.managedCatalogRevision = 73
        app.managedCatalogDigest = String(repeating: "a", count: 64)
        app.selectedNodeId = node.id
        app.activeNode = node
        app.proxyService.activeNodeName = node.name
        app.isProtectionBlocked = true
        let observation = await app.collectLocalHealth(account: account, probe: { .init(helperInstalled: true, helperRejectsApp: true) })
        let check = try XCTUnwrap(observation)
        try capture("health-unknown-helper", width: 660, height: 780) {
            SupportCard(icon: "stethoscope", title: String(localized: "Local health check")) {
                LocalHealthResults(check: check)
            }.padding(20)
        }
        try capture("build-unverified", width: 700, height: 480) {
            BuildIdentityDetails(check: check).padding(24)
        }
        account.previewSupportReport(check)
        let draft = try XCTUnwrap(account.supportReportDraft)
        try capture("report-preview", width: 660, height: 540) {
            SupportReportConfirmationView(draft: draft, receipt: nil, sending: false, error: nil, canSend: true, confirm: {}, close: {})
        }
        let receipt = SupportReportReceipt(draftID: draft.id, server: .init(referenceCode: "SYNTHETIC-NOT-A-SERVER-RECEIPT", receivedAt: 1_790_000_000), localIdentity: check.localIdentity)
        try capture("report-receipt", width: 660, height: 600) {
            SupportReportConfirmationView(draft: draft, receipt: receipt, sending: false, error: nil, canSend: true, confirm: {}, close: {})
        }
        try capture("report-no-receipt", width: 660, height: 610) {
            SupportReportConfirmationView(draft: draft, receipt: nil, sending: false,
                error: String(localized: "No support receipt was received. The server may have stored the report. Try again only if you want to send this same preview again."),
                canSend: true, confirm: {}, close: {})
        }
        app.isProtectionBlocked = false
        app.toggleRouteFavorite(node.name, owner: owner)
        app.isConnected = true
        app.recordVerifiedRouteSuccess(node.name, owner: owner, generation: app.connectionCoordinator.protectionOperationGeneration)
        app.isConnected = false
        try capture("nodes-favorite-recommendation", width: 740, height: 600) {
            ProxiesView().environment(app).environment(account)
        }
        app.isProtectionBlocked = true
        app.recoveryCause = .wake
        app.protectedReconnectPausedForUserAction = true
        try capture("dashboard-wake-paused", width: 720, height: 560) {
            DashboardView().environment(app).environment(account)
        }
        try capture("menubar-wake-paused", width: 300, height: 480) {
            MenuBarView().environment(app).environment(account)
        }
        app.protectedReconnectPausedForUserAction = false
        app.isProtectedReconnectScheduled = true
        app.recoveryCause = .networkChange
        try capture("network-recovery-running", width: 560, height: 220) {
            RecoveryNotice(appState: app).padding(24)
        }
        let cloud = APIConnection(id: "synthetic-cloud", metadata: .init(network: "tcp", type: "HTTPS", process: "Example App", processPath: nil, sourceIP: nil, destinationIP: nil, sourcePort: nil, destinationPort: "443", host: "cloud.example.test"), upload: 10, download: 30, start: "0", chains: [node.name, "Tono-Exit"], rule: "DOMAIN-SUFFIX", rulePayload: "example.test")
        let unknown = APIConnection(id: "synthetic-unknown", metadata: .init(network: "tcp", type: "HTTPS", process: "Example App", processPath: nil, sourceIP: nil, destinationIP: nil, sourcePort: nil, destinationPort: nil, host: "unknown.example.test"), upload: 0, download: 0, start: "0", chains: ["Tono-Exit"], rule: "MATCH", rulePayload: nil)
        app.updateConnections(from: .init(downloadTotal: 30, uploadTotal: 10, connections: [cloud, unknown]))
        try capture("activity-cloud-and-unknown", width: 540, height: 500) {
            ActivityRoutingDetails(entries: app.connections)
        }
        XCTAssertNil(app.connectionCoordinator.connectTask)
        XCTAssertNil(app.connectionCoordinator.protectedReconnectTask)
        XCTAssertNil(account.uploadingSupportReportID)
    }

    private func capture<Content: View>(
        _ name: String, width: CGFloat, height: CGFloat,
        @ViewBuilder content: () -> Content
    ) throws {
        let root = VStack(alignment: .leading, spacing: 0) {
            Text("SYNTHETIC NATIVE XCTEST · \(name)")
                .font(.system(size: 10, design: .monospaced)).padding(8)
            content()
        }
        .frame(width: width, height: height, alignment: .topLeading)
        .background(Color(nsColor: .windowBackgroundColor))
        .environment(\.colorScheme, .light)
        .environment(\.locale, Locale(identifier: "en"))
        .environment(\.accessibilityReduceMotion, true)
        let host = NSHostingView(rootView: root)
        let rect = NSRect(x: 0, y: 0, width: width, height: height)
        let window = NSWindow(contentRect: rect, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        host.frame = rect
        host.layoutSubtreeIfNeeded()
        host.displayIfNeeded()
        let bitmap = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        XCTAssertGreaterThan(png.count, 5_000, "capture must contain rendered content, not an empty canvas")
        XCTAssertLessThan(png.count, 4 * 1_024 * 1_024)
        let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("test-results/renders", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try png.write(to: folder.appendingPathComponent(name + ".png"), options: .atomic)
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        window.close()
    }
}
