import AppKit
import QuartzCore
import Darwin
import ImageIO
import ScreenCaptureKit
import SwiftUI
import XCTest
@testable import Tono

/// Whole production ContentView, not a detail-column surrogate. Only synthetic account/state;
/// no connect/disconnect/restore handlers are invoked and no other process is captured.
@MainActor
final class MacSeaPolishRenderTests: XCTestCase {
    private let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("test-results/renders", isDirectory: true)

    func testWholeWindowStatesAndAccessibility() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TONO_HOSTED_WINDOW_DIAGNOSTIC"] == "1",
                          "whole-window evidence runs on the hosted macOS WindowServer")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let language = Locale.preferredLanguages.first?.hasPrefix("zh") == true ? "zh" : "en"
        let fixture = try makeFixture()
        defer { fixture.clean() }
        for size in [CGSize(width: 920, height: 600), CGSize(width: 1280, height: 720)] {
            let (window, _) = makeWindow(size: size, app: fixture.app, account: fixture.account, reduceMotion: true)
            defer { close(window) }
            for state in ["idle", "connecting-early", "connecting-middle", "connecting-late", "connected", "failed", "blocked"] {
                set(state, app: fixture.app)
                await settle(0.15)
                try await capture("polish-a-\(language)-\(Int(size.width))-\(state)", window: window)
            }
            set("idle", app: fixture.app)
            for page in [AppPage.proxies, .activity, .logs, .support, .settings] {
                fixture.app.selectedPage = page
                await settle(0.2)
                try await capture("polish-a-\(language)-\(Int(size.width))-page-\(page.rawValue)", window: window)
            }
        }
        fixture.app.selectedPage = .dashboard
        set("connected", app: fixture.app)
        for option in ["reduce-motion", "reduce-transparency", "increase-contrast"] {
            let (window, _) = makeWindow(size: CGSize(width: 920, height: 600), app: fixture.app,
                account: fixture.account, reduceMotion: option == "reduce-motion",
                reduceTransparency: option == "reduce-transparency", highContrast: option == "increase-contrast")
            defer { close(window) }
            for page in [AppPage.dashboard, .activity] {
                fixture.app.selectedPage = page
                await settle(0.2)
                try await capture("polish-a-\(language)-\(option)-\(page.rawValue)", window: window)
            }
        }
    }

    func testFullTransitionsWaterAndProcessCPU() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TONO_HOSTED_WINDOW_DIAGNOSTIC"] == "1",
                          "native animation evidence requires the hosted WindowServer")
        // English run produces the shared animation/performance evidence once.
        try XCTSkipUnless(Locale.preferredLanguages.first?.hasPrefix("zh") != true, "shared motion evidence is in the English run")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let old = AppProfile.defaults.object(forKey: SeaAppearance.motionKey)
        AppProfile.defaults.set("Full", forKey: SeaAppearance.motionKey)
        defer {
            if let old { AppProfile.defaults.set(old, forKey: SeaAppearance.motionKey) }
            else { AppProfile.defaults.removeObject(forKey: SeaAppearance.motionKey) }
        }
        let fixture = try makeFixture()
        defer { fixture.clean() }
        let (window, host) = makeWindow(size: CGSize(width: 920, height: 600), app: fixture.app, account: fixture.account)
        defer { close(window) }
        var receipt = ["source=first native own-PID ScreenCaptureKit window; PNGs unmodified",
                       "quality=Full skyDecorationsMayChange=true lowPower=\(ProcessInfo.processInfo.isLowPowerModeEnabled)",
                       "host=\(ProcessInfo.processInfo.operatingSystemVersionString) processors=\(ProcessInfo.processInfo.processorCount)"]
        #if arch(arm64)
        receipt.append("architecture=arm64")
        #else
        receipt.append("architecture=non-arm64 CPU budget NOT ACCEPTED as Apple-silicon evidence")
        #endif
        defer { try? receipt.joined(separator: "\n").write(to: folder.appendingPathComponent("polish-a-motion-receipt.txt"), atomically: true, encoding: .utf8) }
        await settle(0.3)
        // CPU sampling excludes capture, encoding, analysis and the bounded Auto display-link probe.
        for state in ["idle", "connected"] {
            set(state, app: fixture.app)
            await settle(7)
            let t = CACurrentMediaTime(), cpu = cpuTime()
            await settle(5)
            let percent = 100 * (cpuTime() - cpu) / (CACurrentMediaTime() - t)
            receipt.append("CPU visible state=\(state) ownProcessUserPlusSystem oneCorePercent=\(percent) interval=5s captureDuringSample=false")
            let pairStart = CACurrentMediaTime()
            for index in 0...1 {
                if index == 1 { await settle(max(0, pairStart + 0.5 - CACurrentMediaTime())) }
                receipt.append("water state=\(state) index=\(index) beforeCaptureSeconds=\(CACurrentMediaTime() - pairStart)")
                try await capture("polish-a-water-\(state)-\(index)", window: window)
                receipt.append("water state=\(state) index=\(index) afterCaptureSeconds=\(CACurrentMediaTime() - pairStart)")
            }
        }
        let scene = try XCTUnwrap(findScene(host))
        window.orderOut(nil)
        await settle(0.3)
        XCTAssertEqual(scene.layer?.sublayers?.first?.speed, 0, "hidden windows hold all compositor clocks")
        let t = CACurrentMediaTime(), cpu = cpuTime()
        await settle(5)
        receipt.append("CPU hidden ownProcessUserPlusSystem oneCorePercent=\(100 * (cpuTime() - cpu) / (CACurrentMediaTime() - t)) interval=5s")
        window.orderFront(nil)
        await settle(0.3)
        XCTAssertEqual(scene.layer?.sublayers?.first?.speed, 1)
        for (name, from, to, duration) in [("rise", "idle", "connecting-middle", 2.6),
                                          ("arrival", "connecting-late", "connected", 2.6),
                                          ("set", "connected", "idle", 6.6)] {
            set(from, app: fixture.app)
            await settle(7)
            let start = CACurrentMediaTime()
            set(to, app: fixture.app)
            for index in 0..<16 {
                let deadline = start + duration * Double(index) / 15
                await settle(max(0, deadline - CACurrentMediaTime()))
                let timestamp = CACurrentMediaTime() - start
                try await capture("polish-a-\(name)-\(String(format: "%02d", index))", window: window)
                receipt.append("frame transition=\(name) index=\(index) beforeCaptureSeconds=\(timestamp) afterCaptureSeconds=\(CACurrentMediaTime() - start)")
            }
        }
        // Navigation hides, but does not replace, the scene or replay its phase transition.
        fixture.app.selectedPage = .activity
        await settle(0.2)
        XCTAssertTrue(findScene(host) === scene)
        XCTAssertEqual(scene.layer?.sublayers?.first?.speed, 0)
        fixture.app.selectedPage = .dashboard
        await settle(0.2)
        XCTAssertTrue(findScene(host) === scene)
        XCTAssertEqual(scene.layer?.sublayers?.first?.speed, 1)
    }

    private struct FixtureState {
        let app: AppState
        let account: AccountSession
        let defaults: UserDefaults
        let suite: String
        func clean() {
            defaults.removePersistentDomain(forName: suite)
            ManagedExitCatalogOwnership.purge()
        }
    }

    private func makeFixture() throws -> FixtureState {
        let suite = "tono-polish-a-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let app = AppState()
        app.routePreferences = LocalRoutePreferences(defaults: defaults)
        let account = AccountSession(sidecar: TonoSidecarService(), descriptorConsumer: { _ in }, killSwitchDisarmConsumer: {})
        account.user = try JSONDecoder().decode(TonoUser.self, from: Data(#"{"id":"synthetic-polish-a","email":"fixture@example.test"}"#.utf8))
        account.state = .ready
        ManagedExitCatalogOwnership.adopt(try XCTUnwrap(account.user?.id))
        let node = Fixture.realityNode()
        app.proxyRegions = [.init(id: AppState.managedCatalogRegionID, name: "Tono", nodes: [node])]
        app.activeNode = node
        app.selectedNodeId = node.id
        app.proxyService.activeNodeName = node.name
        return .init(app: app, account: account, defaults: defaults, suite: suite)
    }

    private func set(_ state: String, app: AppState) {
        app.isConnecting = false
        app.isConnected = false
        app.isProtectionBlocked = false
        app.lastConnectionFailure = nil
        app.completedConnectionStages = []
        if state.hasPrefix("connecting") {
            app.isConnecting = true
            app.connectionStage = state.hasSuffix("early") ? .preparing : state.hasSuffix("middle") ? .lockingTraffic : .verifyingTraffic
            let index = ConnectionStage.allCases.firstIndex(of: app.connectionStage) ?? 0
            app.completedConnectionStages = Set(ConnectionStage.allCases.prefix(index))
        } else if state == "connected" {
            app.isConnected = true
        } else if state == "blocked" {
            app.isProtectionBlocked = true
        } else if state == "failed" {
            app.lastConnectionFailure = .init(stage: .checkingExit,
                message: "Synthetic fixture: exit unreachable. Direct internet is available.", occurredAt: Date())
        }
    }

    private func makeWindow(size: CGSize, app: AppState, account: AccountSession,
                            reduceMotion: Bool = false, reduceTransparency: Bool = false,
                            highContrast: Bool = false) -> (NSWindow, NSView) {
        let root = ContentView().environment(app).environment(account)
            .environmentObject(AppUpdater(enabled: false))
            .environment(\.seaAppearanceOverride, true)
            .environment(\.seaDecorationsOverride, !reduceTransparency && !highContrast)
            .environment(\.accessibilityReduceMotion, reduceMotion)
            .environment(\.accessibilityReduceTransparency, reduceTransparency)
            .environment(\.colorSchemeContrast, highContrast ? .increased : .standard)
            .environment(\.colorScheme, .dark)
            .environment(\.locale, Locale(identifier: Locale.preferredLanguages.first ?? "en"))
        let window = NSWindow(contentRect: CGRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.setFrame(CGRect(x: 80, y: 80, width: size.width, height: size.height), display: false)
        window.title = "Tono"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(srgbRed: 10 / 255, green: 10 / 255, blue: 18 / 255, alpha: 1)
        window.isOpaque = true
        window.appearance = NSAppearance(named: .darkAqua)
        let host = NSHostingView(rootView: root)
        window.contentView = host
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        return (window, host)
    }

    private func close(_ window: NSWindow) {
        window.orderOut(nil)
        window.contentView = nil
        window.close()
    }

    private func findScene(_ view: NSView) -> SeaSceneNativeView? {
        if let scene = view as? SeaSceneNativeView { return scene }
        return view.subviews.compactMap(findScene).first
    }

    private func settle(_ seconds: Double) async {
        if seconds > 0 { try? await Task.sleep(for: .seconds(seconds)) }
    }

    private func cpuTime() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        return Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec)
            + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1_000_000
    }

    @discardableResult
    private func capture(_ name: String, window: NSWindow) async throws -> CGImage {
        let pid = ProcessInfo.processInfo.processIdentifier
        let expectedID = CGWindowID(window.windowNumber)
        let shareable: SCShareableContent = try await nativeWindowRequest("polish current-process windows", timeout: 10) { complete in
            SCShareableContent.getCurrentProcessShareableContent { content, error in
                if let error { complete(.failure(error)) }
                else if let content { complete(.success(content)) }
                else { complete(.failure(NSError(domain: "MacSeaPolishRender", code: 1))) }
            }
        }
        let target = try XCTUnwrap(shareable.windows.first { $0.windowID == expectedID && $0.owningApplication?.processID == pid })
        XCTAssertTrue(target.isOnScreen)
        XCTAssertEqual(target.frame.size, window.frame.size)
        let filter = SCContentFilter(desktopIndependentWindow: target)
        let config = SCStreamConfiguration()
        config.width = Int(window.frame.width)
        config.height = Int(window.frame.height)
        config.showsCursor = false
        let image: CGImage = try await nativeWindowRequest("polish exact window image", timeout: 10) { complete in
            SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, error in
                if let error { complete(.failure(error)) }
                else if let image { complete(.success(image)) }
                else { complete(.failure(NSError(domain: "MacSeaPolishRender", code: 2))) }
            }
        }
        XCTAssertEqual(image.width, config.width)
        XCTAssertEqual(image.height, config.height)
        let data = try XCTUnwrap(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
        try data.write(to: folder.appendingPathComponent(name + ".png"), options: .atomic)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.png")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        let receipt = "source=first own-PID native window PNG; windowID=\(expectedID) ownerPID=\(pid) frame=\(target.frame) dimensions=\(image.width)x\(image.height) language=\(Locale.preferredLanguages) lowPower=\(ProcessInfo.processInfo.isLowPowerModeEnabled)\n"
        try receipt.write(to: folder.appendingPathComponent(name + ".txt"), atomically: true, encoding: .utf8)
        return image
    }
}
