//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import Testing
@testable import MapLocalCore

@Suite("JSONValue")
struct JSONValueTests {
    @Test("round-trips a JSON document unchanged")
    func roundTrips() throws {
        let text = #"{"a":[1,true,null,"x"],"b":{"c":2.5}}"#
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
        let again = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
        #expect(value == again)
        #expect(value["a"]?.arrayValue?.count == 4)
        #expect(value["b"]?["c"] == .number(2.5))
    }

    @Test("gives an intValue only for numbers that read as integers")
    func intValueOnlyForIntegers() {
        #expect(JSONValue.number(421).intValue == 421)
        #expect(JSONValue.number(1.5).intValue == nil)
    }
}
#endif
