//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

#if MAP_LOCAL_ENABLED
import CoreGraphics
import Foundation
import MapLocalCore

/// Whether the device's first preferred language is Korean.
///
/// The badge and its sheet follow the device's first preferred language: Korean for `ko`,
/// English otherwise. `Bundle.main.preferredLocalizations` would follow the host app's
/// localizations instead, which this package does not control, so an English-only app on a
/// Korean device would get English.
private func isKorean(_ preferredLanguages: [String]) -> Bool {
    preferredLanguages.first.map { Locale(identifier: $0).language.languageCode == .korean } ?? false
}

/// The text of the badge shown over the app, or nil to hide it.
///
/// The badge shows exactly when something applies (`EngineState.effects`), and shows
/// nothing at all otherwise: Map Local off, no allowed host, no rule that can answer.
/// It is short enough to sit beside the Dynamic Island; 🔑 marks a mocked session, as it
/// does in the panel, and VoiceOver reads it out in words.
enum BadgeText {
    static func make(_ state: EngineState) -> String? {
        guard let effects = state.effects else { return nil }
        return effects.mayHoldMockedSession ? "Map Local 🔑" : "Map Local"
    }

    /// What VoiceOver reads for the badge, which is a button that opens the sheet.
    static func accessibility(
        _ state: EngineState,
        preferredLanguages: [String] = Locale.preferredLanguages
    ) -> (label: String, hint: String)? {
        guard let effects = state.effects else { return nil }
        let korean = isKorean(preferredLanguages)
        let label = !effects.mayHoldMockedSession ? "Map Local"
            : korean ? "Map Local, 목업 세션" : "Map Local, mocked session"
        return (label, korean ? "적용 중인 내용을 보고 끌 수 있습니다" : "Shows what applies and lets you turn it off")
    }
}

/// What the sheet opened from the badge says, and the revision it was opened on.
struct BadgeSheet: Equatable {
    var title: String
    var message: String
    var turnOff: String
    var cancel: String
    /// Shown when the write fails, as when the configuration is read-only.
    var failure: String
    /// Turning off is based on this revision, so a change made while the sheet was open is
    /// a conflict, as it is for the panel.
    var baseRevision: Int
    /// Whether the message leads with the sign-out guidance. A mocked session is recorded
    /// without a new revision, so turning off checks this too (`BadgeControl.confirm`).
    var sessionAtRisk: Bool

    /// Nil when nothing applies, so there is no badge to open it from.
    ///
    /// When turning off could send a mocked token to the real server, the message leads
    /// with the panel's own sign-out guidance (`View.sessionAtRisk`).
    static func make(_ state: EngineState, preferredLanguages: [String] = Locale.preferredLanguages) -> BadgeSheet? {
        guard let effects = state.effects else { return nil }
        let korean = isKorean(preferredLanguages)
        var message = Self.message(effects, preferredLanguages: preferredLanguages)
        if effects.sessionAtRisk {
            let guidance = korean
                ? "Map Local을 끄기 전에 앱에서 로그아웃하세요. 목업 토큰이 실서버로 가면 401로 강제 로그아웃될 수 있습니다."
                : "Log out in the app before you turn off Map Local. If a mocked token reaches the real server, a 401 can force a logout."
            message = guidance + "\n\n" + message
        }
        return BadgeSheet(
            title: "Map Local",
            message: message,
            turnOff: korean ? "Map Local 끄기" : "Turn off Map Local",
            cancel: korean ? "취소" : "Cancel",
            failure: korean ? "Map Local을 끄지 못했습니다. 설정을 저장할 수 없습니다."
                : "Couldn't turn off Map Local: its configuration can't be saved.",
            baseRevision: state.configuration.revision,
            sessionAtRisk: effects.sessionAtRisk
        )
    }

    /// How many rules the message names before counting the rest.
    static let listedRules = 3

    /// What applies, line by line: how many rules mock, the first few as the panel labels
    /// them, how many more, whether requests without a rule are blocked or failed, and whether a
    /// mocked session may remain.
    static func message(_ effects: Effects, preferredLanguages: [String] = Locale.preferredLanguages) -> String {
        let korean = isKorean(preferredLanguages)
        var lines: [String] = []
        let count = effects.rules.count
        if count > 0 {
            lines.append(korean ? "목업 규칙 \(count)개가 적용 중입니다" : "Mock rules applying: \(count)")
            lines += effects.rules.prefix(listedRules).map(label)
            if count > listedRules {
                let rest = count - listedRules
                lines.append(korean ? "외 \(rest)개" : "and \(rest) more")
            }
        }
        switch effects.unmatched {
        case .block:
            lines.append(korean ? "차단: 규칙 없는 요청" : "Blocked: requests without a rule")
        case let .fail(error):
            lines.append("\(errorName(error, korean: korean)): " + (korean ? "규칙 없는 요청" : "requests without a rule"))
        case .passthrough, nil:
            break
        }
        if effects.mayHoldMockedSession {
            lines.append(korean ? "앱에 목업 세션이 남아 있을 수 있습니다." : "The app may hold a mocked session.")
        }
        return lines.joined(separator: "\n")
    }

    /// An error as the panel's "Error" menu names it, without the code.
    static func errorName(_ error: MockError, korean: Bool) -> String {
        switch error {
        case .notConnectedToInternet: korean ? "인터넷 연결 없음" : "No internet connection"
        case .connectionLost: korean ? "연결 끊김" : "Connection lost"
        case .timedOut: korean ? "시간 초과" : "Timed out"
        }
    }

    /// A rule as the panel labels it (`ruleLabel` in `Panel/src/rules.ts`): method, path and
    /// query conditions. The engine keeps the conditions unordered, so they are sorted by
    /// key here, where the panel keeps the order they were written in.
    static func label(_ rule: Rule) -> String {
        let query = rule.match.query.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
        return "\(rule.match.method) \(rule.match.path)" + (query.isEmpty ? "" : " ?\(query)")
    }
}

/// What the badge's sheet does.
enum BadgeControl {
    enum Outcome: Equatable {
        case turnedOff
        /// The configuration changed after the sheet opened. Nothing was written; the badge
        /// follows the new state and can be tapped again.
        case conflict
        /// The configuration is read-only, or could not be saved.
        case failed
    }

    enum Step: Equatable {
        case turnOff(baseRevision: Int)
        /// The sign-out guidance became due after the sheet opened: show the sheet again
        /// with it instead of writing.
        case askAgain
    }

    /// What tapping turn off does, given the sheet that was shown and the sheet the state
    /// would show now.
    ///
    /// Recording a mocked sign-in does not raise the revision, so the revision check alone
    /// would turn off without the guidance the user never saw. Every other change is left
    /// to the revision check.
    static func confirm(_ shown: BadgeSheet, now: BadgeSheet?) -> Step {
        if now?.sessionAtRisk == true, !shown.sessionAtRisk { return .askAgain }
        return .turnOff(baseRevision: shown.baseRevision)
    }

    /// Turns Map Local off through the same write the panel's switch makes,
    /// `configuration.patch {"enabled": false}`: checked against `baseRevision`, saved, and
    /// broadcast, so the panel updates from its usual state stream.
    ///
    /// The mocked session mark is left alone. Only the user's confirmation that they
    /// signed out clears it.
    static func turnOff(_ engine: MapLocalEngine, baseRevision: Int) -> Outcome {
        do {
            try engine.apply(.patch(enabled: false, allowedHosts: nil, unmatched: nil, order: nil), baseRevision: baseRevision)
            return .turnedOff
        } catch ApplyError.conflict {
            return .conflict
        } catch {
            return .failed
        }
    }
}

/// Where the badge sits: in a strip of the screen the app does not lay out content in, so
/// it never covers a navigation title, a popover or a tab bar, and takes no touch meant for
/// one.
///
/// Measured in the Necto simulation: centred under the Dynamic Island, the badge covered the
/// app's navigation title on pushed screens and the first row of its popover menus.
/// Measured on an iPhone 17 Pro simulator (iOS 26.4), the status bar cannot hold a badge
/// that takes taps: the system draws the status bar above every app window, so a badge over
/// the clock is unreadable, and it keeps every touch inside the status bar frame (0–54pt of
/// a 62pt inset) without handing it to any app window. Only 8pt are left below it.
///
/// So it goes in the home indicator strip, which takes taps (measured), at the trailing side
/// and clear of the rounded corner: beside the indicator and centred in the strip, which
/// keeps it under the floating search fields of iOS 26 (measured: they end 29pt above the
/// bottom edge, inside the 34pt strip; tab bars are assumed to share that baseline). Where it does not fit beside the
/// indicator it goes above it. A home button iPhone has no such strip, and the badge goes
/// at the leading edge of its status bar, where it shows but may not take taps. With no
/// strip at all (a home button iPhone with the status bar hidden), it is hidden.
///
/// The keyboard reaches into the strip with its dictation key, so the badge hides while
/// a keyboard covers the bottom of its scene (`keyboardCovers`).
enum BadgeLayout {
    struct Insets: Equatable {
        var top: CGFloat
        var left: CGFloat
        var bottom: CGFloat
        var right: CGFloat
    }

    /// Keeps the badge off the screen's rounded corner, up to about a 62pt corner radius at
    /// the badge's height in the strip.
    static let cornerClearance: CGFloat = 34
    /// The home indicator is 134pt wide, so this keeps 4pt either side of it, and it ends
    /// about 13pt above the bottom edge.
    static let indicatorWidth: CGFloat = 142
    static let indicatorTop: CGFloat = 15
    static let statusBarMargin: CGFloat = 8

    /// Nil when there is no such strip, as on a home button iPhone with the status bar hidden:
    /// anywhere else the badge would cover the app's own controls.
    static func frame(in bounds: CGRect, insets: Insets, size: CGSize) -> CGRect? {
        let width = min(size.width, bounds.width)
        let height = min(size.height, bounds.height)
        let trailing = max(bounds.minX, bounds.maxX - max(insets.right, cornerClearance) - width)
        if insets.bottom >= height, trailing >= bounds.midX + indicatorWidth / 2 {
            let bottom = bounds.maxY - (insets.bottom - height) / 2
            return CGRect(x: trailing, y: bottom - height, width: width, height: height)
        }
        if insets.bottom >= height + indicatorTop {
            let bottom = bounds.maxY - indicatorTop
            return CGRect(x: trailing, y: bottom - height, width: width, height: height)
        }
        if insets.top >= height {
            let x = min(bounds.minX + max(insets.left, statusBarMargin), bounds.maxX - width)
            return CGRect(x: x, y: bounds.minY + (insets.top - height) / 2, width: width, height: height)
        }
        return nil
    }

    /// Software keyboards measured on iOS 26.4 simulators are 335pt (iPhone 17 Pro) and
    /// 337pt (iPad Air 11-inch) tall. The shortcut bar an iPad shows with a hardware keyboard
    /// is assumed to be well under this (not measured); it leaves the badge shown.
    static let keyboardMinimumHeight: CGFloat = 150

    /// Whether a keyboard frame covers the bottom of the badge's scene, both in the screen's
    /// coordinates.
    ///
    /// Keyboard notifications reach every scene, so a keyboard shown in another window on
    /// an iPad must leave this badge alone unless it actually covers this scene's bottom
    /// edge. A floating keyboard, a hidden one (zero height) and the shortcut bar do not.
    static func keyboardCovers(_ keyboard: CGRect, scene: CGRect) -> Bool {
        keyboard.height >= keyboardMinimumHeight
            && keyboard.minX < scene.maxX && keyboard.maxX > scene.minX
            && keyboard.minY < scene.maxY && keyboard.maxY >= scene.maxY
    }

    /// Whether a touch at `point` is the badge's. Only the shown pill takes touches; every
    /// other point of the badge's window passes through to the app.
    static func accepts(_ point: CGPoint, pill: CGRect?) -> Bool {
        pill?.contains(point) ?? false
    }
}

/// Which window of the badge's scene presents the sheet.
enum BadgePresenter {
    /// One of the app's windows in the scene, the badge's own left out.
    struct Window: Equatable {
        var level: CGFloat
        var isKey = false
        var isHidden = false
        var hasRoot = true
    }

    /// The index of the window whose top-most controller presents the sheet, or nil to
    /// present it from the badge's own window.
    ///
    /// The app's key window at the normal level, or its first normal-level window, as the
    /// status bar follows. A scene with no such window (an app that shows only a window of
    /// its own level) still gets the sheet: from its key window, then from its top-most
    /// window, and with none it comes from the badge's window, so a tap is never ignored.
    static func pick(_ windows: [Window]) -> Int? {
        let usable = windows.indices.filter { !windows[$0].isHidden && windows[$0].hasRoot }
        let normal = usable.filter { windows[$0].level == 0 }
        let top = usable.map { windows[$0].level }.max()
        return normal.first { windows[$0].isKey } ?? normal.first
            ?? usable.first { windows[$0].isKey }
            ?? usable.last { windows[$0].level == top }
    }
}

#if canImport(UIKit) && !os(macOS) && !targetEnvironment(macCatalyst)
import UIKit

/// Shows a small badge window on every scene, without any help from the app.
///
/// Only the pill takes touches; tapping it opens a sheet that says what applies and turns
/// Map Local off. The presentation is UIKit glue and is not unit tested: what the sheet
/// says and what turning off writes are, in `BadgeSheet` and `BadgeControl`.
@MainActor
final class MapLocalBadge {
    private static var shared: MapLocalBadge?
    private let engine: MapLocalEngine
    private var windows: [ObjectIdentifier: BadgeWindow] = [:]
    private var state: EngineState?
    /// The last keyboard frame shown on each screen, in its coordinates. The keyboard
    /// reaches into the home indicator strip, where its dictation key sits.
    private var keyboards: [ObjectIdentifier: CGRect] = [:]

    private init(engine: MapLocalEngine) { self.engine = engine }

    nonisolated static func startIfNeeded() {
        Task { @MainActor in
            guard shared == nil, let engine = MapLocalRuntime.engine else { return }
            let badge = MapLocalBadge(engine: engine)
            shared = badge
            badge.observeScenes()
            for await state in engine.stateEvents() {
                badge.update(state)
            }
        }
    }

    private func observeScenes() {
        // Measured: there is no scene yet when `App.init` runs. Observe scenes as they
        // connect, and attach to those already connected.
        NotificationCenter.default.addObserver(
            forName: UIScene.didActivateNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let scene = notification.object as? UIWindowScene
            MainActor.assumeIsolated {
                if let scene { self?.attach(scene) }
            }
        }
        NotificationCenter.default.addObserver(
            forName: UIScene.didDisconnectNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let id = (notification.object as AnyObject?).map(ObjectIdentifier.init)
            MainActor.assumeIsolated {
                if let id { self?.windows.removeValue(forKey: id) }
            }
        }
        // Measured: the notification's object is the keyboard's screen, and its frame is in
        // that screen's coordinates. It reaches every scene, so each badge checks whether the
        // keyboard covers its own scene (`BadgeLayout.keyboardCovers`).
        for (name, shown) in [
            (UIResponder.keyboardWillShowNotification, true),
            (UIResponder.keyboardWillChangeFrameNotification, true),
            (UIResponder.keyboardWillHideNotification, false),
        ] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                let screen = (notification.object as? UIScreen).map(ObjectIdentifier.init)
                let frame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
                MainActor.assumeIsolated {
                    guard let self, let screen else { return }
                    self.keyboards[screen] = shown ? frame : nil
                    self.windows.values.forEach(self.render)
                }
            }
        }
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.forEach(attach)
    }

    private func attach(_ scene: UIWindowScene) {
        let key = ObjectIdentifier(scene)
        guard windows[key] == nil else { return }
        let window = BadgeWindow(windowScene: scene)
        window.windowLevel = .statusBar + 1
        window.backgroundColor = .clear
        var configuration = UIButton.Configuration.filled()
        configuration.baseBackgroundColor = UIColor.systemOrange.withAlphaComponent(0.92)
        configuration.baseForegroundColor = .white
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 2, leading: 8, bottom: 2, trailing: 8)
        configuration.titleLineBreakMode = .byClipping
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var attributes = attributes
            attributes.font = .systemFont(ofSize: 11, weight: .semibold)
            return attributes
        }
        let pill = UIButton(configuration: configuration)
        pill.accessibilityTraits = .button
        pill.addAction(UIAction { [weak self, weak window] _ in
            guard let window else { return }
            self?.presentSheet(from: window)
        }, for: .primaryActionTriggered)
        let root = BadgeRootController(scene: scene, badgeWindow: window, pill: pill)
        root.view.addSubview(pill)
        window.rootViewController = root
        window.pill = pill
        windows[key] = window
        render(window)
    }

    private func update(_ state: EngineState) {
        self.state = state
        windows.values.forEach(render)
    }

    private func render(_ window: BadgeWindow) {
        let text = state.flatMap(BadgeText.make)
        let spoken = state.flatMap { BadgeText.accessibility($0) }
        window.pill?.configuration?.title = text
        window.pill?.accessibilityLabel = spoken?.label
        window.pill?.accessibilityHint = spoken?.hint
        window.isHidden = text == nil || keyboardCovers(window)
        window.rootViewController?.view.setNeedsLayout()
    }

    private func keyboardCovers(_ window: BadgeWindow) -> Bool {
        guard let keyboard = keyboards[ObjectIdentifier(window.screen)] else { return false }
        let scene = window.convert(window.bounds, to: window.screen.coordinateSpace)
        return BadgeLayout.keyboardCovers(keyboard, scene: scene)
    }

    /// Presents the sheet from the app's top-most controller in the badge's scene, or from
    /// the badge's own window when the app has none (`BadgePresenter`).
    ///
    /// Does nothing when that controller is an alert or is on its way in or out: the badge
    /// stays above an alert, and a second sheet must not stack on the first.
    private func presentSheet(from window: BadgeWindow) {
        guard let sheet = BadgeSheet.make(engine.state),
              let pill = window.pill,
              let presenter = (window.rootViewController as? BadgeRootController)?.presenter,
              !(presenter is UIAlertController),
              !presenter.isBeingPresented, !presenter.isBeingDismissed,
              presenter.viewIfLoaded?.window != nil
        else {
            return
        }
        let alert = UIAlertController(title: sheet.title, message: sheet.message, preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: sheet.turnOff, style: .destructive) { [weak self, weak window] _ in
            guard let self else { return }
            guard case let .turnOff(baseRevision) = BadgeControl.confirm(sheet, now: BadgeSheet.make(self.engine.state)) else {
                if let window { self.presentSheet(from: window) }
                return
            }
            switch BadgeControl.turnOff(self.engine, baseRevision: baseRevision) {
            case .turnedOff:
                break
            case .conflict:
                // Changed while the sheet was open: ask again with what applies now. With
                // nothing left to turn off, there is no badge and no sheet.
                if let window { self.presentSheet(from: window) }
            case .failed:
                self.presentFailure(sheet.failure, from: presenter)
            }
        })
        alert.addAction(UIAlertAction(title: sheet.cancel, style: .cancel))
        if let popover = alert.popoverPresentationController, let view = presenter.view {
            // The pill is in another window, so it cannot be the source view. Its frame is
            // carried over through the screen's coordinate space.
            let space = window.screen.coordinateSpace
            popover.sourceView = view
            popover.sourceRect = view.convert(pill.convert(pill.bounds, to: space), from: space)
            popover.permittedArrowDirections = [.up, .down]
        }
        presenter.present(alert, animated: true)
    }

    private func presentFailure(_ message: String, from presenter: UIViewController) {
        guard presenter.presentedViewController == nil, presenter.viewIfLoaded?.window != nil else { return }
        let alert = UIAlertController(title: "Map Local", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presenter.present(alert, animated: true)
    }
}

/// The badge's window. It takes only touches on the pill, and on a sheet it presents
/// itself (`BadgePresenter`), and never becomes the key window,
/// so the app keeps the keyboard and every touch outside the pill.
private final class BadgeWindow: UIWindow {
    weak var pill: UIButton?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        // The sheet presented from this window, when the app had no window to present it.
        if rootViewController?.presentedViewController != nil { return super.hitTest(point, with: event) }
        guard let pill, !pill.isHidden,
              BadgeLayout.accepts(point, pill: pill.convert(pill.bounds, to: self))
        else {
            return nil
        }
        return super.hitTest(point, with: event)
    }

    override var canBecomeKey: Bool { false }
}

/// Places the badge with `BadgeLayout`, and hands the status bar decision to the app.
///
/// Measured: the root of a window above the status bar decides how the status bar looks,
/// so left alone it would show a status bar the app had hidden. It defers to the topmost
/// controller of the app's window in the same scene.
private final class BadgeRootController: UIViewController {
    private weak var scene: UIWindowScene?
    private weak var badgeWindow: UIWindow?
    private let pill: UIButton

    init(scene: UIWindowScene, badgeWindow: UIWindow, pill: UIButton) {
        self.scene = scene
        self.badgeWindow = badgeWindow
        self.pill = pill
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let insets = view.safeAreaInsets
        let frame = BadgeLayout.frame(
            in: view.bounds,
            insets: .init(top: insets.top, left: insets.left, bottom: insets.bottom, right: insets.right),
            size: pill.intrinsicContentSize
        )
        pill.isHidden = frame == nil
        if let frame { pill.frame = frame }
    }

    /// The app's top-most controller in this scene: the root of its key window, or of its
    /// first normal-level window, followed through everything it presents.
    var appController: UIViewController? {
        let appWindows = scene?.windows.filter { $0 !== badgeWindow && $0.windowLevel == .normal } ?? []
        var top = (appWindows.first(where: \.isKeyWindow) ?? appWindows.first)?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }

    /// The controller the sheet is presented from: the top-most controller of the app's
    /// window that `BadgePresenter` picks, or this controller, through everything either
    /// presents.
    ///
    /// Kept apart from `appController`, which the status bar follows and which must never
    /// lead back to this controller.
    var presenter: UIViewController {
        let appWindows = scene?.windows.filter { $0 !== badgeWindow } ?? []
        let picked = BadgePresenter.pick(appWindows.map {
            BadgePresenter.Window(level: $0.windowLevel.rawValue, isKey: $0.isKeyWindow, isHidden: $0.isHidden, hasRoot: $0.rootViewController != nil)
        })
        var top: UIViewController = picked.flatMap { appWindows[$0].rootViewController } ?? self
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }

    override var childForStatusBarHidden: UIViewController? { appController }
    override var childForStatusBarStyle: UIViewController? { appController }
}
#endif
#endif
