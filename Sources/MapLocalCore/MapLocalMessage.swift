//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
/// Every message the engine sends to the panel, as a stable code.
///
/// A failed write carries one as `code`, `params` and `message` beside its `reason`, and
/// each configuration issue is sent the same way in `issueDetails`. `message` is the
/// English `template` with `params` filled in, written for the CLI and agents. The panel
/// translates by `code` and keys its dictionary by the same template, so codes are a
/// contract: add new ones, and never reuse or rename one.
///
/// `Fixtures/message-codes.json` lists the same codes and templates, and both the Swift
/// and the panel tests read it.
public enum MessageCode: String, CaseIterable, Sendable {
    // A value in a configuration or an operation's input has the wrong shape. `key` is
    // the path to it, such as `responses.ok.status`, or `input` for the input itself.
    case mustBeObject
    case mustBeArray
    case mustBeStringArray
    case mustBeBoolean
    case mustBeString
    case mustBeIntegerAtLeast
    case outOfRange
    case mustBeOneOf
    case unsupportedKey
    case required
    case invalidHost
    case pathMustStartWithSlash
    case pathHasQuery
    case pathNotEncoded
    case responsesEmpty
    case activeNotInResponses
    case statusOrErrorRequired
    case duplicateID
    case versionTooNew
    case authMockedOnlyFalse
    case authMockedAlone
    case orderMismatch
    case notWriteOperation

    // A write that was well formed but could not be applied.
    case ruleNotFound
    case responseNotFound
    case conflict
    case readOnly
    case saveFailed
    case engineMissing

    // Issues found while loading the configuration, sent with the state.
    case fileUnreadable
    case fileMovedAside
    case fileTooNew
    /// A rule that is kept but not applied. Its `cause` says why.
    case ruleUnsupported

    /// The English text, with `{name}` for each value in `params`.
    public var template: String {
        switch self {
        case .mustBeObject: "{key} must be an object"
        case .mustBeArray: "{key} must be an array"
        case .mustBeStringArray: "{key} must be an array of strings"
        case .mustBeBoolean: "{key} must be true or false"
        case .mustBeString: "{key} must be a string"
        case .mustBeIntegerAtLeast: "{key} must be an integer of {min} or more"
        case .outOfRange: "{key} must be an integer from {min} to {max}"
        case .mustBeOneOf: "{key} must be one of: {choices}"
        case .unsupportedKey: "Unsupported key in {place}: {key}"
        case .required: "{key} is required"
        case .invalidHost: "{key} has a value that can't be read as a host: {value}"
        case .pathMustStartWithSlash: "match.path must start with /"
        case .pathHasQuery: "match.path can't contain a query or a fragment; use match.query"
        case .pathNotEncoded: "match.path must be percent-encoded, as the app sends it: {value}"
        case .responsesEmpty: "responses must have at least one response"
        case .activeNotInResponses: "active must name one of the responses"
        case .statusOrErrorRequired: "{key} needs a status or an error"
        case .duplicateID: "Duplicate id: {id}"
        case .versionTooNew: "Configuration version {version} is newer than this plugin supports ({supported})"
        case .authMockedOnlyFalse: "authMocked can only be false, which clears the mocked session"
        case .authMockedAlone: "authMocked can't be sent with other keys"
        case .orderMismatch: "order must list every rule id exactly once"
        case .notWriteOperation: "Not a write operation"
        case .ruleNotFound: "No rule '{rule}'"
        case .responseNotFound: "No response '{response}'"
        case .conflict: "Changed elsewhere first. Get the latest configuration and try again"
        case .readOnly: "The configuration is read-only (see issues)"
        case .saveFailed: "Couldn't save the configuration: {error}"
        case .engineMissing: "The Map Local engine isn't running"
        case .fileUnreadable:
            "Couldn't read the configuration file, so it opens read-only and won't be overwritten: {error}"
        case .fileMovedAside: "Couldn't read the configuration file, so it was moved aside to {file}"
        case .fileTooNew: "Configuration version {version} is newer than this plugin, so it is read-only"
        case .ruleUnsupported: "Rule {rule}: {cause}"
        }
    }
}

/// A message with its code, the values its text needs, and the message that caused it.
///
/// It is also the error thrown when a configuration, or a part of one, cannot be read.
public struct MapLocalMessage: Error, Equatable, Sendable {
    public let code: MessageCode
    public let params: [String: String]
    /// Holds at most one message. An array, because a struct cannot hold itself directly.
    private let causes: [MapLocalMessage]

    public init(_ code: MessageCode, _ params: [String: String] = [:], cause: MapLocalMessage? = nil) {
        self.code = code
        self.params = params
        self.causes = cause.map { [$0] } ?? []
    }

    public var cause: MapLocalMessage? { causes.first }

    /// The English text. A cause fills `{cause}`.
    public var text: String {
        var values = params
        if let cause { values["cause"] = cause.text }
        return Self.fill(code.template, values)
    }

    /// Fills each `{name}` in one pass, so a value that itself contains braces is left as is.
    static func fill(_ template: String, _ values: [String: String]) -> String {
        var result = ""
        var rest = Substring(template)
        while let open = rest.firstIndex(of: "{"), let close = rest[open...].firstIndex(of: "}") {
            result += rest[..<open]
            result += values[String(rest[rest.index(after: open)..<close])] ?? String(rest[open...close])
            rest = rest[rest.index(after: close)...]
        }
        return result + rest
    }

    /// `{code, params, message, cause?}`, as the panel reads it.
    public var json: JSONValue {
        var object: [String: JSONValue] = [
            "code": .string(code.rawValue),
            "params": .object(params.mapValues(JSONValue.string)),
            "message": .string(text),
        ]
        if let cause { object["cause"] = cause.json }
        return .object(object)
    }
}
#endif
