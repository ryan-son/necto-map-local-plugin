//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import Foundation
import ObjectiveC

/// Puts `MapLocalURLProtocol` in front of every `URLSession` the app creates.
///
/// Registering the class covers `URLSession.shared`. Sessions built from a configuration
/// get the protocol from the replaced `default` and `ephemeral` getters, so the app needs
/// no changes of its own.
enum MapLocalInstaller {
    /// Runs once per process.
    ///
    /// The plugin may be created more than once, and the replacement must hold each time.
    /// Exchanging implementations instead would undo it on the second call.
    static func installIfNeeded() { _ = once }

    private static let once: Void = {
        URLProtocol.registerClass(MapLocalURLProtocol.self)
        replaceGetter(#selector(getter: URLSessionConfiguration.default))
        replaceGetter(#selector(getter: URLSessionConfiguration.ephemeral))
    }()

    private static func replaceGetter(_ selector: Selector) {
        guard let method = class_getClassMethod(URLSessionConfiguration.self, selector) else { return }
        typealias Getter = @convention(c) (AnyClass, Selector) -> URLSessionConfiguration
        let original = unsafeBitCast(method_getImplementation(method), to: Getter.self)
        let block: @convention(block) (AnyClass) -> URLSessionConfiguration = { receiver in
            let configuration = original(receiver, selector)
            var classes = (configuration.protocolClasses ?? []).filter { $0 != MapLocalURLProtocol.self }
            classes.insert(MapLocalURLProtocol.self, at: 0)
            configuration.protocolClasses = classes
            return configuration
        }
        method_setImplementation(method, imp_implementationWithBlock(block))
    }
}
#endif
