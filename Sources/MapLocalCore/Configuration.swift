//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation

/// The single canonical form every host comparison goes through.
///
/// Allowed hosts, blocked hosts and request hosts are all compared in this form. Without
/// it, a blocked host written with a port would no longer match, and "never mock this
/// host" would quietly stop holding.
public enum HostName {
    /// Reduces a host, URL or host with port to a bare lowercase host name.
    ///
    /// `HTTPS://Prod.Example.com:443/` and `prod.example.com.` both become
    /// `prod.example.com`. Returns nil when what is left cannot be read as a host.
    public static func normalize(_ raw: String) -> String? {
        var text = raw.trimmingCharacters(in: .whitespaces).lowercased()
        if let scheme = text.range(of: "://") {
            text = String(text[scheme.upperBound...])
        }
        if let slash = text.firstIndex(of: "/") {
            text = String(text[..<slash])
        }
        if let colon = text.lastIndex(of: ":"),
           text[text.index(after: colon)...].allSatisfy({ $0.isASCII && $0.isNumber }) {
            text = String(text[..<colon])
        }
        while text.hasSuffix(".") {
            text.removeLast()
        }
        guard !text.isEmpty,
              text.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" || $0 == "_" })
        else {
            return nil
        }
        return text
    }
}

/// Everything Map Local knows about how to answer an app's requests.
///
/// The panel edits it, the engine matches requests against it, and `ConfigurationCodec`
/// stores it as JSON. `revision` grows by one on every write so that two editors cannot
/// silently overwrite each other.
public struct Configuration: Sendable, Equatable {
    /// The file format this build reads and writes. A newer file opens read-only.
    public static let currentVersion = 1

    public var version: Int
    public var revision: Int
    public var enabled: Bool
    public var allowedHosts: [String]
    public var unmatched: Unmatched
    public var rules: [RuleEntry]

    public init(
        version: Int = Configuration.currentVersion,
        revision: Int = 0,
        enabled: Bool = true,
        allowedHosts: [String] = [],
        unmatched: Unmatched = .passthrough,
        rules: [RuleEntry] = []
    ) {
        self.version = version
        self.revision = revision
        self.enabled = enabled
        self.allowedHosts = allowedHosts
        self.unmatched = unmatched
        self.rules = rules
    }

    public static let empty = Configuration()

    /// One issue for each rule that is kept but not applied.
    var unsupportedIssues: [MapLocalMessage] {
        rules.compactMap { entry in
            guard case let .unsupported(_, reason) = entry else { return nil }
            return MapLocalMessage(.ruleUnsupported, ["rule": entry.id ?? "?"], cause: reason)
        }
    }
}

/// What happens to a request on an allowed host that no rule answers.
public enum Unmatched: Sendable, Equatable {
    /// The request reaches the network as usual.
    case passthrough
    /// The request gets `status`, so a missing mock shows up instead of reaching a server.
    case block(status: Int)
    /// The request fails with the error, as if the server could not be reached.
    case fail(MockError)

    public static let defaultBlockStatus = 421
}

/// One item in the rule list, as it was read.
public enum RuleEntry: Sendable, Equatable {
    case rule(Rule)
    /// A rule this build cannot apply, such as one with an unsupported key.
    ///
    /// It is never applied, but it is written back exactly as it was read, so a newer
    /// file does not lose rules by passing through an older plugin.
    case unsupported(raw: JSONValue, reason: MapLocalMessage)

    public var id: String? {
        switch self {
        case let .rule(rule): rule.id
        case let .unsupported(raw, _): raw["id"]?.stringValue
        }
    }
}

/// A request pattern and the named responses it can answer with.
///
/// Only the response named by `active` is served. Keeping the others lets a user switch
/// between, say, a success and an error response without retyping either.
public struct Rule: Sendable, Equatable {
    public var id: String
    public var enabled: Bool
    public var tags: [String]
    public var match: Match
    public var active: String
    public var responses: [String: ResponseSpec]

    public init(
        id: String,
        enabled: Bool = true,
        tags: [String] = [],
        match: Match,
        active: String,
        responses: [String: ResponseSpec]
    ) {
        self.id = id
        self.enabled = enabled
        self.tags = tags
        self.match = match
        self.active = active
        self.responses = responses
    }
}

/// The part of a request a rule matches on.
///
/// `path` is a template in which `{name}` stands for any single non-empty segment. A
/// request matches only when every pair in `query` is present with the same value.
public struct Match: Sendable, Equatable {
    public var method: String
    /// The host to match, or nil to match any allowed host.
    public var host: String?
    public var path: String
    public var query: [String: String]

    public init(method: String, host: String? = nil, path: String, query: [String: String] = [:]) {
        self.method = method.uppercased()
        self.host = host?.lowercased()
        self.path = path
        self.query = query
    }
}

/// A response as the user wrote it.
///
/// It needs a `status`, an `error`, or both. An `error` makes the request fail as if the
/// network had failed.
public struct ResponseSpec: Sendable, Equatable {
    public var status: Int?
    public var headers: [String: String]
    public var body: ResponseBody?
    public var delayMs: Int
    public var error: MockError?

    public init(
        status: Int? = nil,
        headers: [String: String] = [:],
        body: ResponseBody? = nil,
        delayMs: Int = 0,
        error: MockError? = nil
    ) {
        self.status = status
        self.headers = headers
        self.body = body
        self.delayMs = delayMs
        self.error = error
    }
}

/// A response body: text sent as is, or JSON encoded when the response is served.
public enum ResponseBody: Sendable, Equatable {
    case text(String)
    case json(JSONValue)
}

/// A network failure a response can simulate instead of returning a status.
public enum MockError: String, Sendable, Equatable, CaseIterable {
    case notConnectedToInternet
    case connectionLost
    case timedOut

    /// The `URLError` code the app receives.
    public var urlErrorCode: URLError.Code {
        switch self {
        case .notConnectedToInternet: .notConnectedToInternet
        case .connectionLost: .networkConnectionLost
        case .timedOut: .timedOut
        }
    }
}
#endif
