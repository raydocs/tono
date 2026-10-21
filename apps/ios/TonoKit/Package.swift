// swift-tools-version:5.9
// Portable Tono iOS core: catalog admission, the sing-box configuration, the route explainer,
// the control-plane client and the connection state model. Foundation only, so `swift test`
// runs on Linux CI as well as in Xcode; the App and the PacketTunnel extension both link it.
import PackageDescription

let package = Package(
    name: "TonoKit",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "TonoKit", targets: ["TonoKit"]),
        .executable(name: "tono-config", targets: ["TonoConfigTool"]),
    ],
    targets: [
        .target(name: "TonoKit"),
        .executableTarget(name: "TonoConfigTool", dependencies: ["TonoKit"]),
        .testTarget(name: "TonoKitTests", dependencies: ["TonoKit"]),
    ]
)
