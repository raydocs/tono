import Foundation

/// How often the sea scene redraws. Every element keeps moving while anyone can see it; Low Power
/// Mode and serious thermal pressure only halve the rate. The scene holds the still frame Reduce
/// Motion draws while nothing can see it move (the app is not active, or a sheet hides Home) and at
/// critical thermal pressure.
public enum SceneAnimationPolicy {
    /// `ProcessInfo.ThermalState` as the policy reads it. Foundation on Linux, where TonoKit's tests
    /// also run, has no thermal state, so the app maps the system value into this.
    public enum Thermal: Sendable { case nominal, fair, serious, critical }

    /// Seconds between redraws, or nil to hold the still frame.
    public static func frameInterval(appActive: Bool, sheetCovering: Bool, lowPowerMode: Bool,
                                     thermal: Thermal) -> Double? {
        if !appActive || sheetCovering || thermal == .critical { return nil }
        return lowPowerMode || thermal == .serious ? 1.0 / 15 : 1.0 / 30
    }
}

/// The localization key for Home's status line while connected. Only a running Stable graph claims
/// the whole phone; Three-tier sends ordinary traffic direct, and a tunnel whose graph is not
/// confirmed takes that narrower claim too. `home`: the line names the Home exit's region.
public enum ConnectedStatusKey {
    public static func key(runningMode: RoutingMode?, home: Bool) -> String {
        if runningMode == .stable { return home ? "status_protected_home" : "status_protected" }
        return home ? "status_split_home" : "status_split"
    }
}
