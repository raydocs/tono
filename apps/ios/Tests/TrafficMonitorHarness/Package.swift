// swift-tools-version:5.9
import PackageDescription

// test-traffic-monitor.sh stages the actual App source here; the Libbox shim supplies signatures,
// not connection behavior. Tests inject the connection and clock at the production boundary.
let package = Package(name: "TrafficMonitorHarness", platforms: [.macOS(.v13)],
    dependencies: [.package(path: "TonoKit")], targets: [
    .target(name: "Libbox"),
    .target(name: "TrafficMonitor", dependencies: ["Libbox", .product(name: "TonoKit", package: "TonoKit")]),
    .testTarget(name: "TrafficMonitorTests", dependencies: ["TrafficMonitor", .product(name: "TonoKit", package: "TonoKit")]),
])
