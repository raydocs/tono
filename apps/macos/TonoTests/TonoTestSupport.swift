import Foundation
import XCTest
@testable import Tono

/// Shared fixtures for the owned-runtime tests. Every value here satisfies the
/// production import contract (VLESS over Reality, public IPv4 literal server)
/// so individual tests can mutate exactly one field to prove one rejection.
enum Fixture {
    static let realityPublicKey = String(repeating: "A", count: 43)
    static let realityShortID = "0011223344556677"

    static func realityNode(
        name: String = "US-VLESS-Reality",
        id: String = "us-reality",
        server: String = "203.0.114.7",
        port: Int = 443,
        uuid: String = "00000000-0000-4000-8000-000000000001",
        sni: String = "exit.example.com",
        flag: String = "🇺🇸"
    ) -> ProxyNode {
        var node = ProxyNode(id: id, flag: flag, name: name, type: .vless, server: server, port: port)
        node.uuid = uuid
        node.tls = true
        node.network = "tcp"
        node.sni = sni
        node.realityPublicKey = realityPublicKey
        node.realityShortId = realityShortID
        return node
    }

    static func overlay(
        mixedPort: Int = 7890,
        selectedNodeName: String,
        tunEnabled: Bool = false,
        claudeHomeNodeName: String? = nil,
        defaultNodeName: String? = nil,
        claudeHomeSocks5: TonoExitCatalogHomeSocks5? = nil,
        externalController: String = "127.0.0.1:9090",
        logLevel: String = "info"
    ) -> ConfigPipeline.OverlayConfig {
        var overlay = ConfigPipeline.OverlayConfig()
        overlay.mixedPort = mixedPort
        overlay.externalController = externalController
        overlay.logLevel = logLevel
        overlay.tunEnabled = tunEnabled
        overlay.selectedNodeName = selectedNodeName
        overlay.claudeHomeNodeName = claudeHomeNodeName
        overlay.defaultNodeName = defaultNodeName
        overlay.claudeHomeSocks5 = claudeHomeSocks5
        return overlay
    }

    static func directPolicy(
        physicalInterface: String = "en0",
        domainPins: [ConfigPipeline.DirectDomainPin] = [],
        webDomainPins: [ConfigPipeline.DirectDomainPin] = [],
        webDomainSuffixes: [ConfigPipeline.DirectDomainSuffix] = [],
        mediaEndpoints: [ConfigPipeline.DirectEndpoint] = [],
        tcpEndpoints: [ConfigPipeline.DirectEndpoint] = [],
        directResolverHosts: [String] = []
    ) -> ConfigPipeline.ManagedDirectRuntimePolicy {
        .init(
            physicalInterface: physicalInterface,
            domainPins: domainPins,
            webDomainPins: webDomainPins,
            webDomainSuffixes: webDomainSuffixes,
            mediaEndpoints: mediaEndpoints,
            tcpEndpoints: tcpEndpoints,
            directResolverHosts: directResolverHosts
        )
    }

    /// Builds the owned runtime without touching disk. `generateRuntime` only
    /// adds a `secureWrite`, so every routing assertion belongs here.
    static func ownedRuntime(
        subscriptionYAML: String = "",
        overlay: ConfigPipeline.OverlayConfig,
        transport: TonoTransportDescriptor? = nil,
        nodes: [ProxyNode] = [],
        directPolicy: ConfigPipeline.ManagedDirectRuntimePolicy? = nil
    ) throws -> String {
        try ConfigPipeline.buildOwnedTonoRuntime(
            subscriptionYAML: subscriptionYAML,
            overlay: overlay,
            transport: transport,
            customNodes: nodes,
            directPolicy: directPolicy
        )
    }
}

/// Stable, comparable label for a thrown injection error, including its
/// payload. `TonoInjectionError` is not Equatable, and the payload identifies
/// which validation boundary rejected the input.
func injectionErrorLabel(_ error: Error) -> String {
    guard let error = error as? ConfigPipeline.TonoInjectionError else {
        return "unexpected(\(type(of: error)))"
    }
    switch error {
    case .unsafeDescriptor: return "unsafeDescriptor"
    case .unsafeOverlay: return "unsafeOverlay"
    case .unsafeNode(let field): return "unsafeNode(\(field))"
    case .duplicateNode(let name): return "duplicateNode(\(name))"
    case .missingSelection: return "missingSelection"
    }
}

func XCTAssertThrowsInjectionError<T>(
    _ expected: String,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ expression: () throws -> T
) {
    do {
        _ = try expression()
        XCTFail("expected \(expected) but nothing was thrown", file: file, line: line)
    } catch {
        XCTAssertEqual(injectionErrorLabel(error), expected, file: file, line: line)
    }
}
