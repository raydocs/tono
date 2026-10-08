import SwiftUI

private struct SeaAccentKey: EnvironmentKey {
    static let defaultValue = SeaTheme.cool
}

extension EnvironmentValues {
    var seaAccent: Color {
        get { self[SeaAccentKey.self] }
        set { self[SeaAccentKey.self] = newValue }
    }
}

enum SeaControlSize {
    case page, row
    var height: CGFloat { self == .page ? 40 : 32 }
}

enum SeaButtonVariant {
    case primary, quiet, text, danger
}

struct SeaButtonStyle: ButtonStyle {
    var variant: SeaButtonVariant = .quiet
    var size: SeaControlSize = .page
    @Environment(\.seaAccent) private var accent
    @Environment(\.isEnabled) private var enabled
    @SeaDisplayPreferences private var display

    func makeBody(configuration: Configuration) -> some View {
        SeaStyledButton(configuration: configuration, variant: variant, size: size,
                        accent: accent, enabled: enabled, display: display)
    }
}

private struct SeaStyledButton: View {
    let configuration: ButtonStyleConfiguration
    let variant: SeaButtonVariant
    let size: SeaControlSize
    let accent: Color
    let enabled: Bool
    let display: SeaDisplayOptions
    @State private var hovered = false

    private var foreground: Color {
        switch variant {
        case .primary: SeaTheme.ink
        case .quiet: SeaTheme.text
        case .text: accent
        case .danger: SeaTheme.danger
        }
    }

    var body: some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, variant == .text ? 0 : 18)
            .frame(minHeight: size.height)
            .background {
                if variant == .primary {
                    Capsule().fill(SeaTheme.primaryGradient)
                } else if variant == .quiet {
                    Capsule().fill(display.reduceTransparency ? SeaTheme.opaquePanel : .white.opacity(0.08))
                }
            }
            .overlay {
                if display.contrast == .increased {
                    Capsule().strokeBorder(foreground.opacity(0.45), lineWidth: 1)
                }
            }
            .contentShape(Capsule())
            .opacity(enabled ? (hovered ? 0.88 : 1) : 0.42)
            .scaleEffect(SeaHomePresentation.pressScale(pressed: configuration.isPressed, reduceMotion: display.reduceMotion))
            .animation(TonoMotion.press(reduceMotion: display.reduceMotion), value: configuration.isPressed)
            .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hovered)
            .onHover { hovered = $0 }
    }
}

enum SeaLegacyButtonStyle { case automatic, plain, bordered, prominent, gatePrimary, gateSecondary, link, borderless }

struct SeaActionStyle: ViewModifier {
    var variant: SeaButtonVariant = .quiet
    var size: SeaControlSize = .page
    var legacy: SeaLegacyButtonStyle = .plain
    @SeaAppearancePreference private var sea

    @ViewBuilder func body(content: Content) -> some View {
        if sea { content.buttonStyle(SeaButtonStyle(variant: variant, size: size)) }
        else {
            switch legacy {
            case .automatic: content.buttonStyle(.automatic)
            case .plain: content.buttonStyle(.plain)
            case .bordered: content.buttonStyle(.bordered)
            case .prominent: content.buttonStyle(.borderedProminent)
            case .gatePrimary: content.buttonStyle(GateProminentButtonStyle())
            case .gateSecondary: content.buttonStyle(GateSecondaryButtonStyle())
            case .link: content.buttonStyle(.link)
            case .borderless: content.buttonStyle(.borderless)
            }
        }
    }
}

struct SeaToggleStyle: ToggleStyle {
    @Environment(\.seaAccent) private var accent
    @Environment(\.isEnabled) private var enabled
    @SeaDisplayPreferences private var display

    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            Capsule().fill(configuration.isOn ? accent : .white.opacity(0.16))
                .frame(width: 36, height: 20)
                .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                    Circle().fill(configuration.isOn ? Color(hex: "171421") : SeaTheme.text)
                        .frame(width: 16, height: 16).padding(2)
                }
                .overlay {
                    if display.contrast == .increased {
                        Capsule().strokeBorder(SeaTheme.text.opacity(0.45), lineWidth: 1)
                    }
                }
        }
        .buttonStyle(.plain)
        .opacity(enabled ? 1 : 0.42)
        .animation(display.reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isOn)
        .accessibilityRepresentation {
            Toggle(isOn: configuration.$isOn) { configuration.label }.toggleStyle(.switch)
        }
    }
}

struct SeaChoice: View {
    let label: LocalizedStringKey
    @Binding var selection: String
    let options: [String]
    @Environment(\.seaAccent) private var accent
    @SeaDisplayPreferences private var display

    var body: some View {
        if options.count <= 4 {
            HStack(spacing: 2) {
                ForEach(options, id: \.self) { option in
                    Button { selection = option } label: {
                        Text(LocalizedStringKey(option)).font(.system(size: 13))
                            .foregroundStyle(selection == option ? SeaTheme.text : SeaTheme.muted)
                            .padding(.horizontal, 13).padding(.vertical, 5)
                            .background {
                                if selection == option {
                                    Capsule().fill(.white.opacity(0.12))
                                        .overlay {
                                            Capsule().strokeBorder(LinearGradient(colors: [.white.opacity(0.12), .clear],
                                                startPoint: .top, endPoint: .center), lineWidth: 1)
                                        }
                                }
                            }
                            .contentShape(Capsule())
                    }.buttonStyle(.plain)
                }
            }
            .padding(3)
            .background(display.reduceTransparency ? SeaTheme.opaquePanel : .white.opacity(0.05), in: Capsule())
            .overlay { if display.contrast == .increased { Capsule().strokeBorder(accent.opacity(0.45), lineWidth: 1) } }
            .accessibilityRepresentation {
                Picker(label, selection: $selection) {
                    ForEach(options, id: \.self) { Text(LocalizedStringKey($0)).tag($0) }
                }.pickerStyle(.segmented)
            }
        } else {
            // A quiet capsule that opens a menu: the borderless menu draws only
            // its title, so the capsule and the one shared chevron sit around it
            // instead of the platform pop-up arrow.
            HStack(spacing: 8) {
                Menu {
                    ForEach(options, id: \.self) { option in
                        Button { selection = option } label: {
                            if selection == option { Label(LocalizedStringKey(option), systemImage: "checkmark") }
                            else { Text(LocalizedStringKey(option)) }
                        }
                    }
                } label: {
                    Text(LocalizedStringKey(selection)).font(.system(size: 13))
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityLabel(label)
                SeaChevron(expanded: true).allowsHitTesting(false)
            }
            .foregroundStyle(SeaTheme.text)
            .padding(.horizontal, 14)
            .frame(minHeight: SeaControlSize.row.height)
            .background(display.reduceTransparency ? SeaTheme.opaquePanel : .white.opacity(0.08), in: Capsule())
            .overlay { if display.contrast == .increased { Capsule().strokeBorder(accent.opacity(0.45), lineWidth: 1) } }
        }
    }
}

struct SeaFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        SeaFocusedField { configuration.textFieldStyle(.plain) }
    }
}

private struct SeaFocusedField<Content: View>: View {
    @ViewBuilder let content: Content
    @FocusState private var focused: Bool

    var body: some View {
        content.focused($focused).modifier(SeaFieldSurface(focused: focused))
    }
}

struct SeaFieldSurface: ViewModifier {
    var focused: Bool = false
    @Environment(\.seaAccent) private var accent
    @SeaDisplayPreferences private var display
    func body(content: Content) -> some View {
        content.font(.system(size: 15)).foregroundStyle(SeaTheme.text)
            .padding(.horizontal, 14).frame(minHeight: 48)
            .background(display.reduceTransparency ? SeaTheme.opaquePanel : .white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12).strokeBorder(
                    focused ? accent : .white.opacity(display.contrast == .increased ? 0.45 : 0.09), lineWidth: 1)
            }
    }
}

struct SeaDisclosureTreatment: ViewModifier {
    @SeaAppearancePreference private var sea
    @ViewBuilder func body(content: Content) -> some View {
        if sea { content.disclosureGroupStyle(SeaDisclosureStyle()) }
        else { content }
    }
}


enum SeaTagKind { case neutral, good, attention }

struct SeaTag: View {
    let title: LocalizedStringKey
    var kind: SeaTagKind = .neutral
    @SeaDisplayPreferences private var display
    private var foreground: Color {
        switch kind { case .neutral: SeaTheme.muted; case .good: Color(hex: "BFECC9"); case .attention: Color(hex: "FFD9A0") }
    }
    private var fill: Color {
        switch kind { case .neutral: .white.opacity(0.08); case .good: Color(hex: "A0E6B4").opacity(0.14); case .attention: Color(hex: "FFC878").opacity(0.18) }
    }
    var body: some View {
        Text(title).font(.system(size: 12)).foregroundStyle(foreground)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(display.reduceTransparency ? SeaTheme.opaquePanel : fill, in: Capsule())
            .overlay {
                if display.contrast == .increased {
                    Capsule().strokeBorder(foreground.opacity(0.45), lineWidth: 1)
                }
            }
    }
}

struct SeaChevron: View {
    var expanded: Bool
    @SeaDisplayPreferences private var display
    var body: some View {
        // The Windows summary marker: a 6 pt corner of two 1.5 pt strokes at
        // 72 % of the text colour, pointing right and turning down when open.
        SeaChevronShape()
            .stroke(style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
            .frame(width: 6, height: 9)
            .opacity(0.72)
            .rotationEffect(.degrees(expanded ? 90 : 0))
            .animation(display.reduceMotion ? nil : .easeOut(duration: 0.14), value: expanded)
            .accessibilityHidden(true)
    }
}

private struct SeaChevronShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + 1, y: rect.minY + 1))
        path.addLine(to: CGPoint(x: rect.maxX - 1, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.minX + 1, y: rect.maxY - 1))
        return path
    }
}

struct SeaDisclosureStyle: DisclosureGroupStyle {
    @SeaDisplayPreferences private var display
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(TonoMotion.stateChange(reduceMotion: display.reduceMotion)) {
                    configuration.isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) { SeaChevron(expanded: configuration.isExpanded); configuration.label }
                    .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }.buttonStyle(.plain)
            if configuration.isExpanded { configuration.content }
        }
        .accessibilityRepresentation {
            DisclosureGroup(isExpanded: configuration.$isExpanded) {
                configuration.content
            } label: { configuration.label }.disclosureGroupStyle(.automatic)
        }
    }
}
