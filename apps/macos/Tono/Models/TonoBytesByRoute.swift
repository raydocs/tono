/// The route-byte wire shape accepted by `telemetry/windows`.
/// Kept independent of the UI ledger so policy/runtime tools can compile the
/// API models without importing application services.
nonisolated struct TonoBytesByRoute: Encodable, Equatable, Sendable {
    let cloud: Int64
    let residential: Int64
    let direct: Int64
}
