import SwiftUI

/// The motion contract: one table, both clients (Windows mirrors it in
/// `tono-ui/tokens/motion.css`; the numbers are listed in
/// `docs/ui-design-system.md` §7).
///
/// Every entry is feedback for something the user just did or something that
/// just happened to them; nothing here loops. Reduce Motion returns `nil` so
/// the change lands instantly — callers that still need a cue pair the
/// animation with an opacity-only transition.
extension TonoMotion {
    /// Press feedback: applied on press, not on release.
    static func press(reduceMotion: Bool) -> Animation? {
        easeOut(0.1, reduceMotion: reduceMotion)
    }

    /// Hover background lift.
    static func hover(reduceMotion: Bool) -> Animation? {
        easeOut(0.15, reduceMotion: reduceMotion)
    }

    /// A color or fill following a state change.
    static func stateChange(reduceMotion: Bool) -> Animation? {
        easeOut(0.22, reduceMotion: reduceMotion)
    }

    /// Live text replacing live text: stage labels, the active city.
    static func textSwap(reduceMotion: Bool) -> Animation? {
        easeOut(0.22, reduceMotion: reduceMotion)
    }

    /// A surface arriving or leaving. Critically damped: no overshoot.
    static func surfaceIn(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .spring(duration: 0.35, bounce: 0)
    }

    /// The sidebar indicator sliding to the chosen item.
    static func nav(reduceMotion: Bool) -> Animation? {
        easeOut(0.16, reduceMotion: reduceMotion)
    }

    /// Page content switching in the detail column.
    static func pageSwitch(reduceMotion: Bool) -> Animation? {
        easeOut(0.18, reduceMotion: reduceMotion)
    }

    /// A banner growing in or collapsing out.
    static func banner(reduceMotion: Bool) -> Animation? {
        easeOut(0.22, reduceMotion: reduceMotion)
    }

    /// Numeric text rolling once, when a measurement lands.
    static func numeric(reduceMotion: Bool) -> Animation? {
        easeOut(0.3, reduceMotion: reduceMotion)
    }

    /// The one overshoot in the app: the tunnel coming up.
    static func arrival(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .spring(duration: 0.5, bounce: 0.15)
    }

    /// Pairs with `textSwap`: fade plus a 2 pt rise.
    static let textSwapTransition: AnyTransition =
        .opacity.combined(with: .offset(y: 2))

    /// Pairs with `surfaceIn`: fade plus a 6 pt rise.
    static let surfaceTransition: AnyTransition =
        .opacity.combined(with: .offset(y: 6))

    /// Pairs with `pageSwitch`: fade plus a 4 pt rise.
    static let pageTransition: AnyTransition =
        .opacity.combined(with: .offset(y: 4))
}
