//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation

/// Decides whether a request is answered by a rule, blocked, or left to the network.
///
/// It is a pure function of the request and the configuration, so the same table of cases
/// in `Fixtures/matcher-cases.json` checks it here and in the panel.
public enum Matcher {
    /// Returns how to answer `request`, or nil to let it reach the network.
    ///
    /// Only requests to an allowed host that is not blocked are considered. A blocked host
    /// is never answered, even when it is also allowed.
    public static func decide(
        _ request: URLRequest,
        configuration: Configuration,
        blockedHosts: Set<String>
    ) -> Decision? {
        guard configuration.enabled,
              let url = request.url,
              let host = url.host().flatMap(HostName.normalize)
        else {
            return nil
        }
        guard !blockedHosts.contains(host), configuration.allowedHosts.contains(host) else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let path = components?.percentEncodedPath.isEmpty == false ? components!.percentEncodedPath : "/"
        let method = (request.httpMethod ?? "GET").uppercased()
        var query: [String: String] = [:]
        for item in components?.queryItems ?? [] {
            query[item.name] = item.value ?? ""
        }

        // The rule with more query conditions wins, so a `?page=2` rule made after a general
        // rule for the same path is not shadowed by it. On a tie, the earlier rule wins.
        var best: (rule: Rule, spec: ResponseSpec)?
        for entry in configuration.rules {
            guard case let .rule(rule) = entry, rule.enabled else { continue }
            guard rule.match.method == method else { continue }
            if let ruleHost = rule.match.host, ruleHost != host { continue }
            guard PathTemplate.matches(template: rule.match.path, path: path) else { continue }
            guard rule.match.query.allSatisfy({ query[$0.key] == $0.value }) else { continue }
            guard let spec = rule.responses[rule.active] else { continue }
            if let current = best, current.rule.match.query.count >= rule.match.query.count { continue }
            best = (rule, spec)
        }
        if let (rule, spec) = best {
            return Decision(
                kind: .mock,
                ruleID: rule.id,
                responseName: rule.active,
                revision: configuration.revision,
                path: path,
                response: resolve(spec, tag: "\(rule.id)/\(rule.active)")
            )
        }
        let response: ResolvedResponse
        switch configuration.unmatched {
        case .passthrough:
            return nil
        case let .block(status):
            let body = #"{"code":"MAP_LOCAL_UNMOCKED","message":"unmocked: \#(path)"}"#
            response = ResolvedResponse(
                status: status,
                headers: ["Content-Type": "application/json", "X-Map-Local": "unmocked"],
                body: Data(body.utf8),
                delayMs: 0,
                errorCode: nil
            )
        case let .fail(error):
            response = ResolvedResponse(
                status: 0,
                headers: [:],
                body: Data(),
                delayMs: 0,
                errorCode: error.urlErrorCode.rawValue
            )
        }
        return Decision(
            kind: .unmocked,
            ruleID: nil,
            responseName: nil,
            revision: configuration.revision,
            path: path,
            response: response
        )
    }

    /// Fills in the defaults of `spec` and tags the response with the rule that served it.
    static func resolve(_ spec: ResponseSpec, tag: String) -> ResolvedResponse {
        var headers = spec.headers
        headers["X-Map-Local"] = tag
        var body = Data()
        switch spec.body {
        case let .text(text):
            body = Data(text.utf8)
        case let .json(json):
            body = (try? JSONEncoder().encode(json)) ?? Data()
            if headers.keys.first(where: { $0.lowercased() == "content-type" }) == nil {
                headers["Content-Type"] = "application/json"
            }
        case nil:
            break
        }
        return ResolvedResponse(
            status: spec.status ?? 200,
            headers: headers,
            body: body,
            delayMs: spec.delayMs,
            errorCode: spec.error?.urlErrorCode.rawValue
        )
    }
}
#endif
