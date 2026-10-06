import SwiftUI

struct AccountSettingsCard: View {
    @Bindable var session: AccountSession
    @SeaAppearancePreference private var seaEnabled

    var body: some View {
        if seaEnabled {
            SeaPanel("Account", icon: "person.crop.circle") {
                VStack(alignment: .leading, spacing: 16) {
                    if let user = session.user {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(user.name ?? user.email)
                                .font(.system(size: 18, weight: .medium))
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
                                    Capsule().fill(SeaTheme.warm)
                                        .frame(width: geometry.size.width * min(Double(usage) / Double(quota), 1))
                                }
                            }
                            .frame(height: 6)
                            .accessibilityLabel("Usage")
                            .accessibilityValue("\(ByteCountFormatter.string(fromByteCount: usage, countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: quota, countStyle: .file))")
                        }
                    }
                    Divider()
                    Text("Devices")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(SeaTheme.text)
                    ForEach(session.devices) { device in
                        HStack(spacing: 10) {
                            Image(systemName: "desktopcomputer")
                                .foregroundStyle(SeaTheme.cool)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(device.name).foregroundStyle(SeaTheme.text)
                                if let seen = device.lastSeenAt {
                                    Text("Last seen \(seen.formatted(.relative(presentation: .named)))")
                                        .font(.caption).foregroundStyle(SeaTheme.muted)
                                }
                            }
                            Spacer()
                            if device.id == session.device?.id || device.current == true {
                                Text("This Mac")
                                    .font(.caption).foregroundStyle(SeaTheme.cool)
                            } else {
                                Button("Revoke", role: .destructive) {
                                    Task { await session.revoke(device) }
                                }
                            }
                        }
                    }
                    if let error = session.deviceActionError {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(.callout).foregroundStyle(SeaTheme.danger)
                    }
                    if session.isAtDeviceLimit {
                        Label("\(session.deviceLimit)-device limit reached", systemImage: "info.circle")
                            .foregroundStyle(SeaTheme.warm)
                    }
                    Divider()
                    Button("Sign Out", role: .destructive) {
                        Task { await session.logout() }
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
            Text(label).font(.system(size: 11)).foregroundStyle(SeaTheme.muted)
            Text(value).font(.system(size: 12, weight: .medium)).foregroundStyle(SeaTheme.text)
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
