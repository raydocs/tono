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
        case .text: hovered && enabled ? SeaTheme.text : accent
        case .danger: hovered && enabled ? Color(hex: "FFB5A8") : SeaTheme.danger
        }
    }

    private var quietFill: Color {
        if display.reduceTransparency {
            return hovered && enabled ? Color(hex: "343139") : SeaTheme.opaqueQuiet
        }
        if configuration.isPressed { return .white.opacity(0.16) }
        return .white.opacity(hovered && enabled ? 0.13 : 0.08)
    }

    var body: some View {
        let sheenOpacity: Double = configuration.isPressed ? 0.16 : (hovered && enabled ? 0.08 : 0)
        configuration.label
            .font(.system(size: size == .row ? 13 : 15, weight: .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, variant == .text || variant == .danger ? 0 : 18)
            .frame(minHeight: size.height)
            .background {
                if variant == .primary {
                    Capsule()
                        .fill(SeaTheme.primaryGradient)
                        .overlay {
                            Capsule().fill(.white.opacity(sheenOpacity))
                        }
                } else if variant == .quiet {
                    Capsule().fill(quietFill)
                }
            }
            .overlay {
                // Text and danger actions have no surface; a tight stroke
                // around bare words would read as a broken button.
                if variant == .primary {
                    Capsule().strokeBorder(
                        display.contrast == .increased
                            ? AnyShapeStyle(foreground.opacity(0.55))
                            : AnyShapeStyle(LinearGradient(
                                colors: [Color(hex: "FFEBD2").opacity(0.45), .white.opacity(0.06)],
                                startPoint: .top, endPoint: .bottom)),
                        lineWidth: display.contrast == .increased ? 1 : 0.75
                    )
                } else if variant == .quiet {
                    Capsule().strokeBorder(
                        display.contrast == .increased
                            ? AnyShapeStyle(foreground.opacity(0.45))
                            : SeaTheme.specularBorder(contrast: display.contrast, reduceTransparency: display.reduceTransparency, topOpacity: 0.18, bottomOpacity: 0.05),
                        lineWidth: display.contrast == .increased ? 1 : 0.75
                    )
                }
            }
            .shadow(
                color: variant == .primary && !display.reduceTransparency && display.contrast != .increased && enabled
                    ? SeaTheme.warm.opacity(hovered ? 0.24 : 0.14) : .clear,
                radius: hovered ? 12 : 8, y: 3
            )
            .contentShape(Capsule())
            .opacity(enabled ? (configuration.isPressed && (variant == .text || variant == .danger) ? 0.65 : 1) : 0.42)
            .scaleEffect(SeaHomePresentation.pressScale(pressed: configuration.isPressed, reduceMotion: display.reduceMotion))
            .animation(TonoMotion.tactileSpring(reduceMotion: display.reduceMotion), value: configuration.isPressed)
            .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hovered)
            .onHover { hovered = enabled ? $0 : false }
            .pointerStyle(enabled ? .link : .default)
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
    @Environment(\.isEnabled) private var enabled
    @SeaDisplayPreferences private var display

    func makeBody(configuration: Configuration) -> some View {
        SeaToggleSwitch(configuration: configuration, enabled: enabled, display: display)
    }
}

private struct SeaToggleSwitch: View {
    let configuration: ToggleStyleConfiguration
    let enabled: Bool
    let display: SeaDisplayOptions
    @State private var hovered = false

    var body: some View {
        Button { configuration.isOn.toggle() } label: {
            // On is the sunrise, whatever the page tone, like the Windows switch.
            Capsule()
                .fill(configuration.isOn
                    ? AnyShapeStyle(SeaTheme.primaryGradient)
                    : AnyShapeStyle(display.reduceTransparency
                        ? (hovered && enabled ? SeaTheme.opaqueQuiet : SeaTheme.opaqueTrack)
                        : .white.opacity(hovered && enabled ? 0.22 : 0.16)))
                .frame(width: 36, height: 20)
                .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                    Circle()
                        .fill(configuration.isOn ? Color(hex: "171421") : SeaTheme.text)
                        .frame(width: 16, height: 16)
                        .shadow(color: .black.opacity(0.22), radius: 2, y: 1)
                        .padding(2)
                }
                .overlay {
                    Capsule().strokeBorder(
                        display.contrast == .increased
                            ? SeaTheme.text.opacity(0.55)
                            : (configuration.isOn
                                ? Color(hex: "FFEBD2").opacity(0.28)
                                : SeaTheme.text.opacity(0.14)),
                        lineWidth: display.contrast == .increased ? 1 : 0.65
                    )
                }
        }
        .buttonStyle(.plain)
        .opacity(enabled ? 1 : 0.42)
        .animation(TonoMotion.tactileSpring(reduceMotion: display.reduceMotion), value: configuration.isOn)
        .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hovered)
        .onHover { hovered = enabled ? $0 : false }
        .pointerStyle(enabled ? .link : .default)
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
    @State private var hoveredOption: String?

    var body: some View {
        if options.count <= 4 {
            HStack(spacing: 2) {
                ForEach(options, id: \.self) { option in
                    let isSelected = selection == option
                    let isHovered = hoveredOption == option
                    Button { selection = option } label: {
                        Text(LocalizedStringKey(option))
                            .font(.system(size: 13, weight: isSelected ? .medium : .regular))
                            .foregroundStyle(isSelected ? SeaTheme.text : (isHovered ? SeaTheme.text.opacity(0.88) : SeaTheme.muted))
                            .padding(.horizontal, 13).padding(.vertical, 5)
                            .background {
                                if isSelected {
                                    Capsule()
                                        .fill(display.reduceTransparency ? SeaTheme.opaqueQuiet : SeaTheme.warm.opacity(0.19))
                                        .overlay {
                                            Capsule().strokeBorder(LinearGradient(
                                                colors: [SeaTheme.warm.opacity(display.contrast == .increased ? 0.65 : 0.30),
                                                         SeaTheme.warm.opacity(0.04)],
                                                startPoint: .top, endPoint: .bottom), lineWidth: 1)
                                        }
                                } else if isHovered {
                                    Capsule().fill(.white.opacity(0.06))
                                }
                            }
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .pointerStyle(.link)
                    .onHover { hovering in
                        hoveredOption = hovering ? option : (hoveredOption == option ? nil : hoveredOption)
                    }
                }
            }
            .padding(3)
            .background(display.reduceTransparency ? SeaTheme.opaqueTrack : .white.opacity(0.05), in: Capsule())
            .overlay {
                Capsule().strokeBorder(
                    display.contrast == .increased
                        ? AnyShapeStyle(accent.opacity(0.45))
                        : SeaTheme.specularBorder(contrast: display.contrast, reduceTransparency: display.reduceTransparency, topOpacity: 0.12, bottomOpacity: 0.04),
                    lineWidth: display.contrast == .increased ? 1 : 0.65
                )
            }
            .animation(TonoMotion.stateChange(reduceMotion: display.reduceMotion), value: selection)
            .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hoveredOption)
            .accessibilityRepresentation {
                Picker(label, selection: $selection) {
                    ForEach(options, id: \.self) { Text(LocalizedStringKey($0)).tag($0) }
                }.pickerStyle(.segmented)
            }
        } else {
            SeaMenuButton(title: Text(LocalizedStringKey(selection)), accessibilityLabel: Text(label)) {
                ForEach(options, id: \.self) { option in
                    Button { selection = option } label: {
                        if selection == option { Label(LocalizedStringKey(option), systemImage: "checkmark") }
                        else { Text(LocalizedStringKey(option)) }
                    }
                }
            }
        }
    }
}

/// A quiet capsule that opens a menu. The borderless menu draws only its title,
/// so the capsule and the one shared chevron sit around it in place of the
/// platform pop-up arrow.
struct SeaMenuButton<Items: View>: View {
    let title: Text
    let accessibilityLabel: Text
    var accessibilityValue: Text?
    @ViewBuilder let items: Items
    @Environment(\.seaAccent) private var accent
    @SeaDisplayPreferences private var display
    @State private var hovered = false

    var body: some View {
        Menu {
            items
        } label: {
            HStack(spacing: 8) {
                title.font(.system(size: 13, weight: .medium))
                SeaChevron(expanded: true)
            }
            .foregroundStyle(SeaTheme.text)
            .padding(.horizontal, 14)
            .frame(minHeight: SeaControlSize.row.height)
            .background(
                display.reduceTransparency
                    ? (hovered ? Color(hex: "343139") : SeaTheme.opaqueQuiet)
                    : .white.opacity(hovered ? 0.12 : 0.08),
                in: Capsule()
            )
            .overlay {
                Capsule().strokeBorder(
                    display.contrast == .increased
                        ? AnyShapeStyle(accent.opacity(0.5))
                        : SeaTheme.specularBorder(contrast: display.contrast, reduceTransparency: display.reduceTransparency, topOpacity: 0.16, bottomOpacity: 0.04),
                    lineWidth: display.contrast == .increased ? 1 : 0.65
                )
            }
            .contentShape(Capsule())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .pointerStyle(.link)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(accessibilityValue ?? title)
        .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hovered)
        .onHover { hovered = $0 }
    }
}

/// Filter tabs (`.sea-tabs`): 13 pt text 22 pt apart over one hairline; the
/// selected tab is the accent with a 2 pt underline.
struct SeaTabs: View {
    let label: LocalizedStringKey
    @Binding var selection: String
    let options: [String]
    /// The shown word when it differs from the stored option.
    var title: (String) -> LocalizedStringKey = { LocalizedStringKey($0) }
    @Environment(\.seaAccent) private var accent
    @SeaDisplayPreferences private var display
    @State private var hoveredOption: String?
    @Namespace private var tabNS

    var body: some View {
        HStack(spacing: 22) {
            ForEach(options, id: \.self) { option in
                let selected = selection == option
                let hovered = hoveredOption == option
                Button { selection = option } label: {
                    Text(title(option)).font(.system(size: 13, weight: .medium))
                        .foregroundStyle(selected ? accent : (hovered ? SeaTheme.muted : SeaTheme.tertiary))
                        .padding(.vertical, 10)
                        .overlay(alignment: .bottom) {
                            if selected {
                                Capsule()
                                    .fill(accent)
                                    .frame(height: 2)
                                    .modifier(SeaTabUnderlineMatch(namespace: display.reduceMotion ? nil : tabNS))
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .pointerStyle(.link)
                .onHover { hovering in
                    hoveredOption = hovering ? option : (hoveredOption == option ? nil : hoveredOption)
                }
                .accessibilityAddTraits(selected ? [.isSelected] : [])
            }
        }
        .animation(TonoMotion.nav(reduceMotion: display.reduceMotion), value: selection)
        .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hoveredOption)
        .overlay(alignment: .bottom) {
            Rectangle().fill(.white.opacity(display.contrast == .increased ? 0.35 : 0.08)).frame(height: 0.75)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

private struct SeaTabUnderlineMatch: ViewModifier {
    var namespace: Namespace.ID?

    func body(content: Content) -> some View {
        if let namespace {
            content.matchedGeometryEffect(id: "seaTabUnderline", in: namespace)
        } else {
            content
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
    var minHeight: CGFloat = 48
    @SeaDisplayPreferences private var display

    func body(content: Content) -> some View {
        content.font(.system(size: minHeight < 44 ? 13.5 : 15)).foregroundStyle(SeaTheme.text)
            .padding(.horizontal, 14).frame(minHeight: minHeight)
            .background(
                display.reduceTransparency
                    ? SeaTheme.opaquePanel
                    : (focused ? .white.opacity(0.065) : .white.opacity(0.045)),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .overlay {
                // A focused field takes the sunrise ring on every page; the tone
                // accent stays for links and selection.
                RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(
                    focused
                        ? AnyShapeStyle(SeaTheme.attention)
                        : SeaTheme.specularBorder(contrast: display.contrast, reduceTransparency: display.reduceTransparency, topOpacity: 0.15, bottomOpacity: 0.05),
                    lineWidth: focused ? 1.5 : (display.contrast == .increased ? 1 : 0.75)
                )
            }
            .shadow(
                color: focused && !display.reduceTransparency ? SeaTheme.attention.opacity(0.14) : .clear,
                radius: 6, y: 2
            )
            .animation(TonoMotion.stateChange(reduceMotion: display.reduceMotion), value: focused)
    }
}

struct SeaDisclosureTreatment: ViewModifier {
    @SeaAppearancePreference private var sea
    @ViewBuilder func body(content: Content) -> some View {
        if sea { content.disclosureGroupStyle(SeaDisclosureStyle()) }
        else { content }
    }
}


enum SeaTagKind { case neutral, good, attention, danger }

struct SeaTag: View {
    private let title: Text
    var kind: SeaTagKind = .neutral
    @SeaDisplayPreferences private var display

    init(title: LocalizedStringKey, kind: SeaTagKind = .neutral) {
        self.title = Text(title)
        self.kind = kind
    }

    /// For text that is already localized (a status computed with String(localized:)).
    init(verbatim title: String, kind: SeaTagKind = .neutral) {
        self.title = Text(verbatim: title)
        self.kind = kind
    }

    private var foreground: Color {
        switch kind {
        case .neutral: SeaTheme.muted
        case .good: SeaTheme.good
        case .attention: SeaTheme.attention
        case .danger: SeaTheme.danger
        }
    }
    private var fill: Color {
        switch kind {
        case .neutral, .danger: .white.opacity(0.08)
        case .good: Color(hex: "A0E6B4").opacity(0.14)
        case .attention: Color(hex: "FFC878").opacity(0.18)
        }
    }
    private var opaqueFill: Color {
        switch kind {
        case .neutral: SeaTheme.opaqueQuiet
        case .good: SeaTheme.opaqueGood
        case .attention: SeaTheme.opaqueAttention
        case .danger: SeaTheme.opaqueDanger
        }
    }
    var body: some View {
        title.font(.system(size: 12, weight: .medium)).monospacedDigit().foregroundStyle(foreground)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(display.reduceTransparency ? opaqueFill : fill, in: Capsule())
            .overlay {
                Capsule().strokeBorder(
                    foreground.opacity(display.contrast == .increased ? 0.52 : 0.18),
                    lineWidth: display.contrast == .increased ? 1 : 0.6
                )
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
    @State private var hovered = false

    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(TonoMotion.stateChange(reduceMotion: display.reduceMotion)) {
                    configuration.isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) { SeaChevron(expanded: configuration.isExpanded); configuration.label }
                    .opacity(hovered ? 1 : 0.86)
                    .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .pointerStyle(.link)
            .animation(TonoMotion.hover(reduceMotion: display.reduceMotion), value: hovered)
            .onHover { hovered = $0 }
            if configuration.isExpanded {
                configuration.content
                    .transition(display.reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
            }
        }
        .accessibilityRepresentation {
            DisclosureGroup(isExpanded: configuration.$isExpanded) {
                configuration.content
            } label: { configuration.label }.disclosureGroupStyle(.automatic)
        }
    }
}
