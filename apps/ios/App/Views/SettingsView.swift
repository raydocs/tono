import SwiftUI
import TonoKit
import UIKit

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
                    #if DEBUG
                    // In the content, under the navigation bar, so it never covers the sheet's edge.
                    if PreviewBadge.shown { PreviewBadge().padding(.leading, 6).padding(.top, 4) }
                    #endif
                    // The mode is chosen in one place, Details (one tap from Home, next to where traffic
                    // goes); Settings names it and keeps the full descriptions in the disclosure below.
                    SectionLabel(text: L.t("settings_routing"))
                    Text(L.t("settings_mode_where", L.t(model.mode == .stable ? "mode_stable_short" : "mode_three_tier_short")))
                        .tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 4).padding(.bottom, 8)
                        .accessibilityIdentifier("settingsModeWhere")

                    // The routing boundaries stay one tap away instead of a wall of text on open.
                    SmokeCard {
                        DisclosureGroup(isExpanded: $showScope) {
                            VStack(alignment: .leading, spacing: 10) {
                                // The full mode descriptions live here; the picker is in Details.
                                para(L.t("mode_three_tier") + (L.isChinese ? "：" : ": ") + L.t("mode_three_tier_desc"))
                                para(L.t("mode_stable") + (L.isChinese ? "：" : ": ") + L.t("mode_stable_desc"))
                                para(L.t("routing_scope"))
                                para(L.t("routing_platform"))
                                Text(L.t(model.underlyingIPv6 ? "ipv6_on" : "ipv6_off")).tonoFont(12, .medium, relativeTo: .caption).foregroundStyle(TonoColor.textTertiary)
                                small(L.t("about_contract", String(DesktopRoutingContract.sourceDigest.prefix(12))))
                            }
                            .padding(.top, 8)
                        } label: {
                            Text(L.t("routing_scope_title")).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                                .frame(minHeight: 44, alignment: .leading)
                        }
                        .tint(TonoColor.textSecondary)
                        .accessibilityIdentifier("scopeDisclosure")
                    }

                    // "Where does a site go?" lives in Details, next to where traffic goes.

                    SectionLabel(text: L.t("settings_system"))
                    SmokeCard {
                        Toggle(isOn: Binding(get: { model.includeAllNetworks }, set: { on in Task { await model.setIncludeAllNetworks(on) } })) {
                            Text(L.t("system_include_all")).tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                        }
                        .tint(TonoColor.accent)
                        if model.includeAllPending {
                            // The running tunnel keeps the previous setting until it next starts.
                            Text(L.t("system_include_all_pending")).tonoFont(13, .medium, relativeTo: .footnote)
                                .foregroundStyle(TonoColor.warning)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("includeAllPending")
                        }
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
                    }

                    SectionLabel(text: L.t("settings_account"))
                    SmokeCard {
                        // "Signed in as …", not the bare address: VoiceOver gets a sentence (Apple's audit
                        // flagged the bare address as not human-readable once Settings got shorter).
                        Text(L.t("settings_signed_in_as", model.email ?? "")).tonoFont(16, relativeTo: .callout)
                            .foregroundStyle(TonoColor.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        QuietButton(title: L.t("settings_sign_out"), color: TonoColor.error) { confirmSignOut = true }
                    }

                    SectionLabel(text: L.t("settings_about"))
                    SmokeCard {
                        Text(L.t("about_version", AppModel.appVersion)).tonoFont(15, relativeTo: .subheadline).foregroundStyle(TonoColor.textPrimary)
                        small(L.t("about_core", model.coreVersion.isEmpty ? "—" : model.coreVersion))
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

/// "Where does this site go?" against the same graph the tunnel runs (shown in Details). The answer
/// is worked out from the routing rules for the current mode, not a live test. Submitting closes the
/// keyboard, so the answer is on screen, and VoiceOver reads it; a different site or mode clears or
/// recomputes it, so an old answer never stands next to new input.
struct RouteCheck: View {
    /// The answer appeared: the sheet scrolls it into view.
    var onAnswer: () -> Void = {}
    /// The field gained or lost focus: the sheet grows to full height while typing.
    var onFocus: (Bool) -> Void = { _ in }
    @EnvironmentObject private var model: AppModel
    @State private var host = ""
    @State private var answer: RouteAnswer?
    @FocusState private var focused: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // Accessibility sizes: Check goes under the field, which then has the full width.
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                                                  : AnyLayout(HStackLayout(spacing: 10))
        layout {
            TonoField(title: L.t("check_hint_inline"), text: $host, wraps: true)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($focused)
                .onSubmit(run)
                .onChange(of: host) { value in
                    // A wrapping field types return as a newline: treat it as Search.
                    if value.contains("\n") {
                        host = value.replacingOccurrences(of: "\n", with: "")
                        run()
                        return
                    }
                    // Another site: the answer on screen is no longer about it.
                    if let answer, RouteExplainer.cleanHost(value) != answer.host { self.answer = nil }
                }
            QuietButton(title: L.t("check_go"), action: run)
        }
        .onChange(of: focused) { onFocus($0) }
        // The same site under the other mode can go elsewhere (example.com: direct vs cloud).
        .onChange(of: model.mode) { _ in if answer != nil { run() } }
        if let answer {
            VStack(alignment: .leading, spacing: 4) {
                Text(L.t("check_answer_\(answer.tcp.rawValue)", answer.host))
                    .tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(L.t("check_result", L.t("verdict_\(answer.tcp.rawValue)"), L.t("verdict_\(answer.udp.rawValue)")))
                    .tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.textSecondary)
                Text(L.t("check_basis")).tonoFont(12, relativeTo: .caption).foregroundStyle(TonoColor.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("routeAnswer")
            .id("routeAnswer")
        }
    }

    private func run() {
        focused = false
        guard let found = model.explain(host) else { answer = nil; return }
        answer = found
        onAnswer()
        let spoken = L.t("check_answer_\(found.tcp.rawValue)", found.host)
        // After the keyboard has gone, so the announcement is not cut off by the focus change.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            UIAccessibility.post(notification: .announcement, argument: spoken)
        }
    }
}
