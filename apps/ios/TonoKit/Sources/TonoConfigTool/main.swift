import Foundation
import TonoKit

// Host-side helper for the checks that do not need Apple tools:
//   tono-config write <dir>        writes the SampleCatalog graphs for `sing-box check` and the route harness
//   tono-config explain <host>...  prints where the sample three-tier graph sends each host
let args = CommandLine.arguments.dropFirst()
switch args.first {
case "write":
    guard let dir = args.dropFirst().first else { fatalError("usage: tono-config write <dir>") }
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    for (name, config) in SampleCatalog.snapshotCases {
        try Data(config.serialized().utf8).write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).json"))
        print("wrote \(name).json")
    }
case "explain":
    let config = SampleCatalog.config()
    for host in args.dropFirst() {
        if let a = RouteExplainer.answer(config: config, catalog: SampleCatalog.catalog(), host: host) {
            print("\(a.host): TCP → \(a.tcp.rawValue) · UDP → \(a.udp.rawValue)")
        } else {
            print("\(host): not a host")
        }
    }
default:
    print("usage: tono-config write <dir> | explain <host>...")
    exit(2)
}
