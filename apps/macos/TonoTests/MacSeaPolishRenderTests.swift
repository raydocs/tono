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
        let old = AppProfile.defaults.object(forKey: SeaAppearance.motionKey)
        AppProfile.defaults.set("Full", forKey: SeaAppearance.motionKey)
        defer {
            if let old { AppProfile.defaults.set(old, forKey: SeaAppearance.motionKey) }
            else { AppProfile.defaults.removeObject(forKey: SeaAppearance.motionKey) }
        }
        for size in [CGSize(width: 920, height: 600), CGSize(width: 1280, height: 720)] {
            for state in ["idle", "connecting-early", "connecting-middle", "connecting-late", "connected", "failed", "blocked"] {
                set(state, app: fixture.app)
                // An initial Full mount has the real destination plus live loops, not a
                // Reduce Motion stand-in or a manufactured wait for an earlier transition.
                let (window, _) = try await makeWindow(size: size, app: fixture.app, account: fixture.account)
                defer { close(window) }
                await settle(0.3)
                try await capture("polish-a-\(language)-\(Int(size.width))-\(state)", window: window)
            }
            set("idle", app: fixture.app)
            for page in [AppPage.proxies, .activity, .logs, .support, .settings] {
                fixture.app.selectedPage = page
                let (window, _) = try await makeWindow(size: size, app: fixture.app, account: fixture.account)
                defer { close(window) }
                await settle(0.5)
                try await capture("polish-a-\(language)-\(Int(size.width))-page-\(page.rawValue)", window: window)
            }
        }
        fixture.app.selectedPage = .dashboard
        set("connected", app: fixture.app)
        for option in ["reduce-motion", "reduce-transparency", "increase-contrast"] {
            fixture.app.selectedPage = .dashboard
            let (window, _) = try await makeWindow(size: CGSize(width: 920, height: 600), app: fixture.app,
                account: fixture.account, reduceMotion: option == "reduce-motion",
                reduceTransparency: option == "reduce-transparency", highContrast: option == "increase-contrast")
            defer { close(window) }
            for page in [AppPage.dashboard, .activity] {
                fixture.app.selectedPage = page
                await settle(0.6)
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
        let (window, host) = try await makeWindow(size: CGSize(width: 920, height: 600), app: fixture.app, account: fixture.account)
        defer { close(window) }
        var receipt = ["source=first native own-PID ScreenCaptureKit window; PNGs unmodified",
                       "quality=Full skyDecorationsMayChange=true lowPower=\(ProcessInfo.processInfo.isLowPowerModeEnabled)",
                       "host=\(ProcessInfo.processInfo.operatingSystemVersionString) processors=\(ProcessInfo.processInfo.processorCount)",
                       "CPU scope=synthetic native UI host, no live-network/helper load; not production connected-device CPU acceptance"]
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
            try await capture("polish-a-water-\(state)-preflight", window: window)
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
                                          ("set", "connected", "idle", 6.0)] {
            set(from, app: fixture.app)
            await settle(7)
            try await capture("polish-a-\(name)-preflight", window: window)
            let start = CACurrentMediaTime()
            set(to, app: fixture.app)
            for index in 0..<16 {
                let deadline = start + duration * Double(index) / 15
                await settle(max(0, deadline - CACurrentMediaTime()))
                let timestamp = CACurrentMediaTime() - start
                try await capture("polish-a-\(name)-\(String(format: "%02d", index))", window: window)
                receipt.append("frame transition=\(name) index=\(index) beforeCaptureSeconds=\(timestamp) afterCaptureSeconds=\(CACurrentMediaTime() - start)")
            }
            if name == "set" {
                await settle(max(0, start + 7 - CACurrentMediaTime()))
                try await capture("polish-a-set-night-reference", window: window)
                receipt.append("setNightReferenceSeconds=\(CACurrentMediaTime() - start) phase=night canonicalNightHandoffSeconds=6")
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
        app.selectedPage = .dashboard
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
                            highContrast: Bool = false) async throws -> (NSWindow, NSView) {
        let root = ContentView().environment(app).environment(account)
            .environmentObject(AppUpdater(enabled: false))
            .environment(\.seaAppearanceOverride, true)
            .environment(\.seaDecorationsOverride, !reduceTransparency && !highContrast)
            .environment(\.seaDisplayOverride, SeaDisplayOptions(reduceMotion: reduceMotion,
                reduceTransparency: reduceTransparency, contrast: highContrast ? .increased : .standard))
            .environment(\.colorScheme, .dark)
            .environment(\.locale, Locale(identifier: Locale.preferredLanguages.first ?? "en"))
        let window = MacSeaPolishWindow(contentRect: CGRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.requestedSize = size
        var ready = false
        defer { if !ready { close(window) } }
        window.setFrame(CGRect(x: 80, y: 80, width: size.width, height: size.height), display: false)
        window.title = "Tono"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(srgbRed: 10 / 255, green: 10 / 255, blue: 18 / 255, alpha: 1)
        window.isOpaque = true
        window.hasShadow = false
        window.appearance = NSAppearance(named: .darkAqua)
        let host = NSHostingView(rootView: root)
        // The hosted display is 1024 wide. Capture the native window surface at
        // the requested size, not a display-constrained or content-autosized proxy.
        host.sizingOptions = []
        // Top-level NSHostingView also updates NSWindow sizing. A manual
        // fixed-surface fixture does not own the production WindowGroup's
        // sizing policy; mount the unchanged view into a normal AppKit surface.
        let surface = NSView(frame: CGRect(origin: .zero, size: size))
        host.frame = surface.bounds
        host.autoresizingMask = [.width, .height]
        surface.addSubview(host)
        window.hostedView = host
        window.contentView = surface
        recordGeometry(window, stage: "mounted-before-toolbar-layout")
        window.setFrame(CGRect(x: 80, y: 80, width: size.width, height: size.height), display: false)
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        // NavigationSplitView installs its toolbar during the first layout;
        // AppKit may preserve the content size by growing the outer frame then.
        recordGeometry(window, stage: "after-toolbar-first-layout")
        sizeNativeWindow(window, outerSize: size)
        host.layoutSubtreeIfNeeded()
        recordGeometry(window, stage: "after-AppKit-content-size-layout")
        // Toolbar installation and WindowServer registration are asynchronous.
        // Wait for published metadata, never retry/replace a captured image.
        _ = try await registeredWindow(window)
        XCTAssertEqual(window.frame.size, size, "whole-window evidence must use its requested native dimensions")
        ready = true
        return (window, host)
    }

    private func close(_ window: NSWindow) {
        window.orderOut(nil)
        window.contentView = nil
        window.close()
    }

    private func sizeNativeWindow(_ window: NSWindow, outerSize: CGSize) {
        // Use the instance conversion after its native toolbar is installed;
        // frame/content chrome is not a hard-coded correction in points.
        let outer = CGRect(origin: window.frame.origin, size: outerSize)
        let content = window.contentRect(forFrameRect: outer)
        window.setContentSize(content.size)
    }

    private func recordGeometry(_ window: NSWindow, stage: String) {
        let host = (window as? MacSeaPolishWindow)?.hostedView
        let line = "stage=\(stage) windowID=\(window.windowNumber) frame=\(window.frame) contentRect=\(window.contentRect(forFrameRect: window.frame)) layoutRect=\(window.contentLayoutRect) minSize=\(window.minSize) contentMinSize=\(window.contentMinSize) contentMaxSize=\(window.contentMaxSize) surfaceFrame=\(String(describing: window.contentView?.frame)) hostFrame=\(String(describing: host?.frame)) hostBounds=\(String(describing: host?.bounds)) hostFitting=\(String(describing: host?.fittingSize)) safeArea=\(String(describing: host?.safeAreaInsets)) toolbar=\(window.toolbar != nil) toolbarStyle=\(window.toolbarStyle.rawValue)\n"
        let url = folder.appendingPathComponent("polish-a-window-geometry-\(window.windowNumber).txt")
        let previous = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        try? (previous + line).write(to: url, atomically: true, encoding: .utf8)
        print("polish native geometry: \(line)", terminator: "")
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
        let registration = try await registeredWindow(window)
        let target = registration.target
        let expectedID = target.windowID
        let requestedSize = try XCTUnwrap((window as? MacSeaPolishWindow)?.requestedSize)
        XCTAssertNotNil(window.toolbar, "whole-window evidence must retain the native split-view toolbar")
        XCTAssertEqual(expectedID, CGWindowID(window.windowNumber))
        XCTAssertEqual(registration.windowServerFrame.size, requestedSize)
        XCTAssertEqual(window.frame.size, requestedSize)
        let host = try XCTUnwrap((window as? MacSeaPolishWindow)?.hostedView)
        XCTAssertEqual(host.frame, window.contentView?.bounds, "unchanged production view must fill the actual native surface")
        let filter = SCContentFilter(desktopIndependentWindow: target)
        let config = SCStreamConfiguration()
        config.width = Int(requestedSize.width)
        config.height = Int(requestedSize.height)
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        let image: CGImage = try await nativeWindowRequest("polish exact window image", timeout: 10) { complete in
            SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) { image, error in
                if let error { complete(.failure(error)) }
                else if let image { complete(.success(image)) }
                else { complete(.failure(NSError(domain: "MacSeaPolishRender", code: 2))) }
            }
        }
        XCTAssertEqual(window.frame.size, requestedSize, "native surface must not resize during capture")
        XCTAssertEqual(image.width, config.width)
        XCTAssertEqual(image.height, config.height)
        let data = try XCTUnwrap(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
        try data.write(to: folder.appendingPathComponent(name + ".png"), options: .atomic)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.png")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        let receipt = "source=first own-PID native window PNG; mount=fixed-AppKit-surface-not-production-WindowGroup-sizing windowID=\(expectedID) ownerPID=\(pid) windowServerOnScreen=true windowServerFrame=\(registration.windowServerFrame) SCFrame=\(target.frame) SCOnScreen=\(target.isOnScreen) requested=\(requestedSize) hostFrame=\(host.frame) sceneBounds=\(String(describing: findScene(host)?.bounds)) toolbar=\(window.toolbar != nil) dimensions=\(image.width)x\(image.height) registrationAttempts=\(registration.attempts) metadataBeforeImage=true language=\(Locale.preferredLanguages) lowPower=\(ProcessInfo.processInfo.isLowPowerModeEnabled) accessibilitySource=shared-presentation-inputs-not-host-OS-mutation\n"
        try receipt.write(to: folder.appendingPathComponent(name + ".txt"), atomically: true, encoding: .utf8)
        return image
    }

    private func registeredWindow(_ window: NSWindow) async throws -> (target: SCWindow, windowServerFrame: CGRect, attempts: Int) {
        let size = try XCTUnwrap((window as? MacSeaPolishWindow)?.requestedSize)
        let pid = ProcessInfo.processInfo.processIdentifier
        let deadline = CACurrentMediaTime() + 5
        var attempts = 0, last = "unpublished"
        while CACurrentMediaTime() < deadline {
            attempts += 1
            if window.frame.size != size {
                recordGeometry(window, stage: "registration-\(attempts)-before-size")
                sizeNativeWindow(window, outerSize: size)
                await settle(0.1)
                recordGeometry(window, stage: "registration-\(attempts)-after-size")
            }
            let id = CGWindowID(window.windowNumber)
            let content: SCShareableContent = try await nativeWindowRequest("polish window registration", timeout: max(0.1, deadline - CACurrentMediaTime())) { complete in
                SCShareableContent.getCurrentProcessShareableContent { content, error in
                    if let error { complete(.failure(error)) }
                    else if let content { complete(.success(content)) }
                    else { complete(.failure(NSError(domain: "MacSeaPolishRender", code: 1))) }
                }
            }
            let info = (CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]])?.first {
                ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == id
                    && ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
                    && ($0[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true
            }
            let frame = (info?[kCGWindowBounds as String] as? [String: Any]).flatMap {
                CGRect(dictionaryRepresentation: $0 as CFDictionary)
            }
            last = "SC exactID present=false, WindowServer=\(String(describing: frame)), AppKit=\(window.frame) visible=\(window.isVisible)"
            if let target = content.windows.first(where: { $0.windowID == id && $0.owningApplication?.processID == pid }) {
                last = "SC onScreen=\(target.isOnScreen) frame=\(target.frame), WindowServer=\(String(describing: frame)), AppKit=\(window.frame)"
                if window.isVisible, window.frame.size == size, CGWindowID(window.windowNumber) == id,
                   NativePolishWindowRegistration.matches(windowID: target.windowID,
                    ownerPID: target.owningApplication?.processID, onScreen: target.isOnScreen,
                    frame: target.frame, windowServerFrame: frame,
                    expectedID: id, expectedPID: pid, expectedSize: size), let frame {
                    return (target, frame, attempts)
                }
            }
            await settle(0.1)
        }
        let message = "exact own-PID window \(window.windowNumber) not published at \(size) after \(attempts) metadata requests: \(last)"
        print("polish native registration FAILED: \(message)")
        try? message.write(to: folder.appendingPathComponent("polish-a-registration-failure-\(window.windowNumber).txt"), atomically: true, encoding: .utf8)
        throw NativePolishWindowRegistrationError(message: message)
    }

    func testRegistrationRequiresWindowServerProofForRedactedSCMetadata() {
        let frame = CGRect(x: 80, y: 80, width: 920, height: 600)
        func matches(id: CGWindowID = 10, pid: pid_t = 20, visible: Bool = true,
                     candidate: CGRect? = nil, published: CGRect? = nil, missing: Bool = false) -> Bool {
            NativePolishWindowRegistration.matches(windowID: id, ownerPID: pid, onScreen: visible,
                frame: candidate ?? frame, windowServerFrame: missing ? nil : published ?? frame,
                expectedID: 10, expectedPID: 20, expectedSize: frame.size)
        }
        XCTAssertTrue(matches())
        XCTAssertTrue(matches(visible: false, candidate: .zero), "current-process SC metadata may be redacted; WindowServer must prove this exact surface")
        XCTAssertFalse(matches(visible: false, candidate: .zero, missing: true))
        XCTAssertFalse(matches(visible: false, candidate: .zero, published: .zero))
        XCTAssertFalse(matches(candidate: .zero))
        XCTAssertFalse(matches(visible: false))
        XCTAssertFalse(matches(id: 11))
        XCTAssertFalse(matches(pid: 21))
        XCTAssertFalse(matches(published: CGRect(x: 80, y: 80, width: 920, height: 604)))
    }
}

@MainActor
private final class MacSeaPolishWindow: NSWindow {
    var requestedSize = CGSize.zero
    weak var hostedView: NSView?
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

private enum NativePolishWindowRegistration {
    static func matches(windowID: CGWindowID, ownerPID: pid_t?, onScreen: Bool,
                        frame: CGRect, windowServerFrame: CGRect?, expectedID: CGWindowID,
                        expectedPID: pid_t, expectedSize: CGSize) -> Bool {
        guard windowID == expectedID, ownerPID == expectedPID,
              let windowServerFrame, windowServerFrame.size == expectedSize else { return false }
        // SCShareableContent.h documents redacted current-process information
        // without TCC. The exact own-ID WindowServer query above independently
        // requires own PID + onScreen=true; zero SC geometry is not that proof.
        return (onScreen && frame == windowServerFrame) || (!onScreen && frame == .zero)
    }
}

private struct NativePolishWindowRegistrationError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
