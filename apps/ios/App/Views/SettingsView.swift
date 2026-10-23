import SwiftUI
import TonoKit
import UIKit

/// Sign out's red, muted to the night surfaces (5.8:1 on Smoke, 6.2:1 on Night) instead of the
/// system alert red, which was the one saturated colour on the screen.
private let signOutRed = Color(hex: 0xE27068)
/// The switch's "on": the deeper end of the primary button's sun gradient, one accent with Home,
/// warm enough to part from the white knob without the coral of the sun's edge. The only place
/// the sun appears on this screen.
private let switchOn = Color(hex: 0xFF9E6B)

/// Settings is what you set and who you are: the first screen holds the controls (the protection
/// switch, the routing rules entry with the mode in effect, Live Activity, the account), and the
/// explanation lives one level down. A native inset-grouped form on the Tono sheet surface, so the
/// group structure survives the largest text size without relying on gaps. The mode picker and
/// the route check stay in Details, next to the lanes they change; nothing is repeated here.
struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmSignOut = false
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        // A navigation bar, not a hand-made header: on iOS 26 the close button is system glass and
        // the content blurs under the bar as it scrolls (scroll edge effect).
        NavigationStack {
            List {
                #if DEBUG
                // In the content, under the navigation bar, so it never covers the sheet's edge.
                if PreviewBadge.shown {
                    Section { PreviewBadge() }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
                }
                #endif

                // 1. Protection: the one switch that decides what happens while Tono restarts.
                // The safety boundary (Connect On Demand, what iOS does while Tono is off) is the
                // group's footer, always visible, said once.
                Section {
                    Toggle(isOn: Binding(get: { model.includeAllNetworks }, set: { on in Task { await model.setIncludeAllNetworks(on) } })) {
                        rowTitle(L.t("system_include_all"))
                    }
                    .toggleStyle(RowToggleStyle(meta: L.t("system_include_all_short"),
                                                // The running tunnel keeps the previous setting until it next starts.
                                                note: model.includeAllPending ? L.t("system_include_all_pending") : nil,
                                                identifier: "includeAllToggle"))
                } header: {
                    SettingsHeader(L.t("settings_system")).accessibilityIdentifier("settingsProtectionHeader")
                } footer: {
                    SettingsFooter(L.t("system_on_demand") + (L.isChinese ? "" : " ") + L.t("system_limit"))
                }
                .settingsRows()

                // 2. Routing: the rules are a value here (the mode in effect) and one screen down in
                // full. The picker itself is in Details, one tap from Home, next to where traffic goes.
                Section {
                    NavigationLink {
                        RoutingRulesView()
                    } label: {
                        valueRow(L.t("settings_routing_rules"),
                                 value: model.routesUnconfirmed ? L.t("lane_unconfirmed") : ModeText.name(model.mode))
                    }
                    .accessibilityIdentifier("settingsRoutingRules")
                } header: {
                    SettingsHeader(L.t("settings_routing_group"))
                }
                .settingsRows()

                // 3. Lock Screen and widgets.
                Section {
                    Toggle(isOn: Binding(get: { model.liveActivityEnabled }, set: { model.setLiveActivity($0) })) {
                        rowTitle(L.t("settings_live_activity"))
                    }
                    .toggleStyle(RowToggleStyle(meta: L.t("settings_live_activity_desc"), identifier: "liveActivityToggle"))
                } header: {
                    SettingsHeader(L.t("settings_lock_screen"))
                }
                .settingsRows()

                // 4. Account: the address is a value, not a headline. VoiceOver still gets the
                // sentence (Apple's audit flagged the bare address as not human-readable).
                Section {
                    valueRow(L.t("settings_signed_in"), value: Self.breakable(model.email ?? ""))
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(L.t("settings_signed_in_as", model.email ?? ""))
                } header: {
                    SettingsHeader(L.t("settings_account"))
                }
                .settingsRows()

                // Sign out in a group of its own: the one red on the screen, set apart by the group
                // gap, and it asks before acting.
                Section {
                    Button { confirmSignOut = true } label: {
                        Text(L.t("settings_sign_out")).tonoFont(17, relativeTo: .body).foregroundStyle(signOutRed)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressScale())
                    .accessibilityIdentifier("settingsSignOut")
                }
                .settingsRows()

                // Colophon in small print under the licences row; no "About" label, no update or
                // download row (distribution is chosen but not live, so nothing may claim "latest").
                Section {
                    NavigationLink {
                        LicencesView()
                    } label: {
                        rowTitle(L.t("settings_licences"))
                    }
                    .accessibilityIdentifier("settingsLicences")
                } footer: {
                    SettingsFooter(Self.breakable(L.t("about_version", AppModel.appVersion)) + "\n"
                                   + Self.breakable(model.coreVersion.isEmpty ? L.t("about_core_no_version") : L.t("about_core", model.coreVersion)))
                }
                .settingsRows()
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
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
            // A flat disc, as Kura's map controls: no sheen or rim, lighter than anything in the content.
            Image(systemName: "xmark").font(.system(size: 17, weight: .semibold)).foregroundStyle(TonoColor.textPrimary)
                .frame(width: 44, height: 44)
                .background(Color.white.opacity(contrast == .increased ? 0.14 : 0.08), in: Circle())
                .overlay(Circle().stroke(Color.white.opacity(contrast == .increased ? 0.4 : 0), lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(PressScale())
        .accessibilityLabel(L.t("settings_close"))
        .accessibilityIdentifier("settingsClose")
    }

    /// Identifiers (an address, a source URL) may break only after "@", "/" and a "." that starts
    /// the next part of a name: a zero-width break opportunity there, so the line breaker never has
    /// to hyphenate inside a word (AX5 showed "preview@ex-ample.com" and "Sager-Net"). Silent for
    /// VoiceOver; the string resources are untouched.
    static func breakable(_ text: String) -> String {
        let chars = Array(text)
        var out = ""
        out.reserveCapacity(chars.count + 8)
        for (i, c) in chars.enumerated() {
            out.append(c)
            let next: Character? = i + 1 < chars.count ? chars[i + 1] : nil
            if c == "@" || c == "/" || (c == "." && next?.isLetter == true) { out.append("\u{200B}") }
        }
        return out
    }
}

// MARK: - Row grammar (three roles: title, value or control, footer)

/// A row title: body size, primary ink, the one weight of the screen.
func rowTitle(_ text: String) -> some View {
    Text(text).tonoFont(17, relativeTo: .body).foregroundStyle(TonoColor.textPrimary)
        .fixedSize(horizontal: false, vertical: true)
}

/// A row that shows a value: the title leading, the value trailing in the secondary tone. At
/// accessibility sizes the value goes under the title, so neither breaks inside a word.
func valueRow(_ title: String, value: String) -> some View {
    ValueRow(title: title, value: value)
}

private struct ValueRow: View {
    let title: String
    let value: String
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                                                  : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
        layout {
            rowTitle(title).frame(maxWidth: typeSize.isAccessibilitySize ? .infinity : nil, alignment: .leading)
            if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
            Text(value).tonoFont(17, relativeTo: .body).foregroundStyle(TonoColor.textSecondary)
                .multilineTextAlignment(typeSize.isAccessibilitySize ? .leading : .trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(minHeight: 28)
    }
}

/// A group heading: sentence case, small and in the quietest tone. A clear step under the 17 pt
/// row title, so label and title never read as one size.
struct SettingsHeader: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .tonoFont(13, relativeTo: .footnote)
            .foregroundStyle(TonoColor.textTertiary)
            .textCase(nil)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A group footer: the explanation for the group above, small and secondary, always visible.
struct SettingsFooter: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .tonoFont(13, relativeTo: .footnote).lineSpacing(2)
            .foregroundStyle(TonoColor.textSecondary)
            .textCase(nil)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The row fill inside the sheet: the content card's smoke, opaque when transparency is reduced
/// or contrast increased (a stroke is not available on a list row, so the fill alone separates).
private struct SettingsRowFill: View {
    @Environment(\.tonoReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    var body: some View {
        TonoColor.smokeHigh.opacity(reduceTransparency || contrast == .increased ? 1 : 0.5)
    }
}

extension View {
    /// Tono's row surface and hairline on a form section.
    func settingsRows() -> some View {
        listRowBackground(SettingsRowFill())
            .listRowSeparatorTint(TonoColor.hairline)
    }
}

// MARK: - Routing rules (the only second-level screen)

/// Everything the first screen used to explain, once: the two modes with their descriptions and
/// where to change them, what Tono recognises, and what enters the tunnel on iPhone.
struct RoutingRulesView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List {
            Section {
                modeRow(.threeTier, name: L.t("mode_three_tier"), desc: L.t("mode_three_tier_desc"))
                modeRow(.stable, name: L.t("mode_stable"), desc: L.t("mode_stable_desc"))
            } header: {
                SettingsHeader(L.t("settings_routing"))
            } footer: {
                // The picker is in Details; this screen only tells.
                SettingsFooter(L.t("settings_mode_where")).accessibilityIdentifier("settingsModeWhere")
            }
            .settingsRows()

            Section {
                explanation(L.t("routing_scope")).accessibilityIdentifier("routingScope")
            } header: {
                SettingsHeader(L.t("routing_scope_title"))
            }
            .settingsRows()

            Section {
                explanation(L.t("routing_platform"))
            } header: {
                SettingsHeader(L.t("settings_rules_platform"))
            } footer: {
                SettingsFooter(L.t(model.underlyingIPv6 ? "ipv6_on" : "ipv6_off") + "\n"
                               + L.t("about_contract", String(DesktopRoutingContract.sourceDigest.prefix(12))))
            }
            .settingsRows()
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .modifier(SheetSurface())
        .navigationTitle(L.t("settings_routing_rules"))
        .navigationBarTitleDisplayMode(.inline)
    }

    /// The mode's name with "In use" as its trailing value when it is the one in effect (never
    /// while the tunnel has not confirmed which runs), and its description under it.
    private func modeRow(_ mode: RoutingMode, name: String, desc: String) -> some View {
        let inUse = model.mode == mode && !model.routesUnconfirmed
        return VStack(alignment: .leading, spacing: 4) {
            valueRow(name, value: inUse ? L.t("settings_mode_in_use") : "")
            Text(desc).tonoFont(15, relativeTo: .subheadline).lineSpacing(2).foregroundStyle(TonoColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("rulesMode_\(mode.rawValue)")
    }

    private func explanation(_ text: String) -> some View {
        Text(text).tonoFont(15, relativeTo: .subheadline).lineSpacing(2).foregroundStyle(TonoColor.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 4)
    }
}

// MARK: - Licences and source

/// The colophon in full: the build, the core and its licence, and the source as a link.
struct LicencesView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List {
            Section {
                rowTitle(SettingsView.breakable(L.t("about_version", AppModel.appVersion)))
            }
            .settingsRows()

            Section {
                rowTitle(SettingsView.breakable(model.coreVersion.isEmpty ? L.t("about_core_no_version") : L.t("about_core", model.coreVersion)))
                Link(destination: URL(string: "https://github.com/SagerNet/sing-box")!) {
                    valueRow(L.t("about_source_link"), value: "github.com")
                }
                .accessibilityIdentifier("aboutSourceLink")
            } header: {
                SettingsHeader("sing-box")
            }
            .settingsRows()
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .modifier(SheetSurface())
        .navigationTitle(L.t("settings_licences"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Route check (shown in Details)

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

// MARK: - Row switch

/// A settings switch whose whole row is the tap target (at least 44 pt tall), not only the
/// 63 x 28 pt switch; VoiceOver gets one switch with its label, description and note.
struct RowToggleStyle: ToggleStyle {
    /// The description under the title: drawn full width below the title row, spoken with the label.
    var meta: String? = nil
    /// A state line under the description (pending), in the warning tone.
    var note: String? = nil
    /// The switch's identifier for UI tests, set on the element VoiceOver and XCUITest see.
    var identifier: String? = nil

    func makeBody(configuration: Configuration) -> some View {
        RowToggle(configuration: configuration, meta: meta, note: note, identifier: identifier)
    }
}

private struct RowToggle: View {
    let configuration: ToggleStyleConfiguration
    let meta: String?
    let note: String?
    let identifier: String?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // The switch sits on the title line, centred on it; the description runs the full width
        // under both. Accessibility sizes: the switch goes under the title, which then has the full width.
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                                                  : AnyLayout(HStackLayout(spacing: 12))
        Button { configuration.isOn.toggle() } label: {
            VStack(alignment: .leading, spacing: 4) {
                layout {
                    configuration.label
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    // Drawn only; the row's button takes the tap.
                    Toggle("", isOn: configuration.$isOn).labelsHidden().tint(switchOn).allowsHitTesting(false)
                }
                if let meta {
                    Text(meta).tonoFont(13, relativeTo: .footnote).lineSpacing(2).foregroundStyle(TonoColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let note {
                    Text(note).tonoFont(13, relativeTo: .footnote).foregroundStyle(TonoColor.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.vertical, 4)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation {
            Toggle(isOn: configuration.$isOn) {
                VStack(alignment: .leading) {
                    configuration.label
                    if let meta { Text(meta) }
                    if let note { Text(note) }
                }
            }
            .accessibilityIdentifier(identifier ?? "")
        }
    }
}
