import SwiftUI
import TonoKit

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false
    @State private var showScope = false
    @State private var showSystemHow = false

    var body: some View {
        // A navigation bar, not a hand-made header: on iOS 26 the close button is system glass and
        // the content blurs under the bar as it scrolls (scroll edge effect).
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    SectionLabel(text: L.t("settings_routing"))
                    SmokeCard {
                        ModeRow(title: L.t("mode_three_tier"), desc: L.t("mode_three_tier_desc"), selected: model.mode == .threeTier) {
                            Task { await model.setMode(.threeTier) }
                        }
                        ModeRow(title: L.t("mode_stable"), desc: L.t("mode_stable_desc"), selected: model.mode == .stable) {
                            Task { await model.setMode(.stable) }
                        }
                        Text(L.t("mode_applies")).tonoFont(12, relativeTo: .caption).foregroundStyle(TonoColor.textTertiary)
                    }

                    // The routing boundaries stay one tap away instead of a wall of text on open.
                    SmokeCard {
                        DisclosureGroup(isExpanded: $showScope) {
                            VStack(alignment: .leading, spacing: 10) {
                                para(L.t("routing_scope"))
                                para(L.t("routing_platform"))
                                Text(L.t(model.underlyingIPv6 ? "ipv6_on" : "ipv6_off")).tonoFont(12, .medium, relativeTo: .caption).foregroundStyle(TonoColor.textTertiary)
                            }
                            .padding(.top, 8)
                        } label: {
                            Text(L.t("routing_scope_title")).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                                .frame(minHeight: 44, alignment: .leading)
                        }
                        .tint(TonoColor.textSecondary)
                        .accessibilityIdentifier("scopeDisclosure")
                    }
                    .padding(.top, 16)

                    SectionLabel(text: L.t("settings_check"))
                    SmokeCard { RouteCheck() }

                    SectionLabel(text: L.t("settings_system"))
                    SmokeCard {
                        Toggle(isOn: Binding(get: { model.includeAllNetworks }, set: { on in Task { await model.setIncludeAllNetworks(on) } })) {
                            Text(L.t("system_include_all")).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                        }
                        .tint(TonoColor.accent)
                        para(L.t("system_include_all_short"))
                        // The mechanics (restart hold, Connect On Demand) one tap away, as the routing scope.
                        DisclosureGroup(isExpanded: $showSystemHow) {
                            VStack(alignment: .leading, spacing: 10) {
                                para(L.t("system_include_all_desc"))
                                para(L.t("system_on_demand"))
                            }
                            .padding(.top, 8)
                        } label: {
                            Text(L.t("system_how_title")).tonoFont(15, .medium, relativeTo: .subheadline).foregroundStyle(TonoColor.textPrimary)
                                .frame(minHeight: 44, alignment: .leading)
                        }
                        .tint(TonoColor.textSecondary)
                        Text(L.t("system_limit")).tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.warning)
                    }

                    SectionLabel(text: L.t("settings_lock_screen"))
                    SmokeCard {
                        Toggle(isOn: Binding(get: { model.liveActivityEnabled }, set: { model.setLiveActivity($0) })) {
                            Text(L.t("settings_live_activity")).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                        }
                        .tint(TonoColor.accent)
                        .accessibilityIdentifier("liveActivityToggle")
                        para(L.t("settings_live_activity_desc"))
                        para(L.t("settings_widgets_desc"))
                    }

                    SectionLabel(text: L.t("settings_account"))
                    SmokeCard {
                        Text(model.email ?? "").tonoFont(16, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                        QuietButton(title: L.t("settings_sign_out"), color: TonoColor.error) { confirmSignOut = true }
                    }

                    SectionLabel(text: L.t("settings_about"))
                    SmokeCard {
                        Text(L.t("about_version", AppModel.appVersion)).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textPrimary)
                        small(L.t("about_core", model.coreVersion.isEmpty ? "—" : model.coreVersion))
                        small(L.t("about_contract", String(DesktopRoutingContract.sourceDigest.prefix(12))))
                        Text(L.t("about_test")).tonoFont(12, relativeTo: .caption).foregroundStyle(TonoColor.textTertiary)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .background(TonoColor.night.ignoresSafeArea())
            .navigationTitle(L.t("settings_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) { closeButton }
            }
        }
        .presentationDragIndicator(.visible)
        .confirmationDialog(L.t("settings_sign_out"), isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(L.t("settings_sign_out"), role: .destructive) {
                Task { await model.signOut() }
                dismiss()
            }
        }
        .previewBadge(alignment: .bottom)
    }

    /// Presented as a sheet: swipe down closes it; the button is for VoiceOver and two-handed use.
    private var closeButton: some View {
        Button { dismiss() } label: {
            Image(systemName: "xmark").font(.body.weight(.semibold)).foregroundStyle(TonoColor.textPrimary)
        }
        .accessibilityLabel(L.t("settings_close"))
        .accessibilityIdentifier("settingsClose")
    }

    private func para(_ text: String) -> some View {
        Text(text).tonoFont(15, relativeTo: .subheadline).lineSpacing(2).foregroundStyle(TonoColor.textSecondary).fixedSize(horizontal: false, vertical: true)
    }

    private func small(_ text: String) -> some View {
        Text(text).tonoFont(12, relativeTo: .caption).foregroundStyle(TonoColor.textSecondary).fixedSize(horizontal: false, vertical: true)
    }
}

private struct ModeRow: View {
    let title: String
    let desc: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle().strokeBorder(selected ? TonoColor.accent : TonoColor.textTertiary, lineWidth: 2).frame(width: 20, height: 20)
                    if selected { Circle().fill(TonoColor.accent).frame(width: 10, height: 10) }
                }
                .padding(.top, 2)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                    Text(desc).tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.textSecondary).multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

/// "Where does this site go?" against the same graph the tunnel runs.
private struct RouteCheck: View {
    @EnvironmentObject private var model: AppModel
    @State private var host = ""
    @State private var result: String?

    var body: some View {
        HStack(spacing: 10) {
            TonoField(title: L.t("check_hint"), text: $host)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit(run)
            QuietButton(title: L.t("check_go"), action: run)
        }
        if let result {
            Text(result).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }

    private func run() {
        guard let answer = model.explain(host) else { result = nil; return }
        result = L.t("check_result", L.t("verdict_\(answer.tcp.rawValue)"), L.t("verdict_\(answer.udp.rawValue)"))
    }
}
