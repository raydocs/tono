// swift-tools-version:5.9
import PackageDescription

// test-traffic-monitor.sh stages the actual App source here (it links no libbox). Tests inject the
// connection and clock at the production boundary.
let package = Package(name: "TrafficMonitorHarness", platforms: [.macOS(.v13)],
    dependencies: [.package(path: "TonoKit")], targets: [
    .target(name: "TrafficMonitor", dependencies: [.product(name: "TonoKit", package: "TonoKit")]),
    .testTarget(name: "TrafficMonitorTests", dependencies: ["TrafficMonitor", .product(name: "TonoKit", package: "TonoKit")]),
])
