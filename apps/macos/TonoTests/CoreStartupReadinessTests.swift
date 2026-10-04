import XCTest
@testable import Tono

@MainActor
final class CoreStartupReadinessTests: XCTestCase {
    private enum Failure: Error { case startRejected }

    func testRejectedStartCancelsAndDrainsPendingControllerReadiness() async {
        let controllerStarted = expectation(description: "controller polling started")
        let controllerFinished = expectation(description: "controller polling drained")
        let returned = expectation(description: "start rejection returned")
        var failure: Error?
        let work = Task {
            do {
                try await CoreStartupReadiness.wait(
                    start: {
                        await self.fulfillment(of: [controllerStarted], timeout: 1)
                        throw Failure.startRejected
                    },
                    controller: {
                        controllerStarted.fulfill()
                        defer { controllerFinished.fulfill() }
                        try await Task.sleep(for: .seconds(30))
                    }
                )
                XCTFail("a rejected start must not pass readiness")
            } catch {
                failure = error
            }
            returned.fulfill()
        }
        await fulfillment(of: [returned, controllerFinished], timeout: 2)
        work.cancel()
        await work.value
        guard let rejection = failure as? Failure, case .startRejected = rejection else {
            return XCTFail("the original start rejection must be preserved")
        }
    }
}
