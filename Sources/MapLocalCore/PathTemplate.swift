//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
/// Matches a request path against a rule's path template.
public enum PathTemplate {
    /// Returns whether `path` fits `template` segment by segment.
    ///
    /// A `{name}` segment matches any non-empty segment; every other segment must be equal.
    /// Both must have the same number of segments, so a template never matches a prefix.
    public static func matches(template: String, path: String) -> Bool {
        let templateSegments = template.split(separator: "/", omittingEmptySubsequences: false)
        let pathSegments = path.split(separator: "/", omittingEmptySubsequences: false)
        guard templateSegments.count == pathSegments.count else { return false }
        for (templateSegment, pathSegment) in zip(templateSegments, pathSegments) {
            if templateSegment.hasPrefix("{"), templateSegment.hasSuffix("}") {
                if pathSegment.isEmpty { return false }
            } else if templateSegment != pathSegment {
                return false
            }
        }
        return true
    }

    /// Whether `template` matches every path `other` matches.
    ///
    /// Segment by segment: a `{name}` segment covers a template segment or a non-empty
    /// literal, and any other segment covers only the same literal.
    public static func covers(_ template: String, _ other: String) -> Bool {
        let templateSegments = template.split(separator: "/", omittingEmptySubsequences: false)
        let otherSegments = other.split(separator: "/", omittingEmptySubsequences: false)
        guard templateSegments.count == otherSegments.count else { return false }
        return zip(templateSegments, otherSegments).allSatisfy { segment, otherSegment in
            let otherIsTemplate = otherSegment.hasPrefix("{") && otherSegment.hasSuffix("}")
            if segment.hasPrefix("{"), segment.hasSuffix("}") {
                return otherIsTemplate || !otherSegment.isEmpty
            }
            return !otherIsTemplate && segment == otherSegment
        }
    }

    /// Whether `path` is written as requests are matched: percent-encoded.
    ///
    /// `Matcher` compares the request's `percentEncodedPath`, which holds only RFC 3986 path
    /// characters, so a rule path with any other character (a space, Korean, `|`) could
    /// never match. Every segment is a `{name}` template, or unreserved characters,
    /// sub-delimiters, `:`, `@` and `%` followed by two hex digits. The panel applies the
    /// same test (`isEncodedPath` in `Panel/src/traffic/match.ts`).
    public static func isEncoded(_ path: String) -> Bool {
        path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { segment in
            if segment.hasPrefix("{"), segment.hasSuffix("}") { return true }
            var bytes = segment.utf8.makeIterator()
            while let byte = bytes.next() {
                if byte == UInt8(ascii: "%") {
                    guard let high = bytes.next(), let low = bytes.next(), isHex(high), isHex(low) else { return false }
                } else if !pathCharacters.contains(byte) {
                    return false
                }
            }
            return true
        }
    }

    private static let pathCharacters = Set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@".utf8
    )

    private static func isHex(_ byte: UInt8) -> Bool {
        switch byte {
        case UInt8(ascii: "0")...UInt8(ascii: "9"), UInt8(ascii: "A")...UInt8(ascii: "F"), UInt8(ascii: "a")...UInt8(ascii: "f"):
            true
        default:
            false
        }
    }
}
#endif
