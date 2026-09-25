import Foundation

/// What one control-plane exchange returned once its status line arrived
/// (#584).
nonisolated struct ControlPlaneAnswer: Sendable {
    let status: Int
    let body: Data
    let bodyFailure: (any Error)?
}

/// One way to reach the control plane (#584).
nonisolated struct ControlPlanePath: Sendable {
    let label: String
    let exchange: @Sendable (URLRequest, Int) async throws -> ControlPlaneAnswer
}
