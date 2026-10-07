import SwiftUI

/// Presentation inputs shared by the scene and surfaces. Production reads the
/// system environment; previews can inject the same values without changing the Mac.
struct SeaDisplayOptions {
    var reduceMotion: Bool
    var reduceTransparency: Bool
    var contrast: ColorSchemeContrast
}

private struct SeaDisplayOverrideKey: EnvironmentKey {
    static let defaultValue: SeaDisplayOptions? = nil
}

extension EnvironmentValues {
    var seaDisplayOverride: SeaDisplayOptions? {
        get { self[SeaDisplayOverrideKey.self] }
        set { self[SeaDisplayOverrideKey.self] = newValue }
    }
}

@propertyWrapper
struct SeaDisplayPreferences: DynamicProperty {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.seaDisplayOverride) private var override

    var wrappedValue: SeaDisplayOptions {
        override ?? SeaDisplayOptions(reduceMotion: reduceMotion,
            reduceTransparency: reduceTransparency, contrast: contrast)
    }
}
