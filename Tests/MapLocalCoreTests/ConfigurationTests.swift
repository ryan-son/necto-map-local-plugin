//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Testing
@testable import MapLocalCore

@Suite("Configuration")
struct ConfigurationTests {
    @Test("an empty configuration is on, but has no allowed hosts and passes unmatched requests through")
    func emptyConfiguration() {
        let configuration = Configuration.empty
        #expect(configuration.version == Configuration.currentVersion)
        #expect(configuration.revision == 0)
        #expect(configuration.allowedHosts.isEmpty)
        #expect(configuration.unmatched == .passthrough)
        #expect(configuration.rules.isEmpty)
    }

    @Test("turns each mock error into its URLError code", arguments: [
        (MockError.notConnectedToInternet, URLError.Code.notConnectedToInternet),
        (.connectionLost, .networkConnectionLost),
        (.timedOut, .timedOut),
    ])
    func errorCode(error: MockError, code: URLError.Code) {
        #expect(error.urlErrorCode == code)
    }

    @Test("reads a rule entry's id from the raw rule, even when it is unsupported")
    func entryID() {
        let raw: JSONValue = .object(["id": .string("x"), "weird": .bool(true)])
        #expect(RuleEntry.unsupported(raw: raw, reason: MapLocalMessage(.required, ["key": "id"])).id == "x")
    }
}
#endif
