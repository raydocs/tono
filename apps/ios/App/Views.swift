import SwiftUI

struct RootView: View {
    @Bindable var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            NavigationStack {
                if model.user != nil || model.isPreview { HomeView(model: model) }
                else { LoginView(model: model) }
            }
            .id(model.user?.id ?? (model.isPreview ? "preview" : "signed-out"))
            if scenePhase != .active {
                Color(uiColor: .systemBackground).ignoresSafeArea()
                Text("Tono").font(.largeTitle.weight(.medium))
            }
        }
        .alert("Tono", isPresented: Binding(get: { model.notice != nil }, set: { if !$0 { model.notice = nil } })) {
            Button("OK", role: .cancel) { model.notice = nil }
        } message: { Text(model.notice ?? "") }
    }
}

private struct LoginView: View {
    @Bindable var model: AppModel
    @State private var email = ""
    @State private var code = ""
    @FocusState private var focusCode: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 2) {
                    Text("T").font(.largeTitle.weight(.bold))
                    Circle().stroke(lineWidth: 5).frame(width: 26, height: 26)
                }
                .accessibilityHidden(true)
                .padding(.top, 32)
                Text("A quieter connection.").font(.largeTitle.weight(.medium))
                Text("Sign in with your Tono account.").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 16) {
                    if let recovery = model.accountRecovery {
                        Text(recovery.message)
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("login.recovery")
                        CTAButton(title: recovery.actionTitle, busy: model.busy) {
                            Task { await model.retryAccountRecovery() }
                        }
                        .disabled(model.busy)
                        .accessibilityIdentifier("login.retry")
                    } else if model.challenge == nil {
                        TextField("Email address", text: $email)
                            .textContentType(.emailAddress).keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder).accessibilityIdentifier("login.email")
                        CTAButton(title: "Send code", busy: model.busy) {
                            Task { await model.sendCode(email: email) }
                        }
                        .disabled(model.busy || !email.contains("@"))
                    } else {
                        Text("Enter the six-digit code sent to your email.")
                        TextField("Verification code", text: $code)
                            .textContentType(.oneTimeCode).keyboardType(.numberPad)
                            .textFieldStyle(.roundedBorder).focused($focusCode)
                            .accessibilityIdentifier("login.code")
                            .onChange(of: code) { code = String(code.filter { $0.isASCII && $0.isNumber }.prefix(6)) }
                        CTAButton(title: "Continue", busy: model.busy) {
                            let value = code
                            code = ""
                            Task { await model.verifyCode(value) }
                        }
                        .disabled(model.busy || code.count != 6)
                        Button("Use another email or request a new code") {
                            code = ""; model.challenge = nil; model.challengeExpires = nil
                        }.disabled(model.busy)
                    }
                }
                Text("Signing in uses this device's place in your allowance.")
                    .font(.footnote).foregroundStyle(.secondary)
                Link("ninx.app", destination: URL(string: "https://ninx.app")!)
                #if DEBUG
                Button("Preview interface · no VPN") { model.preview(.ready) }
                    .font(.footnote).disabled(model.busy)
                #endif
            }.padding(24).frame(maxWidth: 540)
                .frame(maxWidth: .infinity)
        }
        .background(TonoBrand.ground.ignoresSafeArea())
        .navigationTitle("Tono")
        .onChange(of: model.challenge?.challengeId) { focusCode = model.challenge != nil }
    }
}

struct HomeView: View {
    @Bindable var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var showPause = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if model.isPreview {
                    Label("Interface preview · no VPN", systemImage: "eye")
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("preview.banner")
                }
                // 290pt keeps state, power control and the location chip on the
                // first screen of a 375x812 phone; 330 pushed the chip under the
                // home indicator there and cut the control on 375x667.
                QuietField(state: model.state)
                    .frame(height: typeSize.isAccessibilitySize ? 140 : 290)
                VStack(spacing: 8) {
                    Text(model.state.title).font(.largeTitle.weight(.medium))
                        .contentTransition(.numericText())
                        .accessibilityIdentifier("home.state")
                    Text(model.state.detail).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.center)
                .accessibilityElement(children: .combine)
                .animation(reduceMotion ? nil : .spring(response: 0.5, dampingFraction: 0.9), value: model.state)
                if model.state == .actionRequired {
                    Text((model.machine.blocker ?? .coreUnavailable).message)
                        .font(.callout).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    NavigationLink("Review protection", destination: ProtectionSettings(model: model))
                }
                VStack(spacing: 8) {
                    PowerButton(on: shouldPause && !model.isPreview,
                                enabled: !model.busy && !model.isPreview,
                                label: actionTitle) {
                        if shouldPause { showPause = true } else { Task { await model.connect() } }
                    }
                    // The button already carries the VoiceOver label. Keep the
                    // visual verb 8pt from its edge, without extra button padding.
                    // Primary, not secondary: it sits on the halo/shadow wash,
                    // where secondary gray drops to about 2.7-3:1 in light mode.
                    Text(actionTitle).font(.footnote).foregroundStyle(.primary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityHidden(true)
                }
                .padding(.top, 8)
                NavigationLink(destination: LocationsView(model: model)) {
                    HStack(spacing: 10) {
                        Image(systemName: "globe")
                        Text(model.locationTitle)
                        Image(systemName: "chevron.right").font(.caption)
                    }
                    .padding(.horizontal, 22).padding(.vertical, 14)
                }
                .buttonStyle(.plain)
                .modifier(LocationChip())
                .accessibilityIdentifier("home.locations")
                #if DEBUG
                if model.isPreview { PreviewControls(model: model) }
                #endif
            }
            .padding(.horizontal, 24).padding(.bottom, 32)
            .frame(maxWidth: 540).frame(maxWidth: .infinity)
        }
        .background(TonoBrand.ground.ignoresSafeArea())
        .navigationTitle("Tono")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(destination: ProtectionSettings(model: model)) {
                    Image(systemName: "gearshape")
                }.accessibilityLabel("Protection settings")
            }
        }
        .confirmationDialog("Pause protection?", isPresented: $showPause, titleVisibility: .visible) {
            Button("Pause until I resume", role: .destructive) { Task { await model.pause() } }
        } message: { Text("Your traffic will no longer be protected by Tono. On Demand stays off until you resume.") }
        .sensoryFeedback(trigger: model.state == .protected) { _, arrived in
            arrived ? .success : nil
        }
    }

    private var shouldPause: Bool { [.protected, .connecting, .recovering].contains(model.state) }
    private var actionTitle: String { shouldPause ? "Pause" : model.state == .paused ? "Resume protection" : "Connect" }
}

/// Glossy indigo power control. On = luminous ramp + halo. Off but available
/// (Ready, Paused) = tinted disc with a 1pt accent edge, so it reads as a
/// control rather than a disabled one. Disabled/preview = quiet gray.
private struct PowerButton: View {
    let on: Bool
    let enabled: Bool
    let label: String
    let action: () -> Void
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        Button(action: action) {
            Image(systemName: "power")
                .font(.system(size: 64, weight: .semibold))
                .foregroundStyle(glyph)
                .frame(width: 188, height: 188)
                .background { Circle().fill(fill) }
                .overlay {
                    if on {
                        Circle().fill(LinearGradient(
                            colors: [.white.opacity(reduceTransparency ? 0 : 0.35), .white.opacity(0)],
                            startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.45)))
                    } else if enabled {
                        // The 10% tint alone is ~1.1:1 against the ground; the
                        // edge is what gives the tap target a boundary.
                        Circle().strokeBorder(TonoBrand.accent.opacity(0.35), lineWidth: 1)
                    }
                }
                .shadow(color: on ? TonoBrand.powerMid.opacity(0.5) : .black.opacity(0.12),
                        radius: on ? 32 : 12, y: on ? 15 : 8)
        }
        // Halo lives in .background so the 264pt glow never enters layout:
        // the control footprint stays 188pt and the chip below cannot jump.
        .background {
            if on && !reduceTransparency {
                Circle()
                    .fill(.radialGradient(
                        Gradient(colors: [TonoBrand.halo.opacity(0.48), TonoBrand.halo.opacity(0)]),
                        center: .center, startRadius: 44, endRadius: 132))
                    .frame(width: 264, height: 264)
                    .allowsHitTesting(false)
            }
        }
        .buttonStyle(PressScaleStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.6)
        .accessibilityIdentifier("home.action")
        .accessibilityLabel(label)
    }

    private var glyph: Color { on ? .white : enabled ? TonoBrand.accent : .secondary }

    private var fill: AnyShapeStyle {
        if on {
            AnyShapeStyle(RadialGradient(
                colors: [TonoBrand.powerTop, TonoBrand.powerMid, TonoBrand.powerDeep],
                center: UnitPoint(x: 0.35, y: 0.28),
                startRadius: 10, endRadius: 120))
        } else if enabled {
            AnyShapeStyle(TonoBrand.accent.opacity(0.10))
        } else {
            AnyShapeStyle(Color(uiColor: .secondarySystemBackground))
        }
    }
}

private struct LocationChip: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(Color(uiColor: .secondarySystemBackground), in: Capsule())
        } else {
            content.glassEffect(.regular.interactive(), in: Capsule())
        }
    }
}

private struct LocationsView: View {
    @Bindable var model: AppModel
    var body: some View {
        List {
            Section {
                Label("Automatic", systemImage: "location")
                Text("Your chosen location stays pinned. Automatic uses Tono's default for your account.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if model.isPreview {
                #if DEBUG
                Section("Preview locations · not live") {
                    Button { model.selectPreviewLocation(nil) } label: {
                        HStack { Text("Automatic"); Spacer(); if model.selectedLocation == nil { Image(systemName: "checkmark") } }
                    }
                    .accessibilityAddTraits(model.selectedLocation == nil ? .isSelected : [])
                    ForEach(["Netherlands", "Japan", "United States"], id: \.self) { name in
                        Button { model.selectPreviewLocation(name) } label: {
                            HStack { Text(name); Spacer(); if model.selectedLocation == name { Image(systemName: "checkmark") } }
                        }
                        .accessibilityAddTraits(model.selectedLocation == name ? .isSelected : [])
                    }
                }
                #endif
            } else if !model.locations.isEmpty {
                Section("Managed locations") {
                    Button { Task { await model.selectLocation(nil) } } label: {
                        HStack { Text("Automatic"); Spacer(); if model.selectedLocation == nil { Image(systemName: "checkmark") } }
                    }
                    .accessibilityAddTraits(model.selectedLocation == nil ? .isSelected : [])
                    ForEach(model.locations, id: \.self) { name in
                        Button { Task { await model.selectLocation(name) } } label: {
                            HStack { Text(name); Spacer(); if model.selectedLocation == name { Image(systemName: "checkmark") } }
                        }.privacySensitive()
                            .accessibilityAddTraits(model.selectedLocation == name ? .isSelected : [])
                    }
                    Text("Changing location pauses protection. Connect again to use it; a failed pin never chooses another location.")
                        .font(.footnote).foregroundStyle(.secondary)
                }.disabled(model.busy)
            } else {
                Section {
                    ContentUnavailableView("Locations unavailable", systemImage: "location.slash",
                                           description: Text(Blocker.catalogAdapterUnavailable.message))
                    Button("Refresh managed locations") { Task { await model.refreshLocations() } }.disabled(model.busy)
                }
            }
        }.navigationTitle("Location").task { await model.refreshLocations() }
    }
}

private struct ProtectionSettings: View {
    @Bindable var model: AppModel
    @State private var diagnosticsVisible = false
    @State private var confirmSignOut = false

    var body: some View {
        Form {
            Section("Protection") {
                Toggle("Connect On Demand", isOn: Binding(get: { model.onDemand }, set: { value in
                    Task { await model.setOnDemand(value) }
                })).disabled(model.busy || model.isPreview)
                Text("Enabled by default. This preference becomes active only after an approved networking core is installed and you allow the VPN configuration. This draft cannot establish protection.")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Pause protection", role: .destructive) { Task { await model.pause() } }
                    .disabled(model.busy || model.isPreview)
            }
            Section("Account") {
                if let user = model.user { Text(user.email).privacySensitive() }
                NavigationLink("Devices", destination: DevicesView(model: model))
                Button("Sign out", role: .destructive) { confirmSignOut = true }
                    .disabled(model.busy || model.isPreview)
            }
            Section("Diagnostics") {
                Picker("Collection", selection: Binding(get: { model.diagnosticPolicy }, set: model.setDiagnosticPolicy)) {
                    if model.distribution == "testflight" {
                        Text("Comprehensive · TestFlight").tag(DiagnosticPolicy.comprehensive)
                    }
                    Text("Minimal").tag(DiagnosticPolicy.minimal)
                    Text("Off").tag(DiagnosticPolicy.off)
                }.disabled(model.busy || model.isPreview)
                Text("Comprehensive includes app state transitions, fixed failure codes and coarse timing. Minimal sends failures only. No credentials, account details, traffic content, destinations or raw logs. Pending history clears when you change this setting. Uploads run while this draft is open.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section {
                Link("ninx.app", destination: URL(string: "https://ninx.app")!)
                Text("Tono for iOS · 0.1.0").foregroundStyle(.secondary)
                    .onLongPressGesture(minimumDuration: 1.5) { diagnosticsVisible = true }
                    .accessibilityAction(named: "Open technical diagnostics") { diagnosticsVisible = true }
            }
            #if DEBUG
            Section("Development") { PreviewControls(model: model) }
            #endif
        }
        .navigationTitle("Protection")
        .sheet(isPresented: $diagnosticsVisible) {
            NavigationStack { DiagnosticsView(model: model).toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { diagnosticsVisible = false } }
            } }
        }
        .confirmationDialog("Sign out and pause protection?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
        } message: { Text("This removes the local session. It does not revoke other devices.") }
    }
}

private struct DevicesView: View {
    @Bindable var model: AppModel
    @State private var removal: CloudDevice?
    var body: some View {
        List {
            if let limit = model.user?.deviceLimit { Text("Device allowance: \(limit)").foregroundStyle(.secondary) }
            ForEach(model.devices) { device in
                HStack {
                    VStack(alignment: .leading) {
                        Text(device.name).privacySensitive()
                        Text(device.current == true ? "This device" : device.status ?? "Registered").font(.caption).foregroundStyle(.secondary)
                        Text("Device ID: \(device.id)")
                            .font(.caption).foregroundStyle(.secondary).privacySensitive()
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    if device.current != true {
                        Button("Remove", role: .destructive) { removal = device }
                            .accessibilityLabel(device.removalLabel)
                            .disabled(model.busy)
                    }
                }
            }
            if model.devices.isEmpty { Text(model.isPreview ? "Preview mode does not load your devices." : "No devices loaded.").foregroundStyle(.secondary) }
        }
        .navigationTitle("Devices").task { await model.refreshDevices() }
        .refreshable { await model.refreshDevices() }
        .confirmationDialog(removal.map { $0.removalLabel + "?" } ?? "Remove device?", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }), titleVisibility: .visible) {
            Button("Remove device", role: .destructive) {
                if let device = removal { Task { await model.removeDevice(device) } }
                removal = nil
            }
        } message: { Text("Its Tono credentials will be revoked. It will need to sign in again.") }
    }
}

private struct DiagnosticsView: View {
    @Bindable var model: AppModel
    var body: some View {
        List {
            Section("Runtime") {
                LabeledContent("Core", value: "sing-box \(SingBoxIdentity.version)")
                LabeledContent("iOS artifact", value: "Unavailable")
                LabeledContent("Go / CGO", value: "\(SingBoxIdentity.goVersion) / 0")
                Text("No network protection, background execution or handshake has been qualified in this build.")
            }
            Section("Policy families") {
                ForEach(PolicyFamily.allCases, id: \.rawValue) { family in
                    VStack(alignment: .leading) {
                        Text(family.rawValue)
                        Text(family.unavailableReason.message).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Section("Safe event buffer") {
                LabeledContent("Events", value: "\(model.diagnostics.events.count)")
                Button("Send diagnostics now") { Task { await model.uploadDiagnostics() } }
                    .disabled(model.busy || model.isPreview || model.diagnosticPolicy == .off)
                ForEach(Array(model.diagnostics.events.enumerated()), id: \.offset) { _, event in
                    Text("\(event.kind.rawValue) · \(event.state.title)").font(.caption)
                }
            }
        }.navigationTitle("Technical diagnostics")
    }
}

/// Dribbble-style indigo pill CTA. Busy renders the spinner inside the button.
struct CTAButton: View {
    let title: String
    var busy = false
    let action: () -> Void
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.isEnabled) private var isEnabled
    @ScaledMetric(relativeTo: .body) private var scaledAdornment: CGFloat = 22
    /// Follows Dynamic Type through xxxLarge (~30pt) and then holds, so the
    /// symmetric clearance never squeezes the title zone below one long word
    /// on a 375pt phone at accessibility sizes.
    private var adornmentWidth: CGFloat { min(scaledAdornment, 30) }
    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title).fontWeight(.semibold)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    // Symmetric clearance keeps the title centered and lets it
                    // wrap before reaching the busy/idle adornment.
                    .padding(.horizontal, adornmentWidth + 10)
                HStack {
                    Spacer()
                    Group {
                        if busy { ProgressView().tint(.white) }
                        else { Image(systemName: "arrow.right").accessibilityHidden(true) }
                    }
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .frame(width: adornmentWidth, alignment: .trailing)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .padding(.horizontal, 20)
            .background {
                // Deep indigo under the text for contrast; gloss stays clear
                // of the title zone.
                Capsule().fill(LinearGradient(
                    colors: [TonoBrand.powerMid, TonoBrand.powerDeep],
                    startPoint: .top, endPoint: .bottom))
            }
            .overlay {
                if !reduceTransparency {
                    Capsule().fill(LinearGradient(
                        colors: [.white.opacity(0.22), .white.opacity(0)],
                        startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.3)))
                }
            }
        }
        .buttonStyle(PressScaleStyle())
        .foregroundStyle(.white)
        .opacity(isEnabled ? 1 : 0.55)
        .controlSize(.large)
    }
}

/// Press shrink per the house motion spec (scale 0.98, frozen under Reduce Motion).
private struct PressScaleStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(reduceMotion ? 1 : (configuration.isPressed ? 0.98 : 1))
            .animation(reduceMotion ? nil : .easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

#if DEBUG
private struct PreviewControls: View {
    let model: AppModel
    var body: some View {
        Menu("Preview state · no VPN") {
            ForEach(ProtectionState.allCases, id: \.rawValue) { state in
                Button(state.title) { model.preview(state) }
            }
        }.accessibilityIdentifier("preview.states").disabled(model.busy)
    }
}

#Preview("Protected · interface only") {
    let model = AppModel()
    model.preview(.protected)
    return RootView(model: model)
}

#Preview("Ready · interface only") {
    let model = AppModel()
    model.preview(.ready)
    return RootView(model: model)
}

#Preview("Paused · interface only") {
    let model = AppModel()
    model.preview(.paused)
    return RootView(model: model)
}

// Component-only preview. App previews keep the power control gray and
// disabled; this is the only way to inspect the on / ready styles without
// touching that contract or a VPN. Actions are no-ops.
#Preview("PowerButton · on / ready / disabled") {
    VStack(spacing: 40) {
        PowerButton(on: true, enabled: true, label: "Pause") {}
        PowerButton(on: false, enabled: true, label: "Connect") {}
        PowerButton(on: false, enabled: false, label: "Connect") {}
    }
    .padding(48)
    .background(TonoBrand.ground.ignoresSafeArea())
}
#endif
