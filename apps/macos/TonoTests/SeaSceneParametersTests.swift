import XCTest
import AppKit
import SwiftUI
@testable import Tono

final class SeaSceneParametersTests: XCTestCase {
    func testReducedMotionKeepsPressedPillsAtUnitScale() {
        XCTAssertEqual(SeaHomePresentation.pressScale(pressed: true, reduceMotion: true), 1)
        XCTAssertEqual(SeaHomePresentation.pressScale(pressed: false, reduceMotion: true), 1)
        XCTAssertLessThan(SeaHomePresentation.pressScale(pressed: true, reduceMotion: false), 1)
    }

    @MainActor
    func testHomeLatencyReadingExpiresWithoutAnotherSampleOrInteraction() async throws {
        let sample = (node: "Tokyo", ms: 83, at: Date().addingTimeInterval(-118))
        let host = NSHostingView(rootView: SeaHomeLatencyReading(sample: sample, name: "Tokyo", failed: false))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 60),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        defer { window.orderOut(nil); window.contentView = nil; window.close() }
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        XCTAssertGreaterThan(host.fittingSize.width, 0, "fresh sample is initially rendered")
        try await Task.sleep(for: .milliseconds(2300))
        host.layoutSubtreeIfNeeded()
        XCTAssertEqual(host.fittingSize.width, 0, "expiry itself must invalidate the visible reading")
        XCTAssertNil(SeaHomePresentation.freshExitDelay(sample, for: "Tokyo", failed: false))
    }

    func testOnlyRealConnectingStagesAdvanceTheSun() {
        XCTAssertEqual(SeaSceneParameters.progress(for: .preparing), 0)
        XCTAssertEqual(SeaSceneParameters.progress(for: .verifyingTraffic), 1)
        let early = SeaSceneParameters.forPhase(.dawn, progress: SeaSceneParameters.progress(for: .startingTunnel))
        let late = SeaSceneParameters.forPhase(.dawn, progress: SeaSceneParameters.progress(for: .checkingExit))
        XCTAssertGreaterThan(early.offset, late.offset)
        XCTAssertEqual(SeaSceneParameters.forPhase(.dawn, progress: .nan).offset,
                       SeaSceneParameters.forPhase(.dawn).offset)
        XCTAssertEqual(SeaSceneParameters.forPhase(.dawn, progress: -1).offset, 205)
        XCTAssertEqual(SeaSceneParameters.forPhase(.dawn, progress: 2).offset, 55)
    }

    func testMotionAndPowerOverridesHaveDifferentQualities() {
        XCTAssertEqual(SeaSceneQuality.requested("Full", reduceMotion: true, lowPower: false, automatic: .full), .static)
        XCTAssertEqual(SeaSceneQuality.requested("Full", reduceMotion: false, lowPower: true, automatic: .full), .lite)
        XCTAssertEqual(SeaSceneQuality.requested("Lite", reduceMotion: false, lowPower: false, automatic: .full), .lite)
        XCTAssertEqual(SeaSceneQuality.requested("Simple", reduceMotion: false, lowPower: false, automatic: .full), .lite)
        XCTAssertEqual(SeaSceneQuality.requested("Static", reduceMotion: false, lowPower: false, automatic: .full), .static)
        XCTAssertEqual(SeaSceneQuality.requested("Auto", reduceMotion: false, lowPower: false, automatic: .lite), .lite)
    }

    func testAutoProbeDowngradesAndStopsAfterItsVisibleBudget() {
        var probe = SeaSceneQualityProbe()
        probe.frame(at: 0)
        for index in 1...32 { probe.frame(at: Double(index) * 0.05) }
        XCTAssertEqual(probe.quality, .lite)
        probe.pause()
        probe.frame(at: 100)
        XCTAssertLessThan(probe.elapsed, 1700, "occlusion is not counted as a dropped frame")
        for index in 1...30 { probe.frame(at: 100 + Double(index) * 0.06) }
        XCTAssertEqual(probe.quality, .static)
        XCTAssertTrue(probe.complete)
        let elapsed = probe.elapsed
        probe.frame(at: 200)
        XCTAssertEqual(probe.elapsed, elapsed, "there is no lasting per-frame sample after the bounded probe")
    }

    @MainActor
    func testWaterTrafficRisesWithLiveRatesThenDecaysOnceTheReadingFreezes() {
        var traffic = SeaWaterTraffic()
        for frame in 0..<120 { traffic.advance(.init(up: 0, down: 2_000_000 + Int64(frame / 60)), dt: 1.0 / 60) }
        XCTAssertGreaterThan(traffic.level, 0.5)
        XCTAssertLessThanOrEqual(traffic.level, 1)
        for _ in 0..<600 { traffic.advance(.init(up: 0, down: 2_000_001), dt: 1.0 / 60) }
        XCTAssertLessThan(traffic.level, 0.05, "a reading frozen past the 1 s feed cadence is stale and decays")
    }

    func testLowPowerPausesAutomaticSamplingWithoutPromotingMeasuredStatic() {
        let probe = SeaSceneQualityProbe()
        XCTAssertTrue(probe.canSample(preference: "Auto", reduceMotion: false, lowPower: false))
        XCTAssertFalse(probe.canSample(preference: "Auto", reduceMotion: false, lowPower: true),
                       "a power-forced Lite scene must not be measured as Full")
        XCTAssertEqual(SeaSceneQuality.requested("Auto", reduceMotion: false, lowPower: true, automatic: .static), .static)
        XCTAssertEqual(SeaSceneQuality.requested("Full", reduceMotion: false, lowPower: true, automatic: .full), .lite)
    }

    func testHomeLatencyOnlyShowsRecentMatchingSuccessfulSamples() {
        let now = Date(timeIntervalSince1970: 1000)
        let sample = (node: "Tokyo", ms: 83, at: now.addingTimeInterval(-30))
        XCTAssertEqual(SeaHomePresentation.freshExitDelay(sample, for: "Tokyo", failed: false, now: now), 83)
        XCTAssertNil(SeaHomePresentation.freshExitDelay(sample, for: "Seattle", failed: false, now: now))
        XCTAssertNil(SeaHomePresentation.freshExitDelay(sample, for: "Tokyo", failed: true, now: now))
        XCTAssertNil(SeaHomePresentation.freshExitDelay(sample, for: "Tokyo", failed: false, now: now.addingTimeInterval(200)))
        XCTAssertNil(SeaHomePresentation.freshExitDelay(sample, for: "Tokyo", failed: false, now: now.addingTimeInterval(-40)))
        XCTAssertNil(SeaHomePresentation.freshExitDelay(nil, for: "Tokyo", failed: false, now: now))
    }

}
