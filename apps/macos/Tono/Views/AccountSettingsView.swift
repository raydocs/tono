import SwiftUI

struct AccountSettingsCard: View {
    @Bindable var session: AccountSession
    @Environment(\.seaAccent) private var seaAccent
    @SeaAppearancePreference private var seaEnabled

    var body: some View {
        if seaEnabled {
            SeaPanel("Account", icon: "person.crop.circle") {
                VStack(alignment: .leading, spacing: 16) {
                    if let user = session.user {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(user.name ?? user.email)
                                .font(.system(size: 20, weight: .light))
                                .foregroundStyle(SeaTheme.text)
                            if user.name != nil {
                                Text(user.email).font(.system(size: 12)).foregroundStyle(SeaTheme.muted)
                            }
                        }
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), alignment: .leading)], alignment: .leading, spacing: 16) {
                            if let plan = user.plan {
                                seaFact("Plan", value: plan)
                            }
                            seaFact("Devices", value: TonoAccountRules.quotaText(
                                used: session.devices.count, limit: session.deviceLimit))
                            if let expiry = user.expiresAt {
                                seaFact("Expires", value: TonoAccountRules.expiryText(expiry))
                            }
                            if let quota = user.quotaBytes, let usage = user.usageBytes {
                                seaFact("Usage", value: "\(ByteCountFormatter.string(fromByteCount: usage, countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: quota, countStyle: .file))")
                            }
                        }
                        if let quota = user.quotaBytes, let usage = user.usageBytes, quota > 0, usage >= 0 {
                            GeometryReader { geometry in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(.white.opacity(0.10))
                                    Capsule().fill(seaAccent)
                                        .frame(width: geometry.size.width * min(Double(usage) / Double(quota), 1))
                                }
                            }
                            .frame(height: 4)
                            .accessibilityLabel("Usage")
                            .accessibilityValue("\(ByteCountFormatter.string(fromByteCount: usage, countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: quota, countStyle: .file))")
                        }
                    }
                    Rectangle().fill(.white.opacity(0.06)).frame(height: 1)
                    Text("Devices")
                        .font(.system(size: 13))
                        .foregroundStyle(SeaTheme.muted)
                    ForEach(session.devices) { device in
                        HStack(spacing: 10) {
                            Image(systemName: "desktopcomputer")
                                .foregroundStyle(seaAccent)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(device.name).font(.system(size: 15)).foregroundStyle(SeaTheme.text)
                                if let seen = device.lastSeenAt {
                                    Text("Last seen \(seen.formatted(.relative(presentation: .named)))")
                                        .font(.system(size: 12)).foregroundStyle(SeaTheme.muted)
                                }
                            }
                            Spacer()
                            if device.id == session.device?.id || device.current == true {
                                SeaTag(title: "This Mac")
                            } else {
                                Button("Revoke", role: .destructive) {
                                    Task { await session.revoke(device) }
                                }
                                .buttonStyle(SeaButtonStyle(variant: .danger, size: .row))
                            }
                        }
                        .frame(minHeight: 52)
                        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.06)).frame(height: 1) }
                    }
                    if let error = session.deviceActionError {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(.system(size: 13)).foregroundStyle(SeaTheme.danger)
                    }
                    if session.isAtDeviceLimit {
                        SeaTag(title: "\(session.deviceLimit)-device limit reached", kind: .attention)
                    }
                    HStack {
                        Spacer()
                        Button("Sign Out", role: .destructive) {
                            Task { await session.logout() }
                        }
                        .buttonStyle(SeaButtonStyle(variant: .danger))
                    }
                }
            }
        } else {
            GroupBox("Tono Account") {
            VStack(alignment: .leading, spacing: 12) {
                if let user = session.user {
                    LabeledContent("User", value: user.name ?? user.email)
                    if user.name != nil { LabeledContent("Email", value: user.email) }
                    LabeledContent("Plan", value: user.plan ?? "Tono")
                    LabeledContent("Devices", value: TonoAccountRules.quotaText(used: session.devices.count, limit: session.deviceLimit))
                    LabeledContent("Expires", value: TonoAccountRules.expiryText(user.expiresAt))
                    if let quota = user.quotaBytes, let usage = user.usageBytes {
                        LabeledContent("Usage", value: "\(ByteCountFormatter.string(fromByteCount: usage, countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: quota, countStyle: .file))")
                    }
                }
                Divider()
                ForEach(session.devices) { device in
                    HStack {
                        Image(systemName: "desktopcomputer")
                        VStack(alignment: .leading) {
                            Text(device.name)
                            if let seen = device.lastSeenAt { Text("Last seen \(seen.formatted(.relative(presentation: .named)))").font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        if device.id == session.device?.id || device.current == true { Text("This Mac").foregroundStyle(.secondary) }
                        else { Button("Revoke", role: .destructive) { Task { await session.revoke(device) } } }
                    }
                }
                if let deviceActionError = session.deviceActionError {
                    // Reported here rather than through the account gate: a
                    // failed revoke leaves the tunnel and the window alone.
                    Label(deviceActionError, systemImage: "exclamationmark.circle")
                        .font(.callout)
                        .foregroundStyle(TonoStatus.error)
                }
                if session.isAtDeviceLimit {
                    Label("\(session.deviceLimit)-device limit reached", systemImage: "info.circle")
                        .foregroundStyle(.orange)
                }
                Divider()
                Button("Sign Out", role: .destructive) { Task { await session.logout() } }
            }.padding(8)
            }
        }
    }

    private func seaFact(_ label: LocalizedStringKey, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12)).foregroundStyle(SeaTheme.muted)
            Text(value).font(.system(size: 15)).monospacedDigit().foregroundStyle(SeaTheme.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct AccountSettingsView: View {
    @Bindable var session: AccountSession
    @SeaAppearancePreference private var seaEnabled
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if seaEnabled {
                SeaPageHeading(title: "Account", subtitle: "Your plan, devices, and allowance")
            } else {
                Text("Tono").font(.title2.bold())
            }
            AccountSettingsCard(session: session)
            if !seaEnabled {
                HStack { Spacer(); Button("Sign Out", role: .destructive) { Task { await session.logout() } } }
            }
        }
        .padding()
        .task {
            session.clearDeviceActionError()
            // Plan, expiry, quota and usage are otherwise whatever they were at
            // sign-in, which for a resident menu-bar client can be days old.
            await session.refreshAccount()
            _ = try? await session.reloadDevices()
        }
    }
}
