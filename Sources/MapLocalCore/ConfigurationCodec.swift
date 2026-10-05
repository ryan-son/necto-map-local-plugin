//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation

/// Reads and writes the configuration file format.
///
/// Reading is strict about the file but lenient about single rules: a malformed file is
/// an error, while a malformed rule becomes `RuleEntry.unsupported` and is kept as it was
/// written. A file from a newer version therefore survives a round trip through this one.
/// Every error it throws is a `MapLocalMessage`.
public enum ConfigurationCodec {
    static let topKeys: Set<String> = ["version", "revision", "enabled", "allowedHosts", "unmatched", "rules"]
    static let ruleKeys: Set<String> = ["id", "enabled", "tags", "match", "active", "responses"]
    static let matchKeys: Set<String> = ["method", "host", "path", "query"]
    static let responseKeys: Set<String> = ["status", "headers", "body", "json", "delayMs", "error"]

    public static func decode(_ json: JSONValue) throws -> Configuration {
        guard let object = json.objectValue else { throw MapLocalMessage(.mustBeObject, ["key": "configuration"]) }
        guard let version = object["version"]?.intValue, version >= 1 else {
            throw MapLocalMessage(.mustBeIntegerAtLeast, ["key": "version", "min": "1"])
        }
        // A newer file opens read-only even with keys this build does not know. Treating it as
        // corrupt would move it aside, and a single downgrade would lose the configuration.
        let isNewer = version > Configuration.currentVersion
        if !isNewer, let unknown = Set(object.keys).subtracting(topKeys).sorted().first {
            throw MapLocalMessage(.unsupportedKey, ["place": "configuration", "key": unknown])
        }
        let revision = try object["revision"].map { value -> Int in
            guard let revision = value.intValue, revision >= 0 else {
                throw MapLocalMessage(.mustBeIntegerAtLeast, ["key": "revision", "min": "0"])
            }
            return revision
        } ?? 0
        let rulesJSON = object["rules"] ?? .array([])
        guard let rules = rulesJSON.arrayValue else { throw MapLocalMessage(.mustBeArray, ["key": "rules"]) }
        return Configuration(
            version: version,
            revision: revision,
            enabled: try decodeBool(object["enabled"], at: "enabled") ?? true,
            allowedHosts: try decodeHosts(object["allowedHosts"]),
            unmatched: try decodeUnmatched(object["unmatched"]),
            rules: deduplicated(rules.map(decodeRule))
        )
    }

    /// Reads a list of hosts and normalizes each one with `HostName`.
    public static func decodeHosts(_ json: JSONValue?) throws -> [String] {
        guard let json else { return [] }
        guard let items = json.arrayValue, items.allSatisfy({ $0.stringValue != nil }) else {
            throw MapLocalMessage(.mustBeStringArray, ["key": "allowedHosts"])
        }
        return try items.compactMap(\.stringValue).map { raw in
            guard let host = HostName.normalize(raw) else {
                throw MapLocalMessage(.invalidHost, ["key": "allowedHosts", "value": raw])
            }
            return host
        }
    }

    /// Reads an optional Boolean. `place` names the key in the error message.
    public static func decodeBool(_ json: JSONValue?, at place: String) throws -> Bool? {
        guard let json else { return nil }
        guard let value = json.boolValue else { throw MapLocalMessage(.mustBeBoolean, ["key": place]) }
        return value
    }

    /// Keeps the first entry with each id and turns later ones into unsupported entries.
    ///
    /// Editing and reordering find entries by id, so a second entry with the same id could
    /// never be addressed. It is kept as written instead of being applied.
    static func deduplicated(_ entries: [RuleEntry]) -> [RuleEntry] {
        var seen: Set<String> = []
        return entries.map { entry in
            guard let id = entry.id else { return entry }
            if seen.insert(id).inserted { return entry }
            switch entry {
            case let .rule(rule): return .unsupported(raw: encodeRule(rule), reason: MapLocalMessage(.duplicateID, ["id": id]))
            case let .unsupported(raw, _): return .unsupported(raw: raw, reason: MapLocalMessage(.duplicateID, ["id": id]))
            }
        }
    }

    public static func decodeUnmatched(_ json: JSONValue?) throws -> Unmatched {
        guard let json else { return .passthrough }
        let mode = try keys(json, allowed: ["mode", "status", "error"], at: "unmatched")["mode"]?.stringValue
        switch mode {
        case "passthrough":
            _ = try keys(json, allowed: ["mode", "status"], at: "unmatched")
            return .passthrough
        case "block":
            let object = try keys(json, allowed: ["mode", "status"], at: "unmatched")
            guard let raw = object["status"] else { return .block(status: Unmatched.defaultBlockStatus) }
            guard let status = raw.intValue, (100...599).contains(status) else {
                throw MapLocalMessage(.outOfRange, ["key": "unmatched.status", "min": "100", "max": "599"])
            }
            return .block(status: status)
        case "fail":
            let object = try keys(json, allowed: ["mode", "error"], at: "unmatched")
            guard let raw = object["error"] else { return .fail(.notConnectedToInternet) }
            guard let error = raw.stringValue.flatMap(MockError.init(rawValue:)) else {
                throw MapLocalMessage(.mustBeOneOf, [
                    "key": "unmatched.error",
                    "choices": MockError.allCases.map(\.rawValue).joined(separator: ", "),
                ])
            }
            return .fail(error)
        default:
            throw MapLocalMessage(.mustBeOneOf, ["key": "unmatched.mode", "choices": "passthrough, block, fail"])
        }
    }

    /// Reads one rule, or keeps it as an unsupported entry with the reason it was rejected.
    public static func decodeRule(_ json: JSONValue) -> RuleEntry {
        do {
            return .rule(try strictRule(json))
        } catch let message as MapLocalMessage {
            return .unsupported(raw: json, reason: message)
        } catch {
            // Unreachable: `strictRule` throws only messages.
            return .unsupported(raw: json, reason: MapLocalMessage(.mustBeObject, ["key": "rule"]))
        }
    }

    static func strictRule(_ json: JSONValue) throws -> Rule {
        let ruleObject = try keys(json, allowed: ruleKeys, at: "rule")
        guard let id = ruleObject["id"]?.stringValue, !id.isEmpty else { throw MapLocalMessage(.required, ["key": "id"]) }
        let matchObject = try keys(ruleObject["match"] ?? .null, allowed: matchKeys, at: "match")
        guard let method = matchObject["method"]?.stringValue else {
            throw MapLocalMessage(.required, ["key": "match.method"])
        }
        guard let path = matchObject["path"]?.stringValue else { throw MapLocalMessage(.required, ["key": "match.path"]) }
        guard path.hasPrefix("/") else { throw MapLocalMessage(.pathMustStartWithSlash) }
        guard !path.contains("?"), !path.contains("#") else { throw MapLocalMessage(.pathHasQuery) }
        guard PathTemplate.isEncoded(path) else { throw MapLocalMessage(.pathNotEncoded, ["value": path]) }
        let host = try matchObject["host"].map { value -> String in
            guard let raw = value.stringValue else { throw MapLocalMessage(.mustBeString, ["key": "match.host"]) }
            guard let host = HostName.normalize(raw) else {
                throw MapLocalMessage(.invalidHost, ["key": "match.host", "value": raw])
            }
            return host
        }
        let tags = try ruleObject["tags"].map { value -> [String] in
            guard let items = value.arrayValue, items.allSatisfy({ $0.stringValue != nil }) else {
                throw MapLocalMessage(.mustBeStringArray, ["key": "tags"])
            }
            return items.compactMap(\.stringValue)
        } ?? []
        // Rejected like `tags`. Reading a non-object as no conditions would make the rule
        // answer every query, and writing it back would drop the conditions for good.
        let queryJSON = try matchObject["query"].map { value -> [String: JSONValue] in
            guard let object = value.objectValue else { throw MapLocalMessage(.mustBeObject, ["key": "match.query"]) }
            return object
        } ?? [:]
        var query: [String: String] = [:]
        for (key, value) in queryJSON {
            guard let string = value.stringValue else {
                throw MapLocalMessage(.mustBeString, ["key": "match.query.\(key)"])
            }
            query[key] = string
        }
        guard let responsesJSON = ruleObject["responses"]?.objectValue, !responsesJSON.isEmpty else {
            throw MapLocalMessage(.responsesEmpty)
        }
        var responses: [String: ResponseSpec] = [:]
        for (name, value) in responsesJSON {
            responses[name] = try strictResponse(value, name: name)
        }
        guard let active = ruleObject["active"]?.stringValue, responses[active] != nil else {
            throw MapLocalMessage(.activeNotInResponses)
        }
        return Rule(
            id: id,
            enabled: try decodeBool(ruleObject["enabled"], at: "enabled") ?? true,
            tags: tags,
            match: Match(method: method, host: host, path: path, query: query),
            active: active,
            responses: responses
        )
    }

    static func strictResponse(_ json: JSONValue, name: String) throws -> ResponseSpec {
        let place = "responses.\(name)"
        let responseObject = try keys(json, allowed: responseKeys, at: place)
        var spec = ResponseSpec()
        if let statusJSON = responseObject["status"] {
            guard let status = statusJSON.intValue, (100...599).contains(status) else {
                throw MapLocalMessage(.outOfRange, ["key": "\(place).status", "min": "100", "max": "599"])
            }
            spec.status = status
        }
        let headersJSON = try responseObject["headers"].map { value -> [String: JSONValue] in
            guard let object = value.objectValue else {
                throw MapLocalMessage(.mustBeObject, ["key": "\(place).headers"])
            }
            return object
        } ?? [:]
        for (key, value) in headersJSON {
            guard let string = value.stringValue else {
                throw MapLocalMessage(.mustBeString, ["key": "\(place).headers.\(key)"])
            }
            spec.headers[key] = string
        }
        if let body = responseObject["body"] {
            guard let text = body.stringValue else { throw MapLocalMessage(.mustBeString, ["key": "\(place).body"]) }
            spec.body = .text(text)
        }
        if let json = responseObject["json"] {
            spec.body = .json(json)
        }
        if let delayJSON = responseObject["delayMs"] {
            guard let delay = delayJSON.intValue, (0...60_000).contains(delay) else {
                throw MapLocalMessage(.outOfRange, ["key": "\(place).delayMs", "min": "0", "max": "60000"])
            }
            spec.delayMs = delay
        }
        if let errorJSON = responseObject["error"] {
            guard let raw = errorJSON.stringValue, let error = MockError(rawValue: raw) else {
                throw MapLocalMessage(.mustBeOneOf, [
                    "key": "\(place).error",
                    "choices": MockError.allCases.map(\.rawValue).joined(separator: ", "),
                ])
            }
            spec.error = error
        }
        guard spec.status != nil || spec.error != nil else {
            throw MapLocalMessage(.statusOrErrorRequired, ["key": place])
        }
        return spec
    }

    /// Returns `json` as an object, or fails when it is not one or has a key outside `allowed`.
    static func keys(_ json: JSONValue, allowed: Set<String>, at place: String) throws -> [String: JSONValue] {
        guard let object = json.objectValue else { throw MapLocalMessage(.mustBeObject, ["key": place]) }
        if let unknown = Set(object.keys).subtracting(allowed).sorted().first {
            throw MapLocalMessage(.unsupportedKey, ["place": place, "key": unknown])
        }
        return object
    }

    /// Writes a configuration. Unsupported entries are written back exactly as they were read.
    public static func encode(_ configuration: Configuration) -> JSONValue {
        let unmatched: JSONValue = switch configuration.unmatched {
        case .passthrough: .object(["mode": .string("passthrough")])
        case let .block(status): .object(["mode": .string("block"), "status": .number(Double(status))])
        case let .fail(error): .object(["mode": .string("fail"), "error": .string(error.rawValue)])
        }
        return .object([
            "version": .number(Double(configuration.version)),
            "revision": .number(Double(configuration.revision)),
            "enabled": .bool(configuration.enabled),
            "allowedHosts": .array(configuration.allowedHosts.map(JSONValue.string)),
            "unmatched": unmatched,
            "rules": .array(configuration.rules.map { entry in
                switch entry {
                case let .rule(rule): encodeRule(rule)
                case let .unsupported(raw, _): raw
                }
            }),
        ])
    }

    public static func encodeRule(_ rule: Rule) -> JSONValue {
        var match: [String: JSONValue] = ["method": .string(rule.match.method), "path": .string(rule.match.path)]
        if let host = rule.match.host { match["host"] = .string(host) }
        if !rule.match.query.isEmpty { match["query"] = .object(rule.match.query.mapValues(JSONValue.string)) }
        return .object([
            "id": .string(rule.id),
            "enabled": .bool(rule.enabled),
            "tags": .array(rule.tags.map(JSONValue.string)),
            "match": .object(match),
            "active": .string(rule.active),
            "responses": .object(rule.responses.mapValues(encodeResponse)),
        ])
    }

    static func encodeResponse(_ spec: ResponseSpec) -> JSONValue {
        var object: [String: JSONValue] = [:]
        if let status = spec.status { object["status"] = .number(Double(status)) }
        if !spec.headers.isEmpty { object["headers"] = .object(spec.headers.mapValues(JSONValue.string)) }
        switch spec.body {
        case let .text(text): object["body"] = .string(text)
        case let .json(json): object["json"] = json
        case nil: break
        }
        if spec.delayMs > 0 { object["delayMs"] = .number(Double(spec.delayMs)) }
        if let error = spec.error { object["error"] = .string(error.rawValue) }
        return .object(object)
    }
}
#endif
