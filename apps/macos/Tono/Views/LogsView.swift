import SwiftUI
import UniformTypeIdentifiers
import AppKit

struct LogsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.seaAccent) private var seaAccent
    @SeaAppearancePreference private var seaEnabled
    @FocusState private var searchFocused
    @State private var searchText: String = ""
    @State private var levelFilter: String?

    private static let knownLevels = ["error", "warning", "info", "debug"]

    private var filteredLogs: [LogEntry] {
        appState.logEntries.filter { entry in
            (levelFilter == nil || entry.level.lowercased() == levelFilter)
                && (searchText.isEmpty || entry.message.localizedCaseInsensitiveContains(searchText))
        }
    }

    /// Badge/chip tint per log level, from the shared status ramp.
    private func levelTint(_ level: String?) -> Color {
        switch level?.lowercased() {
        case "error": TonoStatus.error
        case "warning": TonoStatus.blocked
        default: .secondary
        }
    }

    private func seaLevelTint(_ level: String?) -> Color {
        switch level?.lowercased() {
        case "error": SeaTheme.danger
        case "warning": SeaTheme.attention
        default: SeaTheme.muted
        }
    }

    private func levelTitle(_ level: String?) -> LocalizedStringKey {
        switch level?.lowercased() {
        case "error": "Error"
        case "warning": "Warning"
        case "info": "Info"
        case "debug": "Debug"
        default: "All"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
                .padding(.bottom, 10)
            levelFilterRow
                .padding(.bottom, 12)

            // Log container
            VStack(spacing: 0) {
                // Table header
                if seaEnabled {
                    // No all-caps eyebrow: a 12 pt tertiary header over a hairline.
                    HStack(spacing: 0) {
                        Text("Time").frame(width: 100, alignment: .leading)
                        Text("Level").frame(width: 80, alignment: .leading)
                        Text("Message").frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(SeaTheme.tertiary)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    Rectangle().fill(.white.opacity(0.06)).frame(height: 1)
                } else {
                HStack(spacing: 0) {
                    Text("TIME")
                        .frame(width: 100, alignment: .leading)
                    Text("LEVEL")
                        .frame(width: 80, alignment: .leading)
                    Text("MESSAGE")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .tracking(0.5)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(.white.opacity(colorScheme == .dark ? 0.06 : 0.15))

                Divider().opacity(0.3)
                }

                // Log entries
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(filteredLogs) { entry in
                                logRow(entry)
                                    .id(entry.id)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .scrollIndicators(.hidden)
                    .onChange(of: appState.logEntries.count) {
                        if let last = filteredLogs.last {
                            // A new animation for every log line creates a
                            // permanently interrupted animation under load.
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }

                // Empty state
                if filteredLogs.isEmpty {
                    VStack(spacing: 8) {
                        if !seaEnabled {
                            Image(systemName: "doc.text.magnifyingglass")
                                .font(.system(size: 32))
                                .foregroundStyle(.secondary)
                        }
                        Text(LocalizedStringKey(appState.isConnected ? "No logs matching filter" : "Connect to see logs"))
                            .font(.system(size: seaEnabled ? 14 : 13))
                            .foregroundStyle(seaEnabled ? SeaTheme.muted : Color.secondary)
                        if !appState.isConnected {
                            // Runtime logs only exist while the core runs, but
                            // helper, Kill Switch, and reconnect events keep
                            // recording locally — the file that matters when
                            // diagnosing why a connection never came up.
                            Text("System events (helper, Kill Switch, reconnects) are kept in the local audit log.")
                                .font(.system(size: seaEnabled ? 12 : 11))
                                .foregroundStyle(seaEnabled ? AnyShapeStyle(SeaTheme.tertiary) : AnyShapeStyle(.tertiary))
                            Button("Show Audit Log in Finder") {
                                let url = LocalTrafficAudit.shared.prepareForReveal()
                                NSWorkspace.shared.activateFileViewerSelecting([url])
                            }
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(seaEnabled ? seaAccent : TonoBrand.accent)
                            .modifier(SeaActionStyle(variant: .text, size: .row, legacy: .plain))
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(.white.opacity(seaEnabled ? 0 : (colorScheme == .dark ? 0.08 : 0.4)), in: RoundedRectangle(cornerRadius: 20))
            .overlay(
                RoundedRectangle(cornerRadius: 20)
                    .strokeBorder(.white.opacity(seaEnabled ? 0 : (colorScheme == .dark ? 0.12 : 0.7)), lineWidth: 0.5)
            )
            .modifier(SeaPanelSurface())
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 16)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // MARK: - Header

    private var headerRow: some View {
        HStack(alignment: .center) {
            HStack(spacing: 10) {
                Text("Logs")
                    .font(.system(size: seaEnabled ? 28 : 24, weight: seaEnabled ? .light : .semibold))
                    .foregroundStyle(seaEnabled ? SeaTheme.text : Color.primary)

                if seaEnabled {
                    SeaTag(title: "\(appState.logEntries.count) entries")
                } else {
                Text("\(appState.logEntries.count) entries")
                    .font(.system(size: seaEnabled ? 15 : 12, weight: .medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: Capsule())
                }
            }

            Spacer()

            HStack(spacing: 10) {
                // Search
                if seaEnabled {
                    HStack(spacing: 6) {
                        Image(systemName: "magnifyingglass").foregroundStyle(SeaTheme.muted)
                        TextField("Filter logs...", text: $searchText)
                            .textFieldStyle(.plain).focused($searchFocused).frame(width: 160)
                    }.modifier(SeaFieldSurface(focused: searchFocused))
                } else {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    TextField("Filter logs...", text: $searchText)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12))
                        .frame(width: 160)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: Capsule())
                .overlay(Capsule().strokeBorder(.white.opacity(colorScheme == .dark ? 0.12 : 0.5), lineWidth: 0.5))
                }

                // Export logs
                Button {
                    exportLogs()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "square.and.arrow.down")
                            .font(.system(size: 11))
                        Text("Export")
                            .font(.system(size: seaEnabled ? 15 : 12, weight: .medium))
                    }
                    .foregroundStyle(.primary)
                    .padding(.horizontal, seaEnabled ? 0 : 12)
                    .padding(.vertical, seaEnabled ? 0 : 6)
                    .background(seaEnabled ? .clear : .white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: Capsule())
                    .overlay(Capsule().strokeBorder(.white.opacity(seaEnabled ? 0 : (colorScheme == .dark ? 0.12 : 0.5)), lineWidth: 0.5))
                    .contentShape(Capsule())
                }
                .modifier(SeaActionStyle(variant: .quiet, size: .row))
                .fixedSize()

                // Clear
                Button {
                    appState.clearLogs()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "trash")
                            .font(.system(size: 11))
                        Text("Clear")
                            .font(.system(size: seaEnabled ? 15 : 12, weight: .medium))
                    }
                    .foregroundStyle(seaEnabled ? SeaTheme.danger : Color(hex: "FF6E52"))
                    .padding(.horizontal, seaEnabled ? 0 : 12)
                    .padding(.vertical, seaEnabled ? 0 : 6)
                    .background(seaEnabled ? .clear : .white.opacity(colorScheme == .dark ? 0.08 : 0.4), in: Capsule())
                    .overlay(Capsule().strokeBorder(Color(hex: "FF6E52").opacity(seaEnabled ? 0 : 0.3), lineWidth: 0.5))
                    .contentShape(Capsule())
                }
                .modifier(SeaActionStyle(variant: .danger, size: .row))
                .fixedSize()
            }
        }
    }

    // MARK: - Level Filter

    @ViewBuilder private var levelFilterRow: some View {
        if seaEnabled {
            SeaTabs(label: "Level", selection: Binding(
                get: { levelFilter?.capitalized ?? "All" },
                set: { levelFilter = $0 == "All" ? nil : $0.lowercased() }),
                options: ["All"] + Self.knownLevels.map(\.capitalized))
        } else {
            legacyLevelFilterRow
        }
    }

    private var legacyLevelFilterRow: some View {
        HStack(spacing: 3) {
            levelFilterChip(nil)
            ForEach(Self.knownLevels, id: \.self) { level in
                levelFilterChip(level)
            }
            Spacer(minLength: 0)
        }
        .padding(3)
        .background(.white.opacity(colorScheme == .dark ? 0.06 : 0.32), in: Capsule())
        .overlay(
            Capsule()
                .strokeBorder(.white.opacity(colorScheme == .dark ? 0.1 : 0.55), lineWidth: 0.5)
        )
        .fixedSize()
    }

    @ViewBuilder
    private func levelFilterChip(_ level: String?) -> some View {
        let isOn = levelFilter == level
        Button {
            levelFilter = level
        } label: {
            HStack(spacing: 4) {
                if let level {
                    Circle()
                        .fill(levelTint(level))
                        .frame(width: 5, height: 5)
                }
                Text(levelTitle(level))
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(isOn ? .primary : .secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(
                isOn ? (seaEnabled ? seaAccent : TonoBrand.accent).opacity(0.14) : .clear,
                in: Capsule()
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Log Row

    private func logRow(_ entry: LogEntry) -> some View {
        HStack(spacing: 0) {
            Text(entry.formattedTime)
                .font(.system(size: seaEnabled ? 12 : 11, design: seaEnabled ? .default : .monospaced)).monospacedDigit()
                .foregroundStyle(seaEnabled ? SeaTheme.tertiary : Color.secondary)
                .frame(width: 100, alignment: .leading)

            if seaEnabled {
                Text(levelTitle(entry.level))
                    .font(.system(size: 12))
                    .foregroundStyle(seaLevelTint(entry.level))
                    .frame(width: 80, alignment: .leading)
            } else {
            Text(entry.level.uppercased())
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(levelTint(entry.level))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(levelTint(entry.level).opacity(0.1), in: RoundedRectangle(cornerRadius: 4))
                .frame(width: 80, alignment: .leading)
            }

            Text(entry.message)
                .font(.system(size: seaEnabled ? 13 : 12, design: seaEnabled ? .default : .monospaced))
                .foregroundStyle(seaEnabled ? SeaTheme.text : Color.primary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 6)
    }

    // MARK: - Export

    private func exportLogs() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.plainText]
        panel.nameFieldStringValue = "clash-logs.txt"

        guard panel.runModal() == .OK, let url = panel.url else { return }

        let content = appState.logEntries.map { entry in
            "[\(entry.formattedTime)] [\(entry.level.uppercased())] \(entry.message)"
        }.joined(separator: "\n")

        do {
            try content.write(to: url, atomically: true, encoding: .utf8)
            ToastCenter.shared.show(
                String(localized: "Logs exported"),
                systemImage: "checkmark.circle.fill"
            )
        } catch {
            // A read-only destination, a full disk or a sandbox refusal all
            // land here, and a silent catch left the Export button looking
            // like it had written a file that is not there.
            ToastCenter.shared.show(
                String(localized: "Log export failed. \(error.localizedDescription)"),
                systemImage: "exclamationmark.triangle.fill"
            )
        }
    }
}

#Preview {
    ZStack {
        MeshGradientBackground()
        LogsView()
    }
    .frame(width: 900, height: 600)
    .environment({
        let state = AppState()
        state.logEntries = [
            LogEntry(level: "info", message: "Start initial compatible provider Auto", timestamp: Date()),
            LogEntry(level: "info", message: "Proxy [Tokyo-01] connected", timestamp: Date()),
            LogEntry(level: "warning", message: "DNS lookup timeout for example.com", timestamp: Date()),
            LogEntry(level: "error", message: "Failed to connect to 10.0.0.1:443", timestamp: Date()),
            LogEntry(level: "debug", message: "TCP connection established to 192.168.1.1:8080", timestamp: Date()),
        ]
        return state
    }())
}
