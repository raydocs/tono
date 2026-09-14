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
            VStack(alignment: .leading, spacing: 28) {
                Image(systemName: "sparkle").font(.largeTitle).foregroundStyle(.teal).accessibilityHidden(true)
                Text("A quieter connection.").font(.largeTitle.weight(.medium))
                Text("Sign in with your Tono account.").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 16) {
                    if model.challenge == nil {
                        TextField("Email address", text: $email)
                            .textContentType(.emailAddress).keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder).accessibilityIdentifier("login.email")
                        ActionButton(title: "Send verification code", symbol: "arrow.right", prominent: true) {
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
                        ActionButton(title: "Continue", symbol: "arrow.right", prominent: true) {
                            let value = code
                            code = ""
                            Task { await model.verifyCode(value) }
                        }
                        .disabled(model.busy || code.count != 6)
                        Button("Use another email or request a new code") {
                            code = ""; model.challenge = nil; model.challengeExpires = nil
                        }.disabled(model.busy)
                    }
                    if model.busy { ProgressView().accessibilityLabel("Contacting Tono") }
                }
                Text("Signing in uses your current device allowance. If it is full, Tono may replace your least recently active device.")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("During TestFlight, comprehensive diagnostics are on by default. Only structured app states, failure codes and coarse timing leave this device—never your browsing content or credentials. Change this in Protection settings.")
                    .font(.footnote).foregroundStyle(.secondary)
                Link("ninx.app", destination: URL(string: "https://ninx.app")!)
                #if DEBUG
                Button("Preview interface · no VPN") { model.preview(.ready) }
                    .font(.footnote).disabled(model.busy)
                #endif
            }.padding(28).frame(maxWidth: 540)
                .frame(maxWidth: .infinity)
        }
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
            VStack(spacing: 28) {
                if model.isPreview {
                    Label("Interface preview · no VPN", systemImage: "eye")
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("preview.banner")
                }
                QuietField(state: model.state)
                    .frame(height: typeSize.isAccessibilitySize ? 100 : 220)
                VStack(spacing: 12) {
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
                ActionButton(title: actionTitle, symbol: shouldPause ? "pause.fill" : "arrow.right", prominent: !shouldPause) {
                    if shouldPause { showPause = true } else { Task { await model.connect() } }
                }
                .disabled(model.busy || model.isPreview)
                .accessibilityIdentifier("home.action")
                NavigationLink(destination: LocationsView(model: model)) {
                    HStack(spacing: 12) {
                        Image(systemName: "location")
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.locationTitle)
                            Text(model.isPreview ? (model.selectedLocation == nil ? "Netherlands" : "Pinned location") : "Managed by Tono")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption)
                    }.padding(20)
                }
                .buttonStyle(.plain)
                .modifier(CompanionSurface())
                .accessibilityIdentifier("home.locations")
                #if DEBUG
                if model.isPreview { PreviewControls(model: model) }
                #endif
            }
            .padding(.horizontal, 28).padding(.bottom, 32)
            .frame(maxWidth: 540).frame(maxWidth: .infinity)
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle("Tono")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink(destination: ProtectionSettings(model: model)) {
                    Image(systemName: "slider.horizontal.3")
                }.accessibilityLabel("Protection settings")
            }
        }
        .confirmationDialog("Pause protection?", isPresented: $showPause, titleVisibility: .visible) {
            Button("Pause until I resume", role: .destructive) { Task { await model.pause() } }
        } message: { Text("Your traffic will no longer be protected by Tono. On Demand stays off until you resume.") }
    }

    private var shouldPause: Bool { [.protected, .connecting, .recovering].contains(model.state) }
    private var actionTitle: String { shouldPause ? "Pause" : model.state == .paused ? "Resume protection" : "Connect" }
}

private struct LocationsView: View {
    @Bindable var model: AppModel
    var body: some View {
        List {
            Section {
                Label("Automatic", systemImage: "location")
                Text("Your chosen location stays pinned. Automatic can keep a working backup instead of moving you back unexpectedly.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if model.isPreview {
                #if DEBUG
                Section("Preview locations · not live") {
                    Button("Automatic") { model.selectPreviewLocation(nil) }
                    ForEach(["Netherlands", "Japan", "United States"], id: \.self) { name in
                        Button { model.selectPreviewLocation(name) } label: {
                            HStack { Text(name); Spacer(); if model.selectedLocation == name { Image(systemName: "checkmark") } }
                        }
                    }
                }
                #endif
            } else {
                Section {
                    ContentUnavailableView("Locations unavailable", systemImage: "location.slash",
                                           description: Text(Blocker.catalogAdapterUnavailable.message))
                    Button("Refresh managed locations") { Task { await model.refreshLocations() } }.disabled(model.busy)
                }
            }
        }.navigationTitle("Location")
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
                Picker("Collection", selection: $model.diagnosticPolicy) {
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
                    }
                    Spacer()
                    if device.current != true {
                        Button("Remove", role: .destructive) { removal = device }.disabled(model.busy)
                    }
                }
            }
            if model.devices.isEmpty { Text(model.isPreview ? "Preview mode does not load your devices." : "No devices loaded.").foregroundStyle(.secondary) }
        }
        .navigationTitle("Devices").task { await model.refreshDevices() }
        .refreshable { await model.refreshDevices() }
        .confirmationDialog("Remove this device?", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }), titleVisibility: .visible) {
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

private struct ActionButton: View {
    let title: String
    let symbol: String
    var prominent = false
    let action: () -> Void
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var body: some View {
        Group {
            if reduceTransparency { button.buttonStyle(.borderedProminent) }
            else if prominent { button.buttonStyle(.glassProminent) }
            else { button.buttonStyle(.glass) }
        }.controlSize(.large)
    }
    private var button: some View { Button(action: action) { Label(title, systemImage: symbol).padding(.horizontal, 12) } }
}

private struct CompanionSurface: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    func body(content: Content) -> some View {
        if reduceTransparency { content.background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24)) }
        else { content.glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 24)) }
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
#endif
