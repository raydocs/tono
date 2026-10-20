import SwiftUI
import TonoKit
import UIKit

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false
    @State private var showScope = false
    @State private var showSystemHow = false
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        // A navigation bar, not a hand-made header: on iOS 26 the close button is system glass and
        // the content blurs under the bar as it scrolls (scroll edge effect).
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    #if DEBUG
                    // In the content, under the navigation bar, so it never covers the sheet's edge.
                    if PreviewBadge.shown { PreviewBadge().padding(.top, 4) }
                    #endif
                    // The mode is chosen in one place, Details (one tap from Home, next to where traffic
                    // goes); Settings names it and keeps the full descriptions in the disclosure below.
                    // Editorial layout: no cards or dividers, groups set apart by space alone.
                    SettingsLabel(text: L.t("settings_routing"), first: true)
                    Group {
                        if model.routesUnconfirmed {
                            meta(L.t("settings_mode_unconfirmed"))
                        } else {
                            VStack(alignment: .leading, spacing: 4) {
                                title(ModeText.name(model.mode))
                                meta(L.t("settings_mode_where"))
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 12)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("settingsModeWhere")

                    // The routing boundaries stay one tap away instead of a wall of text on open.
                    DisclosureGroup(isExpanded: $showScope) {
                        VStack(alignment: .leading, spacing: 12) {
                            // The full mode descriptions live here; the picker is in Details.
                            meta(L.t("mode_three_tier") + (L.isChinese ? "：" : ": ") + L.t("mode_three_tier_desc"))
                            meta(L.t("mode_stable") + (L.isChinese ? "：" : ": ") + L.t("mode_stable_desc"))
                            meta(L.t("routing_scope"))
                            meta(L.t("routing_platform"))
                            fine(L.t(model.underlyingIPv6 ? "ipv6_on" : "ipv6_off"))
                            fine(L.t("about_contract", String(DesktopRoutingContract.sourceDigest.prefix(12))))
                        }
                        .padding(.top, 8).padding(.bottom, 12)
                    } label: {
                        title(L.t("routing_scope_title"))
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                    }
                    .tint(TonoColor.textTertiary)
                    .accessibilityIdentifier("scopeDisclosure")

                    // "Where does a site go?" lives in Details, next to where traffic goes.

                    SettingsLabel(text: L.t("settings_system"))
                    Toggle(isOn: Binding(get: { model.includeAllNetworks }, set: { on in Task { await model.setIncludeAllNetworks(on) } })) {
                        VStack(alignment: .leading, spacing: 4) {
                            title(L.t("system_include_all"))
                            meta(L.t("system_include_all_short"))
                        }
                    }
                    .toggleStyle(RowToggleStyle())
                    if model.includeAllPending {
                        // The running tunnel keeps the previous setting until it next starts.
                        Text(L.t("system_include_all_pending")).tonoFont(15, relativeTo: .subheadline)
                            .foregroundStyle(TonoColor.warning)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.bottom, 8)
                            .accessibilityIdentifier("includeAllPending")
                    }
                    // The mechanics (restart hold, Connect On Demand) one tap away, as the routing scope.
                    DisclosureGroup(isExpanded: $showSystemHow) {
                        VStack(alignment: .leading, spacing: 12) {
                            meta(L.t("system_include_all_desc"))
                            meta(L.t("system_on_demand"))
                            Text(L.t("system_limit")).tonoFont(15, relativeTo: .subheadline).lineSpacing(2).foregroundStyle(TonoColor.warning)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.top, 8).padding(.bottom, 12)
                    } label: {
                        title(L.t("system_how_title"))
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                    }
                    .tint(TonoColor.textTertiary)

                    SettingsLabel(text: L.t("settings_lock_screen"))
                    Toggle(isOn: Binding(get: { model.liveActivityEnabled }, set: { model.setLiveActivity($0) })) {
                        VStack(alignment: .leading, spacing: 4) {
                            title(L.t("settings_live_activity"))
                            meta(L.t("settings_live_activity_desc"))
                        }
                    }
                    .toggleStyle(RowToggleStyle())
                    .accessibilityIdentifier("liveActivityToggle")

                    SettingsLabel(text: L.t("settings_account"))
                    // "Signed in as …", not the bare address: VoiceOver gets a sentence (Apple's audit
                    // flagged the bare address as not human-readable once Settings got shorter).
                    title(L.t("settings_signed_in_as", model.email ?? ""))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 12)
                    // A text action, not a capsule: red is the only colour on the row.
                    Button { confirmSignOut = true } label: {
                        Text(L.t("settings_sign_out")).tonoFont(17, .medium, relativeTo: .body)
                            .foregroundStyle(TonoColor.error)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressScale())
                    .padding(.top, 4)

                    // About as a colophon: the one line on the screen, then small print.
                    Rectangle().fill(contrast == .increased ? Color.white.opacity(0.4) : TonoColor.hairline)
                        .frame(height: 1).padding(.top, 40)
                        .accessibilityHidden(true)
                    SettingsLabel(text: L.t("settings_about"), first: true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L.t("about_version", AppModel.appVersion)).tonoFont(13, relativeTo: .footnote)
                            .foregroundStyle(TonoColor.textSecondary).fixedSize(horizontal: false, vertical: true)
                        fine(model.coreVersion.isEmpty ? L.t("about_core_no_version") : L.t("about_core", model.coreVersion))
                    }
                    .padding(.top, 8)
                }
                .padding(.horizontal, 20).padding(.bottom, 32)
            }
            .modifier(SheetSurface())
            .navigationTitle(L.t("settings_title"))
            .navigationBarTitleDisplayMode(.inline)
        }
        // Over the bar, not in it: iOS 26 holds toolbar items to 36 pt tall, under the 44 pt minimum
        // (the AX5 sweep measured 48 x 36 with a 44 pt frame inside the toolbar).
        .overlay(alignment: .topTrailing) { closeButton.padding(.top, 14).padding(.trailing, 14) }
        // One detent: nothing to drag between, so no grabber (a swipe down still closes it). At AX5
        // the grabber's 76 x 25 pt target was flagged by the contrast/hit-area sweep.
        .presentationDragIndicator(.hidden)
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
            // Fixed glyph inside the fixed 44 pt circle: at AX5 a body-scaled xmark grew past the circle.
            Image(systemName: "xmark").font(.system(size: 17, weight: .semibold)).foregroundStyle(TonoColor.textPrimary)
                .frame(width: 44, height: 44)
                .glassSurface(Circle(), interactive: true)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L.t("settings_close"))
        .accessibilityIdentifier("settingsClose")
    }

    /// Row title: the larger of the two sizes; hierarchy comes from size and tone, not weight.
    private func title(_ text: String) -> some View {
        Text(text).tonoFont(20, relativeTo: .title3).foregroundStyle(TonoColor.textPrimary).fixedSize(horizontal: false, vertical: true)
    }

    private func meta(_ text: String) -> some View {
        Text(text).tonoFont(15, relativeTo: .subheadline).lineSpacing(2).foregroundStyle(TonoColor.textSecondary).fixedSize(horizontal: false, vertical: true)
    }

    private func fine(_ text: String) -> some View {
        Text(text).tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.textTertiary).fixedSize(horizontal: false, vertical: true)
    }
}

/// A Settings group heading: sentence case at reading size in the quietest tone, set apart by
/// space above it rather than a card around the group.
private struct SettingsLabel: View {
    let text: String
    var first = false
    var body: some View {
        Text(text)
            .tonoFont(15, relativeTo: .subheadline)
            .foregroundStyle(TonoColor.textTertiary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, first ? 12 : 40)
            .accessibilityAddTraits(.isHeader)
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
    @State private var result: RouteCheckResult?
    /// The text the result on screen answers.
    @State private var asked: String?
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
                        let typed = value.replacingOccurrences(of: "\n", with: "")
                        host = typed
                        submit(typed)
                        return
                    }
                    // Another site: the result on screen is no longer about it. (Stripping the
                    // newline above lands here too, with the text just checked.)
                    if value == asked { return }
                    if case .answer(let answer) = result, RouteExplainer.cleanHost(value) == answer.host { return }
                    result = nil
                }
            QuietButton(title: L.t("check_go"), action: run)
        }
        .onChange(of: focused) { onFocus($0) }
        // The same site under the other mode can go elsewhere (example.com: direct vs cloud). Only a
        // confirmed mode changes `model.mode`, so a pending or refused switch never rewrites it.
        .onChange(of: model.mode) { _ in if result != nil { run() } }
        .onChange(of: model.routesStopped) { _ in if result != nil { run() } }
        // An unanswered switch withdraws a rule-based answer until a status read settles it.
        .onChange(of: model.routeChange) { _ in if result != nil { run() } }
        // A confirmation that arrives, expires or goes unanswered changes what may be answered.
        .onChange(of: model.routing) { _ in if result != nil { run() } }
        switch result {
        case .answer(let answer)?:
            VStack(alignment: .leading, spacing: 4) {
                Text(L.t("check_answer_\(answer.tcp.rawValue)", answer.host))
                    .tonoFont(16, .medium, relativeTo: .callout).foregroundStyle(TonoColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(L.t("check_result", L.t("verdict_\(answer.tcp.rawValue)"), L.t("verdict_\(answer.udp.rawValue)")))
                    .tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.textSecondary)
                // Names the mode the answer is for: the one in effect, not a pending request.
                Text(L.t("check_basis", ModeText.name(model.mode))).tonoFont(12, relativeTo: .caption).foregroundStyle(TonoColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("routeAnswer")
            .id("routeAnswer")
        case let other?:
            Text(Self.message(other)).tonoFont(14, relativeTo: .footnote).foregroundStyle(TonoColor.warning)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("routeCheckMessage")
                .id("routeAnswer")
        case nil:
            EmptyView()
        }
    }

    static func message(_ result: RouteCheckResult) -> String {
        switch result {
        case .answer(let a): return L.t("check_answer_\(a.tcp.rawValue)", a.host)
        case .empty: return L.t("check_empty")
        case .invalid(let typed): return L.t("check_invalid", String(typed.prefix(40)))
        case .noLines: return L.t("check_no_lines")
        case .routesStopped: return L.t("check_routes_stopped")
        case .unconfirmed: return L.t("check_unconfirmed")
        }
    }

    private func run() { submit(host) }

    private func submit(_ text: String) {
        focused = false
        let found = model.check(text)
        asked = text
        result = found
        onAnswer()
        let spoken = Self.message(found)
        // After the keyboard has gone, so the announcement is not cut off by the focus change.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            UIAccessibility.post(notification: .announcement, argument: spoken)
        }
    }
}

/// A settings switch whose whole row is the tap target (at least 44 pt tall), not only the
/// 63 x 28 pt switch; VoiceOver gets one switch with its label.
struct RowToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        RowToggle(configuration: configuration)
    }
}

private struct RowToggle: View {
    let configuration: ToggleStyleConfiguration
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // Accessibility sizes: the switch goes under the label, which then has the full width.
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                                                  : AnyLayout(HStackLayout(spacing: 12))
        Button { configuration.isOn.toggle() } label: {
            layout {
                configuration.label
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                // Drawn only; the row's button takes the tap.
                Toggle("", isOn: configuration.$isOn).labelsHidden().tint(TonoColor.accent).allowsHitTesting(false)
                    .padding(.trailing, 4)
            }
            .padding(.vertical, 12)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation {
            Toggle(isOn: configuration.$isOn) { configuration.label }
        }
    }
}
