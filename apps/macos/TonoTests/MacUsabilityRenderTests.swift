import AppKit
import ScreenCaptureKit
import SwiftUI
import XCTest
@testable import Tono

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
        let png = try XCTUnwrap(bitmap?.representation(using: .png, properties: [:]))
        let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("test-results/renders", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let nativeOnly = name == "dashboard-sea-blocked-minimum"
            || name == "dashboard-sea-blocked-paused-recovery-minimum"
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
                await captureNativeWindowAcceptance(name, window: window, host: host, folder: folder)
            } else {
                XCTFail("\(name): exact-window native acceptance unavailable; TEST_RUNNER_TONO_HOSTED_WINDOW_DIAGNOSTIC=1 required")
            }
        } else {
            XCTAssertEqual(minimumAlpha, 1, "\(name): incomplete offscreen capture")
            XCTAssertGreaterThan(png.count, 5_000, "capture must contain rendered content, not an empty canvas")
            XCTAssertLessThan(png.count, 4 * 1_024 * 1_024)
        }
    }

    /// Only these two preselected fixtures accept this same-process window image.
    /// Offscreen cacheDisplay output remains separate failed diagnostic evidence.
    private func captureNativeWindowAcceptance(_ name: String, window: NSWindow, host: NSView, folder: URL) async {
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
        guard window.windowNumber > 0, window.isVisible,
              window.frame.width == 660, window.frame.height == 540 else {
            receipt.append("capture=failed: synthetic window not visible at 660x540")
            XCTFail("\(name): synthetic window not visible at 660x540")
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
                  target.frame.width == 660, target.frame.height == 540 else {
                receipt.append("capture=failed: shareable window on-screen/frame mismatch")
                XCTFail("\(name): shareable window on-screen/frame mismatch")
                return
            }
            let filter = SCContentFilter(desktopIndependentWindow: target)
            let configuration = SCStreamConfiguration()
            configuration.width = 660
            configuration.height = 540
            configuration.showsCursor = false
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
            guard image.width == 660, image.height == 540 else {
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
            for y in 0..<bitmap.pixelsHigh {
                for x in 0..<bitmap.pixelsWide {
                    guard bitmap.colorAt(x: x, y: y)?.alphaComponent == 1 else {
                        receipt.append("acceptance=failed: nonopaque pixel at \(x),\(y)")
                        XCTFail("\(name): native image contains a transparent pixel")
                        return
                    }
                }
            }
            guard nativeContentIsVisible(name, host: host, window: window, bitmap: bitmap, receipt: &receipt) else {
                receipt.append("acceptance=failed: fixture content/layout evidence")
                XCTFail("\(name): native image lacks bounded fixture content/layout evidence")
                return
            }
            receipt.append("acceptance=passed: exact window, opaque native PNG and content/layout evidence")
        } catch {
            let failure = error as NSError
            receipt.append("capture=failed: domain=\(failure.domain) code=\(failure.code) reason=\(failure.localizedDescription) userInfo=\(failure.userInfo)")
            XCTFail("\(name): native-window capture unavailable: \(failure.domain) code \(failure.code)")
        }
    }

    /// Public in-process accessibility geometry must agree with visible pixels;
    /// an opaque gradient alone cannot satisfy the Dashboard fixture contract.
    private func nativeContentIsVisible(
        _ name: String, host: NSView, window: NSWindow, bitmap: NSBitmapImageRep,
        receipt: inout [String]
    ) -> Bool {
        var queue: [any NSAccessibility] = [host]
        var visited = Set<ObjectIdentifier>()
        var matches: [String: NSRect] = [:]
        let retryLabel = name == "dashboard-sea-blocked-paused-recovery-minimum"
            ? "Repair and reconnect" : "Retry now"
        let blockedTitle = name == "dashboard-sea-blocked-paused-recovery-minimum"
            ? "Protected Offline · retries paused" : "Protected Offline"
        let required = [blockedTitle, retryLabel, "Restore internet"]
        while !queue.isEmpty && visited.count < 512 {
            let element = queue.removeFirst()
            guard visited.insert(ObjectIdentifier(element as AnyObject)).inserted else { continue }
            let label = element.accessibilityLabel ?? ""
            let stringValue = element.accessibilityValue as? String
            let identifier = element.accessibilityIdentifier ?? ""
            for expected in required where label == expected || stringValue == expected {
                matches[expected] = element.accessibilityFrame
            }
            if identifier == "protectedRecoveryFeedback" {
                matches[identifier] = element.accessibilityFrame
            }
            for child in element.accessibilityChildren ?? [] {
                if let child = child as? any NSAccessibility { queue.append(child) }
            }
        }
        receipt.append("accessibilityNodes=\(visited.count) matched=\(matches.keys.sorted())")
        guard visited.count < 512, required.allSatisfy({ matches[$0] != nil }) else { return false }
        if name == "dashboard-sea-blocked-paused-recovery-minimum",
           matches["protectedRecoveryFeedback"] == nil { return false }
        for key in required + (name == "dashboard-sea-blocked-paused-recovery-minimum" ? ["protectedRecoveryFeedback"] : []) {
            guard let frame = matches[key], frame.width >= 10, frame.height >= 10,
                  window.frame.contains(frame),
                  nativePixelContrast(in: frame, windowFrame: window.frame, bitmap: bitmap) else {
                receipt.append("contentMissingOrBlank=\(key) frame=\(String(describing: matches[key]))")
                return false
            }
            receipt.append("contentVisible=\(key) frame=\(frame)")
        }
        return true
    }

    private func nativePixelContrast(in screenFrame: NSRect, windowFrame: NSRect, bitmap: NSBitmapImageRep) -> Bool {
        let minX = max(0, Int(screenFrame.minX - windowFrame.minX))
        let maxX = min(bitmap.pixelsWide - 1, Int(screenFrame.maxX - windowFrame.minX))
        let minY = max(0, Int(windowFrame.maxY - screenFrame.maxY))
        let maxY = min(bitmap.pixelsHigh - 1, Int(windowFrame.maxY - screenFrame.minY))
        guard maxX > minX, maxY > minY else { return false }
        var low: CGFloat = 1
        var high: CGFloat = 0
        for y in stride(from: minY, through: maxY, by: 2) {
            for x in stride(from: minX, through: maxX, by: 2) {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { return false }
                let luminance = 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
                low = min(low, luminance)
                high = max(high, luminance)
            }
        }
        return high - low >= 0.08
    }
}
