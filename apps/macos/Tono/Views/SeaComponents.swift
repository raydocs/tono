import SwiftUI

/// Production always uses the sea appearance; only render fixtures override it.
@propertyWrapper
struct SeaAppearancePreference: DynamicProperty {
    @Environment(\.seaAppearanceOverride) private var previewOverride
    var wrappedValue: Bool { previewOverride ?? true }
}

enum SeaTheme {
    static let text = Color(hex: "F6F2EC")
    static let muted = text.opacity(0.72)
    static let cool = Color(hex: "D5DAFF")
    static let warm = Color(hex: "FFD58E")
    static let ink = Color(hex: "1A0F0A")
    static let tertiary = text.opacity(0.56)
    static let subtle = text.opacity(0.42)
    static let opaquePanel = Color(hex: "17151C")
    static let danger = Color(hex: "FF9A8A")
    static let primaryGradient = LinearGradient(
        stops: [.init(color: Color(hex: "FFE9C4"), location: 0),
                .init(color: Color(hex: "FFB877"), location: 0.6),
                .init(color: Color(hex: "FF9E63"), location: 1)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
}

struct SeaPanelSurface: ViewModifier {
    @SeaAppearancePreference private var enabled
    @SeaDisplayPreferences private var display

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content
                .background {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(display.reduceTransparency || display.contrast == .increased
                            ? AnyShapeStyle(SeaTheme.opaquePanel)
                            : AnyShapeStyle(LinearGradient(colors: [.white.opacity(0.075), .white.opacity(0.04)],
                                                         startPoint: .top, endPoint: .bottom)))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(display.contrast == .increased ? 0.45 : (display.reduceTransparency ? 0.14 : 0.06)), lineWidth: 1)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(LinearGradient(colors: [.white.opacity(0.12), .clear], startPoint: .top, endPoint: .bottom), lineWidth: 1)
                }
        } else { content }
    }
}

struct SeaPanel<Content: View>: View {
    let title: String?
    let icon: String?
    let content: Content

    init(_ title: String? = nil, icon: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let title {
                Text(LocalizedStringKey(title))
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(SeaTheme.muted)
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(SeaPanelSurface())
    }
}

struct SeaPageHeading: View {
    let title: String
    var subtitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(LocalizedStringKey(title))
                .font(.system(size: 28, weight: .light)).tracking(-0.5)
                .foregroundStyle(SeaTheme.text).accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(LocalizedStringKey(subtitle)).font(.system(size: 13))
                    .foregroundStyle(SeaTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Sea primary chrome; a render override can still exercise legacy prominence.
struct SeaPrimaryAction: ViewModifier {
    @SeaAppearancePreference private var enabled

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.buttonStyle(SeaButtonStyle(variant: .primary))
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}
