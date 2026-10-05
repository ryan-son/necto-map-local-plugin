//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
/// The operations the panel can call.
///
/// The single source for the names and kinds the handlers register. A test checks that
/// `Panel/public/manifest.json` declares the same ones.
enum MapLocalOperation: String, CaseIterable, Sendable {
    case state = "maplocal.state"
    case stateObserve = "maplocal.state.observe"
    case configurationReplace = "maplocal.configuration.replace"
    case configurationPatch = "maplocal.configuration.patch"
    case ruleUpsert = "maplocal.rule.upsert"
    case ruleDelete = "maplocal.rule.delete"
    case ruleSetActive = "maplocal.rule.setActive"
    case requestsObserve = "maplocal.requests.observe"
    case requestsList = "maplocal.requests.list"
    case configurationExport = "maplocal.configuration.export"

    enum Kind: String {
        case once
        case stream
    }

    var kind: Kind {
        switch self {
        case .stateObserve, .requestsObserve: .stream
        default: .once
        }
    }

    /// The input keys an operation accepts, so that a one-letter typo fails instead of being
    /// silently ignored with `ok`.
    var inputKeys: Set<String> {
        switch self {
        case .state, .stateObserve, .requestsObserve, .configurationExport: []
        case .requestsList: ["limit"]
        case .configurationReplace: ["baseRevision", "force", "configuration"]
        case .configurationPatch: ["baseRevision", "enabled", "allowedHosts", "unmatched", "order", "authMocked"]
        case .ruleUpsert: ["baseRevision", "rule"]
        case .ruleDelete: ["baseRevision", "id"]
        case .ruleSetActive: ["baseRevision", "id", "response"]
        }
    }

    /// The input keys an operation cannot do without. `configurationReplace` also needs
    /// `baseRevision` unless `force` is true, which a schema cannot express.
    var requiredKeys: Set<String> {
        switch self {
        case .state, .stateObserve, .requestsObserve, .configurationExport, .requestsList: []
        case .configurationReplace: ["configuration"]
        case .configurationPatch: ["baseRevision"]
        case .ruleUpsert: ["baseRevision", "rule"]
        case .ruleDelete: ["baseRevision", "id"]
        case .ruleSetActive: ["baseRevision", "id", "response"]
        }
    }
}
#endif
