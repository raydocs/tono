import SwiftUI

/// The existing device preference and the read-only render-fixture override.
@propertyWrapper
struct SeaAppearancePreference: DynamicProperty {
    @AppStorage(SeaAppearance.enabledKey, store: AppProfile.defaults) private var stored = SeaAppearance.defaultEnabled
    @Environment(\.seaAppearanceOverride) private var previewOverride
    var wrappedValue: Bool { previewOverride ?? stored }
}

enum SeaTheme {
    static let text = Color(hex: "F6F2EC")
    static let muted = text.opacity(0.72)
    static let cool = Color(hex: "D5DAFF")
    static let warm = Color(hex: "FFD58E")
    static let ink = Color(hex: "1A0F0A")
    static let panel = Color(hex: "211D1E")
    static let panelTop = Color(hex: "272322")
    static let panelBottom = Color(hex: "1E1B1B")
    static let danger = Color(hex: "FF9A8A")
    static let primaryGradient = LinearGradient(
        stops: [.init(color: Color(hex: "FFE9C4"), location: 0),
                .init(color: Color(hex: "FFB877"), location: 0.6),
                .init(color: Color(hex: "FF9E63"), location: 1)],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )
}

/// Secondary pages use an opaque/static panel, not compositor-backed glass.
struct SeaPanelSurface: ViewModifier {
    @SeaAppearancePreference private var enabled
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content
                .background {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(LinearGradient(
                            colors: reduceTransparency || contrast == .increased
                                ? [Color(hex: "302A28"), Color(hex: "282323")]
                                : [SeaTheme.panelTop, SeaTheme.panelBottom],
                            startPoint: .top, endPoint: .bottom
                        ))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(contrast == .increased ? 0.45 : 0.12), lineWidth: 1)
                }
        } else {
            content
        }
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
                HStack(spacing: 10) {
                    if let icon {
                        Image(systemName: icon).foregroundStyle(SeaTheme.cool).accessibilityHidden(true)
                    }
                    Text(LocalizedStringKey(title))
                        .font(.system(size: 17, weight: .medium))
                        .accessibilityAddTraits(.isHeader)
                }
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

/// Sea primary chrome; an explicit opt-out retains native legacy prominence.
struct SeaPrimaryAction: ViewModifier {
    @SeaAppearancePreference private var enabled

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.buttonStyle(GateProminentButtonStyle()).controlSize(.small)
        } else {
            content.buttonStyle(.borderedProminent)
        }
    }
}
