import Foundation

struct CloudUser: Codable, Sendable {
    let id: String
    let email: String
    let deviceLimit: Int?
}

struct CloudDevice: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let current: Bool?
    let status: String?

    // Full server ID avoids collisions even when installs share names or ID prefixes.
    var removalLabel: String { "Remove \(name), device \(id)" }
}

struct CloudSession: Codable, Sendable {
    let accessToken: String
    let refreshToken: String?
    let user: CloudUser
    let device: CloudDevice?
}

struct AuthEnvelope: Decodable {
    let auth: CloudSession
    private enum CodingKeys: String, CodingKey { case auth }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        auth = try values.decodeIfPresent(CloudSession.self, forKey: .auth)
            ?? CloudSession(from: decoder)
    }
}

struct EmailChallenge: Decodable { let challengeId: String; let expiresIn: Int }
struct DevicesEnvelope: Decodable { let devices: [CloudDevice] }
struct MeEnvelope: Decodable { let user: CloudUser }
struct TokenPair: Decodable { let accessToken: String; let refreshToken: String }

// These preserve existing API fields. YAML is opaque, never imported from a user.
struct CatalogEnvelope: Decodable {
    let revision: Int
    let yaml: String
    let sha256: String
    let routing: CatalogRouting?
}

struct CatalogRouting: Decodable {
    let homeProxy: String?
    let defaultProxy: String?
    let homeSocks5: HomeSocks5?
    struct HomeSocks5: Decodable {
        let host: String
        let port: Int
        let username: String
        let password: String
    }
}

struct PolicyEnvelope: Decodable {
    let revision: Int
    let json: String
    let sha256: String
    let signature: String?
}

struct TrafficPolicy: Decodable {
    let version: Int
    let domains: [DomainRule]
    let mediaEndpoints: [EndpointRule]
    let tcpEndpoints: [EndpointRule]?
    let webDomains: [DomainRule]?
    let directSuffixes: [DomainRule]?
    struct DomainRule: Decodable { let host: String; let ports: [Int] }
    struct EndpointRule: Decodable { let address: String; let ports: [Int] }
}

enum PolicyFamily: String, Codable, CaseIterable {
    case reality, hy2, realityHome, hy2Home
    var unavailableReason: Blocker {
        switch self {
        case .hy2, .hy2Home: .unsupportedPolicy // DER pin != SPKI pin
        case .reality, .realityHome: .coreUnavailable
        }
    }
}
