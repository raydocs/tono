import Foundation

/// When the sea scene stops redrawing. The scene keeps every element and its full 30 Hz motion in
/// the foreground; it only holds its last frame while nobody can see it move or the phone asks apps
/// to spend less: the app is not active (Notification Center, app switcher), a sheet covers Home,
/// Low Power Mode is on, or the system is under serious or critical thermal pressure.
public enum SceneAnimationPolicy {
    public static func paused(appActive: Bool, sheetCovering: Bool, lowPowerMode: Bool,
                              thermal: ProcessInfo.ThermalState) -> Bool {
        if !appActive || sheetCovering || lowPowerMode { return true }
        return thermal == .serious || thermal == .critical
    }
}
