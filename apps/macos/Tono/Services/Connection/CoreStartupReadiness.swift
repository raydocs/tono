import Foundation

@MainActor
enum CoreStartupReadiness {
    static func wait(
        start: @escaping @MainActor @Sendable () async throws -> Void,
        controller: @escaping @MainActor @Sendable () async throws -> Void
    ) async throws {
        async let started: Void = start()
        async let ready: Void = controller()
        // Poll concurrently, but surface a rejected start before waiting for
        // a controller that cannot exist. Scope exit cancels and drains it.
        try await started
        try await ready
    }
}
