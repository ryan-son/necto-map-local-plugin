//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import CoreGraphics
import Testing
@testable import NectoMapLocalPlugin

@Suite("BadgeLayout")
struct BadgeLayoutTests {
    /// 「Map Local 🔑」 at 11pt semibold with the pill's padding, the widest badge.
    static let badge = CGSize(width: 91, height: 18)

    /// The area the app lays out its content in. The badge must stay out of it.
    static func safe(_ bounds: CGRect, _ insets: BadgeLayout.Insets) -> CGRect {
        CGRect(
            x: insets.left,
            y: insets.top,
            width: bounds.width - insets.left - insets.right,
            height: bounds.height - insets.top - insets.bottom
        )
    }

    /// The home indicator as drawn on Face ID iPhones: 134 by 5 points, 8 points above the
    /// bottom edge, centred.
    static func indicator(_ bounds: CGRect) -> CGRect {
        CGRect(x: bounds.midX - 67, y: bounds.maxY - 13, width: 134, height: 5)
    }

    /// Measured on an iPhone 17 Pro simulator (iOS 26.4): the system keeps every touch in
    /// the status bar frame (y 0–54) and never hands it to an app window, and the floating
    /// search field of a tab or toolbar ends 845pt down, 29pt above the bottom edge.
    static let statusBarHeight: CGFloat = 54
    static let floatingBarBottom: CGFloat = 845

    /// The notch of an iPhone X, the widest notch: 209 by 30 points, centred.
    static func notch(_ bounds: CGRect) -> CGRect {
        CGRect(x: bounds.midX - 104.5, y: 0, width: 209, height: 30)
    }

    @Test("a Dynamic Island iPhone in portrait: beside the home indicator, below the floating bars, clear of the corner", arguments: [
        (CGRect(x: 0, y: 0, width: 402, height: 874), CGFloat(845)),
        (CGRect(x: 0, y: 0, width: 393, height: 852), CGFloat(823)),
        (CGRect(x: 0, y: 0, width: 440, height: 956), CGFloat(927)),
    ])
    func faceIDPortrait(bounds: CGRect, floatingBarBottom: CGFloat) throws {
        let insets = BadgeLayout.Insets(top: 62, left: 0, bottom: 34, right: 0)
        let frame = try #require(BadgeLayout.frame(in: bounds, insets: insets, size: Self.badge))
        #expect(frame.size == Self.badge)
        #expect(!frame.intersects(Self.safe(bounds, insets)))
        #expect(frame.minY >= floatingBarBottom + 2 && frame.maxY <= bounds.maxY)
        #expect(!frame.intersects(Self.indicator(bounds).insetBy(dx: -2, dy: -2)))
        #expect(frame.minX > bounds.midX)
        #expect(frame.maxX <= bounds.maxX - BadgeLayout.cornerClearance)
        #expect(frame.minY >= Self.statusBarHeight)
    }

    @Test("a badge too wide to sit beside the indicator goes above it")
    func faceIDTooWide() throws {
        let bounds = CGRect(x: 0, y: 0, width: 402, height: 874)
        let insets = BadgeLayout.Insets(top: 62, left: 0, bottom: 34, right: 0)
        let wide = CGSize(width: 130, height: 18)
        let frame = try #require(BadgeLayout.frame(in: bounds, insets: insets, size: wide))
        #expect(!frame.intersects(Self.safe(bounds, insets)))
        #expect(frame.minY >= bounds.maxY - insets.bottom && frame.maxY <= bounds.maxY)
        #expect(!frame.intersects(Self.indicator(bounds)))
        #expect(frame.maxX <= bounds.maxX - BadgeLayout.cornerClearance)
    }

    @Test("a notch iPhone in portrait: no room beside the notch, so in the home indicator strip, never over the notch")
    func notchPortrait() throws {
        let bounds = CGRect(x: 0, y: 0, width: 375, height: 812)
        let insets = BadgeLayout.Insets(top: 44, left: 0, bottom: 34, right: 0)
        let frame = try #require(BadgeLayout.frame(in: bounds, insets: insets, size: Self.badge))
        #expect(!frame.intersects(Self.safe(bounds, insets)))
        #expect(!frame.intersects(Self.notch(bounds)))
        #expect(!frame.intersects(Self.indicator(bounds)))
    }

    @Test("a Face ID iPhone in landscape: no status bar, so in the home indicator strip, inside the side insets")
    func faceIDLandscape() throws {
        let bounds = CGRect(x: 0, y: 0, width: 874, height: 402)
        let insets = BadgeLayout.Insets(top: 0, left: 62, bottom: 21, right: 62)
        let frame = try #require(BadgeLayout.frame(in: bounds, insets: insets, size: Self.badge))
        #expect(!frame.intersects(Self.safe(bounds, insets)))
        #expect(frame.maxY <= bounds.maxY && frame.minY >= bounds.maxY - insets.bottom)
        #expect(frame.maxX <= bounds.maxX - insets.right)
        #expect(!frame.intersects(Self.indicator(bounds)))
    }

    @Test("a home button iPhone: in the status bar at the leading edge")
    func homeButton() throws {
        let bounds = CGRect(x: 0, y: 0, width: 375, height: 667)
        let insets = BadgeLayout.Insets(top: 20, left: 0, bottom: 0, right: 0)
        let frame = try #require(BadgeLayout.frame(in: bounds, insets: insets, size: Self.badge))
        #expect(!frame.intersects(Self.safe(bounds, insets)))
        #expect(frame.minY >= 0 && frame.maxY <= insets.top)
        #expect(frame.minX < bounds.midX - Self.badge.width / 2)
    }

    @Test("a Face ID iPad: its status bar is full, so in the home indicator strip beside the indicator")
    func iPad() throws {
        let bounds = CGRect(x: 0, y: 0, width: 1032, height: 1376)
        let insets = BadgeLayout.Insets(top: 24, left: 0, bottom: 20, right: 0)
        let frame = try #require(BadgeLayout.frame(in: bounds, insets: insets, size: Self.badge))
        #expect(!frame.intersects(Self.safe(bounds, insets)))
        #expect(!frame.intersects(Self.indicator(bounds)))
        #expect(frame.minY >= bounds.maxY - insets.bottom)
    }

    @Test("a home button iPhone with the status bar hidden (landscape, a full-screen camera): no strip, so it is hidden rather than over the app's controls")
    func homeButtonStatusBarHidden() {
        let bounds = CGRect(x: 0, y: 0, width: 667, height: 375)
        #expect(BadgeLayout.frame(in: bounds, insets: .init(top: 0, left: 0, bottom: 0, right: 0), size: Self.badge) == nil)
    }

    @Test("only a point inside the shown pill is the badge's; every other touch goes to the app")
    func hits() {
        let pill = CGRect(x: 28, y: 22, width: 91, height: 18)
        #expect(BadgeLayout.accepts(CGPoint(x: 30, y: 30), pill: pill))
        #expect(BadgeLayout.accepts(CGPoint(x: 118.5, y: 39.5), pill: pill))
        #expect(!BadgeLayout.accepts(CGPoint(x: 27.5, y: 30), pill: pill))
        #expect(!BadgeLayout.accepts(CGPoint(x: 30, y: 40.5), pill: pill))
        #expect(!BadgeLayout.accepts(CGPoint(x: 200, y: 400), pill: pill))
        #expect(!BadgeLayout.accepts(CGPoint(x: 30, y: 30), pill: nil))
    }

    /// Measured on iOS 26.4 simulators: the software keyboard ends at 539pt with 335pt on an
    /// iPhone 17 Pro (402 by 874), and at 843pt with 337pt on an iPad Air 11-inch (820 by
    /// 1180). With a hardware keyboard the iPhone posts only a hide, with a zero height.
    /// On iOS 27.0 the iPhone 18 Pro (also 402 by 874) keyboard is 328pt at 546pt, and the
    /// iPad Air 11-inch (M4) one is unchanged.
    static let iPhoneScreen = CGRect(x: 0, y: 0, width: 402, height: 874)
    static let iPhoneKeyboard = CGRect(x: 0, y: 539, width: 402, height: 335)
    static let iPhoneKeyboardIOS27 = CGRect(x: 0, y: 546, width: 402, height: 328)
    static let iPadScreen = CGRect(x: 0, y: 0, width: 820, height: 1180)
    static let iPadKeyboard = CGRect(x: 0, y: 843, width: 820, height: 337)

    @Test("the keyboard hides the badge only when it covers the bottom of the badge's own scene", arguments: [
        // Full screen: the keyboard reaches the home indicator strip.
        (BadgeLayoutTests.iPhoneKeyboard, BadgeLayoutTests.iPhoneScreen, true),
        (BadgeLayoutTests.iPhoneKeyboardIOS27, BadgeLayoutTests.iPhoneScreen, true),
        (BadgeLayoutTests.iPadKeyboard, BadgeLayoutTests.iPadScreen, true),
        // Split View: the keyboard spans the screen, so it covers this scene's strip too.
        (BadgeLayoutTests.iPadKeyboard, CGRect(x: 0, y: 0, width: 410, height: 1180), true),
        (BadgeLayoutTests.iPadKeyboard, CGRect(x: 410, y: 0, width: 410, height: 1180), true),
        // A Stage Manager window that ends above the keyboard, or beside it.
        (BadgeLayoutTests.iPadKeyboard, CGRect(x: 100, y: 40, width: 600, height: 700), false),
        (CGRect(x: 0, y: 843, width: 400, height: 337), CGRect(x: 420, y: 300, width: 400, height: 880), false),
        // A hidden keyboard, as posted with a hardware keyboard on an iPhone.
        (CGRect(x: 0, y: 874, width: 402, height: 0), BadgeLayoutTests.iPhoneScreen, false),
        // A floating keyboard that does not reach the bottom edge.
        (CGRect(x: 250, y: 500, width: 320, height: 260), BadgeLayoutTests.iPadScreen, false),
        // The shortcut bar shown with a hardware keyboard on an iPad (assumed, not measured).
        (CGRect(x: 0, y: 1125, width: 820, height: 55), BadgeLayoutTests.iPadScreen, false),
        (CGRect(x: 600, y: 1120, width: 200, height: 50), BadgeLayoutTests.iPadScreen, false),
    ])
    func keyboard(keyboard: CGRect, scene: CGRect, hides: Bool) {
        #expect(BadgeLayout.keyboardCovers(keyboard, scene: scene) == hides)
    }

    @Test("with no inset tall enough it is hidden, whatever the screen size")
    func noRoom() {
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 300)
        let insets = BadgeLayout.Insets(top: 10, left: 0, bottom: 10, right: 0)
        #expect(BadgeLayout.frame(in: bounds, insets: insets, size: Self.badge) == nil)
    }
}
#endif
