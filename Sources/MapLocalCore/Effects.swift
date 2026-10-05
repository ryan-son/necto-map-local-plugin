//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation

/// What Map Local can do to the app right now. The badge shows exactly when there is some.
///
/// Rules apply whenever Map Local is on, with or without Necto, so this depends on the
/// configuration alone. It mirrors `Matcher.decide`: a request can be answered only on an
/// allowed host that is not blocked.
public struct Effects: Sendable, Equatable {
    /// Enabled rules that can answer a request on one of `hosts`, in the configuration's
    /// order. A rule that an earlier rule always wins over is left out (`shadows`).
    public var rules: [Rule]
    /// The allowed hosts that are not blocked, in the configuration's order.
    public var hosts: [String]
    /// What requests without a rule get, when they are blocked or failed instead of reaching
    /// the network.
    public var unmatched: Unmatched?
    /// The app may still hold a sign-in session that a mocked response created.
    public var mayHoldMockedSession: Bool
    /// Turning Map Local off now could send that session's token to the real server.
    ///
    /// The same test as the panel's `sessionAtRisk`: a mocked session may remain and an
    /// enabled auth rule answers an allowed host.
    public var sessionAtRisk: Bool

    public init(rules: [Rule], hosts: [String], unmatched: Unmatched?, mayHoldMockedSession: Bool, sessionAtRisk: Bool) {
        self.rules = rules
        self.hosts = hosts
        self.unmatched = unmatched
        self.mayHoldMockedSession = mayHoldMockedSession
        self.sessionAtRisk = sessionAtRisk
    }

    public var mockingRules: Int { rules.count }
}

extension EngineState {
    /// What applies now, or nil when Map Local is off or nothing it does reaches the app.
    ///
    /// A mocked session counts on its own, because the app is affected by it even when no
    /// rule answers any more, and the cue to sign out must stay visible.
    public var effects: Effects? {
        let configuration = configuration
        guard configuration.enabled else { return nil }
        let blocked = Set(blockedHosts)
        let hosts = configuration.allowedHosts.filter { !blocked.contains($0) }
        let rules = configuration.rules.compactMap { entry -> Rule? in
            guard case let .rule(rule) = entry, rule.enabled else { return nil }
            return rule
        }
        let candidates = rules.filter { $0.responses[$0.active] != nil }
        let mocking = candidates.enumerated().filter { index, rule in
            !Self.reach(rule, hosts: hosts).isEmpty
                && !candidates[..<index].contains { Self.shadows($0, rule, hosts: hosts) }
        }.map(\.element)
        let unmatched: Unmatched? = configuration.unmatched == .passthrough || hosts.isEmpty ? nil : configuration.unmatched
        let atRisk = mayHoldMockedSession && rules.contains { rule in
            guard rule.tags.contains("auth") else { return false }
            guard let host = rule.match.host else { return !configuration.allowedHosts.isEmpty }
            return configuration.allowedHosts.contains(HostName.normalize(host) ?? host)
        }
        guard !mocking.isEmpty || unmatched != nil || mayHoldMockedSession else { return nil }
        return Effects(
            rules: mocking,
            hosts: hosts,
            unmatched: unmatched,
            mayHoldMockedSession: mayHoldMockedSession,
            sessionAtRisk: atRisk
        )
    }

    /// The allowed, unblocked hosts a rule can answer on.
    private static func reach(_ rule: Rule, hosts: [String]) -> Set<String> {
        guard let host = rule.match.host else { return Set(hosts) }
        return hosts.contains(host) ? [host] : []
    }

    /// Whether `earlier` matches every request `later` matches and wins each one, so `later`
    /// can never answer.
    ///
    /// `Matcher.decide` lets the rule with more query conditions win, and the earlier rule
    /// on a tie. An earlier rule that matches all of `later`'s requests needs a subset of
    /// its conditions, so it wins only with exactly the same ones. This is a sufficient
    /// test, not an exact one: several earlier rules that together cover `later` are not
    /// looked for, so such a rule is still counted.
    private static func shadows(_ earlier: Rule, _ later: Rule, hosts: [String]) -> Bool {
        earlier.match.method == later.match.method
            && earlier.match.query == later.match.query
            && reach(later, hosts: hosts).isSubset(of: reach(earlier, hosts: hosts))
            && PathTemplate.covers(earlier.match.path, later.match.path)
    }
}
#endif
