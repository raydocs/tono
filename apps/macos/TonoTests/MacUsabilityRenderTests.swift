import AppKit
import ScreenCaptureKit
import SwiftUI
import XCTest
@testable import Tono

/// Native AppKit/SwiftUI captures on the existing hosted macOS test host.
/// Synthetic state only: no sign-in, helper calls, browser scans or uploads.
@MainActor
final class MacUsabilityRenderTests: XCTestCase {
    func testNativeUsabilityStatesProduceReviewableAttachments() async throws {
        try await capture("sea-night", width: 600, height: 400) {
            SeaScene(phase: .night, motionEnabled: false).frame(width: 600, height: 375)
        }
        try await capture("sea-confirmed", width: 600, height: 400) {
            SeaScene(phase: .day, motionEnabled: false).frame(width: 600, height: 375)
        }
        try await capture("sea-blocked", width: 600, height: 400) {
            SeaScene(phase: .blocked, motionEnabled: false).frame(width: 600, height: 375)
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
        app.isConnected = false
        app.isProtectionBlocked = true
        try await captureDashboard("dashboard-sea-blocked-minimum", app: app, account: account,
                             sea: true, width: 660, height: 540)
        app.recoveryCause = .wake
        app.protectedReconnectPausedForUserAction = true
        try await captureDashboard("dashboard-sea-blocked-paused-recovery-minimum", app: app, account: account,
                                   sea: true, width: 660, height: 540)
        app.recoveryCause = nil
        app.protectedReconnectPausedForUserAction = false
        try await capture("settings-sea-normal", width: 920, height: 600, annotate: false) {
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

    private func captureDashboard(
        _ name: String, app: AppState, account: AccountSession,
        sea: Bool, width: CGFloat, height: CGFloat
    ) async throws {
        try await capture(name, width: width, height: height, annotate: false) {
            ZStack {
                MeshGradientBackground()
                DashboardView()
            }
            .modifier(SeaPageAppearance())
            .environment(\.seaAppearanceOverride, sea)
            .environment(app)
            .environment(account)
        }
    }

    private func capture<Content: View>(
        _ name: String, width: CGFloat, height: CGFloat,
        annotate: Bool = true,
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
        .environment(\.colorScheme, .light)
        .environment(\.locale, Locale(identifier: "en"))
        .transaction { transaction in
            transaction.animation = nil
            transaction.disablesAnimations = true
        }
        let host = NSHostingView(rootView: root)
        let rect = NSRect(x: 0, y: 0, width: width, height: height)
        let window = NSWindow(contentRect: rect, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .aqua)
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
        XCTAssertEqual(minimumAlpha, 1, "\(name): incomplete offscreen capture, not native visual acceptance")
        let png = try XCTUnwrap(bitmap?.representation(using: .png, properties: [:]))
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
        if name == "dashboard-sea-blocked-minimum"
            || name == "dashboard-sea-blocked-paused-recovery-minimum" {
            let environment = ProcessInfo.processInfo.environment
            if environment["CI"] == "true" && environment["GITHUB_ACTIONS"] == "true"
                && environment["RUNNER_OS"] == "macOS" {
                await captureNativeWindowDiagnostic(name, window: window, folder: folder)
            }
        }
    }

    /// One-shot WindowServer evidence for the synthetic test window only. An
    /// unavailable capture is recorded, never treated as an offscreen pass.
    private func captureNativeWindowDiagnostic(_ name: String, window: NSWindow, folder: URL) async {
        var receipt = ["name=\(name)", "api=ScreenCaptureKit independent window"]
        defer {
            let data = Data((receipt.joined(separator: "\n") + "\n").utf8)
            let url = folder.appendingPathComponent(name + "-native-window.txt")
            do {
                try data.write(to: url, options: .atomic)
            } catch {
                NSLog("native-window receipt write failed: %@", String(reflecting: error))
            }
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.plain-text")
            attachment.name = name + "-native-window-receipt"
            attachment.lifetime = .keepAlways
            add(attachment)
            NSLog("native-window diagnostic: %@", receipt.joined(separator: " | "))
        }

        let expectedPID = ProcessInfo.processInfo.processIdentifier
        receipt.append("windowNumber=\(window.windowNumber) processID=\(expectedPID) visible=\(window.isVisible) frame=\(window.frame)")
        guard window.windowNumber > 0, window.isVisible,
              window.frame.width == 660, window.frame.height == 540 else {
            receipt.append("capture=skipped: synthetic window not visible at 660x540")
            return
        }
        let expectedID = CGWindowID(window.windowNumber)

        do {
            let content: SCShareableContent = try await withCheckedThrowingContinuation { continuation in
                SCShareableContent.getCurrentProcessShareableContent { content, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if let content {
                        continuation.resume(returning: content)
                    } else {
                        continuation.resume(throwing: NSError(domain: "TonoNativeWindowDiagnostic", code: 1,
                            userInfo: [NSLocalizedDescriptionKey: "current-process shareable content was nil without an error"]))
                    }
                }
            }
            guard let target = content.windows.first(where: {
                $0.windowID == expectedID && $0.owningApplication?.processID == expectedPID
            }) else {
                receipt.append("capture=skipped: exact windowID/processID not present in current-process shareable content")
                return
            }
            receipt.append("shareableWindowID=\(target.windowID) ownerPID=\(target.owningApplication?.processID ?? -1) onScreen=\(target.isOnScreen) frame=\(target.frame)")
            guard target.isOnScreen, target.frame.width == 660, target.frame.height == 540 else {
                receipt.append("capture=skipped: matching window not on screen at 660x540")
                return
            }
            let filter = SCContentFilter(desktopIndependentWindow: target)
            let configuration = SCStreamConfiguration()
            configuration.width = 660
            configuration.height = 540
            configuration.showsCursor = false
            let image: CGImage = try await withCheckedThrowingContinuation { continuation in
                SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else if let image {
                        continuation.resume(returning: image)
                    } else {
                        continuation.resume(throwing: NSError(domain: "TonoNativeWindowDiagnostic", code: 2,
                            userInfo: [NSLocalizedDescriptionKey: "independent-window capture returned nil without an error"]))
                    }
                }
            }
            guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
                receipt.append("capture=failed: CGImage could not be encoded as PNG")
                return
            }
            let url = folder.appendingPathComponent(name + "-native-window.png")
            try png.write(to: url, options: .atomic)
            let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
            attachment.name = name + "-native-window"
            attachment.lifetime = .keepAlways
            add(attachment)
            receipt.append("capture=saved path=\(url.path) pixels=\(image.width)x\(image.height) bytes=\(png.count)")
        } catch {
            let failure = error as NSError
            receipt.append("capture=failed: domain=\(failure.domain) code=\(failure.code) reason=\(failure.localizedDescription) userInfo=\(failure.userInfo)")
        }
    }
}
