import SwiftUI

struct AddRuleSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme
    @SeaDisplayPreferences private var displayPreferences
    @Binding var isPresented: Bool
    var onAdd: ((RuleItem) -> Void)?

    @State private var selectedType = "DOMAIN-SUFFIX"
    @State private var value = ""
    @State private var selectedPolicy = "Proxy"
    @State private var selectedTarget = "Proxy"
    @State private var validationError: LocalizedStringKey?

    private let ruleTypes = [
        "DOMAIN-SUFFIX",
        "DOMAIN-KEYWORD",
        "DOMAIN",
        "IP-CIDR",
        "IP-CIDR6",
        "GEOIP",
        "MATCH"
    ]

    private let policies: [(value: String, label: LocalizedStringKey, color: String)] = [
        ("Proxy", "Proxy", "4B6EFF"),
        ("Direct", "Direct", "30D158"),
        ("Reject", "Reject", "FF6E52")
    ]

    private var targetOptions: [(value: String, label: String)] {
        var seen: Set<String> = []
        var options: [(value: String, label: String)] = [("Proxy", String(localized: "Default Proxy"))]
        seen.insert("Proxy")

        for group in availableGroupNames where seen.insert(group).inserted {
            options.append((group, group))
        }

        for node in availableNodes where !isGroupOnlyName(node.name) && seen.insert(node.name).inserted {
            let cleanName = ConfigParser.extractFlag(from: node.name).cleanName
            let label = node.flag.isEmpty ? cleanName : "\(node.flag) \(cleanName)"
            options.append((node.name, label))
        }

        return options
    }

    var body: some View {
        ZStack {
            // Backdrop
            Color.black.opacity(0.2)
                .ignoresSafeArea()
                .onTapGesture { close() }

            // Modal card
            VStack(alignment: .leading, spacing: 0) {
                // Header
                HStack {
                    Text("Add Rule")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.primary)

                    Spacer()

                    Button {
                        close()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 28, height: 28)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.tint(.white.opacity(0.1)), in: Circle())
                }
                .padding(.bottom, 22)

                // Form fields
                VStack(alignment: .leading, spacing: 14) {
                    // Type + Policy
                    HStack(spacing: 14) {
                        formField(label: "Type label") {
                            customPicker(selection: $selectedType, options: ruleTypes.map { ($0, $0) })
                        }

                        formField(label: "Target Policy") {
                            policyPicker
                        }
                        .frame(width: 150)
                    }

                    if selectedPolicy == "Proxy" {
                        formField(label: "Target Node / Group") {
                            customPicker(selection: $selectedTarget, options: targetOptions)
                        }
                    }

                    // Value
                    formField(label: "Value") {
                        glassInput {
                            TextField("e.g. google.com, 192.168.0.0/16, CN", text: $value)
                                .textFieldStyle(.plain)
                        }
                    }

                    if let validationError {
                        Text(validationError)
                            .font(.system(size: 11))
                            .foregroundStyle(.red)
                    }
                }

                // Footer
                Divider()
                    .opacity(0.3)
                    .padding(.top, 20)
                    .padding(.bottom, 16)

                HStack {
                    Spacer()

                    Button {
                        close()
                    } label: {
                        Text("Cancel")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 9)
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut(.cancelAction)
                    .pointerStyle(.link)
                    .modifier(AddRuleGlassCapsule(enabled: !displayPreferences.reduceTransparency, dark: colorScheme == .dark, opacity: 0.06))

                    Button {
                        addRule()
                    } label: {
                        Text("Add Rule")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 9)
                            .background(
                                LinearGradient(
                                    colors: [TonoBrand.accent, Color(hex: "6B8CFF")],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                in: Capsule()
                            )
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut(.defaultAction)
                    .pointerStyle(.link)
                    .shadow(color: displayPreferences.reduceTransparency ? .clear : TonoBrand.accent.opacity(0.25), radius: 8, y: 3)
                }
            }
            .padding(28)
            .frame(width: 420)
            .fixedSize(horizontal: false, vertical: true)
            .background {
                if displayPreferences.reduceTransparency || displayPreferences.contrast == .increased {
                    RoundedRectangle(cornerRadius: 20)
                        .fill(colorScheme == .dark ? SeaTheme.opaquePanel : Color(nsColor: .windowBackgroundColor))
                }
            }
            .overlay {
                if displayPreferences.contrast == .increased {
                    RoundedRectangle(cornerRadius: 20)
                        .strokeBorder(.white.opacity(colorScheme == .dark ? 0.35 : 0.5), lineWidth: 1)
                }
            }
            .modifier(AddRuleModalGlass(enabled: !displayPreferences.reduceTransparency && displayPreferences.contrast != .increased))
            .contentShape(Rectangle())
            .onTapGesture { }
            .shadow(color: displayPreferences.reduceTransparency ? .clear : .black.opacity(0.12), radius: 30, y: 10)
            .opacity(isPresented ? 1 : 0)
        }
        .onChange(of: selectedPolicy) { _, newValue in
            if newValue != "Proxy" {
                selectedTarget = "Proxy"
            }
        }
        .onChange(of: value) { _, _ in
            validationError = nil
        }
    }

    private func close() {
        withAnimation(TonoMotion.easeOut(0.2, reduceMotion: displayPreferences.reduceMotion)) {
            isPresented = false
        }
    }

    private func addRule() {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if selectedType != "MATCH" && trimmedValue.isEmpty {
            validationError = "Value is required"
            return
        }
        let policy: RulePolicy = switch selectedPolicy {
        case "Direct": .direct
        case "Reject": .reject
        default: .proxy
        }
        let newRule = RuleItem(
            id: "r\(UUID().uuidString.prefix(6))",
            type: selectedType,
            value: selectedType == "MATCH" && trimmedValue.isEmpty ? "MATCH" : trimmedValue,
            policy: policy,
            policyName: policy == .proxy && selectedTarget != "Proxy" ? selectedTarget : nil
        )
        onAdd?(newRule)
        close()
    }

    private var availableGroupNames: [String] {
        if !appState.proxyService.groups.isEmpty {
            return appState.proxyService.groups.map(\.name)
        }
        guard let yaml = ConfigStorage.shared.loadSubscriptionYAML() else { return [] }
        return ConfigParser.parseClashYAMLProxyGroups(yaml).map(\.name)
    }

    private var availableNodes: [ProxyNode] {
        if !appState.proxyService.nodes.isEmpty {
            return appState.proxyService.nodes.map { node in
                let (flag, _) = ConfigParser.extractFlag(from: node.name)
                return ProxyNode(
                    id: node.id,
                    flag: flag,
                    name: node.name,
                    type: ProxyType(rawValue: node.type.lowercased()) ?? .trojan,
                    latency: node.latency
                )
            }
        }
        return appState.proxyRegions.flatMap(\.nodes)
    }

    private var groupOnlyNames: Set<String> {
        Set(availableGroupNames).union(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE", "GLOBAL"])
    }

    private func isGroupOnlyName(_ name: String) -> Bool {
        let cleanName = ConfigParser.extractFlag(from: name).cleanName
        return groupOnlyNames.contains(name) || groupOnlyNames.contains(cleanName)
    }

    // MARK: - Policy Picker with colored dots

    private var policyPicker: some View {
        Menu {
            ForEach(policies, id: \.value) { item in
                Button {
                    selectedPolicy = item.value
                } label: {
                    if selectedPolicy == item.value {
                        Label(item.label, systemImage: "checkmark")
                    } else {
                        Text(item.label)
                    }
                }
            }
        } label: {
            HStack(spacing: 8) {
                Circle()
                    .fill(Color(hex: policies.first(where: { $0.value == selectedPolicy })?.color ?? "4B6EFF"))
                    .frame(width: 8, height: 8)
                Text(LocalizedStringKey(selectedPolicy))
                    .font(.system(size: 13))
                    .foregroundStyle(.primary)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(10)
            .background(
                displayPreferences.reduceTransparency
                    ? AnyShapeStyle(colorScheme == .dark ? SeaTheme.opaqueQuiet : Color(nsColor: .controlBackgroundColor))
                    : AnyShapeStyle(.white.opacity(colorScheme == .dark ? 0.07 : 0.35)),
                in: RoundedRectangle(cornerRadius: 10)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(.white.opacity(displayPreferences.contrast == .increased ? 0.45 : (colorScheme == .dark ? 0.14 : 0.5)), lineWidth: displayPreferences.contrast == .increased ? 1 : 0.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .pointerStyle(.link)
    }

    // MARK: - Glass Input Container

    private func glassInput<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        HStack {
            content()
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            displayPreferences.reduceTransparency
                ? AnyShapeStyle(colorScheme == .dark ? SeaTheme.opaqueQuiet : Color(nsColor: .controlBackgroundColor))
                : AnyShapeStyle(.white.opacity(colorScheme == .dark ? 0.07 : 0.35)),
            in: RoundedRectangle(cornerRadius: 10)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(.white.opacity(displayPreferences.contrast == .increased ? 0.45 : (colorScheme == .dark ? 0.14 : 0.5)), lineWidth: displayPreferences.contrast == .increased ? 1 : 0.5)
        )
    }

    // MARK: - Custom Picker

    private func customPicker(selection: Binding<String>, options: [(String, String)]) -> some View {
        Menu {
            ForEach(Array(options.enumerated()), id: \.offset) { _, item in
                Button {
                    selection.wrappedValue = item.0
                } label: {
                    if selection.wrappedValue == item.0 {
                        Label(item.1, systemImage: "checkmark")
                    } else {
                        Text(item.1)
                    }
                }
            }
        } label: {
            HStack {
                Text(options.first(where: { $0.0 == selection.wrappedValue })?.1 ?? "")
                    .font(.system(size: 13))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(10)
            .background(
                displayPreferences.reduceTransparency
                    ? AnyShapeStyle(colorScheme == .dark ? SeaTheme.opaqueQuiet : Color(nsColor: .controlBackgroundColor))
                    : AnyShapeStyle(.white.opacity(colorScheme == .dark ? 0.07 : 0.35)),
                in: RoundedRectangle(cornerRadius: 10)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(.white.opacity(displayPreferences.contrast == .increased ? 0.45 : (colorScheme == .dark ? 0.14 : 0.5)), lineWidth: displayPreferences.contrast == .increased ? 1 : 0.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .pointerStyle(.link)
    }

    // MARK: - Form Field

    @ViewBuilder
    private func formField<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(LocalizedStringKey(label))
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
            content()
        }
    }
}

private struct AddRuleGlassCapsule: ViewModifier {
    let enabled: Bool
    let dark: Bool
    let opacity: Double

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.glassEffect(.regular.tint(.white.opacity(opacity)), in: Capsule())
        } else {
            content.background(dark ? SeaTheme.opaqueQuiet : Color(nsColor: .controlBackgroundColor), in: Capsule())
        }
    }
}

private struct AddRuleModalGlass: ViewModifier {
    let enabled: Bool

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.glassEffect(.regular.tint(.white.opacity(0.15)), in: RoundedRectangle(cornerRadius: 20))
        } else {
            content
        }
    }
}

#Preview {
    @Previewable @State var show = true
    ZStack {
        MeshGradientBackground()
        AddRuleSheet(isPresented: $show)
    }
    .frame(width: 600, height: 400)
}
