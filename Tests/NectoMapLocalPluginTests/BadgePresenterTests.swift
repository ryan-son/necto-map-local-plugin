//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import CoreGraphics
import Testing
@testable import NectoMapLocalPlugin

@Suite("BadgePresenter")
struct BadgePresenterTests {
    typealias Window = BadgePresenter.Window

    static let normal: CGFloat = 0
    static let alert: CGFloat = 2000

    @Test("the sheet comes from the app's window that best stands for the scene", arguments: [
        // The key window at the normal level, as before.
        ([Window(level: normal), Window(level: normal, isKey: true)], 1),
        // The first normal-level window when none is key.
        ([Window(level: alert), Window(level: normal), Window(level: normal)], 1),
        // No normal-level window: the scene's key window, whatever its level.
        ([Window(level: 10), Window(level: alert, isKey: true)], 1),
        // No key window either: the top-most, the last of the highest level.
        ([Window(level: alert), Window(level: 10), Window(level: alert)], 2),
        // A hidden window, or one without a root controller, is passed over.
        ([Window(level: normal, isKey: true, isHidden: true), Window(level: 10)], 1),
        ([Window(level: normal, hasRoot: false), Window(level: 10, isKey: true)], 1),
    ])
    func pick(windows: [Window], expected: Int) {
        #expect(BadgePresenter.pick(windows) == expected)
    }

    @Test("with no app window to present from, the badge's own window presents it", arguments: [
        [Window](),
        [Window(level: normal, isHidden: true), Window(level: 10, hasRoot: false)],
    ])
    func fallsBackToBadge(windows: [Window]) {
        #expect(BadgePresenter.pick(windows) == nil)
    }
}
#endif
