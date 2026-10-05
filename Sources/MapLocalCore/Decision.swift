//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation

/// A response ready to hand to the app, with defaults filled in and the body encoded.
public struct ResolvedResponse: Sendable, Equatable, Codable {
    public var status: Int
    public var headers: [String: String]
    public var body: Data
    public var delayMs: Int
    /// A `URLError.Code` raw value. When set, the request fails instead of returning `status`.
    public var errorCode: Int?
}

/// How Map Local answers one request instead of the network.
///
/// `Matcher` returns nil for a request that should reach the network, so a decision
/// always means the app does not talk to the server.
public struct Decision: Sendable, Equatable, Codable {
    public enum Kind: String, Codable, Sendable {
        /// A rule answered the request.
        case mock
        /// No rule answered, and the configuration blocks or fails unmatched requests.
        case unmocked
    }

    public var kind: Kind
    public var ruleID: String?
    public var responseName: String?
    /// The configuration revision the decision was made from.
    public var revision: Int
    public var path: String
    public var response: ResolvedResponse
}
#endif
