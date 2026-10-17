import SwiftUI
import TonoKit

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false

    var body: some View {
        VStack(spacing: 0) {
            header
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
                        Text(L.t("mode_applies")).font(.system(size: 11)).foregroundStyle(TonoColor.textTertiary)
                    }

                    SectionLabel(text: L.t("routing_scope_title"))
                    SmokeCard {
                        para(L.t("routing_scope"))
                        para(L.t("routing_platform"))
                        Text(L.t(model.underlyingIPv6 ? "ipv6_on" : "ipv6_off")).font(.system(size: 12, weight: .medium)).foregroundStyle(TonoColor.textTertiary)
                    }

                    SectionLabel(text: L.t("settings_check"))
                    SmokeCard { RouteCheck() }

                    SectionLabel(text: L.t("settings_system"))
                    SmokeCard {
                        Toggle(isOn: Binding(get: { model.includeAllNetworks }, set: { on in Task { await model.setIncludeAllNetworks(on) } })) {
                            Text(L.t("system_include_all")).font(.system(size: 16, weight: .medium)).foregroundStyle(TonoColor.textPrimary)
                        }
                        .tint(TonoColor.accent)
                        para(L.t("system_include_all_desc"))
                        para(L.t("system_on_demand"))
                        Text(L.t("system_limit")).font(.system(size: 13)).foregroundStyle(TonoColor.warning)
                    }

                    SectionLabel(text: L.t("settings_account"))
                    SmokeCard {
                        Text(model.email ?? "").font(.system(size: 16)).foregroundStyle(TonoColor.textPrimary)
                        QuietButton(title: L.t("settings_sign_out"), color: TonoColor.error) { confirmSignOut = true }
                    }

                    SectionLabel(text: L.t("settings_about"))
                    SmokeCard {
                        Text(L.t("about_version", AppModel.appVersion)).font(.system(size: 14)).foregroundStyle(TonoColor.textPrimary)
                        small(L.t("about_core", model.coreVersion.isEmpty ? "—" : model.coreVersion))
                        small(L.t("about_contract", String(DesktopRoutingContract.sourceDigest.prefix(12))))
                        Text(L.t("about_test")).font(.system(size: 12)).foregroundStyle(TonoColor.textTertiary)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
        }
        .background(TonoColor.night.ignoresSafeArea())
        .confirmationDialog(L.t("settings_sign_out"), isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(L.t("settings_sign_out"), role: .destructive) {
                Task { await model.signOut() }
                dismiss()
            }
        }
    }

    private var header: some View {
        HStack(spacing: 2) {
            Button { dismiss() } label: {
                GlyphIcon(glyph: .back, tint: TonoColor.textPrimary).frame(width: 48, height: 48).contentShape(Circle())
            }
            .accessibilityLabel(L.t("settings_back"))
            Text(L.t("settings_title")).font(.system(size: 22, weight: .medium)).foregroundStyle(TonoColor.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
    }

    private func para(_ text: String) -> some View {
        Text(text).font(.system(size: 14)).lineSpacing(2).foregroundStyle(TonoColor.textSecondary).fixedSize(horizontal: false, vertical: true)
    }

    private func small(_ text: String) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(TonoColor.textSecondary).fixedSize(horizontal: false, vertical: true)
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
                    Text(title).font(.system(size: 16, weight: .medium)).foregroundStyle(TonoColor.textPrimary)
                    Text(desc).font(.system(size: 13)).foregroundStyle(TonoColor.textSecondary).multilineTextAlignment(.leading)
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
            Text(result).font(.system(size: 16, weight: .medium)).foregroundStyle(TonoColor.textPrimary)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }

    private func run() {
        guard let answer = model.explain(host) else { result = nil; return }
        result = L.t("check_result", L.t("verdict_\(answer.tcp.rawValue)"), L.t("verdict_\(answer.udp.rawValue)"))
    }
}
